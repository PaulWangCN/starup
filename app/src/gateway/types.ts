/**
 * Gateway 类型定义
 * 最小化实现
 */

import { WebSocket } from 'ws';
import { Session, OutgoingMessage, UnifiedMessage } from '../types';

export type ClientRole = 'operator' | 'node' | 'adapter';

export interface GatewayClient {
  id: string;
  role: ClientRole;
  ws?: WebSocket;
  metadata: Record<string, any>;
  connectedAt: number;
  lastPingAt: number;
}

export interface ClientSession {
  clientId: string;
  sessionId: string;
  channel?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatRequest {
  sessionId?: string;
  message: string;
  stream?: boolean;
  clientId?: string;
  channel?: string;
  metadata?: Record<string, any>;
}

export interface ChatResponse {
  sessionId: string;
  message: string;
  thinking: string[];
  done: boolean;
}

export interface StreamChunk {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'content' | 'done';
  data: any;
}

export interface Adapter {
  name: string;
  initialize(config?: any): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutgoingMessage): Promise<void>;
  onMessage(callback: (message: UnifiedMessage) => void): void;
}

export interface GatewayConfig {
  httpPort: number;
  wsPort: number;
  token: string;
  enableCors: boolean;
}
