import axios from 'axios';
import * as dingtalkStream from 'dingtalk-stream';
import {
  ChannelConnector,
  ChannelConfig,
  UnifiedMessage,
  OutgoingMessage,
} from '../../types';

interface DingTalkRobotMessage {
  conversationId: string;
  chatbotCorpId: string;
  chatbotUserId: string;
  msgId: string;
  senderNick: string;
  isAdmin: boolean;
  senderStaffId: string;
  sessionWebhookExpiredTime: number;
  createAt: number;
  senderCorpId: string;
  conversationType: '1' | '2'; // 1: 单聊, 2: 群聊
  senderId: string;
  sessionWebhook: string;
  robotCode: string;
  msgtype: string;
  text?: {
    content: string;
  };
  content?: string; // 某些版本的字段
}

/**
 * 钉钉连接器
 * 使用钉钉 Stream 模式长连接接收消息，HTTP 发送消息
 * 不需要公网地址
 */
export class DingTalkConnector implements ChannelConnector {
  name: string = 'dingtalk';

  private config: ChannelConfig | null = null;
  private client: dingtalkStream.DWClient | null = null;
  private messageCallback: ((message: UnifiedMessage) => void) | null = null;

  async initialize(config?: ChannelConfig): Promise<void> {
    if (config) {
      this.config = config;
    }
    if (!this.config) {
      return;
    }
    if (!this.config.enabled) {
      console.log('[DingTalkConnector] Disabled');
      return;
    }
    if (this.client) {
      return;
    }

    const clientId = this.config.credentials.client_id || this.config.credentials.app_id;
    const clientSecret = this.config.credentials.client_secret || this.config.credentials.app_secret;

    if (!clientId || !clientSecret) {
      console.error('[DingTalkConnector] Missing client_id/client_secret or app_id/app_secret');
      return;
    }

    this.client = new dingtalkStream.DWClient({
      clientId,
      clientSecret,
      debug: false,
    });

    console.log('[DingTalkConnector] Initialized');
  }

  async start(): Promise<void> {
    if (!this.config?.enabled || !this.client) return;
    if (this.client.connected) return;

    console.log('[DingTalkConnector] Starting Stream connection...');

    // 配置订阅：机器人消息
    this.client.config.subscriptions = [
      {
        type: 'EVENT',
        topic: dingtalkStream.TOPIC_ROBOT,
      },
    ];

    // 注册事件监听器
    this.client.registerAllEventListener((message) => {
      this.handleStreamMessage(message);
      return { status: dingtalkStream.EventAck.SUCCESS };
    });

    await this.client.connect();
    console.log('[DingTalkConnector] Stream connected');
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client.removeAllListeners();
      console.log('[DingTalkConnector] Stopped');
    }
  }

  async send(message: OutgoingMessage): Promise<void> {
    const sessionWebhook = message.metadata?.sessionWebhook as string | undefined;
    if (!sessionWebhook) {
      throw new Error('DingTalkConnector: sessionWebhook not found in message metadata');
    }

    const text = message.content.type === 'text'
      ? String(message.content.body)
      : JSON.stringify(message.content.body);

    try {
      await axios.post(sessionWebhook, {
        msgtype: 'text',
        text: {
          content: text,
        },
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      console.log(`[DingTalkConnector] Message sent via sessionWebhook`);
    } catch (error) {
      console.error('[DingTalkConnector] Failed to send message:', error);
      throw error;
    }
  }

  onMessage(callback: (message: UnifiedMessage) => void): void {
    this.messageCallback = callback;
  }

  private handleStreamMessage(message: dingtalkStream.DWClientDownStream): void {
    if (!this.messageCallback) return;

    if (message.headers.topic !== dingtalkStream.TOPIC_ROBOT) {
      return;
    }

    let robotMsg: DingTalkRobotMessage;
    try {
      robotMsg = JSON.parse(message.data);
    } catch (err) {
      console.error('[DingTalkConnector] Failed to parse robot message:', err);
      return;
    }

    // 过滤自己
    if (robotMsg.senderId === robotMsg.chatbotUserId) {
      return;
    }

    const unifiedMsg = this.convertToUnifiedMessage(robotMsg);
    this.messageCallback(unifiedMsg);
  }

  private convertToUnifiedMessage(msg: DingTalkRobotMessage): UnifiedMessage {
    const contentText = msg.text?.content || msg.content || '';
    const isGroup = msg.conversationType === '2';

    return {
      channel: 'dingtalk',
      channel_msg_id: msg.msgId,
      sender: {
        id: msg.senderId,
        name: msg.senderNick || 'unknown',
        type: isGroup ? 'group' : 'user',
      },
      content: {
        type: 'text',
        body: contentText,
      },
      timestamp: msg.createAt,
      metadata: {
        conversationId: msg.conversationId,
        sessionWebhook: msg.sessionWebhook,
        sessionWebhookExpiredTime: msg.sessionWebhookExpiredTime,
        robotCode: msg.robotCode,
        senderStaffId: msg.senderStaffId,
      },
    };
  }
}

export const dingtalkConnector = new DingTalkConnector();
