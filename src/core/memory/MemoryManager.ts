import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryEntry, Session } from '../../types';

/**
 * 内存管理器
 * 管理四级记忆架构：短期、日记忆、长期记忆、项目文件
 */
export class MemoryManager {
  private memoryDir: string;
  private longTermFile: string = 'MEMORY.md';

  constructor() {
    this.memoryDir = path.join(process.env.HOME || '.', '.starup', 'memory');
    this.ensureDirectories();
  }

  /**
   * 确保目录结构存在
   */
  async ensureDirectories(): Promise<void> {
    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
    } catch (error) {
      console.error('[MemoryManager] Failed to create memory directory:', error);
    }
  }

  /**
   * 获取日记忆文件路径
   */
  getDailyLogPath(): string {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.memoryDir, `${date}.md`);
  }

  /**
   * 读取日记忆
   */
  async readDailyLog(date?: string): Promise<string> {
    const filePath = date 
      ? path.join(this.memoryDir, `${date}.md`)
      : this.getDailyLogPath();
    
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      // 文件不存在返回空内容
      return '';
    }
  }

  /**
   * 写入日记忆
   */
  async writeDailyLog(entry: MemoryEntry): Promise<void> {
    const filePath = this.getDailyLogPath();
    const content = await this.readDailyLog();
    
    const entryText = `
## ${entry.topic}
${entry.summary}

_重要性: ${entry.importance}/10 | 时间: ${new Date(entry.timestamp).toLocaleString()}_

---
`;

    const newContent = content + entryText;
    await fs.writeFile(filePath, newContent, 'utf-8');
  }

  /**
   * 读取长期记忆
   */
  async readLongTermMemory(): Promise<string> {
    try {
      return await fs.readFile(this.longTermFile, 'utf-8');
    } catch (error) {
      return '';
    }
  }

  /**
   * 更新长期记忆
   */
  async updateLongTermMemory(content: string): Promise<void> {
    await fs.writeFile(this.longTermFile, content, 'utf-8');
  }

  /**
   * 添加长期记忆条目
   */
  async appendToLongTermMemory(topic: string, content: string): Promise<void> {
    const existing = await this.readLongTermMemory();
    const entry = `
## ${topic}
${content}

---
`;
    await this.updateLongTermMemory(existing + entry);
  }

  /**
   * 语义搜索记忆
   * （需要接入向量数据库）
   */
  async semanticSearch(query: string, limit: number = 5): Promise<any[]> {
    // TODO: 接入 ChromaDB 或 Pinecone
    console.log(`[MemoryManager] Semantic search: ${query} (limit: ${limit})`);
    return [];
  }

  /**
   * 获取相关记忆并注入上下文
   */
  async injectRelevantMemories(context: string, session: Session): Promise<string[]> {
    // 从上下文中提取关键词
    const keywords = this.extractKeywords(context);
    
    // 搜索相关记忆
    const memories: string[] = [];
    
    // 读取近期日记忆
    const recentLogs = await this.getRecentDailyLogs(7);
    for (const log of recentLogs) {
      if (keywords.some(k => log.toLowerCase().includes(k.toLowerCase()))) {
        memories.push(log);
      }
    }

    return memories.slice(0, 3); // 最多返回3条相关记忆
  }

  /**
   * 获取最近N天的日记忆
   */
  async getRecentDailyLogs(days: number): Promise<string[]> {
    const logs: string[] = [];
    const now = new Date();
    
    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      try {
        const log = await fs.readFile(
          path.join(this.memoryDir, `${dateStr}.md`), 
          'utf-8'
        );
        logs.push(log);
      } catch (error) {
        // 忽略不存在的文件
      }
    }
    
    return logs;
  }

  /**
   * 归档旧记忆
   */
  async archiveOldMemories(olderThanDays: number = 30): Promise<void> {
    const archiveDir = path.join(this.memoryDir, 'archive');
    await fs.mkdir(archiveDir, { recursive: true });
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    // 扫描并归档旧文件
    try {
      const files = await fs.readdir(this.memoryDir);
      for (const file of files) {
        if (!file.endsWith('.md') || file === 'archive') continue;
        
        const filePath = path.join(this.memoryDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffDate) {
          const archivePath = path.join(archiveDir, file);
          await fs.rename(filePath, archivePath);
          console.log(`[MemoryManager] Archived: ${file}`);
        }
      }
    } catch (error) {
      console.error('[MemoryManager] Archive failed:', error);
    }
  }

  // ==================== 私有方法 ====================

  private extractKeywords(text: string): string[] {
    // 简单的关键词提取
    const words = text
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
    
    // 去重并返回前10个
    return [...new Set(words)].slice(0, 10);
  }
}

// 单例导出
export const memoryManager = new MemoryManager();
