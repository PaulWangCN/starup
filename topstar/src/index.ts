/**
 * StarUp - AI 助手运行时环境与集成平台
 * v1.2: Skill 生态系统
 */

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
    
    // 默认配置
    this.config = {
      llm: {
        provider: 'deepseek',
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        model: 'deepseek-chat',
        temperature: 0.7,
        maxTokens: 4096,
      },
      channels: [],
      cron: [],
      heartbeat: { interval: 1800000, tasks: [] },
      memory: {
        compressionThreshold: 8000,
        vectorDbEnabled: false,
      },
      sandbox: {
        enabled: true,
        timeout: 300,
      },
      ...config,
    } as SystemConfig;
    
    // 创建 LLM 服务（如果提供了 API key）
    if (this.config.llm.apiKey) {
      this.llmService = new LLMService(this.config.llm);
    }
  }

  /**
   * 初始化 Core
   */
  async initialize(): Promise<void> {
    console.log('[StarUpCore] Initializing...');
    
    // 初始化 SkillRegistry（包含 InstallManager 和 SkillRuntime）
    await this.skillRegistry.initialize();
    
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

    // 添加用户消息到会话
    this.sessionManager.addMessage(sessionId, {
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    // 如果 LLM 服务可用，调用它
    if (this.llmService) {
      const tools = this.toolRegistry.getToolDescriptions();
      const maxIterations = 10; // 防止无限循环
      let iteration = 0;
      
      while (iteration < maxIterations) {
        iteration++;
        console.log(`[StarUpCore] ReAct iteration ${iteration}`);
        
        const response = await this.llmService.chat(
          session.context.messages,
          tools
        );

        // 如果没有工具调用，直接返回结果
        if (!response.tool_calls || response.tool_calls.length === 0) {
          // 添加 assistant 的最终回复到会话
          this.sessionManager.addMessage(sessionId, {
            role: 'assistant',
            content: response.content,
            timestamp: Date.now(),
          });
          return response.content;
        }

        // 有工具调用，先添加 assistant 的消息
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
          
          console.log(`[StarUpCore] Tool call: ${toolName}(${JSON.stringify(toolArgs)})`);
          
          // 通知外部（用于显示工具调用）
          if (onToolCall) {
            onToolCall(toolName, toolArgs);
          }
          
          const result = await this.toolRegistry.execute(
            toolName,
            toolArgs,
            session
          );
          
          console.log(`[StarUpCore] Tool result: ${JSON.stringify(result).substring(0, 200)}`);
          
          // 添加工具结果到会话
          this.sessionManager.addMessage(sessionId, {
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
            timestamp: Date.now(),
          });
        }
        
        // 继续循环，让 AI 观察结果并决定下一步
      }
      
      // 达到最大迭代次数
      return '[达到最大迭代次数，请简化您的请求]';
    }

    return 'LLM service not configured';
  }

  /**
   * 关闭 Core
   */
  async shutdown(): Promise<void> {
    console.log('[StarUpCore] Shutting down...');
    console.log('[StarUpCore] Shutdown complete');
  }
}

// 默认导出
export default StarUpCore;
