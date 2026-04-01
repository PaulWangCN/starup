import 'dotenv/config';
import { sessionManager } from './core/session/SessionManager';
import { sessionSnapshotManager, SessionSnapshotManager } from './core/session/SessionSnapshot';
import { contextManager, ContextManager } from './core/session/ContextManager';
import { modelRouter, ModelRouter } from './core/intent/ModelRouter';
import { toolRegistry } from './core/tools/ToolRegistry';
import { memoryManager } from './core/memory/MemoryManager';
import { skillRegistry } from './core/skills/SkillRegistry';
import { LLMService } from './core/llm/LLMService';
import { feishuConnector } from './connectors/feishu/FeishuConnector';
import { PromptAssembler, createDefaultConfig, RuntimeContext } from './core/prompt';
import { Session, UnifiedMessage, ToolResult, SpawnOptions } from './types';

/**
 * StarUp Core
 * AI助手运行时环境与集成平台
 */
export class StarUpCore {
  private llmService: LLMService | null = null;
  private promptAssembler: PromptAssembler | null = null;
  private initialized: boolean = false;

  /**
   * 初始化系统
   */
  async initialize(): Promise<void> {
    console.log('=================================');
    console.log('  StarUp - AI Runtime Platform  ');
    console.log('=================================\n');

    // 1. 初始化 Memory 系统
    console.log('[Core] Initializing Memory Manager...');
    await memoryManager.ensureDirectories();

    // 2. 加载 Skills
    console.log('[Core] Loading Skills...');
    await skillRegistry.initialize();

    // 3. 初始化 Prompt 组装器并组装系统提示词
    console.log('[Core] Initializing Prompt Assembler...');
    const promptConfig = createDefaultConfig();
    this.promptAssembler = new PromptAssembler(promptConfig, toolRegistry, skillRegistry);
    
    const runtimeContext: RuntimeContext = {
      timestamp: Date.now(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      activeSessions: 1,
      systemStatus: 'healthy',
      memoryUsage: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
      },
      requestId: 'init',
    };
    
    const assembledPrompt = await this.promptAssembler.assemble('default', runtimeContext);
    console.log(`[Core] System prompt assembled: ${assembledPrompt.tokenCount} tokens`);

    // 4. 初始化主会话（注入系统提示词）
    console.log('[Core] Initializing Main Session...');
    const mainSession = sessionManager.initializeMainSession(assembledPrompt.content);
    console.log(`[Core] Main Session ID: ${mainSession.id}`);

    // 5. 初始化 LLM 服务
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (apiKey) {
      this.llmService = new LLMService({
        provider: 'deepseek',
        apiKey,
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        baseUrl: process.env.DEEPSEEK_BASE_URL,
      });
      console.log('[Core] LLM Service initialized (DeepSeek)');
    } else {
      console.warn('[Core] No API key found, LLM Service not available');
    }

    // 6. 初始化 Channel Connectors
    const feishuEnabled = process.env.FEISHU_ENABLED === 'true';
    if (feishuEnabled) {
      await feishuConnector.initialize({
        name: 'feishu',
        enabled: true,
        credentials: {
          app_id: process.env.FEISHU_APP_ID || '',
          app_secret: process.env.FEISHU_APP_SECRET || '',
        },
      });

      feishuConnector.onMessage((msg) => this.handleIncomingMessage(msg));
      await feishuConnector.start();
    }

    this.initialized = true;
    console.log('\n[Core] Initialization complete!\n');
  }

  /**
   * 处理消息
   */
  async processMessage(
    sessionId: string,
    userMessage: string,
    useTools: boolean = true
  ): Promise<string> {
    if (!this.initialized) {
      throw new Error('StarUp Core not initialized');
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // 添加用户消息到上下文
    sessionManager.addMessage(sessionId, {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // 如果没有 LLM 服务，返回提示
    if (!this.llmService) {
      return 'LLM Service not available. Please configure API key.';
    }

    // 获取可用工具和 Skills
    let tools: any[] = [];
    if (useTools) {
      tools = toolRegistry.getToolDescriptions();
      // 添加 Skills 描述
      const skills = skillRegistry.getSkillDescriptions();
      if (skills.length > 0) {
        sessionManager.addMessage(sessionId, {
          role: 'system',
          content: `Available Skills: ${JSON.stringify(skills)}`,
          timestamp: Date.now(),
        });
      }
    }

    // 调用 LLM
    const response = await this.llmService.chat(session.context.messages, tools);

    // 处理工具调用
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        const result = await this.executeTool(session, toolCall);
        
        // 添加工具调用结果到上下文
        sessionManager.addMessage(sessionId, {
          role: 'assistant',
          content: '',
          tool_calls: [toolCall],
          timestamp: Date.now(),
        });
        
        sessionManager.addMessage(sessionId, {
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
          timestamp: Date.now(),
        });
      }

      // 再次调用 LLM 获取最终回复
      const finalResponse = await this.llmService.chat(session.context.messages);
      
      sessionManager.addMessage(sessionId, {
        role: 'assistant',
        content: finalResponse.content,
        timestamp: Date.now(),
      });

      return finalResponse.content;
    }

    // 直接返回回复
    sessionManager.addMessage(sessionId, {
      role: 'assistant',
      content: response.content,
      timestamp: Date.now(),
    });

    return response.content;
  }

  /**
   * 创建子代理
   */
  async spawnSubAgent(parentId: string, options: SpawnOptions): Promise<Session> {
    return sessionManager.spawnSubAgent(parentId, options);
  }

  /**
   * 获取会话管理器
   */
  getSessionManager() {
    return sessionManager;
  }

  /**
   * 获取工具注册表
   */
  getToolRegistry() {
    return toolRegistry;
  }

  /**
   * 获取 Skill 注册表
   */
  getSkillRegistry() {
    return skillRegistry;
  }

  /**
   * 获取 Memory 管理器
   */
  getMemoryManager() {
    return memoryManager;
  }

  /**
   * 获取会话快照管理器
   */
  getSessionSnapshotManager() {
    return sessionSnapshotManager;
  }

  /**
   * 获取上下文管理器
   */
  getContextManager() {
    return contextManager;
  }

  /**
   * 获取模型路由器
   */
  getModelRouter() {
    return modelRouter;
  }

  /**
   * 获取系统状态
   */
  getStatus(): {
    initialized: boolean;
    sessions: number;
    skills: number;
    tools: number;
  } {
    return {
      initialized: this.initialized,
      sessions: sessionManager.getStats().total,
      skills: skillRegistry.getAll().length,
      tools: toolRegistry.getAll().length,
    };
  }

  // ==================== 私有方法 ====================

  private async handleIncomingMessage(message: UnifiedMessage): Promise<void> {
    console.log(`[Core] Received message from ${message.channel}: ${message.sender.name}`);

    // 处理消息...
    // 这里应该路由到合适的会话进行处理
  }

  private async executeTool(session: Session, toolCall: any): Promise<ToolResult> {
    const { name, arguments: argsStr } = toolCall.function;
    const args = JSON.parse(argsStr);

    console.log(`[Core] Executing tool: ${name}`, args);

    return toolRegistry.execute(name, args, session);
  }
}

// 导出单例（向后兼容）
export const starup = new StarUpCore();

// 导出新的管理器
export { sessionSnapshotManager, SessionSnapshotManager } from './core/session/SessionSnapshot';
export { contextManager, ContextManager } from './core/session/ContextManager';
export { modelRouter, ModelRouter } from './core/intent/ModelRouter';

// 重新导出类型
export type { SessionSnapshot, Entity, Task } from './core/session/SessionSnapshot';
export type { ContextCarryState } from './core/session/ContextManager';
export type { ModelRoutingConfig, ModelRouteResult, UsageStats } from './core/intent/ModelRouter';

// 注意：CLI 入口在 cli.ts，使用 npm run chat 启动
