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

// ==================== 监控指标类型 ====================

export interface ToolCallMetrics {
  id: string;
  tool_name: string;
  session_id: string;
  subagent_id?: string;
  args_summary: string;
  success: boolean;
  error_type?: string;
  error_message?: string;
  duration_ms: number;
  timestamp: number;
}

export interface SkillExecutionMetrics {
  id: string;
  skill_id: string;
  session_id: string;
  mission_id?: string;
  subagent_role?: string;
  steps_count: number;
  tool_calls_count: number;
  llm_calls_count: number;
  duration_ms: number;
  success: boolean;
  completed: boolean;
  timestamp: number;
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
        metadata TEXT NOT NULL DEFAULT '{}'
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
        checksum TEXT NOT NULL
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
        updated_at INTEGER NOT NULL
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

    // 工具调用监控表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_call_metrics (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        session_id TEXT NOT NULL,
        subagent_id TEXT,
        args_summary TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        error_type TEXT,
        error_message TEXT,
        duration_ms INTEGER NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tool_name ON tool_call_metrics(tool_name);
      CREATE INDEX IF NOT EXISTS idx_tool_session ON tool_call_metrics(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_timestamp ON tool_call_metrics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tool_success ON tool_call_metrics(success);
    `);

    // Skill 执行监控表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skill_execution_metrics (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        mission_id TEXT,
        subagent_role TEXT,
        steps_count INTEGER NOT NULL DEFAULT 0,
        tool_calls_count INTEGER NOT NULL DEFAULT 0,
        llm_calls_count INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL DEFAULT 1,
        completed INTEGER NOT NULL DEFAULT 1,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_skill_id ON skill_execution_metrics(skill_id);
      CREATE INDEX IF NOT EXISTS idx_skill_session ON skill_execution_metrics(session_id);
      CREATE INDEX IF NOT EXISTS idx_skill_timestamp ON skill_execution_metrics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_skill_success ON skill_execution_metrics(success);
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at,
        context = excluded.context,
        metadata = excluded.metadata
    `);

    stmt.run(
      session.id,
      session.type,
      session.status,
      session.parentId || null,
      session.createdAt,
      session.updatedAt,
      session.context,
      session.metadata
    );
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
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      snapshot.id,
      snapshot.sessionId,
      snapshot.timestamp,
      snapshot.messages,
      snapshot.summary || null,
      snapshot.tokenCount,
      snapshot.checksum
    );

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

  // ==================== 工具调用监控 ====================

  /**
   * 记录工具调用指标
   */
  recordToolCallMetrics(metrics: Omit<ToolCallMetrics, 'id'>): string {
    if (!this.db) throw new Error('Database not initialized');

    const id = `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const stmt = this.db.prepare(`
      INSERT INTO tool_call_metrics 
      (id, tool_name, session_id, subagent_id, args_summary, success, error_type, error_message, duration_ms, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      metrics.tool_name,
      metrics.session_id,
      metrics.subagent_id || null,
      metrics.args_summary || null,
      metrics.success ? 1 : 0,
      metrics.error_type || null,
      metrics.error_message || null,
      metrics.duration_ms,
      metrics.timestamp
    );

    return id;
  }

  /**
   * 获取工具调用统计
   */
  getToolCallStats(options: {
    since?: number;
    toolName?: string;
    limit?: number;
  } = {}): Array<{
    tool_name: string;
    total_calls: number;
    success_count: number;
    fail_count: number;
    avg_duration_ms: number;
    max_duration_ms: number;
    min_duration_ms: number;
  }> {
    if (!this.db) return [];

    let sql = `
      SELECT 
        tool_name,
        COUNT(*) as total_calls,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as fail_count,
        ROUND(AVG(duration_ms), 2) as avg_duration_ms,
        MAX(duration_ms) as max_duration_ms,
        MIN(duration_ms) as min_duration_ms
      FROM tool_call_metrics
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options.since) {
      sql += ' AND timestamp >= ?';
      params.push(options.since);
    }

    if (options.toolName) {
      sql += ' AND tool_name = ?';
      params.push(options.toolName);
    }

    sql += ' GROUP BY tool_name ORDER BY total_calls DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as any[];
  }

  /**
   * 获取工具错误分析
   */
  getToolErrorAnalysis(options: {
    since?: number;
    toolName?: string;
    limit?: number;
  } = {}): Array<{
    error_type: string;
    error_count: number;
    affected_tools: string;
    sample_error: string;
  }> {
    if (!this.db) return [];

    let sql = `
      SELECT 
        error_type,
        COUNT(*) as error_count,
        GROUP_CONCAT(DISTINCT tool_name) as affected_tools,
        MAX(error_message) as sample_error
      FROM tool_call_metrics
      WHERE success = 0 AND error_type IS NOT NULL
    `;
    const params: any[] = [];

    if (options.since) {
      sql += ' AND timestamp >= ?';
      params.push(options.since);
    }

    if (options.toolName) {
      sql += ' AND tool_name = ?';
      params.push(options.toolName);
    }

    sql += ' GROUP BY error_type ORDER BY error_count DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as any[];
  }

  /**
   * 获取最近失败的工具调用
   */
  getRecentFailedToolCalls(limit: number = 10): ToolCallMetrics[] {
    if (!this.db) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM tool_call_metrics 
      WHERE success = 0 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map(row => this.mapToolMetricsRow(row));
  }

  // ==================== Skill 执行监控 ====================

  /**
   * 记录 Skill 执行指标
   */
  recordSkillExecutionMetrics(metrics: Omit<SkillExecutionMetrics, 'id'>): string {
    if (!this.db) throw new Error('Database not initialized');

    const id = `skill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const stmt = this.db.prepare(`
      INSERT INTO skill_execution_metrics 
      (id, skill_id, session_id, mission_id, subagent_role, steps_count, tool_calls_count, 
       llm_calls_count, duration_ms, success, completed, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      metrics.skill_id,
      metrics.session_id,
      metrics.mission_id || null,
      metrics.subagent_role || null,
      metrics.steps_count,
      metrics.tool_calls_count,
      metrics.llm_calls_count,
      metrics.duration_ms,
      metrics.success ? 1 : 0,
      metrics.completed ? 1 : 0,
      metrics.timestamp
    );

    return id;
  }

  /**
   * 获取 Skill 执行统计
   */
  getSkillExecutionStats(options: {
    since?: number;
    skillId?: string;
    limit?: number;
  } = {}): Array<{
    skill_id: string;
    total_executions: number;
    success_count: number;
    fail_count: number;
    avg_steps: number;
    avg_tool_calls: number;
    avg_duration_ms: number;
    completion_rate: number;
  }> {
    if (!this.db) return [];

    let sql = `
      SELECT 
        skill_id,
        COUNT(*) as total_executions,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as fail_count,
        ROUND(AVG(steps_count), 2) as avg_steps,
        ROUND(AVG(tool_calls_count), 2) as avg_tool_calls,
        ROUND(AVG(duration_ms), 2) as avg_duration_ms,
        ROUND(100.0 * SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) / COUNT(*), 2) as completion_rate
      FROM skill_execution_metrics
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options.since) {
      sql += ' AND timestamp >= ?';
      params.push(options.since);
    }

    if (options.skillId) {
      sql += ' AND skill_id = ?';
      params.push(options.skillId);
    }

    sql += ' GROUP BY skill_id ORDER BY total_executions DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as any[];
  }

  /**
   * 获取 Subagent 角色效率统计
   */
  getSubagentRoleStats(options: {
    since?: number;
  } = {}): Array<{
    subagent_role: string;
    total_executions: number;
    avg_steps: number;
    avg_tool_calls: number;
    avg_duration_ms: number;
    success_rate: number;
  }> {
    if (!this.db) return [];

    let sql = `
      SELECT 
        COALESCE(subagent_role, 'unknown') as subagent_role,
        COUNT(*) as total_executions,
        ROUND(AVG(steps_count), 2) as avg_steps,
        ROUND(AVG(tool_calls_count), 2) as avg_tool_calls,
        ROUND(AVG(duration_ms), 2) as avg_duration_ms,
        ROUND(100.0 * SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
      FROM skill_execution_metrics
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options.since) {
      sql += ' AND timestamp >= ?';
      params.push(options.since);
    }

    sql += ' GROUP BY subagent_role ORDER BY total_executions DESC';

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as any[];
  }

  /**
   * 清理旧的监控数据
   */
  cleanupOldMetrics(olderThanDays: number = 30): void {
    if (!this.db) return;

    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    const toolStmt = this.db.prepare('DELETE FROM tool_call_metrics WHERE timestamp < ?');
    const toolResult = toolStmt.run(cutoff);
    
    const skillStmt = this.db.prepare('DELETE FROM skill_execution_metrics WHERE timestamp < ?');
    const skillResult = skillStmt.run(cutoff);
    
    logger.debug('Database', `Cleaned up ${toolResult.changes} tool metrics and ${skillResult.changes} skill metrics`);
  }

  // ==================== 工具方法 ====================

  private mapToolMetricsRow(row: any): ToolCallMetrics {
    return {
      id: row.id,
      tool_name: row.tool_name,
      session_id: row.session_id,
      subagent_id: row.subagent_id,
      args_summary: row.args_summary,
      success: row.success === 1,
      error_type: row.error_type,
      error_message: row.error_message,
      duration_ms: row.duration_ms,
      timestamp: row.timestamp,
    };
  }

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
