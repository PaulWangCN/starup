/**
 * StarUp 核心类型定义
 */

// ==================== 消息类型 ====================

export type MessageType = 'text' | 'image' | 'file' | 'card';
export type SenderType = 'user' | 'group' | 'bot';

export interface Sender {
  id: string;
  name: string;
  type: SenderType;
}

export interface MessageContent {
  type: MessageType;
  body: any;
}

export interface UnifiedMessage {
  channel: string;
  channel_msg_id: string;
  sender: Sender;
  content: MessageContent;
  timestamp: number;
  metadata: Record<string, any>;
}

// ==================== Session 类型 ====================

export type SessionType = 'main' | 'sub' | 'acp';
export type SessionStatus = 'active' | 'idle' | 'completed' | 'error';

export interface Session {
  id: string;
  type: SessionType;
  status: SessionStatus;
  parentId?: string;           // 子代理的父会话ID
  createdAt: number;
  updatedAt: number;
  context: ConversationContext;
  memory: SessionMemory;
  allowedTools: string[];
  memoryAccess: 'none' | 'read' | 'write';
  timeout: number;
  callbackToParent: boolean;
}

export interface SpawnOptions {
  task: string;
  tools?: string[];
  memory_access?: 'none' | 'read' | 'write';
  timeout?: number;
  parent_callback?: boolean;
}

// ==================== 对话上下文 ====================

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ConversationContext {
  messages: ConversationMessage[];
  tokenCount: number;
  compressed: boolean;
}

// ==================== Memory 类型 ====================

export interface SessionMemory {
  shortTerm: string[];         // 短期记忆（当前会话）
  dailyLog: string;            // 日记忆文件路径
  longTerm: string;            // 长期记忆文件路径
}

export interface MemoryEntry {
  timestamp: number;
  topic: string;
  summary: string;
  importance: number;
}

// ==================== Tool 类型 ====================

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  handler: ToolHandler;
}

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: any;
}

export type ToolHandler = (args: any, session: Session) => Promise<ToolResult>;

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

// ==================== Skill 类型 ====================

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  license?: string;
  tools?: string[];
  parameters?: SkillParameter[];
}

export interface SkillParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface Skill {
  id: string;
  metadata: SkillMetadata;
  content: string;             // SKILL.md 内容
  path: string;                // Skill 目录路径
  scripts?: Map<string, string>;
  resources?: Map<string, string>;
}

// ==================== Channel 类型 ====================

export interface ChannelConfig {
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
  options?: Record<string, any>;
}

export interface ChannelConnector {
  name: string;
  initialize(config: ChannelConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutgoingMessage): Promise<void>;
  onMessage(callback: (message: UnifiedMessage) => void): void;
}

export interface OutgoingMessage {
  channel: string;
  target: { user_id?: string; group_id?: string };
  content: MessageContent;
}

// ==================== Cron & Heartbeat ====================

export interface CronJob {
  id: string;
  schedule: string;            // crontab 格式
  action: 'skill' | 'message' | 'spawn';
  target: string;
  parameters?: any;
  enabled: boolean;
}

export interface HeartbeatConfig {
  interval: number;            // 毫秒，默认 30 分钟
  tasks: HeartbeatTask[];
}

export interface HeartbeatTask {
  name: string;
  handler: () => Promise<void>;
}

// ==================== LLM 配置 ====================

export interface LLMConfig {
  provider: 'deepseek' | 'openai' | 'anthropic';
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

// ==================== 系统配置 ====================

export interface SystemConfig {
  llm: LLMConfig;
  channels: ChannelConfig[];
  cron: CronJob[];
  heartbeat: HeartbeatConfig;
  memory: {
    compressionThreshold: number;
    vectorDbEnabled: boolean;
  };
  sandbox: {
    enabled: boolean;
    timeout: number;
  };
}
