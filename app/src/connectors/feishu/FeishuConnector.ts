import axios, { AxiosInstance } from 'axios';
import {
  ChannelConnector,
  ChannelConfig,
  UnifiedMessage,
  OutgoingMessage,
  Sender,
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
}

/**
 * 飞书连接器
 * 实现飞书开放平台的消息接收和发送
 */
export class FeishuConnector implements ChannelConnector {
  name: string = 'feishu';
  
  private config: ChannelConfig | null = null;
  private httpClient: AxiosInstance | null = null;
  private tenantAccessToken: string = '';
  private tokenExpiry: number = 0;
  private messageCallback: ((message: UnifiedMessage) => void) | null = null;
  private eventHandler: any = null;

  /**
   * 初始化连接器
   */
  async initialize(config: ChannelConfig): Promise<void> {
    this.config = config;
    
    if (!config.enabled) {
      console.log('[FeishuConnector] Disabled');
      return;
    }

    this.httpClient = axios.create({
      baseURL: 'https://open.feishu.cn/open-apis',
      timeout: 30000,
    });

    // 获取 tenant access token
    await this.refreshToken();
    
    console.log('[FeishuConnector] Initialized');
  }

  /**
   * 启动消息监听
   */
  async start(): Promise<void> {
    if (!this.config?.enabled) return;

    // 这里应该启动 webhook 服务器或建立 websocket 连接
    // 简化版本：通过轮询获取消息（实际生产环境应使用事件订阅）
    console.log('[FeishuConnector] Started');
    
    // 启动定期刷新 token
    setInterval(() => this.refreshToken(), 30 * 60 * 1000); // 每30分钟
  }

  /**
   * 停止连接器
   */
  async stop(): Promise<void> {
    console.log('[FeishuConnector] Stopped');
  }

  /**
   * 发送消息
   */
  async send(message: OutgoingMessage): Promise<void> {
    if (!this.httpClient) {
      throw new Error('Feishu connector not initialized');
    }

    await this.ensureToken();

    const { target, content } = message;
    
    // 构建消息体
    const messageBody = this.buildMessageBody(content);
    
    try {
      if (target.user_id) {
        // 发送给用户
        await this.httpClient.post('/im/v1/messages?receive_id_type=open_id', {
          receive_id: target.user_id,
          msg_type: content.type === 'text' ? 'text' : 'interactive',
          content: JSON.stringify(messageBody),
        }, {
          headers: { Authorization: `Bearer ${this.tenantAccessToken}` },
        });
      } else if (target.group_id) {
        // 发送到群聊
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
   * 处理 webhook 事件
   */
  handleWebhookEvent(event: any): void {
    if (!this.messageCallback) return;

    // 处理消息事件
    if (event.type === 'message') {
      const message = this.convertToUnifiedMessage(event.data);
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

  private async refreshToken(): Promise<void> {
    if (!this.config?.credentials) return;

    const { app_id, app_secret } = this.config.credentials;
    
    try {
      const response = await axios.post(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          app_id,
          app_secret,
        }
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
        content = {
          type: 'text',
          body: JSON.parse(feishuMsg.content).text,
        };
        break;
      
      case 'image':
        content = {
          type: 'image',
          body: feishuMsg.content,
        };
        break;
      
      default:
        content = {
          type: 'text',
          body: feishuMsg.content,
        };
    }

    return {
      channel: 'feishu',
      channel_msg_id: feishuMsg.message_id,
      sender: {
        id: feishuMsg.sender.sender_id.open_id,
        name: '', // 需要通过用户信息接口获取
        type: feishuMsg.sender.sender_type === 'user' ? 'user' : 'bot',
      },
      content,
      timestamp: parseInt(feishuMsg.create_time),
      metadata: {},
    };
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(openId: string): Promise<{ name: string } | null> {
    if (!this.httpClient) return null;

    try {
      await this.ensureToken();
      const response = await this.httpClient.get(`/contact/v3/users/${openId}`, {
        headers: { Authorization: `Bearer ${this.tenantAccessToken}` },
      });

      if (response.data.code === 0) {
        return { name: response.data.data.user.name };
      }
      return null;
    } catch (error) {
      console.error('[FeishuConnector] Failed to get user info:', error);
      return null;
    }
  }
}

// 导出单例
export const feishuConnector = new FeishuConnector();
