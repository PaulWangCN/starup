/**
 * StarUp - AI 助手运行时环境与集成平台
 * v1.3-simple: 大道至简版
 */

import { SessionManager, sessionManager } from './core/session/SessionManager';
import { MemoryManager, memoryManager } from './core/memory/MemoryManager';
import { ToolRegistry, toolRegistry } from './core/tools/ToolRegistry';
import { skillRegistry } from './core/skills/SkillRegistry';
import { metaClawhubSkill } from './core/skills/MetaClawhubSkill';
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
    await this.skillRegistry.initialize();
    await metaClawhubSkill.initialize();
    console.log('[StarUpCore] Initialization complete');
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
      const response = await this.llmService.chat(session.context.messages, tools);

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
          const continuation = await this.llmService.chat(session.context.messages, tools);
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

    const finalResponse = await this.llmService.chat(session.context.messages, tools);
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
