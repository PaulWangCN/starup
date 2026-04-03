import TelegramBot from 'node-telegram-bot-api';
import * as https from 'https';
import {
  ChannelConnector,
  ChannelConfig,
  UnifiedMessage,
  OutgoingMessage,
} from '../../types';

export class TelegramConnector implements ChannelConnector {
  name: string = 'telegram';

  private config: ChannelConfig | null = null;
  private bot: TelegramBot | null = null;
  private messageCallback: ((message: UnifiedMessage) => void) | null = null;

  async initialize(config?: ChannelConfig): Promise<void> {
    if (config) {
      this.config = config;
    }
    if (!this.config) {
      return;
    }
    if (!this.config.enabled) {
      console.log('[TelegramConnector] Disabled');
      return;
    }
    if (this.bot) {
      return;
    }

    const token = this.config.credentials.token;
    if (!token) {
      console.error('[TelegramConnector] Missing token');
      return;
    }

    // 检查代理设置
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
    
    const botOptions: any = { polling: false };
    
    if (proxyUrl) {
      console.log(`[TelegramConnector] Using proxy: ${proxyUrl}`);
      // 使用代理服务器
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { HttpsProxyAgent } = require('https-proxy-agent');
        botOptions.request = {
          agent: new HttpsProxyAgent(proxyUrl),
        };
      } catch (err) {
        console.warn('[TelegramConnector] https-proxy-agent not installed, proxy may not work');
        console.warn('[TelegramConnector] Run: npm install https-proxy-agent');
      }
    }

    this.bot = new TelegramBot(token, botOptions);
    console.log('[TelegramConnector] Initialized');
  }

  async start(): Promise<void> {
    if (!this.config?.enabled || !this.bot) return;

    console.log('[TelegramConnector] Starting polling...');

    // 先停止可能存在的旧 polling
    this.bot.stopPolling();

    // 启动 polling
    this.bot.startPolling();

    this.bot.on('message', (msg) => {
      if (!this.messageCallback) return;

      // 过滤自己
      if (msg.from?.is_bot) return;

      const unifiedMsg = this.convertToUnifiedMessage(msg);
      this.messageCallback(unifiedMsg);
    });

    this.bot.on('polling_error', (error) => {
      console.error('[TelegramConnector] Polling error:', error.message);
    });

    console.log('[TelegramConnector] Polling started');
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stopPolling();
      this.bot.removeAllListeners();
      // node-telegram-bot-api 没有 close 方法，停止 polling 即可
      console.log('[TelegramConnector] Stopped');
    }
  }

  async send(message: OutgoingMessage): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram connector not initialized');
    }

    const text = message.content.type === 'text'
      ? String(message.content.body)
      : JSON.stringify(message.content.body);

    if (message.target.group_id) {
      await this.bot.sendMessage(message.target.group_id, text);
    } else if (message.target.user_id) {
      await this.bot.sendMessage(message.target.user_id, text);
    }
  }

  onMessage(callback: (message: UnifiedMessage) => void): void {
    this.messageCallback = callback;
  }

  private convertToUnifiedMessage(msg: TelegramBot.Message): UnifiedMessage {
    const chatId = String(msg.chat.id);
    const userId = msg.from?.id ? String(msg.from.id) : chatId;
    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

    let text = '';
    if (msg.text) {
      text = msg.text;
    } else if (msg.caption) {
      text = msg.caption;
    } else {
      text = '[unsupported message type]';
    }

    return {
      channel: 'telegram',
      channel_msg_id: String(msg.message_id),
      sender: {
        id: userId,
        name: msg.from?.first_name || msg.from?.username || 'unknown',
        type: isGroup ? 'group' : 'user',
      },
      content: {
        type: 'text',
        body: text,
      },
      timestamp: (msg.date || Date.now() / 1000) * 1000,
      metadata: {
        chat_id: chatId,
        chat_type: msg.chat.type,
      },
    };
  }
}

export const telegramConnector = new TelegramConnector();
