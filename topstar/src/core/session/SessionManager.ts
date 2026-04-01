import { v4 as uuidv4 } from 'uuid';
import {
  Session,
  SessionType,
  SessionStatus,
  SpawnOptions,
  ConversationContext,
  ConversationMessage,
} from '../../types';

/**
 * 会话管理器
 * 负责管理主会话和子代理的生命周期
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private mainSessionId: string | null = null;

  /**
   * 初始化主会话
   * @param systemPrompt 可选的系统提示词
   */
  initializeMainSession(systemPrompt?: string): Session {
    const messages: ConversationMessage[] = [];
    
    // 如果提供了系统提示词，添加到会话开头
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
      });
      console.log('[SessionManager] System prompt injected');
    }

    const session: Session = {
      id: uuidv4(),
      type: 'main',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      context: {
        messages,
        tokenCount: 0,
        compressed: false,
      },
      memory: {
        shortTerm: [],
        dailyLog: this.getDailyLogPath(),
        longTerm: 'MEMORY.md',
      },
      allowedTools: ['read', 'write', 'edit', 'exec', 'web_search'],
      memoryAccess: 'write',
      timeout: 300,
      callbackToParent: false,
    };

    this.sessions.set(session.id, session);
    this.mainSessionId = session.id;
    
    console.log(`[SessionManager] Main session created: ${session.id}`);
    return session;
  }

  /**
   * 创建子代理会话
   */
  spawnSubAgent(parentId: string, options: SpawnOptions): Session {
    const parent = this.sessions.get(parentId);
    if (!parent) {
      throw new Error(`Parent session ${parentId} not found`);
    }

    const session: Session = {
      id: uuidv4(),
      type: 'sub',
      status: 'active',
      parentId: parentId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      context: {
        messages: [
          {
            role: 'system',
            content: `You are a sub-agent. Task: ${options.task}`,
            timestamp: Date.now(),
          },
        ],
        tokenCount: 0,
        compressed: false,
      },
      memory: {
        shortTerm: [],
        dailyLog: this.getDailyLogPath(),
        longTerm: '', // 子代理不直接访问长期记忆
      },
      allowedTools: options.tools || ['read', 'web_search'],
      memoryAccess: options.memory_access || 'none',
      timeout: options.timeout || 300,
      callbackToParent: options.parent_callback ?? true,
    };

    this.sessions.set(session.id, session);
    console.log(`[SessionManager] Sub-agent spawned: ${session.id} (parent: ${parentId})`);
    
    // 启动超时处理
    this.setupTimeout(session);
    
    return session;
  }

  /**
   * 获取主会话
   */
  getMainSession(): Session | null {
    if (!this.mainSessionId) return null;
    return this.sessions.get(this.mainSessionId) || null;
  }

  /**
   * 获取指定会话
   */
  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /**
   * 获取所有活跃会话
   */
  getActiveSessions(): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === 'active'
    );
  }

  /**
   * 更新会话上下文
   */
  addMessage(sessionId: string, message: ConversationMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.context.messages.push(message);
    session.updatedAt = Date.now();

    // 检查是否需要压缩
    this.checkCompression(session);
  }

  /**
   * 完成子代理任务
   */
  completeSubAgent(sessionId: string, result: any): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.type !== 'sub') {
      throw new Error(`Sub-agent session ${sessionId} not found`);
    }

    session.status = 'completed';
    session.updatedAt = Date.now();

    // 回流结果到父会话
    if (session.callbackToParent && session.parentId) {
      const parent = this.sessions.get(session.parentId);
      if (parent) {
        this.addMessage(parent.id, {
          role: 'system',
          content: `Sub-agent (${sessionId}) completed. Result: ${JSON.stringify(result)}`,
          timestamp: Date.now(),
        });
      }
    }

    console.log(`[SessionManager] Sub-agent completed: ${sessionId}`);
  }

  /**
   * 销毁会话
   */
  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // 子代理需要回流结果
    if (session.type === 'sub' && session.status === 'active') {
      this.completeSubAgent(sessionId, { status: 'destroyed' });
    }

    this.sessions.delete(sessionId);
    console.log(`[SessionManager] Session destroyed: ${sessionId}`);
  }

  /**
   * 向指定会话发送消息
   */
  sendToSession(toSessionId: string, message: string): void {
    const session = this.sessions.get(toSessionId);
    if (!session) {
      throw new Error(`Session ${toSessionId} not found`);
    }

    this.addMessage(toSessionId, {
      role: 'system',
      content: message,
      timestamp: Date.now(),
    });
  }

  /**
   * 广播消息到所有活跃会话
   */
  broadcast(message: string): void {
    const activeSessions = this.getActiveSessions();
    for (const session of activeSessions) {
      this.addMessage(session.id, {
        role: 'system',
        content: message,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 获取会话统计信息
   */
  getStats(): { total: number; active: number; subAgents: number } {
    const sessions = Array.from(this.sessions.values());
    return {
      total: sessions.length,
      active: sessions.filter((s) => s.status === 'active').length,
      subAgents: sessions.filter((s) => s.type === 'sub').length,
    };
  }

  // ==================== 私有方法 ====================

  private getDailyLogPath(): string {
    const date = new Date().toISOString().split('T')[0];
    return `memory/${date}.md`;
  }

  private setupTimeout(session: Session): void {
    setTimeout(() => {
      if (session.status === 'active') {
        console.warn(`[SessionManager] Sub-agent timeout: ${session.id}`);
        this.completeSubAgent(session.id, { 
          status: 'timeout', 
          error: `Task exceeded timeout of ${session.timeout}s` 
        });
      }
    }, session.timeout * 1000);
  }

  private checkCompression(session: Session): void {
    const threshold = 8000; // 8k tokens
    if (session.context.tokenCount > threshold && !session.context.compressed) {
      // 触发压缩（实际实现需要调用压缩服务）
      console.log(`[SessionManager] Session ${session.id} needs compression`);
      session.context.compressed = true;
    }
  }
}

// 单例导出
export const sessionManager = new SessionManager();
