/**
 * StarUp 数据库管理器
 * 使用 SQLite 持久化会话、任务和状态
 * 支持自我恢复和 KAIROS 模式
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import { logger, safeStringify } from '../../utils/Logger';

export interface SessionRecord {
  id: string;
  type: 'main' | 'sub' | 'acp';
  status: 'active' | 'idle' | 'completed' | 'error';
  parentId?: string;
  createdAt: number;
  updatedAt: number;
  context: string; // JSON serialized ConversationContext
  metadata: string; // JSON serialized metadata
}

export interface SessionSnapshot {
  id: string;
  sessionId: string;
  timestamp: number;
  messages: string; // JSON serialized messages
  summary?: string;
  tokenCount: number;
  checksum: string;
}

export interface PendingTask {
  id: string;
  sessionId: string;
  type: 'tool_call' | 'sub_agent' | 'compact';
  payload: string; // JSON serialized task data
  status: 'pending' | 'running' | 'completed' | 'failed';
  retryCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface SystemState {
  key: string;
  value: string;
  updatedAt: number;
}

export class StarUpDatabase {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), '.starup', 'starup.db');
  }

  /**
   * 初始化数据库
   */
  async initialize(): Promise<void> {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL'); // 启用 WAL 模式，提高并发性能
      this.db.pragma('synchronous = NORMAL'); // 平衡性能和数据安全
      
      this.createTables();
      logger.info('Database', `Initialized at ${this.dbPath}`);
    } catch (error) {
      logger.error('Database', `Failed to initialize: ${error}`);
      throw error;
    }
  }

  /**
   * 创建表结构
   */
  private createTables(): void {
    if (!this.db) return;

    // 会话表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        parent_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        context TEXT NOT NULL DEFAULT '{}',
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (parent_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
    `);

    // 会话快照表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        messages TEXT NOT NULL,
        summary TEXT,
        token_count INTEGER NOT NULL DEFAULT 0,
        checksum TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_session ON session_snapshots(session_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON session_snapshots(timestamp);
    `);

    // 待处理任务表（用于恢复）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_session ON pending_tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON pending_tasks(status);
    `);

    // 系统状态表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // KAIROS 日志表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kairos_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_kairos_time ON kairos_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_kairos_level ON kairos_logs(level);
    `);

    logger.debug('Database', 'Tables created successfully');
  }

  // ==================== Session 操作 ====================

  /**
   * 保存或更新会话
   */
  saveSession(session: SessionRecord): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, type, status, parent_id, created_at, updated_at, context, metadata)
      VALUES (@id, @type, @status, @parentId, @createdAt, @updatedAt, @context, @metadata)
      ON CONFLICT(id) DO UPDATE SET
        status = @status,
        updated_at = @updatedAt,
        context = @context,
        metadata = @metadata
    `);

    stmt.run(session);
  }

  /**
   * 获取会话
   */
  getSession(id: string): SessionRecord | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as any;
    
    if (!row) return null;
    
    return this.mapSessionRow(row);
  }

  /**
   * 获取所有活跃会话
   */
  getActiveSessions(): SessionRecord[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare("SELECT * FROM sessions WHERE status = 'active'");
    const rows = stmt.all() as any[];
    
    return rows.map(row => this.mapSessionRow(row));
  }

  /**
   * 删除会话
   */
  deleteSession(id: string): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(id);
  }

  // ==================== Snapshot 操作 ====================

  /**
   * 保存会话快照
   */
  saveSnapshot(snapshot: SessionSnapshot): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO session_snapshots (id, session_id, timestamp, messages, summary, token_count, checksum)
      VALUES (@id, @sessionId, @timestamp, @messages, @summary, @tokenCount, @checksum)
    `);

    stmt.run(snapshot);

    // 只保留最近 10 个快照
    this.cleanupOldSnapshots(snapshot.sessionId, 10);
  }

  /**
   * 获取会话最新快照
   */
  getLatestSnapshot(sessionId: string): SessionSnapshot | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM session_snapshots 
      WHERE session_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 1
    `);
    
    const row = stmt.get(sessionId) as any;
    if (!row) return null;

    return this.mapSnapshotRow(row);
  }

  /**
   * 清理旧快照
   */
  private cleanupOldSnapshots(sessionId: string, keepCount: number): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      DELETE FROM session_snapshots 
      WHERE session_id = ? 
      AND id NOT IN (
        SELECT id FROM session_snapshots 
        WHERE session_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      )
    `);

    stmt.run(sessionId, sessionId, keepCount);
  }

  // ==================== Pending Tasks 操作 ====================

  /**
   * 添加待处理任务
   */
  addPendingTask(task: Omit<PendingTask, 'id' | 'createdAt' | 'updatedAt'>): string {
    if (!this.db) throw new Error('Database not initialized');

    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO pending_tasks (id, session_id, type, payload, status, retry_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, task.sessionId, task.type, task.payload, task.status, task.retryCount, now, now);
    
    return id;
  }

  /**
   * 获取待处理任务
   */
  getPendingTasks(sessionId?: string): PendingTask[] {
    if (!this.db) throw new Error('Database not initialized');

    let stmt;
    if (sessionId) {
      stmt = this.db.prepare(`
        SELECT * FROM pending_tasks 
        WHERE session_id = ? AND status IN ('pending', 'failed')
        ORDER BY created_at ASC
      `);
      const rows = stmt.all(sessionId) as any[];
      return rows.map(row => this.mapTaskRow(row));
    } else {
      stmt = this.db.prepare(`
        SELECT * FROM pending_tasks 
        WHERE status IN ('pending', 'failed')
        ORDER BY created_at ASC
      `);
      const rows = stmt.all() as any[];
      return rows.map(row => this.mapTaskRow(row));
    }
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(id: string, status: PendingTask['status']): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      UPDATE pending_tasks 
      SET status = ?, updated_at = ?, retry_count = retry_count + 1
      WHERE id = ?
    `);

    stmt.run(status, Date.now(), id);
  }

  /**
   * 删除已完成任务
   */
  removeCompletedTasks(): void {
    if (!this.db) return;

    const stmt = this.db.prepare("DELETE FROM pending_tasks WHERE status IN ('completed', 'failed') AND retry_count >= 3");
    stmt.run();
  }

  // ==================== System State 操作 ====================

  /**
   * 设置系统状态
   */
  setSystemState(key: string, value: string): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO system_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    stmt.run(key, value, Date.now());
  }

  /**
   * 获取系统状态
   */
  getSystemState(key: string): string | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT value FROM system_state WHERE key = ?');
    const row = stmt.get(key) as any;
    
    return row?.value || null;
  }

  /**
   * 获取所有系统状态
   */
  getAllSystemState(): Record<string, string> {
    if (!this.db) return {};

    const stmt = this.db.prepare('SELECT key, value FROM system_state');
    const rows = stmt.all() as any[];
    
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    
    return result;
  }

  // ==================== KAIROS Logs ====================

  /**
   * 记录 KAIROS 日志
   */
  logKairos(level: 'debug' | 'info' | 'warn' | 'error', category: string, message: string, metadata?: object): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT INTO kairos_logs (timestamp, level, category, message, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(Date.now(), level, category, message, metadata ? safeStringify(metadata) : null);
  }

  /**
   * 获取 KAIROS 日志
   */
  getKairosLogs(options: {
    level?: string;
    category?: string;
    since?: number;
    limit?: number;
  } = {}): Array<{timestamp: number; level: string; category: string; message: string; metadata?: object}> {
    if (!this.db) return [];

    let sql = 'SELECT * FROM kairos_logs WHERE 1=1';
    const params: any[] = [];

    if (options.level) {
      sql += ' AND level = ?';
      params.push(options.level);
    }

    if (options.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }

    if (options.since) {
      sql += ' AND timestamp >= ?';
      params.push(options.since);
    }

    sql += ' ORDER BY timestamp DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      timestamp: row.timestamp,
      level: row.level,
      category: row.category,
      message: row.message,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  /**
   * 清理旧日志
   */
  cleanupOldLogs(olderThanDays: number = 7): void {
    if (!this.db) return;

    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare('DELETE FROM kairos_logs WHERE timestamp < ?');
    const result = stmt.run(cutoff);
    
    logger.debug('Database', `Cleaned up ${result.changes} old KAIROS logs`);
  }

  // ==================== 工具方法 ====================

  private mapSessionRow(row: any): SessionRecord {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      parentId: row.parent_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      context: row.context,
      metadata: row.metadata,
    };
  }

  private mapSnapshotRow(row: any): SessionSnapshot {
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      messages: row.messages,
      summary: row.summary,
      tokenCount: row.token_count,
      checksum: row.checksum,
    };
  }

  private mapTaskRow(row: any): PendingTask {
    return {
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      payload: row.payload,
      status: row.status,
      retryCount: row.retry_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 关闭数据库
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('Database', 'Closed');
    }
  }
}

// 单例导出
export const starupDB = new StarUpDatabase();
