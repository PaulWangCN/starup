/**
 * KAIROS 引擎
 * 实现 Claude Code 泄漏代码中的始终在线后台 Agent 模式
 * 
 * KAIROS (希腊语: "恰好的时刻") - 自主守护进程模式
 * - 每 5 分钟 tick
 * - 自动检测代码变更
 * - 空闲时执行 autoDream 记忆整合
 * - 后台静默任务执行
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { StarUpCore } from '../../index';
import { starupDB } from '../persistence/Database';
import { sessionPersistence } from '../persistence/SessionPersistence';
import { selfHealing } from '../resilience/SelfHealing';
import { logger } from '../../utils/Logger';
import { autoDream, AutoDream } from '../memory/AutoDream';

export interface KairosConfig {
  tickInterval: number;      // tick 间隔（毫秒），默认 5 分钟
  blockingBudget: number;    // 阻塞预算（毫秒），默认 15 秒
  autoDreamEnabled: boolean; // 是否启用 autoDream
  autoDreamInterval: number; // autoDream 间隔（毫秒），默认 30 分钟
  codeWatchEnabled: boolean; // 是否监视代码变更
  codeWatchPaths: string[];  // 监视的代码路径
}

export interface KairosTick {
  id: string;
  timestamp: number;
  triggeredBy: 'schedule' | 'code_change' | 'manual';
  actions: KairosAction[];
}

export interface KairosAction {
  type: 'memory_consolidation' | 'code_analysis' | 'task_execution' | 'cleanup';
  description: string;
  result?: string;
  duration: number;
}

export class KairosEngine {
  private core: StarUpCore | null = null;
  private config: KairosConfig;
  private tickTimer: NodeJS.Timeout | null = null;
  private autoDreamTimer: NodeJS.Timeout | null = null;
  private fileWatcher: Map<string, number> = new Map(); // 文件路径 -> 最后修改时间
  private isRunning: boolean = false;
  private currentTick: KairosTick | null = null;
  private sessionId: string | null = null;
  private readonly BRIEF_MODE = true; // KAIROS 模式使用简洁输出

  constructor(config?: Partial<KairosConfig>) {
    this.config = {
      tickInterval: 5 * 60 * 1000,      // 5 分钟
      blockingBudget: 15 * 1000,        // 15 秒
      autoDreamEnabled: true,
      autoDreamInterval: 30 * 60 * 1000, // 30 分钟
      codeWatchEnabled: true,
      codeWatchPaths: ['src', 'lib', 'app'],
      ...config,
    };
  }

  /**
   * 启动 KAIROS 引擎
   */
  async start(core: StarUpCore): Promise<void> {
    if (this.isRunning) return;

    this.core = core;
    this.isRunning = true;

    // 创建 KAIROS 专用会话
    this.sessionId = core.sessionManager.createStandaloneSession(this.getKairosSystemPrompt()).id;
    
    // 注册到持久化系统
    const session = core.sessionManager.getSession(this.sessionId)!;
    sessionPersistence.registerSession(session);

    // 启动定时 tick
    this.startTickTimer();

    // 启动 autoDream
    if (this.config.autoDreamEnabled) {
      this.startAutoDreamTimer();
    }

    // 启动代码监视
    if (this.config.codeWatchEnabled) {
      this.startCodeWatcher();
    }

    starupDB.logKairos('info', 'kairos', 'KAIROS engine started', {
      sessionId: this.sessionId,
      config: this.config,
    });

    logger.info('KAIROS', 'Engine started');
    logger.info('KAIROS', `Tick interval: ${this.config.tickInterval}ms`);
    logger.info('KAIROS', `AutoDream: ${this.config.autoDreamEnabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 停止 KAIROS 引擎
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    if (this.autoDreamTimer) {
      clearInterval(this.autoDreamTimer);
      this.autoDreamTimer = null;
    }

    if (this.sessionId) {
      sessionPersistence.unregisterSession(this.sessionId);
    }

    starupDB.logKairos('info', 'kairos', 'KAIROS engine stopped');
    logger.info('KAIROS', 'Engine stopped');
  }

  /**
   * 手动触发 tick
   */
  async tick(manual: boolean = false): Promise<KairosTick> {
    const tickId = `tick-${Date.now()}`;
    const startTime = Date.now();

    this.currentTick = {
      id: tickId,
      timestamp: startTime,
      triggeredBy: manual ? 'manual' : 'schedule',
      actions: [],
    };

    starupDB.logKairos('debug', 'kairos', `Tick ${tickId} started`);

    try {
      // 在阻塞预算内执行任务
      await this.executeWithBudget(async () => {
        // 1. 检查代码变更
        if (this.config.codeWatchEnabled) {
          await this.checkCodeChanges();
        }

        // 2. 执行 HEARTBEAT.md 中的任务
        await this.executeHeartbeatTasks();

        // 3. 清理过期数据
        await this.performCleanup();
      });

    } catch (error) {
      starupDB.logKairos('error', 'kairos', `Tick failed: ${error}`);
    }

    // 记录 tick 完成
    const duration = Date.now() - startTime;
    starupDB.logKairos('info', 'kairos', `Tick ${tickId} completed in ${duration}ms`, {
      actions: this.currentTick.actions.length,
    });

    return this.currentTick;
  }

  /**
   * 在阻塞预算内执行任务
   */
  private async executeWithBudget(fn: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Blocking budget exceeded'));
      }, this.config.blockingBudget);

      fn()
        .then(() => {
          clearTimeout(timeout);
          resolve();
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * 检查代码变更
   */
  private async checkCodeChanges(): Promise<void> {
    const actionStart = Date.now();
    let changesDetected = false;

    try {
      const srcDir = path.join(process.cwd(), 'src');
      
      // 递归扫描源文件
      const scanDir = async (dir: string) => {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
              await scanDir(fullPath);
            } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
              const stats = await fs.stat(fullPath);
              const lastModified = stats.mtimeMs;
              const previousModified = this.fileWatcher.get(fullPath);
              
              if (previousModified && lastModified > previousModified) {
                changesDetected = true;
                starupDB.logKairos('info', 'kairos', `Code change detected: ${fullPath}`);
                
                // 分析变更影响
                await this.analyzeCodeChange(fullPath);
              }
              
              this.fileWatcher.set(fullPath, lastModified);
            }
          }
        } catch (error) {
          // 忽略扫描错误
        }
      };

      await scanDir(srcDir);

    } catch (error) {
      starupDB.logKairos('warn', 'kairos', `Code watch failed: ${error}`);
    }

    if (changesDetected) {
      this.currentTick?.actions.push({
        type: 'code_analysis',
        description: 'Analyzed code changes',
        duration: Date.now() - actionStart,
      });
    }
  }

  /**
   * 分析代码变更
   */
  private async analyzeCodeChange(filePath: string): Promise<void> {
    // 简化的分析：记录变更文件
    starupDB.setSystemState(`code_change_${Date.now()}`, JSON.stringify({
      path: filePath,
      timestamp: Date.now(),
    }));

    // 这里可以扩展为：
    // - 分析变更影响范围
    // - 检查是否需要更新依赖
    // - 触发相关测试
  }

  /**
   * 执行 HEARTBEAT.md 中的任务
   */
  private async executeHeartbeatTasks(): Promise<void> {
    const actionStart = Date.now();
    
    try {
      const heartbeatPath = path.join(process.cwd(), '.starup', 'HEARTBEAT.md');
      let heartbeatContent = '';
      
      try {
        heartbeatContent = await fs.readFile(heartbeatPath, 'utf-8');
      } catch {
        // HEARTBEAT.md 不存在，静默跳过
        return;
      }

      // 解析 HEARTBEAT.md 中的任务
      const tasks = this.parseHeartbeatTasks(heartbeatContent);
      
      for (const task of tasks) {
        if (!this.isRunning) break;
        
        try {
          await this.executeTask(task);
        } catch (error) {
          starupDB.logKairos('warn', 'kairos', `Task failed: ${task.name}: ${error}`);
        }
      }

    } catch (error) {
      starupDB.logKairos('error', 'kairos', `Heartbeat tasks failed: ${error}`);
    }

    this.currentTick?.actions.push({
      type: 'task_execution',
      description: 'Executed HEARTBEAT tasks',
      duration: Date.now() - actionStart,
    });
  }

  /**
   * 解析 HEARTBEAT.md 中的任务
   */
  private parseHeartbeatTasks(content: string): Array<{name: string; description: string}> {
    const tasks: Array<{name: string; description: string}> = [];
    
    // 简单的任务解析：查找列表项
    const lines = content.split('\n');
    let currentTask: {name: string; description: string} | null = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // 任务标题（- [ ] 或 - [x] 或 -）
      if (trimmed.match(/^- \[[ x]\] (.+)$/)) {
        if (currentTask) {
          tasks.push(currentTask);
        }
        currentTask = {
          name: trimmed.replace(/^- \[[ x]\] /, ''),
          description: '',
        };
      } else if (currentTask && trimmed.startsWith('  ')) {
        // 任务描述
        currentTask.description += trimmed + '\n';
      }
    }
    
    if (currentTask) {
      tasks.push(currentTask);
    }
    
    return tasks;
  }

  /**
   * 执行任务
   */
  private async executeTask(task: {name: string; description: string}): Promise<void> {
    starupDB.logKairos('debug', 'kairos', `Executing task: ${task.name}`);
    
    // 这里可以扩展为调用 AI 处理任务
    // 简化版本：只记录任务执行
    
    if (this.core && this.sessionId) {
      // 通过核心处理任务（可选）
      // const result = await this.core.processMessage(this.sessionId, task.name);
    }
  }

  /**
   * 执行清理
   */
  private async performCleanup(): Promise<void> {
    const actionStart = Date.now();
    
    // 清理旧日志
    starupDB.cleanupOldLogs(7);
    
    // 清理旧快照
    sessionPersistence.getPendingTasks(); // 触发清理

    this.currentTick?.actions.push({
      type: 'cleanup',
      description: 'Cleaned up old logs and snapshots',
      duration: Date.now() - actionStart,
    });
  }

  /**
   * 启动定时 tick
   */
  private startTickTimer(): void {
    if (this.tickTimer) return;

    this.tickTimer = setInterval(() => {
      if (this.isRunning) {
        this.tick().catch((error) => {
          starupDB.logKairos('error', 'kairos', `Scheduled tick failed: ${error}`);
        });
      }
    }, this.config.tickInterval);
    (this.tickTimer as any).unref();
  }

  /**
   * 启动 autoDream 定时器
   */
  private startAutoDreamTimer(): void {
    if (this.autoDreamTimer) return;

    this.autoDreamTimer = setInterval(() => {
      if (this.isRunning) {
        this.runAutoDream().catch((error) => {
          starupDB.logKairos('error', 'kairos', `AutoDream failed: ${error}`);
        });
      }
    }, this.config.autoDreamInterval);
    (this.autoDreamTimer as any).unref();
  }

  /**
   * 启动代码监视
   */
  private startCodeWatcher(): void {
    // 初始扫描
    this.checkCodeChanges().catch(() => {});
  }

  /**
   * 运行 autoDream（记忆整合）
   * 
   * 调用真正的 AutoDream 进行记忆整合
   */
  async runAutoDream(): Promise<void> {
    const startTime = Date.now();
    
    starupDB.logKairos('info', 'autodream', 'Starting memory consolidation');

    try {
      // 使用真正的 AutoDream 进行整合
      const beforeStats = autoDream.getStats();
      await autoDream.forceConsolidate();
      const afterStats = autoDream.getStats();

      // 触发 MemoryManager 维护（导出高置信度 facts）
      if (this.core) {
        await this.core.memoryManager.performMaintenance();
      }

      const duration = Date.now() - startTime;
      
      this.currentTick?.actions.push({
        type: 'memory_consolidation',
        description: `Consolidated: ${afterStats.insights - beforeStats.insights} new insights, ${afterStats.facts - beforeStats.facts} new facts`,
        duration,
      });

      starupDB.logKairos('info', 'autodream', `Memory consolidation completed in ${duration}ms`, {
        before: beforeStats,
        after: afterStats,
      });

    } catch (error) {
      starupDB.logKairos('error', 'autodream', `Memory consolidation failed: ${error}`);
    }
  }

  /**
   * 扫描记忆文件
   */
  private async scanMemories(dir: string): Promise<Array<{path: string; content: string; mtime: number}>> {
    const memories: Array<{path: string; content: string; mtime: number}> = [];

    try {
      const scanDir = async (currentDir: string) => {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.name.endsWith('.md') && entry.name !== 'MEMORY.md') {
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const stats = await fs.stat(fullPath);
              memories.push({ path: fullPath, content, mtime: stats.mtimeMs });
            } catch {
              // 忽略读取错误
            }
          }
        }
      };

      await scanDir(dir);
    } catch {
      // 目录可能不存在
    }

    return memories;
  }

  /**
   * 查找重复记忆
   */
  private findDuplicateMemories(
    memories: Array<{path: string; content: string}>
  ): Array<Array<{path: string; content: string}>> {
    const groups: Array<Array<{path: string; content: string}>> = [];
    const processed = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      if (processed.has(memories[i].path)) continue;

      const group: Array<{path: string; content: string}> = [memories[i]];
      processed.add(memories[i].path);

      // 提取关键词（简化版本）
      const keywords1 = this.extractKeywords(memories[i].content);

      for (let j = i + 1; j < memories.length; j++) {
        if (processed.has(memories[j].path)) continue;

        const keywords2 = this.extractKeywords(memories[j].content);
        const similarity = this.calculateSimilarity(keywords1, keywords2);

        if (similarity > 0.7) { // 70% 相似度阈值
          group.push(memories[j]);
          processed.add(memories[j].path);
        }
      }

      if (group.length > 1) {
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * 提取关键词
   */
  private extractKeywords(content: string): Set<string> {
    const words = content
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
    
    return new Set(words);
  }

  /**
   * 计算相似度
   */
  private calculateSimilarity(set1: Set<string>, set2: Set<string>): number {
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
  }

  /**
   * 合并记忆
   */
  private async mergeMemories(group: Array<{path: string; content: string}>): Promise<void> {
    // 简化版本：保留最新的，删除其他的
    const sorted = [...group].sort((a, b) => {
      // 从内容中提取时间
      const timeA = this.extractTime(a.content);
      const timeB = this.extractTime(b.content);
      return timeB - timeA;
    });

    // 删除旧的
    for (let i = 1; i < sorted.length; i++) {
      try {
        await fs.unlink(sorted[i].path);
        starupDB.logKairos('debug', 'autodream', `Removed duplicate memory: ${sorted[i].path}`);
      } catch {
        // 忽略删除错误
      }
    }
  }

  /**
   * 从内容提取时间
   */
  private extractTime(content: string): number {
    const match = content.match(/updated:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    if (match) {
      return new Date(match[1]).getTime();
    }
    return 0;
  }

  /**
   * 清理过期记忆
   */
  private async cleanupOldMemories(
    memories: Array<{path: string; content: string; mtime: number}>
  ): Promise<void> {
    const cutoff = Date.now() - (90 * 24 * 60 * 60 * 1000); // 90 天

    for (const memory of memories) {
      if (memory.mtime < cutoff) {
        // 归档到冷存储（简化版本：删除）
        try {
          // await fs.unlink(memory.path);
          starupDB.logKairos('debug', 'autodream', `Archived old memory: ${memory.path}`);
        } catch {
          // 忽略错误
        }
      }
    }
  }

  /**
   * 获取 KAIROS 系统提示词
   */
  private getKairosSystemPrompt(): string {
    return `You are KAIROS, the autonomous background agent for StarUp.
Your role is to:
1. Monitor the system and execute periodic tasks
2. Consolidate memories during idle time
3. Detect and analyze code changes
4. Maintain system health

You operate in BRIEF mode - provide concise, actionable responses.
You have a blocking budget of 15 seconds per operation.
Do not perform destructive operations without explicit confirmation.`;
  }

  /**
   * 获取状态
   */
  getStatus(): {
    running: boolean;
    sessionId: string | null;
    lastTick: KairosTick | null;
    config: KairosConfig;
  } {
    return {
      running: this.isRunning,
      sessionId: this.sessionId,
      lastTick: this.currentTick,
      config: this.config,
    };
  }
}

// 单例导出
export const kairosEngine = new KairosEngine();
