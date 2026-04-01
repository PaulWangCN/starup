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
import { SystemConfig } from './types';

export * from './types';
export * from './core/session';
export * from './core/memory/MemoryManager';
export * from './core/tools/ToolRegistry';
export * from './core/skills';
export * from './core/llm/LLMService';
export * from './core/prompt';
export * from './core/intent';

export interface ProcessMessageCallbacks {
  onThinking?: (content: string) => void;
  onToolCall?: (name: string, args: any) => void;
  onToolResult?: (name: string, result: any) => void;
  onStreamChunk?: (chunk: string) => void;
  onIterationStart?: (iteration: number) => void;
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
  private config: SystemConfig;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatSessionId: string | null = null;
  private systemPrompt: string | null = null;

  constructor(config?: Partial<SystemConfig>) {
    this.sessionManager = sessionManager;
    this.memoryManager = memoryManager;
    this.toolRegistry = toolRegistry;
    this.skillRegistry = skillRegistry;

    this.config = {
      llm: {
        provider: 'deepseek',
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        model: 'deepseek-chat',
        temperature: 0.7,
        maxTokens: 8192,
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
    
    // 启动心跳定时器
    this.startHeartbeatTimer();
    
    console.log('[StarUpCore] Initialization complete');
  }

  /**
   * 设置系统提示词（用于心跳会话）
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * 启动心跳定时器
   */
  private startHeartbeatTimer(): void {
    if (this.heartbeatTimer) return;
    const interval = this.config.heartbeat?.interval || 1800000;
    this.heartbeatTimer = setInterval(() => {
      this.runHeartbeat().catch(() => {
        // 静默忽略心跳错误，避免打扰用户
      });
    }, interval);
    console.log(`[StarUpCore] Heartbeat timer started (interval: ${interval}ms)`);
  }

  /**
   * 执行一次心跳任务
   */
  private async runHeartbeat(): Promise<void> {
    if (!this.systemPrompt || !this.llmService) {
      return;
    }

    const localDir = path.join(process.cwd(), '.starup');
    const heartbeatPath = path.join(localDir, 'HEARTBEAT.md');

    let heartbeatContent: string;
    try {
      heartbeatContent = await fs.readFile(heartbeatPath, 'utf-8');
    } catch {
      // HEARTBEAT.md 不存在或无法读取，跳过本次心跳
      return;
    }

    if (!heartbeatContent.trim()) {
      return;
    }

    // 确保心跳会话存在
    if (!this.heartbeatSessionId) {
      const session = this.sessionManager.createStandaloneSession(this.systemPrompt);
      this.heartbeatSessionId = session.id;
    }

    try {
      await this.processMessage(this.heartbeatSessionId, heartbeatContent.trim());
    } catch (error) {
      // 静默忽略，用户无感知
    } finally {
      // 清理心跳会话历史，只保留 system prompt，避免上下文无限膨胀
      const session = this.sessionManager.getSession(this.heartbeatSessionId);
      if (session) {
        session.context.messages = session.context.messages.filter((m) => m.role === 'system');
        session.updatedAt = Date.now();
      }
    }
  }

  /**
   * 停止心跳定时器
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      console.log('[StarUpCore] Heartbeat timer stopped');
    }
    if (this.heartbeatSessionId) {
      try {
        this.sessionManager.destroySession(this.heartbeatSessionId);
      } catch {
        // ignore
      }
      this.heartbeatSessionId = null;
    }
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
    const { legacy, packages } = this.skillRegistry.list();
    return {
      skills: legacy.length + packages.length,
      tools: this.toolRegistry.getAll().length,
    };
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
  ): Promise<{ thinking: string[]; finalReply: string }> {
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
    const maxIterations = 10;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      callbacks?.onIterationStart?.(iteration);
      const response = await this.llmService.chatStream(session.context.messages, tools, {
        onChunk: callbacks?.onStreamChunk,
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
    this.sessionManager.addMessage(sessionId, {
      role: 'system',
      content: '已达到最大迭代次数。请基于已收集的信息给出当前进展和下一步建议。',
      timestamp: Date.now(),
    });

    const finalResponse = await this.llmService.chatStream(session.context.messages, tools, {
      onChunk: callbacks?.onStreamChunk,
    });
    const finalReply = finalResponse.content || '处理超时，请重试';
    
    this.sessionManager.addMessage(sessionId, {
      role: 'assistant',
      content: finalReply,
      timestamp: Date.now(),
    });

    return { thinking, finalReply };
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
    this.stopHeartbeat();
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
