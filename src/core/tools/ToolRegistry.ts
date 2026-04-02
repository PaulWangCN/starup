import { ToolDefinition, ToolResult, Session, ScheduledTask, TaskExecutor } from '../../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
    // schedule_task: 创建定时任务
    this.register({
      name: 'schedule_task',
      description: '创建一个定时任务。当到达指定时间时，系统会自动执行对应的 AI 提示词。支持标准 5 字段 cron 表达式。\n常用示例:\n- 每天早上9点: "0 9 * * *"\n- 每小时: "0 * * * *"\n- 每30分钟: "*/30 * * * *"\n- 每周一早上8点: "0 8 * * 1"\n- 每天凌晨0点: "0 0 * * *"',
      parameters: [
        { name: 'name', type: 'string', description: '任务名称（唯一标识，建议用英文）', required: true },
        { name: 'schedule', type: 'string', description: 'cron 表达式，5 个字段: 分 时 日 月 星期', required: true },
        { name: 'prompt', type: 'string', description: '任务触发时发给 AI 的提示词/指令', required: true },
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

    // list_scheduled_tasks: 列出所有定时任务
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

    // cancel_scheduled_task: 取消定时任务
    this.register({
      name: 'cancel_scheduled_task',
      description: '取消（删除）一个定时任务。可以通过任务ID或任务名称来指定。',
      parameters: [
        { name: 'id_or_name', type: 'string', description: '任务ID或任务名称', required: true },
      ],
      handler: async (args) => {
        // 先尝试精确匹配ID或名称
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
    // list_skills: 列出已安装的 skills
    this.register({
      name: 'list_skills',
      description: '列出当前已安装的所有 skills，返回 skill 名称、描述和路径信息。',
      parameters: [],
      handler: async () => {
        try {
          const skillsDir = path.join(process.cwd(), '.starup', 'skills');
          const entries = await fs.readdir(skillsDir, { withFileTypes: true });
          const skills: { name: string; description: string; path: string }[] = [];
          
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const skillPath = path.join(skillsDir, entry.name);
              const skillFile = path.join(skillPath, 'SKILL.md');
              let description = '';
              
              try {
                const content = await fs.readFile(skillFile, 'utf-8');
                // 解析 frontmatter 中的 description
                const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                if (frontmatterMatch) {
                  const yaml = frontmatterMatch[1];
                  const descMatch = yaml.match(/description:\s*(.+)/);
                  if (descMatch) {
                    description = descMatch[1].trim();
                  }
                }
              } catch {
                // 无法读取 SKILL.md，使用空描述
              }
              
              skills.push({
                name: entry.name,
                description,
                path: skillPath,
              });
            }
          }
          
          return {
            success: true,
            data: {
              count: skills.length,
              skills,
            },
          };
        } catch (error: any) {
          return { success: false, error: `Failed to list skills: ${error.message}` };
        }
      },
    });

    // fetch: 发起 HTTP 网络请求
    this.register({
      name: 'fetch',
      description: '发起 HTTP 网络请求，支持 GET/POST/PUT/DELETE 等方法。用于调用外部 API、获取网页内容、下载数据等。\n注意：如果某个 skill 已经提供了专门的工具（如 web_search、weather），请优先使用该 skill 的工具。',
      parameters: [
        { name: 'url', type: 'string', description: '请求的 URL 地址', required: true },
        { name: 'method', type: 'string', description: 'HTTP 方法: GET、POST、PUT、DELETE、PATCH 等，默认为 GET', required: false, default: 'GET' },
        { name: 'headers', type: 'object', description: '请求头对象，如 { "Content-Type": "application/json" }', required: false },
        { name: 'body', type: 'string', description: '请求体（用于 POST/PUT/PATCH），可以是 JSON 字符串或表单数据', required: false },
        { name: 'timeout', type: 'number', description: '超时时间（秒），默认 30 秒，最大 120 秒', required: false, default: 30 },
      ],
      handler: async (args) => {
        try {
          const url = new URL(args.url);
          const timeout = Math.min((args.timeout || 30) * 1000, 120000);
          
          // 构建请求选项
          const fetchOptions: RequestInit = {
            method: args.method?.toUpperCase() || 'GET',
            headers: args.headers || {},
          };
          
          // 添加请求体（如果不是 GET/HEAD）
          if (args.body && !['GET', 'HEAD'].includes(fetchOptions.method as string)) {
            fetchOptions.body = args.body;
          }
          
          // 使用 AbortController 实现超时
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);
          fetchOptions.signal = controller.signal;
          
          const response = await fetch(url.toString(), fetchOptions);
          clearTimeout(timeoutId);
          
          // 读取响应内容
          const contentType = response.headers.get('content-type') || '';
          let data: any;
          
          if (contentType.includes('application/json')) {
            data = await response.json();
          } else {
            const text = await response.text();
            // 如果内容太大，进行截断
            const maxLen = 50000;
            data = text.length > maxLen ? text.substring(0, maxLen) + '\n... (content truncated)' : text;
          }
          
          return {
            success: response.ok,
            data: {
              status: response.status,
              statusText: response.statusText,
              headers: (() => {
                const h: Record<string, string> = {};
                response.headers.forEach((value, key) => { h[key] = value; });
                return h;
              })(),
              data: data,
            },
          };
        } catch (error: any) {
          if (error.name === 'AbortError') {
            return { success: false, error: 'Request timeout' };
          }
          return { success: false, error: `Request failed: ${error.message}` };
        }
      },
    });

    // web_fetch: 获取网页内容（带内容提取功能）
    this.register({
      name: 'web_fetch',
      description: '获取网页内容，支持 HTML 到文本/Markdown 的转换和长度限制。专门用于网页抓取和内容提取。',
      parameters: [
        { name: 'url', type: 'string', description: '要获取的网页 URL', required: true },
        { name: 'extractMode', type: 'string', description: '内容提取模式: text（纯文本）、markdown（Markdown 格式），默认为 text', required: false, default: 'text' },
        { name: 'maxChars', type: 'number', description: '最大返回字符数，默认 8000', required: false, default: 8000 },
        { name: 'timeout', type: 'number', description: '超时时间（秒），默认 30 秒', required: false, default: 30 },
      ],
      handler: async (args) => {
        try {
          const timeout = Math.min((args.timeout || 30) * 1000, 120000);
          const maxChars = Math.min(args.maxChars || 8000, 50000);
          const extractMode = args.extractMode || 'text';
          
          // 使用 AbortController 实现超时
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);
          
          const response = await fetch(args.url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
            },
          });
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
          }
          
          let html = await response.text();
          
          // 简单的 HTML 到文本转换
          let content = html;
          if (extractMode === 'text' || extractMode === 'markdown') {
            // 移除 script 和 style 标签及其内容
            content = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
            content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
            content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
            
            // 将常见块级标签替换为换行符
            content = content.replace(/<(\/p|br|div|h[1-6]|li|tr)[^>]*>/gi, '\n');
            content = content.replace(/<(p|div|h[1-6]|li|td|th)[^>]*>/gi, '\n');
            
            // 将表格相关标签转换为文本格式
            content = content.replace(/<td[^>]*>/gi, ' ');
            content = content.replace(/<th[^>]*>/gi, ' ');
            content = content.replace(/<tr[^>]*>/gi, '\n');
            
            // 移除所有 HTML 标签
            content = content.replace(/<[^>]+>/g, '');
            
            // 解码 HTML 实体
            content = content.replace(/&nbsp;/g, ' ');
            content = content.replace(/&amp;/g, '&');
            content = content.replace(/&lt;/g, '<');
            content = content.replace(/&gt;/g, '>');
            content = content.replace(/&quot;/g, '"');
            content = content.replace(/&#39;/g, "'");
            content = content.replace(/&mdash;/g, '—');
            content = content.replace(/&ndash;/g, '–');
            content = content.replace(/&hellip;/g, '...');
            content = content.replace(/&[a-zA-Z]+;/g, ''); // 移除其他未处理的实体
            
            // 清理空白字符
            content = content.replace(/\r\n/g, '\n');
            content = content.replace(/\r/g, '\n');
            content = content.replace(/\t/g, ' ');
            content = content.replace(/ +/g, ' ');
            content = content.replace(/\n +/g, '\n');
            content = content.replace(/ +\n/g, '\n');
            content = content.replace(/\n{3,}/g, '\n\n');
            
            content = content.trim();
          }
          
          // 截断内容
          const truncated = content.length > maxChars;
          if (truncated) {
            content = content.substring(0, maxChars) + '\n... (content truncated)';
          }
          
          return {
            success: true,
            data: {
              url: args.url,
              title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim(),
              content: content,
              truncated: truncated,
              length: content.length,
            },
          };
        } catch (error: any) {
          if (error.name === 'AbortError') {
            return { success: false, error: 'Request timeout' };
          }
          return { success: false, error: `Failed to fetch webpage: ${error.message}` };
        }
      },
    });

    // read: 读取文件
    this.register({
      name: 'read',
      description: '读取文本文件或图片文件内容。支持自动检测文件类型并进行相应处理（图片会进行OCR或视觉描述）。',
      parameters: [
        { name: 'path', type: 'string', description: '文件路径', required: true },
        { name: 'offset', type: 'number', description: '起始行号', required: false, default: 1 },
        { name: 'limit', type: 'number', description: '读取行数', required: false, default: 1000 },
      ],
      handler: async (args) => {
        const filePath = path.resolve(this.workingDir, args.path);
        const localStarupDir = path.join(this.workingDir, '.starup');
        if (!filePath.startsWith(this.workingDir) && !filePath.startsWith(localStarupDir)) {
          return { success: false, error: 'Access denied: path outside allowed directories' };
        }
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split('\n');
          const offset = (args.offset || 1) - 1;
          const limit = args.limit || 1000;
          const selectedLines = lines.slice(offset, offset + limit);
          return {
            success: true,
            data: { content: selectedLines.join('\n'), totalLines: lines.length, readLines: selectedLines.length },
          };
        } catch (error) {
          return { success: false, error: `Failed to read file: ${error}` };
        }
      },
    });

    // write: 写入文件
    this.register({
      name: 'write',
      description: '创建或覆盖写入文件。对于系统文件或覆盖操作会要求确认。',
      parameters: [
        { name: 'path', type: 'string', description: '文件路径', required: true },
        { name: 'content', type: 'string', description: '文件内容', required: true },
        { name: 'mode', type: 'string', description: '写入模式: write|append', required: false, default: 'write' },
      ],
      handler: async (args) => {
        const filePath = path.resolve(this.workingDir, args.path);
        const localStarupDir = path.join(this.workingDir, '.starup');
        if (!filePath.startsWith(this.workingDir) && !filePath.startsWith(localStarupDir)) {
          return { success: false, error: 'Access denied: path outside allowed directories' };
        }
        try {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          if (args.mode === 'append') {
            await fs.appendFile(filePath, args.content, 'utf-8');
          } else {
            await fs.writeFile(filePath, args.content, 'utf-8');
          }
          return { success: true, data: { path: filePath, mode: args.mode } };
        } catch (error) {
          return { success: false, error: `Failed to write file: ${error}` };
        }
      },
    });

    // edit: 基于diff的文本编辑
    this.register({
      name: 'edit',
      description: '基于精确匹配和替换的文本编辑。需要提供old和new字符串进行精确替换。',
      parameters: [
        { name: 'path', type: 'string', description: '文件路径', required: true },
        { name: 'old', type: 'string', description: '要替换的旧文本', required: true },
        { name: 'new', type: 'string', description: '新文本', required: true },
        { name: 'replace_all', type: 'boolean', description: '是否替换所有匹配', required: false, default: false },
      ],
      handler: async (args) => {
        const filePath = path.resolve(this.workingDir, args.path);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          if (!content.includes(args.old)) {
            return { success: false, error: 'Old text not found in file' };
          }
          let newContent: string;
          if (args.replace_all) {
            newContent = content.split(args.old).join(args.new);
          } else {
            newContent = content.replace(args.old, args.new);
          }
          await fs.writeFile(filePath, newContent, 'utf-8');
          return {
            success: true,
            data: { path: filePath, replacements: args.replace_all ? content.split(args.old).length - 1 : 1 },
          };
        } catch (error) {
          return { success: false, error: `Failed to edit file: ${error}` };
        }
      },
    });

    // exec: 执行shell命令
    this.register({
      name: 'exec',
      description: '执行本地系统shell命令（自动适配 Windows/Mac/Linux）。这是通用系统命令工具，仅用于执行本地文件/系统操作。\n注意：如果某个skill已经提供了专门工具（如web_search、weather），请优先使用该skill的工具，不要用exec去模拟实现相同功能。',
      parameters: [
        { name: 'command', type: 'string', description: '要执行的命令。Windows: 用dir/cd; Mac/Linux: 用ls/pwd', required: true },
        { name: 'timeout', type: 'number', description: '超时时间（秒）', required: false, default: 60 },
      ],
      handler: async (args) => {
        const timeout = Math.min(args.timeout || 60, 300);
        // 使用正则表达式精确匹配危险命令（避免子串误判，如 python format 方法）
        const dangerousPatterns = [
          /\brm\s+-rf\s+\/\b/,           // rm -rf /
          /\bmkfs\b/,                     // mkfs
          /\bdd\s+if=\/dev\/zero/,        // dd if=/dev/zero
          /\bformat\s+(C:|D:|E:|F:)/i,     // format C: (Windows)
          /\bdel\s+\/f\s+\/s\s+\/q\s+\\/i, // del /f /s /q \
        ];
        for (const pattern of dangerousPatterns) {
          if (pattern.test(args.command)) {
            return { success: false, error: 'Dangerous command blocked for security' };
          }
        }
        try {
          let command = args.command;
          if (process.platform === 'win32') {
            command = command
              .replace(/^ls\s+-la$/i, 'dir')
              .replace(/^ls\s+(-[a-z]+)?\s*/i, 'dir ')
              .replace(/^pwd$/i, 'cd')
              .replace(/^cat\s+/i, 'type ')
              .replace(/^cp\s+/i, 'copy ')
              .replace(/^mv\s+/i, 'move ')
              .replace(/^rm\s+/i, 'del ')
              .replace(/^touch\s+/i, 'type nul > ');
            // 改进的编码处理：对于Python命令使用PowerShell以获得更好的Unicode支持
            const isPythonCommand = command.includes('python') && (command.includes('-c') || command.includes('.py'));
            if (isPythonCommand) {
              // 对于Python命令，使用PowerShell执行以获得更好的UTF-8支持
              // 转义命令中的双引号
              const escapedCommand = command.replace(/"/g, '\\"');
              command = `powershell -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${escapedCommand}"`;
            } else {
              command = `chcp 65001 >nul && ${command}`;
            }
          }
          const { stdout, stderr } = await execAsync(command, {
            timeout: timeout * 1000,
            cwd: this.workingDir,
            encoding: 'utf8',
            windowsHide: true,
            shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
          });
          let output = (stdout || '').replace(/^Active code page: \d+\r?\n?/i, '').trim();
          let errOutput = (stderr || '').trim();
          const maxLen = 3000;
          if (output.length > maxLen) output = output.substring(0, maxLen) + '\n... (output truncated)';
          if (errOutput.length > maxLen) errOutput = errOutput.substring(0, maxLen) + '\n... (stderr truncated)';
          return {
            success: true,
            data: { stdout: output || '(no output)', stderr: errOutput || '(no stderr)', exitCode: 0, platform: process.platform },
          };
        } catch (error: any) {
          let errorMsg = error.message;
          let stdout = (error.stdout || '').toString();
          let stderr = (error.stderr || '').toString();
          stdout = stdout.replace(/^Active code page: \d+\r?\n?/i, '').trim();
          stderr = stderr.replace(/^Active code page: \d+\r?\n?/i, '').trim();
          if (process.platform === 'win32' && error.code === 'ENOENT') {
            errorMsg = `Command not found. On Windows, try using "dir" instead of "ls", "cd" instead of "pwd"`;
          }
          return {
            success: false,
            error: errorMsg,
            data: { stdout: stdout.substring(0, 3000), stderr: stderr.substring(0, 3000), exitCode: error.code || 1, platform: process.platform },
          };
        }
      },
    });


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
