/**
 * 会话持久化管理器
 * 自动保存和恢复会话状态，支持崩溃恢复
 */

import * as crypto from 'crypto';
import { Session, ConversationMessage } from '../../types';
import { starupDB } from './Database';
import { logger, safeStringify } from '../../utils/Logger';

export interface PersistedSession {
  session: Session;
  messages: ConversationMessage[];
  timestamp: number;
}

export class SessionPersistence {
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private readonly SAVE_INTERVAL = 30000; // 30 秒自动保存
  private activeSessions: Map<string, Session> = new Map();

  /**
   * 初始化持久化管理器
   */
  async initialize(): Promise<void> {
    await starupDB.initialize();
    this.startAutoSave();
    logger.info('SessionPersistence', 'Initialized');
  }

  /**
   * 注册会话进行自动保存
   */
  registerSession(session: Session): void {
    this.activeSessions.set(session.id, session);
    
    // 立即保存一次
    this.saveSession(session);
    
    logger.debug('SessionPersistence', `Registered session ${session.id} for auto-save`);
  }

  /**
   * 取消注册会话
   */
  unregisterSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    
    // 更新会话状态为已完成
    const record = starupDB.getSession(sessionId);
    if (record) {
      record.status = 'completed';
      record.updatedAt = Date.now();
      starupDB.saveSession(record);
    }
    
    logger.debug('SessionPersistence', `Unregistered session ${sessionId}`);
  }

  /**
   * 保存会话到数据库
   */
  saveSession(session: Session): void {
    try {
      starupDB.saveSession({
        id: session.id,
        type: session.type,
        status: session.status,
        parentId: session.parentId,
        createdAt: session.createdAt,
        updatedAt: Date.now(),
        context: safeStringify(session.context),
        metadata: safeStringify({
          allowedTools: session.allowedTools,
          memoryAccess: session.memoryAccess,
          timeout: session.timeout,
          callbackToParent: session.callbackToParent,
        }),
      });
    } catch (error) {
      logger.error('SessionPersistence', `Failed to save session ${session.id}: ${error}`);
    }
  }

  /**
   * 创建会话快照
   */
  createSnapshot(session: Session, summary?: string): void {
    try {
      const messages = safeStringify(session.context.messages);
      const checksum = crypto.createHash('sha256').update(messages).digest('hex');
      
      starupDB.saveSnapshot({
        id: `${session.id}-${Date.now()}`,
        sessionId: session.id,
        timestamp: Date.now(),
        messages,
        summary,
        tokenCount: session.context.tokenCount,
        checksum,
      });

      logger.debug('SessionPersistence', `Created snapshot for session ${session.id}`);
    } catch (error) {
      logger.error('SessionPersistence', `Failed to create snapshot: ${error}`);
    }
  }

  /**
   * 从快照恢复会话
   */
  restoreFromSnapshot(sessionId: string): PersistedSession | null {
    try {
      const snapshot = starupDB.getLatestSnapshot(sessionId);
      if (!snapshot) return null;

      const record = starupDB.getSession(sessionId);
      if (!record) return null;

      // 验证校验和
      const checksum = crypto.createHash('sha256').update(snapshot.messages).digest('hex');
      if (checksum !== snapshot.checksum) {
        logger.warn('SessionPersistence', `Checksum mismatch for session ${sessionId}`);
        return null;
      }

      const metadata = JSON.parse(record.metadata);
      const context = JSON.parse(record.context);

      const session: Session = {
        id: record.id,
        type: record.type,
        status: 'active',
        parentId: record.parentId,
        createdAt: record.createdAt,
        updatedAt: Date.now(),
        context: {
          ...context,
          messages: JSON.parse(snapshot.messages),
        },
        memory: {
          shortTerm: [],
          dailyLog: '',
          longTerm: '',
        },
        allowedTools: metadata.allowedTools || [],
        memoryAccess: metadata.memoryAccess || 'none',
        timeout: metadata.timeout || 300,
        callbackToParent: metadata.callbackToParent || false,
      };

      return {
        session,
        messages: JSON.parse(snapshot.messages),
        timestamp: snapshot.timestamp,
      };
    } catch (error) {
      logger.error('SessionPersistence', `Failed to restore session ${sessionId}: ${error}`);
      return null;
    }
  }

  /**
   * 获取需要恢复的会话（崩溃后）
   */
  getSessionsToRecover(): PersistedSession[] {
    const records = starupDB.getActiveSessions();
    const toRecover: PersistedSession[] = [];

    for (const record of records) {
      const restored = this.restoreFromSnapshot(record.id);
      if (restored) {
        toRecover.push(restored);
      }
    }

    return toRecover;
  }

  /**
   * 记录待处理任务（用于恢复）
   */
  recordPendingTask(
    sessionId: string,
    type: 'tool_call' | 'sub_agent' | 'compact',
    payload: object
  ): string {
    return starupDB.addPendingTask({
      sessionId,
      type,
      payload: safeStringify(payload),
      status: 'pending',
      retryCount: 0,
    });
  }

  /**
   * 完成任务
   */
  completeTask(taskId: string): void {
    starupDB.updateTaskStatus(taskId, 'completed');
  }

  /**
   * 标记任务失败
   */
  failTask(taskId: string): void {
    starupDB.updateTaskStatus(taskId, 'failed');
  }

  /**
   * 获取待处理任务
   */
  getPendingTasks(sessionId?: string): Array<{
    id: string;
    sessionId: string;
    type: string;
    payload: object;
    retryCount: number;
  }> {
    const tasks = starupDB.getPendingTasks(sessionId);
    return tasks.map(task => ({
      id: task.id,
      sessionId: task.sessionId,
      type: task.type,
      payload: JSON.parse(task.payload),
      retryCount: task.retryCount,
    }));
  }

  /**
   * 启动自动保存
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) return;

    this.autoSaveInterval = setInterval(() => {
      for (const [id, session] of this.activeSessions) {
        this.saveSession(session);
        this.createSnapshot(session);
      }
    }, this.SAVE_INTERVAL);
    (this.autoSaveInterval as any).unref();

    logger.debug('SessionPersistence', `Auto-save started (${this.SAVE_INTERVAL}ms interval)`);
  }

  /**
   * 停止自动保存
   */
  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      logger.debug('SessionPersistence', 'Auto-save stopped');
    }
  }

  /**
   * 关闭持久化管理器
   */
  async shutdown(): Promise<void> {
    this.stopAutoSave();
    
    // 最后保存一次所有活跃会话
    for (const [id, session] of this.activeSessions) {
      this.saveSession(session);
      this.createSnapshot(session);
    }

    // 清理已完成任务
    starupDB.removeCompletedTasks();
    
    // 清理旧日志
    starupDB.cleanupOldLogs(7);

    starupDB.close();
    logger.info('SessionPersistence', 'Shutdown complete');
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    activeSessions: number;
    pendingTasks: number;
  } {
    try {
      return {
        activeSessions: this.activeSessions.size,
        pendingTasks: starupDB.getPendingTasks().length,
      };
    } catch {
      // 数据库未初始化时返回默认值
      return {
        activeSessions: this.activeSessions.size,
        pendingTasks: 0,
      };
    }
  }
}

// 单例导出
export const sessionPersistence = new SessionPersistence();
