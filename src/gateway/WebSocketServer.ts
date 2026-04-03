/**
 * WebSocketServer
 * 提供 WebSocket 控制平面
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { Gateway } from './Gateway';
import { logger } from '../utils/Logger';
import { GatewayClient, ClientRole, StreamChunk } from './types';

interface WSMessage {
  id?: string;
  type: 'ping' | 'chat' | 'status' | 'register';
  payload?: any;
}

export class WebSocketServer {
  private gateway: Gateway;
  private server: WSServer | null = null;

  constructor(gateway: Gateway) {
    this.gateway = gateway;
  }

  async start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = new WSServer({ port }, () => {
        logger.debug('WebSocketServer', `Listening on port ${port}`);
        resolve();
      });

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`WebSocket 端口 ${port} 已被占用，请检查是否有其他 gateway 实例在运行，或更换端口`));
        } else {
          reject(err);
        }
      });

      this.server.on('connection', (ws, req) => {
        const clientId = `ws-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        logger.debug('WebSocketServer', `Client connected: ${clientId} from ${req.socket.remoteAddress}`);

        const client: GatewayClient = {
          id: clientId,
          role: 'operator',
          ws,
          metadata: {},
          connectedAt: Date.now(),
          lastPingAt: Date.now(),
        };
        this.gateway.registerClient(client);

        ws.on('message', async (data) => {
          try {
            const message: WSMessage = JSON.parse(data.toString());
            await this.handleMessage(client, ws, message);
          } catch (err) {
            this.send(ws, { type: 'error', payload: { message: 'Invalid JSON' } });
          }
        });

        ws.on('close', () => {
          logger.debug('WebSocketServer', `Client disconnected: ${clientId}`);
          this.gateway.removeClient(clientId);
        });

        ws.on('error', (err) => {
          logger.error('WebSocketServer', `Client error: ${clientId} ${err}`);
        });

        // 发送欢迎消息
        this.send(ws, { type: 'connected', payload: { clientId } });
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.clients.forEach((ws) => {
        ws.terminate();
      });
      return new Promise((resolve) => {
        this.server!.close(() => {
          logger.debug('WebSocketServer', 'Stopped');
          resolve();
        });
      });
    }
  }

  private async handleMessage(client: GatewayClient, ws: WebSocket, message: WSMessage): Promise<void> {
    switch (message.type) {
      case 'ping':
        client.lastPingAt = Date.now();
        this.send(ws, { type: 'pong', payload: { timestamp: Date.now() } });
        break;

      case 'register':
        if (message.payload?.role) {
          client.role = message.payload.role as ClientRole;
        }
        if (message.payload?.metadata) {
          client.metadata = { ...client.metadata, ...message.payload.metadata };
        }
        this.send(ws, { type: 'registered', payload: { clientId: client.id, role: client.role } });
        break;

      case 'status':
        this.send(ws, { type: 'status', payload: this.gateway.getStatus() });
        break;

      case 'chat': {
        const payload = message.payload || {};
        const request = {
          sessionId: payload.sessionId,
          clientId: client.id,
          channel: payload.channel,
          message: payload.message || '',
          stream: payload.stream !== false,
        };

        if (!request.message) {
          this.send(ws, { type: 'error', payload: { message: 'message is required' } });
          return;
        }

        const reqId = message.id || `req-${Date.now()}`;

        try {
          await this.gateway.handleChatRequest(request, (chunk: StreamChunk) => {
            this.send(ws, {
              id: reqId,
              type: chunk.type,
              payload: chunk.data,
            });
          });
        } catch (error: any) {
          this.send(ws, {
            id: reqId,
            type: 'error',
            payload: { message: error.message || String(error) },
          });
        }
        break;
      }

      default:
        this.send(ws, { type: 'error', payload: { message: `Unknown type: ${message.type}` } });
    }
  }

  private send(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
}
