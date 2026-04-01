import axios, { AxiosInstance } from 'axios';
import * as lark from '@larksuiteoapi/node-sdk';
import {
  ChannelConnector,
  ChannelConfig,
  UnifiedMessage,
  OutgoingMessage,
  MessageContent,
} from '../../types';

/**
 * 飞书消息类型
 */
interface FeishuMessage {
  message_id: string;
  sender: {
    sender_id: { open_id: string };
    sender_type: string;
  };
  message_type: string;
  content: string;
  create_time: string;
  chat_id?: string;
}

/**
 * 飞书连接器
 * 使用飞书官方 SDK 的 WebSocket 长连接接收消息
 * 不需要公网地址即可接收事件
 */
export class FeishuConnector implements ChannelConnector {
  name: string = 'feishu';

  private config: ChannelConfig | null = null;
  private httpClient: AxiosInstance | null = null;
  private tenantAccessToken: string = '';
  private tokenExpiry: number = 0;
  private messageCallback: ((message: UnifiedMessage) => void) | null = null;
  private tokenRefreshTimer: NodeJS.Timeout | null = null;

  // 官方 SDK 客户端
  private wsClient: lark.WSClient | null = null;
  private eventDispatcher: lark.EventDispatcher | null = null;

  /**
   * 初始化连接器
   */
  async initialize(config?: ChannelConfig): Promise<void> {
    if (config) {
      this.config = config;
    }
    if (!this.config) {
      return;
    }
    if (!this.config.enabled) {
      console.log('[FeishuConnector] Disabled');
      return;
    }
    if (this.httpClient) {
      return;
    }

    this.httpClient = axios.create({
      baseURL: 'https://open.feishu.cn/open-apis',
      timeout: 30000,
    });

    await this.refreshToken();
    console.log('[FeishuConnector] Initialized');
  }

  /**
   * 启动 WebSocket 长连接
   */
  async start(): Promise<void> {
    if (!this.config?.enabled) return;
    if (this.wsClient) return;

    const { app_id, app_secret } = this.config.credentials;
    if (!app_id || !app_secret) {
      console.error('[FeishuConnector] Missing app_id or app_secret for WebSocket');
      return;
    }

    console.log('[FeishuConnector] Starting WebSocket long connection...');

    // 启动定期刷新 token（用于发送消息）
    if (!this.tokenRefreshTimer) {
      this.tokenRefreshTimer = setInterval(() => this.refreshToken(), 30 * 60 * 1000);
    }

    // 创建官方 SDK 的 WSClient
    this.wsClient = new lark.WSClient({
      appId: app_id,
      appSecret: app_secret,
      domain: lark.Domain.Feishu,
    });

    // 创建事件分发器
    this.eventDispatcher = new lark.EventDispatcher({});

    // 注册消息接收事件
    this.eventDispatcher.register({
      'im.message.receive_v1': (data: any) => {
        this.handleSdkEvent(data);
        return undefined; // 不需要返回特定内容
      },
    });

    // 启动长连接（非阻塞，SDK 内部自动重连）
    await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
  }

  /**
   * 停止连接器
   */
  async stop(): Promise<void> {
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
    if (this.wsClient) {
      this.wsClient.close({ force: true });
      this.wsClient = null;
    }
    this.eventDispatcher = null;
    this.httpClient = null;
    console.log('[FeishuConnector] Stopped');
  }

  /**
   * 发送消息（HTTP）
   */
  async send(message: OutgoingMessage): Promise<void> {
    if (!this.httpClient) {
      throw new Error('Feishu connector not initialized');
    }

    await this.ensureToken();

    const { target, content } = message;
    const messageBody = this.buildMessageBody(content);

    try {
      if (target.user_id) {
        await this.httpClient.post('/im/v1/messages?receive_id_type=open_id', {
          receive_id: target.user_id,
          msg_type: content.type === 'text' ? 'text' : 'interactive',
          content: JSON.stringify(messageBody),
        }, {
          headers: { Authorization: `Bearer ${this.tenantAccessToken}` },
        });
      } else if (target.group_id) {
        await this.httpClient.post('/im/v1/messages?receive_id_type=chat_id', {
          receive_id: target.group_id,
          msg_type: content.type === 'text' ? 'text' : 'interactive',
          content: JSON.stringify(messageBody),
        }, {
          headers: { Authorization: `Bearer ${this.tenantAccessToken}` },
        });
      }

      console.log(`[FeishuConnector] Message sent to ${target.user_id || target.group_id}`);
    } catch (error) {
      console.error('[FeishuConnector] Failed to send message:', error);
      throw error;
    }
  }

  /**
   * 处理 webhook 事件（保留兼容）
   */
  handleWebhookEvent(event: any): void {
    if (!this.messageCallback) return;

    if (event.type === 'message') {
      const data = event.data as FeishuMessage;
      if (data.sender?.sender_type === 'bot') {
        return;
      }
      const message = this.convertToUnifiedMessage(data);
      this.messageCallback(message);
    }
  }

  /**
   * 设置消息回调
   */
  onMessage(callback: (message: UnifiedMessage) => void): void {
    this.messageCallback = callback;
  }

  // ==================== 私有方法 ====================

  private handleSdkEvent(data: any): void {
    if (!this.messageCallback) return;

    console.log('[FeishuConnector] SDK event received:', data?.header?.event_type || 'unknown');

    // SDK 的 EventDispatcher.parse 会把 event 字段展平到 data 中
    // 所以 data.message 就是 FeishuMessage，而不是 data.event.message
    const msg = (data?.message || data?.event?.message) as FeishuMessage;
    if (!msg) {
      console.log('[FeishuConnector] No message in event data');
      return;
    }

    // 过滤机器人自己发送的消息
    if (msg.sender?.sender_type === 'bot') {
      console.log('[FeishuConnector] Ignoring bot self-message');
      return;
    }

    console.log('[FeishuConnector] Processing message from', msg.sender?.sender_id?.open_id);
    const message = this.convertToUnifiedMessage(msg);
    this.messageCallback(message);
  }

  private async refreshToken(): Promise<void> {
    if (!this.config?.credentials) return;

    const { app_id, app_secret } = this.config.credentials;

    try {
      const response = await axios.post(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        { app_id, app_secret }
      );

      if (response.data.code === 0) {
        this.tenantAccessToken = response.data.tenant_access_token;
        this.tokenExpiry = Date.now() + (response.data.expire - 60) * 1000;
        console.log('[FeishuConnector] Token refreshed');
      } else {
        throw new Error(`Token refresh failed: ${response.data.msg}`);
      }
    } catch (error) {
      console.error('[FeishuConnector] Failed to refresh token:', error);
    }
  }

  private async ensureToken(): Promise<void> {
    if (Date.now() >= this.tokenExpiry) {
      await this.refreshToken();
    }
  }

  private buildMessageBody(content: MessageContent): any {
    switch (content.type) {
      case 'text':
        return { text: content.body };
      case 'card':
        return content.body;
      default:
        return { text: String(content.body) };
    }
  }

  private convertToUnifiedMessage(feishuMsg: FeishuMessage): UnifiedMessage {
    let content: MessageContent;

    switch (feishuMsg.message_type) {
      case 'text':
        try {
          const parsed = JSON.parse(feishuMsg.content);
          content = { type: 'text', body: parsed.text || feishuMsg.content };
        } catch {
          content = { type: 'text', body: feishuMsg.content };
        }
        break;
      case 'image':
        content = { type: 'image', body: feishuMsg.content };
        break;
      default:
        content = { type: 'text', body: feishuMsg.content };
    }

    return {
      channel: 'feishu',
      channel_msg_id: feishuMsg.message_id,
      sender: {
        id: feishuMsg.sender.sender_id.open_id,
        name: '',
        type: feishuMsg.sender.sender_type === 'user' ? 'user' : 'bot',
      },
      content,
      timestamp: parseInt(feishuMsg.create_time),
      metadata: { chat_id: feishuMsg.chat_id },
    };
  }
}

// 导出单例
export const feishuConnector = new FeishuConnector();
