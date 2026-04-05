/**
 * AutoDream 持久化层
 * 
 * 负责将 AutoDream 数据持久化到文件系统
 * - 使用 JSON 文件存储
 * - 自动备份和恢复
 * - 版本控制（未来扩展）
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/Logger';
import { AutoDreamPersistence as IAutoDreamPersistence, Observation, Insight, Fact, Contradiction } from './AutoDream';

export class AutoDreamPersistence implements IAutoDreamPersistence {
  private baseDir: string;
  private dataFile: string;
  private backupDir: string;
  
  // 数据版本，用于未来迁移
  private readonly DATA_VERSION = 1;

  constructor(baseDir: string = '.starup/memory/autodream') {
    this.baseDir = path.join(process.cwd(), baseDir);
    this.dataFile = path.join(this.baseDir, 'memory.json');
    this.backupDir = path.join(this.baseDir, 'backups');
  }

  /**
   * 确保目录存在
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
      await fs.mkdir(this.backupDir, { recursive: true });
      logger.debug('AutoDreamPersistence', `Initialized at ${this.baseDir}`);
    } catch (error) {
      logger.error('AutoDreamPersistence', `Failed to initialize: ${error}`);
      throw error;
    }
  }

  /**
   * 加载数据
   */
  async load(): Promise<{
    observations: Observation[];
    insights: Insight[];
    facts: Fact[];
    contradictions: Contradiction[];
  } | null> {
    try {
      await this.initialize();
      
      const content = await fs.readFile(this.dataFile, 'utf-8');
      const data = JSON.parse(content);
      
      // 版本检查
      if (data.version && data.version !== this.DATA_VERSION) {
        logger.warn('AutoDreamPersistence', `Data version mismatch: ${data.version} vs ${this.DATA_VERSION}`);
        // 未来这里可以做数据迁移
      }
      
      logger.debug('AutoDreamPersistence', 
        `Loaded: ${data.observations?.length || 0} obs, ` +
        `${data.facts?.length || 0} facts`
      );
      
      return {
        observations: data.observations || [],
        insights: data.insights || [],
        facts: data.facts || [],
        contradictions: data.contradictions || []
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // 文件不存在，返回 null
        logger.debug('AutoDreamPersistence', 'No existing data found');
        return null;
      }
      logger.error('AutoDreamPersistence', `Failed to load: ${error}`);
      throw error;
    }
  }

  /**
   * 保存数据
   */
  async save(data: {
    observations: Observation[];
    insights: Insight[];
    facts: Fact[];
    contradictions: Contradiction[];
  }): Promise<void> {
    try {
      await this.initialize();
      
      // 先备份现有数据
      await this.createBackup();
      
      // 写入新数据
      const toSave = {
        version: this.DATA_VERSION,
        timestamp: Date.now(),
        ...data
      };
      
      // 使用临时文件 + 重命名，确保原子性
      const tempFile = `${this.dataFile}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(toSave, null, 2), 'utf-8');
      await fs.rename(tempFile, this.dataFile);
      
      logger.debug('AutoDreamPersistence', 
        `Saved: ${data.observations.length} obs, ${data.facts.length} facts`
      );
    } catch (error) {
      logger.error('AutoDreamPersistence', `Failed to save: ${error}`);
      throw error;
    }
  }

  /**
   * 创建备份
   */
  private async createBackup(): Promise<void> {
    try {
      // 检查现有数据文件
      await fs.access(this.dataFile);
      
      // 生成备份文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `memory-${timestamp}.json`);
      
      // 复制到备份目录
      await fs.copyFile(this.dataFile, backupFile);
      
      // 清理旧备份（只保留最近10个）
      await this.cleanupOldBackups();
      
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.warn('AutoDreamPersistence', `Failed to create backup: ${error}`);
      }
      // 如果没有现有文件，不需要备份
    }
  }

  /**
   * 清理旧备份
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups = files
        .filter(f => f.startsWith('memory-') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(this.backupDir, f),
          time: fs.stat(path.join(this.backupDir, f)).then(s => s.mtimeMs)
        }));
      
      // 等待所有 stat 完成
      const resolved = await Promise.all(
        backups.map(async b => ({
          ...b,
          mtime: await b.time
        }))
      );
      
      // 按时间排序
      resolved.sort((a, b) => b.mtime - a.mtime);
      
      // 删除旧备份
      const toDelete = resolved.slice(10);
      for (const backup of toDelete) {
        await fs.unlink(backup.path);
        logger.debug('AutoDreamPersistence', `Cleaned old backup: ${backup.name}`);
      }
    } catch (error) {
      logger.warn('AutoDreamPersistence', `Failed to cleanup backups: ${error}`);
    }
  }

  /**
   * 列出备份
   */
  async listBackups(): Promise<Array<{name: string; path: string; date: Date}>> {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups = await Promise.all(
        files
          .filter(f => f.startsWith('memory-') && f.endsWith('.json'))
          .map(async f => {
            const fullPath = path.join(this.backupDir, f);
            const stat = await fs.stat(fullPath);
            return {
              name: f,
              path: fullPath,
              date: new Date(stat.mtimeMs)
            };
          })
      );
      
      return backups.sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch (error) {
      return [];
    }
  }

  /**
   * 从备份恢复
   */
  async restoreFromBackup(backupName: string): Promise<boolean> {
    try {
      const backupPath = path.join(this.backupDir, backupName);
      await fs.access(backupPath);
      
      // 备份当前数据
      await this.createBackup();
      
      // 恢复
      await fs.copyFile(backupPath, this.dataFile);
      
      logger.info('AutoDreamPersistence', `Restored from backup: ${backupName}`);
      return true;
    } catch (error) {
      logger.error('AutoDreamPersistence', `Failed to restore: ${error}`);
      return false;
    }
  }

  /**
   * 导出为 Markdown（用于人工阅读）
   */
  async exportToMarkdown(data: {
    facts: Fact[];
  }, outputPath?: string): Promise<string> {
    const mdPath = outputPath || path.join(this.baseDir, 'facts.md');
    
    const lines = [
      '# AutoDream Facts',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Total Facts: ${data.facts.length}`,
      '',
      '## Facts (by confidence)',
      ''
    ];
    
    const sortedFacts = [...data.facts].sort((a, b) => b.confidence - a.confidence);
    
    for (const fact of sortedFacts) {
      lines.push(`### ${fact.id}`);
      lines.push(`- **Confidence:** ${(fact.confidence * 100).toFixed(1)}%`);
      lines.push(`- **Created:** ${new Date(fact.createdAt).toISOString()}`);
      lines.push(`- **Updated:** ${new Date(fact.updatedAt).toISOString()}`);
      lines.push(`- **Access Count:** ${fact.accessCount}`);
      lines.push('');
      lines.push(fact.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    
    await fs.writeFile(mdPath, lines.join('\n'), 'utf-8');
    logger.info('AutoDreamPersistence', `Exported to ${mdPath}`);
    
    return mdPath;
  }
}

export default AutoDreamPersistence;
