/**
 * StarUp - AI 助手运行时环境与集成平台
 * v1.3-simple: 大道至简版
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { SessionManager, sessionManager } from './core/session/SessionManager';
import { MemoryManager, memoryManager } from './core/memory/MemoryManager';
import { ToolRegistry, toolRegistry } from './core/tools/ToolRegistry';
import { skillRegistry } from './core/skills/SkillRegistry';
import { LLMService } from './core/llm/LLMService';
import { TaskScheduler, taskScheduler } from './core/scheduler/TaskScheduler';
import { SystemConfig } from './types';

export * from './types';
export * from './core/session';
export * from './core/memory/MemoryManager';
export * from './core/tools/ToolRegistry';
export * from './core/skills';
export * from './core/llm/LLMService';
export * from './core/scheduler/TaskScheduler';
export * from './core/prompt';
export * from './core/intent';

export interface ProcessMessageCallbacks {
  onThinking?: (content: string) => void;
  onToolCall?: (name: string, args: any) => void;
  onToolResult?: (name: string, result: any) => void;
  onStreamChunk?: (chunk: string) => void;
  onIterationStart?: (iteration: number) => void;
  onAbort?: (reason: string) => void;
}

/**
 * 中断信号类型
 */
export interface AbortSignal {
  aborted: boolean;
  reason?: string;
}

/**
 * StarUp Core
 */
export class StarUpCore {
  sessionManager: SessionManager;
  memoryManager: MemoryManager;
  toolRegistry: ToolRegistry;
  skillRegistry: typeof skillRegistry;
  llmService: LLMService | null = null;
  scheduler: TaskScheduler;
  onScheduledTaskComplete?: (content: string) => void;
  private config: SystemConfig;
  private systemPrompt: string | null = null;
  
  // 中断控制
  private abortSignal: AbortSignal | null = null;

  constructor(config?: Partial<SystemConfig>) {
    this.sessionManager = sessionManager;
    this.memoryManager = memoryManager;
    this.toolRegistry = toolRegistry;
    this.skillRegistry = skillRegistry;
    this.scheduler = taskScheduler;

    const llmProvider = (process.env.LLM_PROVIDER as any) || 'deepseek';
    const llmModel = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat';

    this.config = {
      llm: {
        provider: llmProvider,
        apiKey: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '',
        model: llmModel,
        baseUrl: process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL,
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
        maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '8192', 10),
      },
      channels: [],
      cron: [],
      heartbeat: { interval: 1800000, tasks: [] },
      memory: { compressionThreshold: 8000, vectorDbEnabled: false },
      sandbox: { enabled: true, timeout: 300 },
      ...config,
    } as SystemConfig;

    if (this.config.llm.apiKey) {
      this.llmService = new LLMService(this.config.llm);
    }
  }

  /**
   * 初始化 Core
   */
  async initialize(): Promise<void> {
    console.log('[StarUpCore] Initializing...');
    
    // 确保配置文件存在
    await this.ensureConfigFiles();
    
    await this.skillRegistry.initialize();

    // 设置定时任务执行器（后台静默执行，避免干扰 CLI spinner）
    this.scheduler.setExecutor({
      execute: async (prompt: string) => {
        if (!this.systemPrompt || !this.llmService) return;
        // 临时静默 stdout，防止后台任务日志打断前台 CLI 输出
        const originalWrite = process.stdout.write.bind(process.stdout);
        const originalLog = console.log;
        const originalError = console.error;
        process.stdout.write = () => true;
        console.log = () => {};
        console.error = () => {};

        const session = this.sessionManager.createStandaloneSession(this.systemPrompt);
        let finalReply = '';
        try {
          const result = await this.processMessage(session.id, prompt);
          finalReply = result.finalReply;
        } catch (e) {
          // 静默处理执行错误
        } finally {
          this.sessionManager.destroySession(session.id);
          process.stdout.write = originalWrite;
          console.log = originalLog;
          console.error = originalError;
        }

        // 恢复输出后，通过回调把 AI 回复传递给前端（如 TerminalChat）
        if (finalReply && this.onScheduledTaskComplete) {
          this.onScheduledTaskComplete(finalReply);
        }
      },
    });

    // 注册调度器工具
    this.toolRegistry.registerSchedulerTools(
      this.scheduler.createTask.bind(this.scheduler),
      this.scheduler.cancelTask.bind(this.scheduler),
      this.scheduler.getTasks.bind(this.scheduler),
      this.scheduler.findTask.bind(this.scheduler)
    );

    // 加载并启动已持久化的定时任务
    await this.scheduler.initialize();
    
    console.log('[StarUpCore] Initialization complete');
  }

  /**
   * 设置系统提示词
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * 获取系统提示词
   */
  getSystemPrompt(): string | null {
    return this.systemPrompt;
  }

  /**
   * 确保配置文件存在
   * 检查 ./.starup/ 目录下的 AGENTS.md、SOUL.md、IDENTITY.md、USER.md
   * 如果不存在，从模板复制
   */
  private async ensureConfigFiles(): Promise<void> {
    const agentPath = path.join(process.cwd(), '.starup');
    
    // 模板目录位置 - 尝试多个可能的位置
    // 开发环境: __dirname = app/src/
    // 编译环境: __dirname = app/dist/ 或 app/dist/core/
    const possibleTemplateDirs = [
      // 开发环境：index.ts 在 app/src/
      path.join(__dirname, 'core', 'prompt', 'templates'),
      // 编译环境：相对于项目根目录
      path.join(process.cwd(), 'app', 'src', 'core', 'prompt', 'templates'),
      // 其他可能位置
      path.join(__dirname, '..', 'src', 'core', 'prompt', 'templates'),
      path.join(__dirname, '..', '..', 'src', 'core', 'prompt', 'templates'),
    ];
    
    console.log(`[StarUpCore] Config path: ${agentPath}`);
    console.log(`[StarUpCore] Possible template paths:`, possibleTemplateDirs);
    
    // 找到实际存在的模板目录
    let templatesDir: string | null = null;
    for (const dir of possibleTemplateDirs) {
      try {
        await fs.access(dir);
        templatesDir = dir;
        console.log(`[StarUpCore] Using templates from: ${templatesDir}`);
        break;
      } catch {
        // 目录不存在，继续尝试下一个
      }
    }
    
    if (!templatesDir) {
      console.error('[StarUpCore] Could not find templates directory. Searched:', possibleTemplateDirs);
      return;
    }
    
    try {
      await fs.mkdir(agentPath, { recursive: true });
      console.log(`[StarUpCore] Ensuring config directory exists: ${agentPath}`);
      
      // 需要检查并复制的文件列表
      const filesToCheck = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md'];
      
      for (const filename of filesToCheck) {
        const targetPath = path.join(agentPath, filename);
        const templatePath = path.join(templatesDir, filename);
        
        console.log(`[StarUpCore] Checking ${filename}...`);
        
        try {
          // 检查文件是否已存在
          await fs.access(targetPath);
          console.log(`[StarUpCore]   ${filename} already exists`);
        } catch {
          // 文件不存在，尝试从模板复制
          console.log(`[StarUpCore]   ${filename} not found, copying from template...`);
          try {
            const templateContent = await fs.readFile(templatePath, 'utf-8');
            await fs.writeFile(targetPath, templateContent, 'utf-8');
            console.log(`[StarUpCore] Created default ${filename}`);
          } catch (templateError) {
            // 模板文件不存在或读取失败
            console.error(`[StarUpCore] Failed to copy template for ${filename}:`, templateError);
          }
        }
      }
    } catch (error) {
      console.error('[StarUpCore] Failed to ensure config files:', error);
    }
  }

  /**
   * 获取系统状态
   */
  getStatus(): { skills: number; tools: number } {
    const { user, packages } = this.skillRegistry.list();
    return {
      skills: user.length + packages.length,
      tools: this.toolRegistry.getAll().length,
    };
  }

  /**
   * 中断当前执行的任务
   */
  abort(reason: string = '用户中断'): void {
    if (this.abortSignal) {
      this.abortSignal.aborted = true;
      this.abortSignal.reason = reason;
    }
  }

  /**
   * 检查是否被中断，如果被中断则抛出错误
   */
  private checkAborted(): void {
    if (this.abortSignal?.aborted) {
      throw new Error(`执行被中断: ${this.abortSignal.reason || '用户取消'}`);
    }
  }

  /**
   * 处理消息 - 支持 ReAct 多轮工具调用
   * 
   * 返回结构包含思考过程和最终回复
   */
  async processMessage(
    sessionId: string,
    message: string,
    callbacks?: ProcessMessageCallbacks
  ): Promise<{ thinking: string[]; finalReply: string; aborted?: boolean }> {
    // 重置中断信号
    this.abortSignal = { aborted: false };
    
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const thinking: string[] = [];

    // system_cmd 快速检测（无需 LLM）
    const lower = message.trim().toLowerCase();
    if (lower.startsWith('/') || ['重置', '清空记忆', '帮助', '状态'].some((k) => lower.includes(k))) {
      const reply = this.handleSystemCmd(message);
      this.sessionManager.addMessage(sessionId, { role: 'user', content: message, timestamp: Date.now() });
      this.sessionManager.addMessage(sessionId, { role: 'assistant', content: reply, timestamp: Date.now() });
      return { thinking: ['[系统] 识别为系统命令，直接处理'], finalReply: reply };
    }

    this.sessionManager.addMessage(sessionId, {
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    if (!this.llmService) {
      return { thinking: [], finalReply: 'LLM service not configured' };
    }

    const tools = this.toolRegistry.getToolDescriptions();
    const maxIterations = 20;

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        this.checkAborted();
        callbacks?.onIterationStart?.(iteration);
        const response = await this.llmService.chatStream(session.context.messages, tools, {
          onChunk: callbacks?.onStreamChunk,
          abortSignal: this.abortSignal,
        });

        // 记录 AI 的思考/回复内容
        if (response.content) {
          thinking.push(response.content);
          if (callbacks?.onThinking) {
            callbacks.onThinking(response.content);
          }
        }

        // 如果没有工具调用，直接返回
        if (!response.tool_calls || response.tool_calls.length === 0) {
          let content = response.content || '';
          
          // 截断恢复
          if (this.seemsTruncated(content)) {
            this.sessionManager.addMessage(sessionId, {
              role: 'assistant',
              content,
              timestamp: Date.now(),
            });
            this.sessionManager.addMessage(sessionId, {
              role: 'system',
              content: '你的上一条回复似乎被截断了，请继续完成你的回复。',
              timestamp: Date.now(),
            });
            const continuation = await this.llmService.chatStream(session.context.messages, tools, {
              onChunk: callbacks?.onStreamChunk,
              abortSignal: this.abortSignal,
            });
            content = content + (continuation.content || '');
            if (continuation.content) {
              thinking.push(continuation.content);
            }
          }

          this.sessionManager.addMessage(sessionId, {
            role: 'assistant',
            content,
            timestamp: Date.now(),
          });
          return { thinking, finalReply: content };
        }

        // 有工具调用，添加到会话
        this.sessionManager.addMessage(sessionId, {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
          timestamp: Date.now(),
        });

        // 执行所有工具调用
        for (const toolCall of response.tool_calls) {
          this.checkAborted();
          
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);
          
          if (callbacks?.onToolCall) {
            callbacks.onToolCall(toolName, toolArgs);
          }

          const result = await this.toolRegistry.execute(toolName, toolArgs, session);
          
          if (callbacks?.onToolResult) {
            callbacks.onToolResult(toolName, result);
          }

          this.sessionManager.addMessage(sessionId, {
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
            timestamp: Date.now(),
          });
        }
      }

      // 达到最大迭代次数
      this.checkAborted();
      this.sessionManager.addMessage(sessionId, {
        role: 'system',
        content: '已达到最大迭代次数。请基于已收集的信息给出当前进展和下一步建议。',
        timestamp: Date.now(),
      });

      const finalResponse = await this.llmService.chatStream(session.context.messages, tools, {
        onChunk: callbacks?.onStreamChunk,
        abortSignal: this.abortSignal,
      });
      const finalReply = finalResponse.content || '处理超时，请重试';
      
      this.sessionManager.addMessage(sessionId, {
        role: 'assistant',
        content: finalReply,
        timestamp: Date.now(),
      });

      return { thinking, finalReply };
    } catch (error: any) {
      // 检查是否是被中断的错误
      if (this.abortSignal?.aborted || error.message?.includes('中断')) {
        const abortReason = this.abortSignal?.reason || '用户中断';
        callbacks?.onAbort?.(abortReason);
        return { 
          thinking, 
          finalReply: `[已中断] ${abortReason}`,
          aborted: true 
        };
      }
      throw error;
    }
  }

  /**
   * 处理系统命令
   */
  private handleSystemCmd(message: string): string {
    const lower = message.toLowerCase().trim();
    if (lower === '/reset' || lower.includes('重置')) {
      return '会话已重置（请在 UI 中执行实际重置操作）。';
    }
    if (lower === '/help' || lower.includes('帮助')) {
      return '可用命令: /reset 重置会话, /status 查看状态, /skills 查看 skills, /tools 查看工具。';
    }
    if (lower === '/status' || lower.includes('状态')) {
      const status = this.getStatus();
      return `系统状态: ${status.skills} 个 skills, ${status.tools} 个工具。`;
    }
    return '未知系统命令。';
  }

  async shutdown(): Promise<void> {
    console.log('[StarUpCore] Shutting down...');
    await this.scheduler.shutdown();
    this.skillRegistry.stopAutoScan();
    console.log('[StarUpCore] Shutdown complete');
  }

  /**
   * 检测文本是否可能截断
   */
  private seemsTruncated(content: string): boolean {
    if (!content || content.length < 20) return false;
    const trimmed = content.trim();
    if (/[:：，,\-\—]$/.test(trimmed)) return true;
    if (content.length > 100 && !/[。\.!?！？]$/.test(trimmed)) return true;
    if (/让我$|我将$|正在$|如下$|步骤$/.test(trimmed)) return true;
    return false;
  }
}

export default StarUpCore;
