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
   * 处理消息
   */
  async processMessage(sessionId: string, message: string): Promise<string> {
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
      const response = await this.llmService.chat(
        session.context.messages,
        tools
      );

      // 处理工具调用
      if (response.tool_calls && response.tool_calls.length > 0) {
        for (const toolCall of response.tool_calls) {
          const result = await this.toolRegistry.execute(
            toolCall.function.name,
            JSON.parse(toolCall.function.arguments),
            session
          );
          
          // 添加工具结果到会话
          this.sessionManager.addMessage(sessionId, {
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
            timestamp: Date.now(),
          });
        }
        
        // 再次调用获取最终回复
        const finalResponse = await this.llmService.chat(
          session.context.messages,
          tools
        );
        
        return finalResponse.content;
      }

      return response.content;
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
