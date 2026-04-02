import { ToolDefinition, ToolResult, Session, ScheduledTask, TaskExecutor } from '../../types';
import * as path from 'path';
import {
  listSkillsTool,
  fetchTool,
  webFetchTool,
  createReadTool,
  createWriteTool,
  createEditTool,
  createExecTool,
  createGrepTool,
} from './definitions';

/**
 * 工具注册表
 * 管理系统所有可用的工具
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private toolSources: Map<string, string> = new Map();
  private workingDir: string;
  private schedulerExecutor: TaskExecutor | null = null;
  private scheduledTasks: Map<string, ScheduledTask> = new Map();

  constructor() {
    this.workingDir = process.cwd();
    if (this.workingDir.includes('node_modules') || this.workingDir.includes('dist')) {
      this.workingDir = path.resolve(this.workingDir, '..');
    }
    this.registerCoreTools();
  }

  register(tool: ToolDefinition, source?: string): void {
    this.tools.set(tool.name, tool);
    if (source) {
      this.toolSources.set(tool.name, source);
    }
  }

  setToolSource(name: string, source: string): void {
    this.toolSources.set(name, source);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getToolDescriptions(): any[] {
    return this.getAll().map((tool) => {
      const parameters = tool.parameters || [];
      const source = this.toolSources.get(tool.name);
      const sourceNote = source ? `（来源: ${source}）` : '（系统内置工具）';
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: `${tool.description}\n${sourceNote}`,
          parameters: {
            type: 'object',
            properties: this.convertParameters(parameters),
            required: parameters.filter((p) => p.required).map((p) => p.name),
          },
        },
      };
    });
  }

  async execute(name: string, args: any, session: Session): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool '${name}' not found` };
    }
    if (!session.allowedTools.includes(name)) {
      return { success: false, error: `Tool '${name}' not allowed in this session` };
    }
    try {
      return await tool.handler(args, session);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  setWorkingDir(dir: string): void {
    this.workingDir = dir;
    console.log(`[ToolRegistry] Working directory set to: ${dir}`);
  }

  getWorkingDir(): string {
    return this.workingDir;
  }

  /**
   * 注册调度器相关工具
   */
  registerSchedulerTools(
    createTask: (name: string, schedule: string, prompt: string, enabled?: boolean) => Promise<{ success: boolean; task?: ScheduledTask; error?: string }>,
    cancelTask: (id: string) => Promise<{ success: boolean; error?: string }>,
    getTasks: () => ScheduledTask[],
    findTask: (query: string) => ScheduledTask | undefined
  ): void {
    this.register({
      name: 'schedule_task',
      description: '创建一个定时任务。当到达指定时间时，系统会自动执行对应的 AI 提示词。支持标准 5 字段 cron 表达式。\n常用示例:\n- 每天早上9点: "0 9 * * *"\n- 每小时: "0 * * * *"\n- 每30分钟: "*/30 * * * *"\n- 每周一早上8点: "0 8 * * 1"\n- 每天凌晨0点: "0 0 * * *"\n\n【任务规范】\n1. 如果任务需要执行脚本，脚本必须放在 `.starup/task/{name}/scripts/` 目录下。\n2. `.starup/task/{name}/README.md` 必须存在，用于说明该定时任务的目的、逻辑和维护信息。\n3. 如果脚本涉及环境变量或必要参数，需在 `.starup/task/{name}/props.json` 中声明，任务执行时会自动读取并注入到 prompt 中。\n\n【prompt 写作要求】\nprompt 必须信息完整、逻辑清晰，控制字数在合理范围内（建议 200-800 字）。必须包含以下要素：\n- 任务目标：要达成什么结果\n- 执行步骤：具体怎么做，按什么顺序\n- 输入/依赖：需要读取哪些文件、调用哪些工具、使用哪些参数\n- 预期输出：结果应该是什么格式、保存到哪里、是否需要通知用户\n- 失败处理：遇到常见问题时如何应对',
      parameters: [
        { name: 'name', type: 'string', description: '任务名称（唯一标识，建议用英文，将作为 .starup/task/{name} 的目录名）', required: true },
        { name: 'schedule', type: 'string', description: 'cron 表达式，5 个字段: 分 时 日 月 星期', required: true },
        { name: 'prompt', type: 'string', description: '任务触发时发给 AI 的完整指令。必须包含：任务目标、执行步骤、输入依赖、预期输出、失败处理。如配置了 props.json，其内容会自动附加到本 prompt 中。', required: true },
        { name: 'enabled', type: 'boolean', description: '是否立即启用', required: false, default: true },
      ],
      handler: async (args) => {
        const result = await createTask(args.name, args.schedule, args.prompt, args.enabled !== false);
        if (result.success && result.task) {
          this.scheduledTasks.set(result.task.id, result.task);
          return { success: true, data: { id: result.task.id, name: result.task.name, schedule: result.task.schedule } };
        }
        return { success: false, error: result.error };
      },
    }, 'scheduler');

    this.register({
      name: 'list_scheduled_tasks',
      description: '列出当前所有的定时任务，包括任务ID、名称、cron表达式和启用状态。',
      parameters: [],
      handler: async () => {
        const tasks = getTasks();
        return {
          success: true,
          data: tasks.map((t) => ({
            id: t.id,
            name: t.name,
            schedule: t.schedule,
            enabled: t.enabled,
            createdAt: t.createdAt,
            lastRun: t.lastRun,
            runCount: t.runCount,
          })),
        };
      },
    }, 'scheduler');

    this.register({
      name: 'cancel_scheduled_task',
      description: '取消（删除）一个定时任务。可以通过任务ID或任务名称来指定。',
      parameters: [
        { name: 'id_or_name', type: 'string', description: '任务ID或任务名称', required: true },
      ],
      handler: async (args) => {
        const task = findTask(args.id_or_name);
        if (!task) {
          return { success: false, error: `Task not found: ${args.id_or_name}` };
        }
        const result = await cancelTask(task.id);
        if (result.success) {
          this.scheduledTasks.delete(task.id);
        }
        return result;
      },
    }, 'scheduler');
  }

  // ==================== 核心工具注册 ====================

  private registerCoreTools(): void {
    // 不需要 workingDir 的工具
    this.register(listSkillsTool, 'core');
    this.register(fetchTool, 'core');
    this.register(webFetchTool, 'core');

    // 需要 workingDir 的工具
    this.register(createReadTool(this.workingDir), 'core');
    this.register(createWriteTool(this.workingDir), 'core');
    this.register(createEditTool(this.workingDir), 'core');
    this.register(createExecTool(this.workingDir), 'core');
    this.register(createGrepTool(this.workingDir), 'core');
  }

  private convertParameters(parameters: any[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const param of parameters) {
      result[param.name] = {
        type: param.type,
        description: param.description,
      };
      if (param.default !== undefined) {
        result[param.name].default = param.default;
      }
    }
    return result;
  }
}

export const toolRegistry = new ToolRegistry();
