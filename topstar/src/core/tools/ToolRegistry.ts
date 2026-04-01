import { ToolDefinition, ToolResult, Session } from '../../types';
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
  private workingDir: string;

  constructor() {
    // 设置工作目录为当前目录或项目根目录
    this.workingDir = process.cwd();
    
    // 如果是从 node_modules 或 dist 运行，向上查找项目根目录
    if (this.workingDir.includes('node_modules') || this.workingDir.includes('dist')) {
      this.workingDir = path.resolve(this.workingDir, '..');
    }
    
    this.registerCoreTools();
  }

  /**
   * 注册工具
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 获取工具
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具列表（用于LLM）
   */
  getToolDescriptions(): any[] {
    return this.getAll().map((tool) => {
      const parameters = tool.parameters || [];
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: this.convertParameters(parameters),
            required: parameters.filter((p) => p.required).map((p) => p.name),
          },
        },
      };
    });
  }

  /**
   * 执行工具
   */
  async execute(name: string, args: any, session: Session): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool '${name}' not found` };
    }

    // 检查权限
    if (!session.allowedTools.includes(name)) {
      return { 
        success: false, 
        error: `Tool '${name}' not allowed in this session` 
      };
    }

    try {
      return await tool.handler(args, session);
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * 设置工作目录
   */
  setWorkingDir(dir: string): void {
    this.workingDir = dir;
    console.log(`[ToolRegistry] Working directory set to: ${dir}`);
  }

  /**
   * 获取工作目录
   */
  getWorkingDir(): string {
    return this.workingDir;
  }

  // ==================== 核心工具注册 ====================

  private registerCoreTools(): void {
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
        
        // 安全检查：防止越权访问
        if (!filePath.startsWith(this.workingDir) && !filePath.startsWith(process.env.HOME || '')) {
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
            data: {
              content: selectedLines.join('\n'),
              totalLines: lines.length,
              readLines: selectedLines.length,
            },
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
        
        // 安全检查
        if (!filePath.startsWith(this.workingDir) && !filePath.startsWith(process.env.HOME || '')) {
          return { success: false, error: 'Access denied: path outside allowed directories' };
        }

        try {
          // 确保目录存在
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
            data: {
              path: filePath,
              replacements: args.replace_all 
                ? content.split(args.old).length - 1 
                : 1,
            },
          };
        } catch (error) {
          return { success: false, error: `Failed to edit file: ${error}` };
        }
      },
    });

    // exec: 执行shell命令
    this.register({
      name: 'exec',
      description: '执行shell命令（自动适配 Windows/Mac/Linux）。常用命令：Windows用"dir"、Mac/Linux用"ls"。支持超时控制，默认60秒。',
      parameters: [
        { name: 'command', type: 'string', description: '要执行的命令。Windows: 用dir/cd; Mac/Linux: 用ls/pwd', required: true },
        { name: 'timeout', type: 'number', description: '超时时间（秒）', required: false, default: 60 },
      ],
      handler: async (args) => {
        const timeout = Math.min(args.timeout || 60, 300);
        
        // 高危命令检查
        const dangerousCommands = ['rm -rf /', 'mkfs', 'dd if=/dev/zero', 'format', 'del /f /s /q'];
        for (const dangerous of dangerousCommands) {
          if (args.command.toLowerCase().includes(dangerous)) {
            return { success: false, error: 'Dangerous command blocked for security' };
          }
        }

        try {
          // 转换 Unix 命令到 Windows
          let command = args.command;
          if (process.platform === 'win32') {
            // 简单的命令转换
            command = command
              .replace(/^ls\s+-la$/i, 'dir')
              .replace(/^ls\s+(-[a-z]+)?\s*/i, 'dir ')
              .replace(/^pwd$/i, 'cd')
              .replace(/^cat\s+/i, 'type ')
              .replace(/^cp\s+/i, 'copy ')
              .replace(/^mv\s+/i, 'move ')
              .replace(/^rm\s+/i, 'del ')
              .replace(/^touch\s+/i, 'type nul > ');
            
            // Windows: 先设置 UTF-8 编码
            command = `chcp 65001 >nul && ${command}`;
          }
          
          const { stdout, stderr } = await execAsync(command, {
            timeout: timeout * 1000,
            cwd: this.workingDir,
            encoding: 'utf8',
            windowsHide: true,
            shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
          });
          
          // 清理 Windows 编码设置输出
          let output = (stdout || '').replace(/^Active code page: \d+\r?\n?/i, '').trim();
          let errOutput = (stderr || '').trim();
          
          // 限制输出长度，避免截断
          const maxLen = 3000;
          if (output.length > maxLen) {
            output = output.substring(0, maxLen) + '\n... (output truncated)';
          }
          if (errOutput.length > maxLen) {
            errOutput = errOutput.substring(0, maxLen) + '\n... (stderr truncated)';
          }
          
          return {
            success: true,
            data: {
              stdout: output || '(no output)',
              stderr: errOutput || '(no stderr)',
              exitCode: 0,
              platform: process.platform,
            },
          };
        } catch (error: any) {
          // 处理错误输出
          let errorMsg = error.message;
          let stdout = (error.stdout || '').toString();
          let stderr = (error.stderr || '').toString();
          
          // 清理 Windows 编码设置输出
          stdout = stdout.replace(/^Active code page: \d+\r?\n?/i, '').trim();
          stderr = stderr.replace(/^Active code page: \d+\r?\n?/i, '').trim();
          
          // 如果是 Windows 命令未找到错误，给出友好提示
          if (process.platform === 'win32' && error.code === 'ENOENT') {
            errorMsg = `Command not found. On Windows, try using "dir" instead of "ls", "cd" instead of "pwd"`;
          }
          
          return {
            success: false,
            error: errorMsg,
            data: {
              stdout: stdout.substring(0, 3000),
              stderr: stderr.substring(0, 3000),
              exitCode: error.code || 1,
              platform: process.platform,
            },
          };
        }
      },
    });

    // web_search: 网络搜索
    this.register({
      name: 'web_search',
      description: '执行网络搜索获取信息。如果搜索功能未配置，会建议安装 search skill。',
      parameters: [
        { name: 'query', type: 'string', description: '搜索查询', required: true },
        { name: 'limit', type: 'number', description: '结果数量', required: false, default: 5 },
      ],
      handler: async (args) => {
        // 提示用户安装 search skill
        return {
          success: false,
          error: 'Web search not configured',
          suggestion: '建议安装 search skill 来启用网络搜索功能',
          installCommand: 'claw install search',
          data: {
            query: args.query,
            message: '网络搜索功能需要通过安装 Skill 来启用。运行 "claw install search" 安装搜索技能。',
          },
        };
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

// 单例导出
export const toolRegistry = new ToolRegistry();
