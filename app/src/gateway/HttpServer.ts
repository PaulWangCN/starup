/**
 * HttpServer
 * 提供 HTTP API 服务（OpenAI 兼容 + 内部 API）
 */

import express, { Request, Response, NextFunction } from 'express';
import { Gateway } from './Gateway';
import { ChatRequest } from './types';

export class HttpServer {
  private gateway: Gateway;
  private app: express.Application;
  private server: any;

  constructor(gateway: Gateway) {
    this.gateway = gateway;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use((req, res, next) => {
      if (this.gateway.config.enableCors) {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // Gateway 状态
    this.app.get('/api/status', this.authMiddleware, (_req, res) => {
      res.json(this.gateway.getStatus());
    });

    // 创建会话
    this.app.post('/api/sessions', this.authMiddleware, (req, res) => {
      const clientId = (req.body.clientId as string) || `http-${Date.now()}`;
      const channel = (req.body.channel as string) || undefined;
      const sessionId = this.gateway.getOrCreateSession(clientId, channel);
      res.json({ success: true, clientId, sessionId });
    });

    // 删除会话
    this.app.delete('/api/sessions/:id', this.authMiddleware, (req, res) => {
      const sessionId = req.params.id as string;
      const found = this.gateway.destroySessionById(sessionId);
      res.json({ success: found, sessionId });
    });

    // 简单聊天接口（非流式）
    this.app.post('/api/chat', this.authMiddleware, async (req, res) => {
      const request: ChatRequest = {
        sessionId: req.body.sessionId,
        clientId: req.body.clientId,
        channel: req.body.channel,
        message: req.body.message || '',
        stream: false,
      };

      if (!request.message) {
        res.status(400).json({ error: 'message is required' });
        return;
      }

      try {
        const result = await this.gateway.handleChatRequest(request);
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message || String(error) });
      }
    });

    // OpenAI 兼容 API /v1/chat/completions
    this.app.post('/v1/chat/completions', this.authMiddleware, async (req, res) => {
      const messages = req.body.messages || [];
      const stream = req.body.stream === true;
      const model = req.body.model || 'starup-default';

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: { message: 'messages is required', type: 'invalid_request_error' } });
        return;
      }

      const lastMessage = messages[messages.length - 1];
      const content = typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
      const sessionId = req.body.sessionId || req.headers['x-session-id'] as string | undefined;

      const request: ChatRequest = {
        sessionId,
        clientId: req.body.clientId || req.headers['x-client-id'] as string | undefined,
        channel: req.body.channel,
        message: content,
        stream,
      };

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const responseId = `chatcmpl-${Date.now()}`;
        let finalContent = '';

        try {
          await this.gateway.handleChatRequest(request, (chunk) => {
            if (chunk.type === 'content') {
              finalContent += chunk.data;
              const data = {
                id: responseId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: chunk.data },
                    finish_reason: null,
                  },
                ],
              };
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            } else if (chunk.type === 'done') {
              const data = {
                id: responseId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: 'stop',
                  },
                ],
              };
              res.write(`data: ${JSON.stringify(data)}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
            }
          });
        } catch (error: any) {
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
        }
      } else {
        try {
          const result = await this.gateway.handleChatRequest(request);
          res.json({
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: result.message },
                finish_reason: 'stop',
              },
            ],
          });
        } catch (error: any) {
          res.status(500).json({ error: { message: error.message || String(error), type: 'internal_error' } });
        }
      }
    });

    // 飞书 Webhook 接收端点（不需要 Token 认证，由飞书平台直接调用）
    this.app.post('/webhook/feishu', (req, res) => {
      const feishu = this.gateway.adapters.get('feishu') as any;
      if (!feishu) {
        res.status(503).json({ error: 'Feishu adapter not available' });
        return;
      }

      const body = req.body;

      // 1. 飞书 URL 验证（配置事件订阅时触发）
      if (body.type === 'url_verification') {
        res.json({ challenge: body.challenge });
        console.log('[HttpServer] Feishu URL verification handled');
        return;
      }

      // 2. 新版事件格式 (schema: 2.0)
      if (body.schema === '2.0' && body.header?.event_type === 'im.message.receive_v1') {
        feishu.handleWebhookEvent({
          type: 'message',
          data: body.event?.message,
        });
        res.json({ code: 0, msg: 'success' });
        return;
      }

      // 3. 旧版事件格式兼容
      if (body.event?.type === 'message') {
        feishu.handleWebhookEvent({
          type: 'message',
          data: body.event.message || body.event,
        });
      }

      res.json({ code: 0, msg: 'success' });
    });

    // 404
    this.app.use((_req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  private authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!this.gateway.verifyToken(token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };

  async start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, () => {
        console.log(`[HttpServer] Listening on port ${port}`);
        resolve();
      });
      
      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${port} 已被占用，请检查是否有其他 gateway 实例在运行，或更换端口`));
        } else {
          reject(err);
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('[HttpServer] Stopped');
          resolve();
        });
      });
    }
  }
}
