/**
 * StarUp - AI 助手运行时环境与集成平台
 * v1.3-simple: 大道至简版
 */

import { SessionManager, sessionManager } from './core/session/SessionManager';
import { MemoryManager, memoryManager } from './core/memory/MemoryManager';
import { ToolRegistry, toolRegistry } from './core/tools/ToolRegistry';
import { skillRegistry } from './core/skills/SkillRegistry';
import { metaClawhubSkill } from './core/skills/MetaClawhubSkill';
import { intentRouter } from './core/intent/IntentRouter';
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
      intentRouter.setLLMService(this.llmService);
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
   */
  async processMessage(sessionId: string, message: string, onToolCall?: (name: string, args: any) => void): Promise<string> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // 意图分类
    const intent = await intentRouter.recognize(message, {
      session,
      recentMessages: [],
      userPreferences: {},
    });

    console.log(`[StarUpCore] Intent: ${intent.intent_id}, target: ${intent.routing.target}`);

    // system_cmd 直接处理
    if (intent.intent_id === 'system_cmd') {
      const reply = this.handleSystemCmd(message);
      this.sessionManager.addMessage(sessionId, { role: 'user', content: message, timestamp: Date.now() });
      this.sessionManager.addMessage(sessionId, { role: 'assistant', content: reply, timestamp: Date.now() });
      return reply;
    }

    // 把意图信息注入到用户消息中，帮助 LLM 理解
    let enrichedMessage = message;
    if (intent.intent_id === 'use_skill' && intent.matched_skill) {
      enrichedMessage = `[用户意图: 使用 skill "${intent.matched_skill}"] ${message}`;
    } else if (intent.intent_id === 'code_help') {
      enrichedMessage = `[用户意图: 代码相关帮助] ${message}`;
    } else if (intent.intent_id === 'memory_query') {
      enrichedMessage = `[用户意图: 查询历史记忆] ${message}`;
    }

    this.sessionManager.addMessage(sessionId, {
      role: 'user',
      content: enrichedMessage,
      timestamp: Date.now(),
    });

    if (this.llmService) {
      const tools = this.toolRegistry.getToolDescriptions();
      const maxIterations = 20;
      let iteration = 0;

      while (iteration < maxIterations) {
        iteration++;
        const response = await this.llmService.chat(session.context.messages, tools);

        if (!response.tool_calls || response.tool_calls.length === 0) {
          let content = response.content || '';
          // 截断恢复：如果回复明显未完成，请求续写
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
            this.sessionManager.addMessage(sessionId, {
              role: 'assistant',
              content,
              timestamp: Date.now(),
            });
            return content;
          }
          this.sessionManager.addMessage(sessionId, {
            role: 'assistant',
            content,
            timestamp: Date.now(),
          });
          return content;
        }

        this.sessionManager.addMessage(sessionId, {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
          timestamp: Date.now(),
        });

        for (const toolCall of response.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);
          if (onToolCall) {
            onToolCall(toolName, toolArgs);
          }
          const result = await this.toolRegistry.execute(toolName, toolArgs, session);
          this.sessionManager.addMessage(sessionId, {
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
            timestamp: Date.now(),
          });
        }
      }

      this.sessionManager.addMessage(sessionId, {
        role: 'system',
        content: '已达到最大迭代次数。请基于已收集的信息给出当前进展和下一步建议。',
        timestamp: Date.now(),
      });

      const finalResponse = await this.llmService.chat(session.context.messages, tools);
      this.sessionManager.addMessage(sessionId, {
        role: 'assistant',
        content: finalResponse.content,
        timestamp: Date.now(),
      });
      return finalResponse.content;
    }

    return 'LLM service not configured';
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
    // 以冒号、逗号、连接号结尾通常表示未完待续
    if (/[:：，,\-\—]$/.test(trimmed)) return true;
    // 如果没有结束标点且长度较长，可能截断
    if (content.length > 100 && !/[。\.!?！？]$/.test(trimmed)) return true;
    // 如果最后一段以"让我"、"我将"等开头词开头但没有结尾
    if (/让我$|我将$|正在$|如下$|步骤$/.test(trimmed)) return true;
    return false;
  }
}

export default StarUpCore;
