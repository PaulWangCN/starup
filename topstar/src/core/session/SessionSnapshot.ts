/**
 * 会话快照管理器
 * 实现会话快照的创建、加载、恢复和管理
 */

import * as fs from 'fs';
import * as path from 'path';
import { Session, ConversationMessage } from '../../types';

/**
 * 实体信息
 */
export interface Entity {
  type: string;
  value: string;
  mentions: number;
}

/**
 * 任务信息
 */
export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: number;
}

/**
 * 会话快照结构
 */
export interface SessionSnapshot {
  sessionId: string;
  timestamp: number;
  version: string;
  summary: string;           // 对话摘要
  keyEntities: Entity[];     // 关键实体
  pendingTasks: Task[];      // 待办事项
  contextState: {            // 上下文状态
    currentIntent?: string;
    slots: Record<string, any>;
    context_carry: boolean;
    ttl: number;
  };
}

/**
 * 会话快照管理器
 * 负责创建、存储和管理会话快照
 */
export class SessionSnapshotManager {
  private snapshotDir: string;

  /**
   * 构造函数
   * @param snapshotDir 快照存储目录，默认为 ~/.starup/snapshots/
   */
  constructor(snapshotDir?: string) {
    // 默认使用用户主目录下的 .starup/snapshots
    const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
    this.snapshotDir = snapshotDir || path.join(homeDir, '.starup', 'snapshots');
    
    // 确保目录存在
    this.ensureDirectoryExists();
  }

  /**
   * 创建快照（每10轮对话或Heartbeat时调用）
   * @param session 当前会话
   * @returns 创建的快照
   */
  async createSnapshot(session: Session): Promise<SessionSnapshot> {
    const snapshot: SessionSnapshot = {
      sessionId: session.id,
      timestamp: Date.now(),
      version: '1.1',
      summary: this.generateSummary(session.context.messages),
      keyEntities: this.extractEntities(session.context.messages),
      pendingTasks: this.extractPendingTasks(session),
      contextState: {
        currentIntent: this.detectCurrentIntent(session),
        slots: this.extractSlots(session),
        context_carry: true,
        ttl: 86400, // 默认24小时
      },
    };

    // 保存快照到文件
    await this.saveSnapshot(snapshot);
    
    console.log(`[SessionSnapshotManager] Snapshot created for session ${session.id}`);
    return snapshot;
  }

  /**
   * 加载快照
   * @param sessionId 会话ID
   * @param timestamp 可选，指定时间戳的快照
   * @returns 快照或 null
   */
  async loadSnapshot(sessionId: string, timestamp?: number): Promise<SessionSnapshot | null> {
    try {
      let snapshotPath: string;
      
      if (timestamp) {
        // 加载指定时间戳的快照
        snapshotPath = path.join(this.snapshotDir, `${sessionId}_${timestamp}.json`);
      } else {
        // 加载最新的快照
        const snapshots = await this.listSnapshots(sessionId);
        if (snapshots.length === 0) {
          return null;
        }
        // 按时间戳排序，取最新的
        const latest = snapshots.sort((a, b) => b.timestamp - a.timestamp)[0];
        snapshotPath = path.join(this.snapshotDir, `${sessionId}_${latest.timestamp}.json`);
      }

      if (!fs.existsSync(snapshotPath)) {
        return null;
      }

      const data = await fs.promises.readFile(snapshotPath, 'utf-8');
      const snapshot: SessionSnapshot = JSON.parse(data);
      
      console.log(`[SessionSnapshotManager] Snapshot loaded from ${snapshotPath}`);
      return snapshot;
    } catch (error) {
      console.error(`[SessionSnapshotManager] Failed to load snapshot:`, error);
      return null;
    }
  }

  /**
   * 恢复快照到会话
   * @param sessionId 目标会话ID
   * @param snapshot 要恢复的快照
   */
  async restoreToSession(sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    // 注意：实际恢复逻辑需要根据具体应用实现
    // 这里提供基础框架
    console.log(`[SessionSnapshotManager] Restoring snapshot to session ${sessionId}`);
    console.log(`  - Summary: ${snapshot.summary}`);
    console.log(`  - Entities: ${snapshot.keyEntities.length}`);
    console.log(`  - Tasks: ${snapshot.pendingTasks.length}`);
    console.log(`  - Intent: ${snapshot.contextState.currentIntent || 'none'}`);
    
    // 实际应用中，这里应该调用 sessionManager 来更新会话状态
  }

  /**
   * 列出历史快照
   * @param sessionId 会话ID
   * @returns 快照列表
   */
  async listSnapshots(sessionId: string): Promise<SessionSnapshot[]> {
    try {
      if (!fs.existsSync(this.snapshotDir)) {
        return [];
      }

      const files = await fs.promises.readdir(this.snapshotDir);
      const snapshots: SessionSnapshot[] = [];

      for (const file of files) {
        if (file.startsWith(`${sessionId}_`) && file.endsWith('.json')) {
          try {
            const filePath = path.join(this.snapshotDir, file);
            const data = await fs.promises.readFile(filePath, 'utf-8');
            const snapshot: SessionSnapshot = JSON.parse(data);
            snapshots.push(snapshot);
          } catch (error) {
            console.warn(`[SessionSnapshotManager] Failed to parse snapshot file: ${file}`);
          }
        }
      }

      return snapshots.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      console.error(`[SessionSnapshotManager] Failed to list snapshots:`, error);
      return [];
    }
  }

  /**
   * 清理过期快照
   * @param sessionId 会话ID
   * @param maxAge 最大年龄（毫秒）
   */
  async cleanExpiredSnapshots(sessionId: string, maxAge: number): Promise<void> {
    try {
      const snapshots = await this.listSnapshots(sessionId);
      const now = Date.now();
      let deletedCount = 0;

      for (const snapshot of snapshots) {
        if (now - snapshot.timestamp > maxAge) {
          const snapshotPath = path.join(
            this.snapshotDir,
            `${sessionId}_${snapshot.timestamp}.json`
          );
          if (fs.existsSync(snapshotPath)) {
            await fs.promises.unlink(snapshotPath);
            deletedCount++;
          }
        }
      }

      console.log(`[SessionSnapshotManager] Cleaned ${deletedCount} expired snapshots for ${sessionId}`);
    } catch (error) {
      console.error(`[SessionSnapshotManager] Failed to clean expired snapshots:`, error);
    }
  }

  /**
   * 清理所有过期快照（按会话）
   * @param maxAge 最大年龄（毫秒），默认7天
   */
  async cleanAllExpiredSnapshots(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    try {
      if (!fs.existsSync(this.snapshotDir)) {
        return;
      }

      const files = await fs.promises.readdir(this.snapshotDir);
      const now = Date.now();
      let deletedCount = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(this.snapshotDir, file);
            const stat = await fs.promises.stat(filePath);
            
            if (now - stat.mtime.getTime() > maxAge) {
              await fs.promises.unlink(filePath);
              deletedCount++;
            }
          } catch (error) {
            console.warn(`[SessionSnapshotManager] Failed to process file: ${file}`);
          }
        }
      }

      console.log(`[SessionSnapshotManager] Cleaned ${deletedCount} total expired snapshots`);
    } catch (error) {
      console.error(`[SessionSnapshotManager] Failed to clean all expired snapshots:`, error);
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 生成对话摘要
   * 使用简单的启发式规则：提取用户和助手的最近几条关键消息
   */
  private generateSummary(messages: ConversationMessage[]): string {
    if (messages.length === 0) {
      return 'Empty conversation';
    }

    // 过滤掉系统消息
    const userAndAssistantMessages = messages.filter(
      (m) => m.role === 'user' || m.role === 'assistant'
    );

    if (userAndAssistantMessages.length === 0) {
      return 'System initialization';
    }

    // 取最近的几条消息生成摘要
    const recentMessages = userAndAssistantMessages.slice(-5);
    const summaries: string[] = [];

    for (const msg of recentMessages) {
      const content = msg.content.substring(0, 100); // 限制长度
      const prefix = msg.role === 'user' ? 'User' : 'Assistant';
      summaries.push(`${prefix}: ${content}${msg.content.length > 100 ? '...' : ''}`);
    }

    return summaries.join(' | ');
  }

  /**
   * 提取关键实体
   * 使用简单的关键词匹配规则
   */
  private extractEntities(messages: ConversationMessage[]): Entity[] {
    const entityMap = new Map<string, { type: string; count: number }>();
    
    // 定义实体类型模式
    const patterns: { type: string; regex: RegExp }[] = [
      { type: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
      { type: 'url', regex: /https?:\/\/[^\s]+/g },
      { type: 'file_path', regex: /(?:[\w]:)?[\/\\][\w\-\.\/\\]+/g },
      { type: 'code_block', regex: /```[\s\S]*?```/g },
      { type: 'mention', regex: /@\w+/g },
      { type: 'hashtag', regex: /#\w+/g },
    ];

    for (const message of messages) {
      for (const { type, regex } of patterns) {
        const matches = message.content.match(regex);
        if (matches) {
          for (const match of matches) {
            const key = `${type}:${match}`;
            const existing = entityMap.get(key);
            if (existing) {
              existing.count++;
            } else {
              entityMap.set(key, { type, count: 1 });
            }
          }
        }
      }
    }

    // 转换为数组并按提及次数排序
    const entities: Entity[] = Array.from(entityMap.entries())
      .map(([key, value]) => ({
        type: value.type,
        value: key.split(':')[1],
        mentions: value.count,
      }))
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 20); // 限制数量

    return entities;
  }

  /**
   * 提取待办任务
   * 从会话中识别可能的任务项
   */
  private extractPendingTasks(session: Session): Task[] {
    const tasks: Task[] = [];
    const messages = session.context.messages;

    // 简单的任务识别模式
    const taskPatterns = [
      /TODO[:\s]+(.+?)(?:\n|$)/gi,
      /任务[:\s]+(.+?)(?:\n|$)/gi,
      /待办[:\s]+(.+?)(?:\n|$)/gi,
      /需要[:\s]+(.+?)(?:\n|$)/gi,
    ];

    for (const message of messages) {
      for (const pattern of taskPatterns) {
        let match;
        while ((match = pattern.exec(message.content)) !== null) {
          tasks.push({
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            description: match[1].trim(),
            status: 'pending',
            createdAt: message.timestamp,
          });
        }
      }
    }

    return tasks;
  }

  /**
   * 检测当前意图
   */
  private detectCurrentIntent(session: Session): string | undefined {
    // 从最近的消息中检测意图
    // 实际应用中可能使用更复杂的NLP处理
    const lastUserMessage = [...session.context.messages]
      .reverse()
      .find((m) => m.role === 'user');

    if (!lastUserMessage) {
      return undefined;
    }

    // 简单的意图关键词匹配
    const content = lastUserMessage.content.toLowerCase();
    
    if (content.includes('搜索') || content.includes('search') || content.includes('find')) {
      return 'search';
    }
    if (content.includes('写') || content.includes('write') || content.includes('code')) {
      return 'code_generation';
    }
    if (content.includes('分析') || content.includes('analyze')) {
      return 'analysis';
    }
    if (content.includes('解释') || content.includes('explain')) {
      return 'explanation';
    }

    return 'general';
  }

  /**
   * 提取槽位信息
   */
  private extractSlots(session: Session): Record<string, any> {
    const slots: Record<string, any> = {};
    
    // 简单的槽位提取逻辑
    // 实际应用中可能需要更复杂的解析
    const lastMessages = session.context.messages.slice(-3);
    
    for (const message of lastMessages) {
      // 提取键值对模式
      const kvPattern = /(\w+)[:：]\s*(.+?)(?:\n|$)/g;
      let match;
      while ((match = kvPattern.exec(message.content)) !== null) {
        slots[match[1].trim()] = match[2].trim();
      }
    }

    return slots;
  }

  /**
   * 保存快照到文件
   */
  private async saveSnapshot(snapshot: SessionSnapshot): Promise<void> {
    const filename = `${snapshot.sessionId}_${snapshot.timestamp}.json`;
    const filepath = path.join(this.snapshotDir, filename);
    
    await fs.promises.writeFile(filepath, JSON.stringify(snapshot, null, 2), 'utf-8');
  }

  /**
   * 确保目录存在
   */
  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.snapshotDir)) {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
      console.log(`[SessionSnapshotManager] Created snapshot directory: ${this.snapshotDir}`);
    }
  }
}

// 单例导出
export const sessionSnapshotManager = new SessionSnapshotManager();
