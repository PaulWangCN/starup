/**
 * StarUp - AI 助手运行时环境与集成平台
 * v1.3-simple: 大道至简版
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './utils/Logger';
import { SessionManager, sessionManager } from './core/session/SessionManager';
import { MemoryManager, memoryManager } from './core/memory/MemoryManager';
import { ToolRegistry, toolRegistry } from './core/tools/ToolRegistry';
import { skillRegistry } from './core/skills/SkillRegistry';
import { LLMService } from './core/llm/LLMService';
import { TaskScheduler, taskScheduler } from './core/scheduler/TaskScheduler';
import { sessionSnapshotManager } from './core/session/SessionSnapshot';
import { sessionPersistence } from './core/persistence/SessionPersistence';
import { selfHealing } from './core/resilience/SelfHealing';
import { kairosEngine, KairosEngine } from './core/kairos/KairosEngine';
import {
  applyMicroCompact,
  autoCompactIfNeeded,
  reactiveCompact,
  estimateMessagesTokens,
} from './core/compact';
import { SystemConfig } from './types';

export * from './types';
export * from './core/session';
export * from './core/memory/MemoryManager';
export * from './core/tools/ToolRegistry';
export * from './core/skills';
export * from './core/llm/LLMService';
export { 
  BaseLLMProvider, 
  OpenAICompatibleProvider, 
  AnthropicProvider,
  GoogleProvider,
  AlibabaProvider,
  OllamaProvider,
  createLLMProvider,
  getModelCapabilities,
  SUPPORTED_MODELS,
  LLMResponse,
  LLMStreamCallbacks
} from './core/llm/LLMProviders';
export { 
  ModelRouter, 
  modelRouter,
  TaskType,
  RoutingStrategy,
  ModelSelection
} from './core/llm/ModelRouter';
export * from './core/scheduler/TaskScheduler';
export * from './core/prompt';
export * from './core/intent';
export { StarUpDatabase, SessionRecord, SessionSnapshot as DBSessionSnapshot, PendingTask, SystemState, starupDB } from './core/persistence/Database';
export { SessionPersistence, PersistedSession, sessionPersistence } from './core/persistence/SessionPersistence';
export * from './core/resilience/SelfHealing';
export * from './core/kairos/KairosEngine';
export * from './core/orchestration/AgentTeam';
export * from './core/lsp/LSPClient';
export * from './core/codeReview/CodeReviewer';
export * from './core/project/ProjectUnderstanding';
// export * from './ui';  // UI 模块需要在单独的 React 构建流程中处理

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
  scheduler: TaskScheduler;
  kairosEngine: KairosEngine;
  onScheduledTaskComplete?: (content: string) => void;
  private config: SystemConfig;
  private systemPrompt: string | null = null;
  private selfHealingEnabled: boolean = true;

  constructor(config?: Partial<SystemConfig>) {
    this.sessionManager = sessionManager;
    this.memoryManager = memoryManager;
    this.toolRegistry = toolRegistry;
    this.skillRegistry = skillRegistry;
    this.scheduler = taskScheduler;
    this.kairosEngine = kairosEngine;

    const llmProvider = (process.env.LLM_PROVIDER as any) || 'deepseek';
    
    // Ollama 使用本地默认配置
    const isOllama = llmProvider === 'ollama';
    const defaultModel = isOllama ? 'llama3.2' : 'deepseek-chat';
    const defaultBaseUrl = isOllama ? 'http://localhost:11434/api/chat' : undefined;
    
    const llmModel = process.env.LLM_MODEL || process.env.OLLAMA_MODEL || defaultModel;

    this.config = {
      llm: {
        provider: llmProvider,
        apiKey: process.env.LLM_API_KEY || '',
        model: llmModel,
        baseUrl: process.env.LLM_BASE_URL || process.env.OLLAMA_BASE_URL || defaultBaseUrl,
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

    // 创建 LLM 服务（Ollama 不需要 API Key）
    if (this.config.llm.apiKey || this.config.llm.provider === 'ollama') {
      this.llmService = new LLMService(this.config.llm);
    }
  }

  /**
   * 初始化 Core
   */
  async initialize(): Promise<void> {
    logger.info('StarUpCore', 'Initializing...');
    
    // 校验环境变量
    this.validateConfig();
    
    // 确保配置文件存在
    await this.ensureConfigFiles();
    
    // 注入 LLM 服务到 MemoryManager（用于 AI 召回）
    if (this.llmService) {
      this.memoryManager.setLLMService(this.llmService);
      logger.info('StarUpCore', 'MemoryManager AI recall enabled');
    }
    
    // 加载 skills
    logger.info('StarUpCore', 'Loading skills...');
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
    
    // 初始化自我恢复系统
    if (this.selfHealingEnabled) {
      await selfHealing.initialize();
      selfHealing.onRecovery((action) => {
        logger.info('StarUpCore', `Self-healing action: ${action.type} - ${action.reason}`);
      });
      logger.info('StarUpCore', 'Self-healing system enabled');
    }
    
    logger.info('StarUpCore', 'Initialization complete');
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
    
    logger.debug('StarUpCore', `Config path: ${agentPath}`);
    
    // 找到实际存在的模板目录
    let templatesDir: string | null = null;
    for (const dir of possibleTemplateDirs) {
      try {
        await fs.access(dir);
        templatesDir = dir;
        logger.debug('StarUpCore', `Using templates from: ${templatesDir}`);
        break;
      } catch {
        // 目录不存在，继续尝试下一个
      }
    }
    
    if (!templatesDir) {
      logger.error('StarUpCore', 'Could not find templates directory');
      return;
    }
    
    try {
      await fs.mkdir(agentPath, { recursive: true });
      logger.debug('StarUpCore', `Ensuring config directory exists: ${agentPath}`);
      
      // 需要检查并复制的文件列表
      const filesToCheck = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md'];
      
      for (const filename of filesToCheck) {
        const targetPath = path.join(agentPath, filename);
        const templatePath = path.join(templatesDir, filename);
        
        try {
          await fs.access(targetPath);
          logger.debug('StarUpCore', `${filename} already exists`);
        } catch {
          try {
            const templateContent = await fs.readFile(templatePath, 'utf-8');
            await fs.writeFile(targetPath, templateContent, 'utf-8');
            logger.info('StarUpCore', `Created default ${filename}`);
          } catch (templateError) {
            logger.error('StarUpCore', `Failed to copy template for ${filename}:`, templateError);
          }
        }
      }
    } catch (error) {
      logger.error('StarUpCore', 'Failed to ensure config files:', error);
    }
  }

  /**
   * 校验环境变量配置
   */
  private validateConfig(): void {
    const provider = this.config.llm.provider;
    const supportedProviders = ['deepseek', 'openai', 'ollama'];
    
    if (!supportedProviders.includes(provider)) {
      logger.warn('StarUpCore', `⚠️ 未知的 LLM 提供商: ${provider}，支持的提供商: ${supportedProviders.join(', ')}`);
      return;
    }
    
    // Ollama 不需要 API Key
    if (provider !== 'ollama' && !this.config.llm.apiKey) {
      logger.warn('StarUpCore', `⚠️ LLM_API_KEY 未设置，AI 功能将被禁用`);
      logger.info('StarUpCore', '💡 提示: 复制 .env.example 为 .env 并填入 API Key');
    }
    
    if (provider === 'ollama') {
      logger.info('StarUpCore', `🦙 使用 Ollama 本地模型: ${this.config.llm.model}`);
      logger.info('StarUpCore', `   地址: ${this.config.llm.baseUrl}`);
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
    const systemCommands = ['/reset', '/help', '/status', '/skills', '/tools', '/tasks', '/clear', '/history'];
    const isExactSystemCmd = systemCommands.some((cmd) => lower === cmd || lower.startsWith(cmd + ' '));
    if (isExactSystemCmd) {
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

    // 注入相关记忆到当前会话上下文
    try {
      const memoryContexts = await this.memoryManager.injectRelevantMemories(message, session);
      if (memoryContexts.length > 0) {
        this.sessionManager.addMessage(sessionId, {
          role: 'system',
          content: `[相关记忆]\n${memoryContexts.join('\n\n')}`,
          timestamp: Date.now(),
        });
      }
    } catch (e) {
      logger.debug('StarUpCore', 'Failed to inject memories:', e);
    }

    const tools = this.toolRegistry.getToolDescriptions();
    const maxIterations = 20000000;
    let reactiveCompactAttempted = false;

    // 预创建快照，为 Session Memory 压缩提供素材
    try {
      await sessionSnapshotManager.createSnapshot(session);
    } catch {
      // 忽略快照错误
    }

    // 初始自动压缩检查
    const initialCompact = await autoCompactIfNeeded(
      session,
      session.context.messages,
      this.llmService,
      this.sessionManager,
      sessionSnapshotManager,
      this.config.llm.model
    );
    if (initialCompact.wasCompacted && initialCompact.newMessages) {
      session.context.messages = initialCompact.newMessages;
      session.context.tokenCount = initialCompact.tokensAfter ?? estimateMessagesTokens(session.context.messages);
      session.context.compressed = true;
      session.context.lastCompactAt = Date.now();
      session.context.compactCount = (session.context.compactCount ?? 0) + 1;
      const modeInfo = initialCompact.mode ? ` (${initialCompact.mode})` : '';
      console.log(
        `[StarUpCore] Auto-compacted via ${initialCompact.method}${modeInfo}, tokens: ${initialCompact.tokensBefore} -> ${initialCompact.tokensAfter}`
      );
    }

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // 第1层：微压缩
      const mc = applyMicroCompact(session.context.messages);
      if (mc.modified) {
        session.context.tokenCount = estimateMessagesTokens(session.context.messages);
        logger.debug('StarUpCore', `Micro-compact cleared ${mc.clearedCount} old tool results`);
      }

      // 第2层：自动压缩（迭代中再次检查）
      const iterCompact = await autoCompactIfNeeded(
        session,
        session.context.messages,
        this.llmService,
        this.sessionManager,
        sessionSnapshotManager,
        this.config.llm.model
      );
      if (iterCompact.wasCompacted && iterCompact.newMessages) {
        session.context.messages = iterCompact.newMessages;
        session.context.tokenCount = iterCompact.tokensAfter ?? estimateMessagesTokens(session.context.messages);
        session.context.compressed = true;
        session.context.lastCompactAt = Date.now();
        session.context.compactCount = (session.context.compactCount ?? 0) + 1;
        const modeInfo = iterCompact.mode ? ` (${iterCompact.mode})` : '';
        console.log(
          `[StarUpCore] Auto-compacted via ${iterCompact.method}${modeInfo}, tokens: ${iterCompact.tokensBefore} -> ${iterCompact.tokensAfter}`
        );
      }

      // 在每次迭代开始时触发回调，确保 ReAct 多轮调用时正确重置状态
      // 注意：截断恢复在循环外，不会触发此回调
      callbacks?.onIterationStart?.(iteration);

      let response;
      try {
        response = await this.llmService.chatStream(session.context.messages, tools, {
          onChunk: callbacks?.onStreamChunk,
        });
      } catch (error: any) {
        const errMsg = String(error.message || error);
        const isPTL =
          errMsg.includes('prompt is too long') ||
          errMsg.includes('maximum context length') ||
          errMsg.includes('context length');

        if (isPTL && !reactiveCompactAttempted) {
          reactiveCompactAttempted = true;
          const rc = await reactiveCompact(
            session,
            session.context.messages,
            this.llmService,
            this.sessionManager
          );
          if (rc.wasCompacted && rc.newMessages) {
            session.context.messages = rc.newMessages;
            session.context.tokenCount = estimateMessagesTokens(session.context.messages);
            session.context.compressed = true;
            session.context.lastCompactAt = Date.now();
            session.context.compactCount = (session.context.compactCount ?? 0) + 1;
            console.log('[StarUpCore] Reactive compact succeeded, retrying iteration');
            iteration--;
            continue;
          }
        }
        throw error;
      }

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
          content: this.safeStringify(result),
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
    logger.info('StarUpCore', 'Shutting down...');
    
    // 停止 KAIROS 引擎
    await this.kairosEngine.stop();
    
    // 停止自我恢复系统
    if (this.selfHealingEnabled) {
      await selfHealing.shutdown();
    }
    
    await this.scheduler.shutdown();
    this.skillRegistry.stopAutoScan();
    logger.info('StarUpCore', 'Shutdown complete');
  }

  /**
   * 启动 KAIROS 始终在线模式
   */
  async startKairosMode(): Promise<void> {
    await this.kairosEngine.start(this);
    logger.info('StarUpCore', 'KAIROS mode started');
  }

  /**
   * 停止 KAIROS 模式
   */
  async stopKairosMode(): Promise<void> {
    await this.kairosEngine.stop();
    logger.info('StarUpCore', 'KAIROS mode stopped');
  }

  /**
   * 安全 JSON 序列化（处理循环引用）
   */
  private safeStringify(obj: any): string {
    try {
      return JSON.stringify(obj);
    } catch (e) {
      const seen = new WeakSet();
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        if (value instanceof Error) {
          return { name: value.name, message: value.message };
        }
        return value;
      });
    }
  }

  /**
   * 注册会话进行持久化
   */
  registerSession(sessionId: string): void {
    const session = this.sessionManager.getSession(sessionId);
    if (session) {
      sessionPersistence.registerSession(session);
    }
  }

  /**
   * 取消注册会话
   */
  unregisterSession(sessionId: string): void {
    sessionPersistence.unregisterSession(sessionId);
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
