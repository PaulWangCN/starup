import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ScheduledTask, TaskExecutor } from '../../types';

// node-cron is a pure-JS scheduler, cross-platform (Win/Mac/Linux)
let cronValidate: (expression: string) => boolean;
let cronSchedule: (
  expression: string,
  handler: () => void,
  options?: { scheduled?: boolean; timezone?: string }
) => { stop: () => void; start: () => void; destroy: () => void };

try {
  const cron = require('node-cron');
  cronValidate = cron.validate;
  cronSchedule = cron.schedule;
} catch {
  // Fallback if node-cron is not installed
  cronValidate = () => false;
  cronSchedule = () => ({ stop: () => {}, start: () => {}, destroy: () => {} });
}

/**
 * 任务调度器
 * 管理定时任务，支持跨平台（Windows/Mac/Linux）
 * 任务持久化存储在 .starup/scheduler.json
 */
export class TaskScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private jobs: Map<string, { stop: () => void }> = new Map();
  private storagePath: string;
  private executor: TaskExecutor | null = null;

  constructor(storageDir?: string) {
    this.storagePath = path.join(storageDir || process.cwd(), '.starup', 'scheduler.json');
  }

  setExecutor(executor: TaskExecutor): void {
    this.executor = executor;
  }

  async initialize(): Promise<void> {
    await this.loadTasks();
    console.log(`[TaskScheduler] Initialized with ${this.tasks.size} tasks`);
  }

  async shutdown(): Promise<void> {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  /**
   * 创建定时任务
   */
  async createTask(
    name: string,
    schedule: string,
    prompt: string,
    enabled: boolean = true
  ): Promise<{ success: boolean; task?: ScheduledTask; error?: string }> {
    if (!cronValidate || !cronValidate(schedule)) {
      return {
        success: false,
        error: `Invalid cron expression: "${schedule}". Use standard 5-field cron (e.g. "0 9 * * *" for daily 9:00).`,
      };
    }

    const task: ScheduledTask = {
      id: uuidv4(),
      name,
      schedule,
      prompt,
      enabled,
      createdAt: Date.now(),
      runCount: 0,
    };

    this.tasks.set(task.id, task);
    if (enabled) {
      this.startJob(task);
    }
    await this.saveTasks();
    return { success: true, task };
  }

  /**
   * 取消定时任务
   */
  async cancelTask(id: string): Promise<{ success: boolean; error?: string }> {
    const task = this.tasks.get(id);
    if (!task) {
      return { success: false, error: `Task not found: ${id}` };
    }

    this.stopJob(id);
    this.tasks.delete(id);
    await this.saveTasks();
    return { success: true };
  }

  /**
   * 获取所有任务
   */
  getTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 通过名称或ID查找任务
   */
  findTask(query: string): ScheduledTask | undefined {
    // 先尝试精确匹配ID
    let task = this.tasks.get(query);
    if (task) return task;

    // 再尝试按名称匹配（不区分大小写）
    const lower = query.toLowerCase();
    return Array.from(this.tasks.values()).find((t) => t.name.toLowerCase() === lower);
  }

  private startJob(task: ScheduledTask): void {
    if (this.jobs.has(task.id)) {
      this.jobs.get(task.id)!.stop();
    }

    const job = cronSchedule(task.schedule, async () => {
      await this.executeTask(task.id);
    }, {
      scheduled: true,
    });

    this.jobs.set(task.id, job);
  }

  private stopJob(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !task.enabled || !this.executor) return;

    console.log(`[TaskScheduler] Executing task: ${task.name}`);
    task.lastRun = Date.now();
    task.runCount++;

    let prompt = task.prompt;
    try {
      const propsPath = path.join(process.cwd(), '.starup', 'tasks', task.name, 'props.json');
      const propsContent = await fs.readFile(propsPath, 'utf-8');
      const props = JSON.parse(propsContent);
      const propsText = typeof props === 'object' ? JSON.stringify(props, null, 2) : String(props);
      prompt = `【任务参数】\n以下参数来自 ${propsPath}，请在执行时引用：\n\`\`\`json\n${propsText}\n\`\`\`\n\n【任务指令】\n${task.prompt}`;
    } catch {
      // props.json 不存在或读取失败，静默使用原始 prompt
    }

    try {
      await this.executor.execute(prompt);
    } catch (error) {
      console.error(`[TaskScheduler] Task execution failed:`, error);
    }

    await this.saveTasks();
  }

  private async loadTasks(): Promise<void> {
    try {
      const content = await fs.readFile(this.storagePath, 'utf-8');
      const data = JSON.parse(content);
      if (Array.isArray(data.tasks)) {
        for (const task of data.tasks) {
          this.tasks.set(task.id, task);
          if (task.enabled) {
            this.startJob(task);
          }
        }
      }
    } catch {
      // 文件不存在或格式错误，静默忽略
    }
  }

  private async saveTasks(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      const data = {
        tasks: Array.from(this.tasks.values()),
        updatedAt: Date.now(),
      };
      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[TaskScheduler] Failed to save tasks:', error);
    }
  }
}

// 单例导出
export const taskScheduler = new TaskScheduler();
