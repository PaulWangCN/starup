/**
 * Gateway
 * StarUp 系统的统一控制平面与通信枢纽
 * 化繁为简，最小化实现
 */

import { v4 as uuidv4 } from 'uuid';
import { StarUpCore, ProcessMessageCallbacks } from '../index';
import { PromptAssembler, createDefaultConfig, RuntimeContext } from '../core/prompt/PromptAssembler';
import { AdapterRegistry } from './AdapterRegistry';
import { HttpServer } from './HttpServer';
import { WebSocketServer } from './WebSocketServer';
import { GatewayConfig, ChatRequest, ChatResponse, StreamChunk, GatewayClient, ClientSession } from './types';
import { UnifiedMessage, OutgoingMessage, MessageContent } from '../types';
import { HeartbeatManager } from './HeartbeatManager';
import { logger } from '../utils/Logger';

export class Gateway {
  core: StarUpCore;
  adapters: AdapterRegistry;
  httpServer: HttpServer;
  wsServer: WebSocketServer;
  config: GatewayConfig;
  heartbeatManager: HeartbeatManager;

  private clients: Map<string, GatewayClient> = new Map();
  private clientSessions: Map<string, ClientSession> = new Map();
  private systemPrompt: string = '';
  private skillsPrompt: string = '';
  private promptAssembler: PromptAssembler | null = null;
  private running: boolean = false;

  constructor(config?: Partial<GatewayConfig>) {
    this.config = {
      httpPort: parseInt(process.env.STARUP_GATEWAY_HTTP_PORT || '18788', 10),
      wsPort: parseInt(process.env.STARUP_GATEWAY_WS_PORT || '18789', 10),
      token: process.env.STARUP_GATEWAY_TOKEN || '',
      enableCors: true,
      ...config,
    };

    this.core = new StarUpCore();
    this.adapters = new AdapterRegistry();
    this.httpServer = new HttpServer(this);
    this.wsServer = new WebSocketServer(this);
    this.heartbeatManager = new HeartbeatManager(this);

    // Adapter 收到消息后路由到 Gateway 处理
    this.adapters.onMessage((msg) => this.handleAdapterMessage(msg));
  }

  /**
   * 启动 Gateway
   */
  async start(): Promise<void> {
    if (this.running) return;
    
    // 显示启动横幅
    logger.printBanner('Gateway', '1.0.0');
    logger.info('Gateway', 'Starting...');

    // 1. 初始化 Core
    await this.core.initialize();

    // 2. 生成并设置系统提示词
    this.systemPrompt = await this.buildSystemPrompt();
    this.core.setSystemPrompt(this.systemPrompt);

    // 3. 加载 skills 提示词
    await this.loadSkillsPrompt();

    // 4. 设置 skills 更新监听
    this.core.skillRegistry.setOnSkillsUpdated(() => {
      this.handleSkillsUpdated();
    });

    // 5. 启动服务
    await this.httpServer.start(this.config.httpPort);
    await this.wsServer.start(this.config.wsPort);
    await this.adapters.initializeAll();
    await this.adapters.startAll();

    // 6. 启动心跳管理器
    this.heartbeatManager.start();

    this.running = true;
    logger.info('Gateway', `HTTP  : http://127.0.0.1:${this.config.httpPort}`);
    logger.info('Gateway', `WS    : ws://127.0.0.1:${this.config.wsPort}`);
    logger.info('Gateway', `Token : ${this.config.token ? '已启用' : '未启用（仅限本地安全环境）'}`);
    logger.info('Gateway', 'Ready');
  }

  /**
   * 加载 Skills 提示词（用于注入会话）
   */
  private async loadSkillsPrompt(): Promise<void> {
    try {
      this.skillsPrompt = await this.core.skillRegistry.getSkillsIndexContent();
      logger.debug('Gateway', `Skills prompt loaded (${this.skillsPrompt.length} chars)`);
    } catch (error) {
      logger.error('Gateway', 'Failed to load skills prompt:', error);
      this.skillsPrompt = '';
    }
  }

  /**
   * Skills 更新时处理
   */
  private async handleSkillsUpdated(): Promise<void> {
    console.log('[Gateway] Skills updated, reloading...');
    await this.loadSkillsPrompt();
    
    // 更新所有活跃会话的 skills 信息
    const activeSessions = this.core.sessionManager.getActiveSessions();
    for (const session of activeSessions) {
      if (session.type === 'main') {
        this.core.sessionManager.addMessage(session.id, {
          role: 'system',
          content: `[Skills 已更新]\n${this.skillsPrompt}`,
          timestamp: Date.now(),
        });
      }
    }
    logger.info('Gateway', `Updated ${activeSessions.length} active sessions with new skills`);
  }

  /**
   * 停止 Gateway
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    logger.info('Gateway', 'Stopping...');
    this.running = false;

    this.heartbeatManager.stop();
    await this.wsServer.stop();
    await this.httpServer.stop();
    await this.adapters.stopAll();
    await this.core.shutdown();

    logger.info('Gateway', 'Stopped');
  }

  /**
   * 验证 Token
   */
  verifyToken(token: string): boolean {
    if (!this.config.token) return true;
    return token === this.config.token;
  }

  /**
   * 注册客户端
   */
  registerClient(client: GatewayClient): void {
    this.clients.set(client.id, client);
    logger.info('Gateway', `Client registered: ${client.id} (${client.role})`);
  }

  /**
   * 移除客户端
   */
  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    // 清理该客户端的会话映射，但保留会话本身（支持重连）
    const keysToDelete: string[] = [];
    for (const [key, cs] of this.clientSessions) {
      if (cs.clientId === clientId) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.clientSessions.delete(key);
    }
    logger.info('Gateway', `Client removed: ${clientId}`);
  }

  /**
   * 获取或创建客户端会话
   */
  getOrCreateSession(clientId: string, channel?: string): string {
    const key = channel ? `${channel}:${clientId}` : clientId;
    const existing = this.clientSessions.get(key);
    if (existing) {
      existing.updatedAt = Date.now();
      return existing.sessionId;
    }

    // 创建会话，注入 system prompt 和 skills
    const fullPrompt = this.buildFullPrompt();
    const session = this.core.sessionManager.createStandaloneSession(fullPrompt);
    
    const cs: ClientSession = {
      clientId,
      sessionId: session.id,
      channel,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.clientSessions.set(key, cs);
    logger.debug('Gateway', `Session created for ${clientId} with skills injected`);
    return session.id;
  }

  /**
   * 构建完整的系统提示词（包含 skills）
   */
  private buildFullPrompt(): string {
    const parts: string[] = [];
    
    if (this.systemPrompt) {
      parts.push(this.systemPrompt);
    }
    
    if (this.skillsPrompt) {
      parts.push('');
      parts.push('<!-- L5_SKILLS: 已安装的 Skills -->');
      parts.push(this.skillsPrompt);
      parts.push('<!-- END L5_SKILLS -->');
    }
    
    return parts.join('\n');
  }

  /**
   * 获取会话 ID（如果不存在返回 null）
   */
  getSessionId(clientId: string, channel?: string): string | null {
    const key = channel ? `${channel}:${clientId}` : clientId;
    return this.clientSessions.get(key)?.sessionId || null;
  }

  /**
   * 销毁客户端会话
   */
  destroySession(clientId: string, channel?: string): void {
    const key = channel ? `${channel}:${clientId}` : clientId;
    const cs = this.clientSessions.get(key);
    if (cs) {
      this.core.sessionManager.destroySession(cs.sessionId);
      this.clientSessions.delete(key);
    }
  }

  /**
   * 通过 sessionId 销毁会话
   */
  destroySessionById(sessionId: string): boolean {
    for (const [key, cs] of this.clientSessions) {
      if (cs.sessionId === sessionId) {
        this.core.sessionManager.destroySession(sessionId);
        this.clientSessions.delete(key);
        return true;
      }
    }
    return false;
  }

  /**
   * 处理聊天请求（HTTP / WS / Adapter 统一入口）
   */
  async handleChatRequest(
    request: ChatRequest,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResponse> {
    const clientId = request.clientId || uuidv4();
    const sessionId = request.sessionId || this.getOrCreateSession(clientId, request.channel);
    logger.debug('Gateway', `handleChatRequest clientId=${clientId}, msg=${request.message.slice(0, 50)}${request.message.length > 50 ? '...' : ''}`);

    const callbacks: ProcessMessageCallbacks = {};
    const thinking: string[] = [];

    if (onChunk) {
      callbacks.onThinking = (content) => {
        thinking.push(content);
        onChunk({ type: 'thinking', data: content });
      };
      callbacks.onToolCall = (name, args) => {
        onChunk({ type: 'tool_call', data: { name, args } });
      };
      callbacks.onToolResult = (name, result) => {
        onChunk({ type: 'tool_result', data: { name, result } });
      };
      callbacks.onStreamChunk = (chunk) => {
        onChunk({ type: 'content', data: chunk });
      };
    }

    try {
      const result = await this.core.processMessage(sessionId, request.message, callbacks);
      logger.debug('Gateway', `processMessage success, reply=${result.finalReply.slice(0, 80)}${result.finalReply.length > 80 ? '...' : ''}`);
      if (onChunk) {
        onChunk({ type: 'done', data: result.finalReply });
      }
      return {
        sessionId,
        message: result.finalReply,
        thinking: result.thinking,
        done: true,
      };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      logger.error('Gateway', 'processMessage error:', errMsg);
      if (onChunk) {
        onChunk({ type: 'done', data: errMsg });
      }
      return {
        sessionId,
        message: errMsg,
        thinking,
        done: true,
      };
    }
  }

  /**
   * 处理来自 Adapter 的消息
   */
  private async handleAdapterMessage(msg: UnifiedMessage): Promise<void> {
    const chatId = msg.metadata?.chat_id;
    const userId = msg.sender.id;
    const clientId = chatId ? `${msg.channel}:${chatId}` : `${msg.channel}:${userId}`;
    
    // 记录用户最近使用的渠道
    this.heartbeatManager.recordUserChannel(userId, msg.channel);
    
    logger.debug('Gateway', `Adapter message from ${msg.channel}, clientId=${clientId}, chatId=${chatId || 'none'}`);

    const response = await this.handleChatRequest({
      clientId,
      channel: msg.channel,
      message: msg.content.type === 'text' ? msg.content.body : JSON.stringify(msg.content.body),
      metadata: msg.metadata,
    });

    logger.debug('Gateway', `AI response: ${response.message.slice(0, 100)}${response.message.length > 100 ? '...' : ''}`);

    // 通过 Adapter 发送回去
    const outgoing: OutgoingMessage = {
      channel: msg.channel,
      target: chatId ? { group_id: chatId } : { user_id: msg.sender.id },
      content: {
        type: 'text',
        body: response.message,
      },
    };

    try {
      await this.adapters.sendTo(msg.channel, outgoing);
      logger.info('Gateway', `Response sent via ${msg.channel}`);
    } catch (err) {
      logger.error('Gateway', `Failed to send response via adapter ${msg.channel}:`, err);
    }
  }

  /**
   * 构建系统提示词
   */
  private async buildSystemPrompt(): Promise<string> {
    try {
      const promptConfig = createDefaultConfig();
      this.promptAssembler = new PromptAssembler(
        promptConfig,
        this.core.toolRegistry,
        this.core.skillRegistry
      );

      const runtimeContext: RuntimeContext = {
        timestamp: Date.now(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        activeSessions: this.core.sessionManager.getActiveSessions().length,
        systemStatus: 'healthy',
        memoryUsage: {
          used: process.memoryUsage().heapUsed,
          total: process.memoryUsage().heapTotal,
        },
        requestId: Math.random().toString(36).substring(7),
      };

      const assembled = await this.promptAssembler.assemble('default', runtimeContext);
      if (!assembled.layers.L0_AGENTS || !assembled.layers.L1_SOUL) {
        logger.error('Gateway', 'Critical prompt layers missing, using fallback.');
        return this.getFallbackSystemPrompt();
      }
      return assembled.content;
    } catch (error) {
      logger.error('Gateway', 'Failed to build system prompt:', error);
      return this.getFallbackSystemPrompt();
    }
  }

  private getFallbackSystemPrompt(): string {
    return '你是 StarUp Gateway AI，一个专业的 AI 助手。请检查 ./.starup/ 目录下的配置文件。';
  }

  /**
   * 加载默认适配器（根据环境变量）
   */
  async loadDefaultAdapters(): Promise<void> {
    // 飞书
    if (process.env.FEISHU_ENABLED === 'true') {
      const { feishuConnector } = await import('../channels/feishu/FeishuConnector');
      await feishuConnector.initialize({
        name: 'feishu',
        enabled: true,
        credentials: {
          app_id: process.env.FEISHU_APP_ID || '',
          app_secret: process.env.FEISHU_APP_SECRET || '',
        },
      });
      this.adapters.register(feishuConnector);
      logger.info('Gateway', 'Feishu adapter registered');
    }

    // Telegram
    if (process.env.TELEGRAM_ENABLED === 'true') {
      const { telegramConnector } = await import('../channels/telegram/TelegramConnector');
      await telegramConnector.initialize({
        name: 'telegram',
        enabled: true,
        credentials: {
          token: process.env.TELEGRAM_BOT_TOKEN || '',
        },
      });
      this.adapters.register(telegramConnector);
      logger.info('Gateway', 'Telegram adapter registered');
    }

    // 钉钉
    if (process.env.DINGTALK_ENABLED === 'true') {
      const { dingtalkConnector } = await import('../channels/dingtalk/DingTalkConnector');
      await dingtalkConnector.initialize({
        name: 'dingtalk',
        enabled: true,
        credentials: {
          client_id: process.env.DINGTALK_CLIENT_ID || process.env.DINGTALK_APP_KEY || '',
          client_secret: process.env.DINGTALK_CLIENT_SECRET || process.env.DINGTALK_APP_SECRET || '',
        },
      });
      this.adapters.register(dingtalkConnector);
      logger.info('Gateway', 'DingTalk adapter registered');
    }
  }

  /**
   * 获取 Gateway 状态
   */
  getStatus(): {
    running: boolean;
    clients: number;
    sessions: number;
    adapters: string[];
    core: { skills: number; tools: number };
  } {
    return {
      running: this.running,
      clients: this.clients.size,
      sessions: this.clientSessions.size,
      adapters: this.adapters.list(),
      core: this.core.getStatus(),
    };
  }
}
