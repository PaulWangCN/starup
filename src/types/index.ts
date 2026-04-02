/**
 * StarUp 核心类型定义
 * v1.2: 新增 Skill 生态系统类型
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
  lastCompactAt?: number;
  compactCount?: number;
}

// ==================== Memory 类型 ====================

export interface SessionMemory {
  shortTerm: string[];         // 短期记忆（当前会话）
  dailyLog: string;            // 日记忆文件路径
  longTerm: string;            // 长期记忆文件路径
}

/**
 * 记忆类型
 * - user: 用户画像、偏好、背景知识（始终私有）
 * - feedback: 用户对工作方式的指导（默认私有）
 * - project: 项目进展、目标、事件（偏向团队）
 * - reference: 外部系统指针（通常团队）
 */
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

/**
 * 记忆文件 frontmatter 结构
 */
export interface MemoryFrontmatter {
  name: string;
  description: string;
  type: MemoryType;
  created?: string;            // ISO 日期
  updated?: string;            // ISO 日期
  tags?: string[];
}

/**
 * 解析后的记忆条目
 */
export interface ParsedMemory {
  path: string;                // 文件路径
  frontmatter: MemoryFrontmatter;
  content: string;             // 正文内容（不含 frontmatter）
  mtime: number;               // 修改时间
}

/**
 * AI 召回结果
 */
export interface RelevantMemory {
  memory: ParsedMemory;
  reason: string;              // 为什么相关
  freshness: string;           // 新鲜度描述
}

/**
 * 记忆条目（向后兼容）
 */
export interface MemoryEntry {
  timestamp: number;
  topic: string;
  summary: string;
  importance: number;
  type?: MemoryType;
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

// ==================== Skill v1.1 类型（兼容） ====================

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

// ==================== Skill v1.2 新类型 ====================

// Skill 运行时类型
export type SkillRuntimeType = 'javascript' | 'python' | 'wasm';

// Skill 状态
export type SkillStatus = 'installed' | 'active' | 'disabled' | 'unloaded' | 'error' | 'upgrading';

// 权限范围
export interface NetworkPermissionScope {
  allow: string[];
  deny: string[];
}

export interface MemoryPermissionScope {
  scope: string[];
  retention?: string;          // 如 "7d", "24h"
  limit?: number;
}

// 权限声明
export interface Permission {
  id: string;
  scope: string[] | NetworkPermissionScope | MemoryPermissionScope;
}

// 依赖声明
export interface Dependency {
  id: string;
  version: string;             // semver 范围
  optional?: boolean;
  registry?: string;           // 私有源
}

// 运行时配置
export interface RuntimeConfig {
  type: SkillRuntimeType;
  entry: string;
  compatible_with?: string[];  // 如 ["node18", "bun1.0"]
}

// 集成配置
export interface IntentIntegration {
  model: 'light' | 'standard' | 'heavy';
  examples: string[];
}

export interface ContextIntegration {
  retention_turns: number;
}

export interface IntegrationsConfig {
  intent_recognition?: IntentIntegration;
  context?: ContextIntegration;
}

// 资源限制
export interface ResourceLimits {
  max_memory?: string;         // 如 "128mb"
  timeout_ms?: number;
  max_cpu_percent?: number;
}

// manifest.yaml 结构
export interface SkillManifest {
  id: string;                  // 反向域名格式
  name: string;
  version: string;             // semver
  api_version: string;         // 如 "1.2"
  author: string;
  license: string;
  description: string;
  homepage?: string;
  
  runtime: RuntimeConfig;
  permissions: Permission[];
  dependencies?: Dependency[];
  integrations?: IntegrationsConfig;
  resources?: ResourceLimits;
}

// Skill 包（v1.2）
export interface SkillPackage {
  manifest: SkillManifest;
  path: string;                // 安装路径
  content?: string;            // SKILL.md/PROMPT.md 内容
  assets?: Map<string, string>;
  schemas?: Map<string, any>;
  status: SkillStatus;
  installedAt: number;
  updatedAt: number;
}

// 安装规范
export interface InstallSpec {
  source: 'marketplace' | 'git' | 'local' | 'url';
  id?: string;                 // marketplace id
  version?: string;            // semver 范围
  url?: string;                // git/url source
  path?: string;               // local path
  registry?: string;           // 指定 registry
}

export interface InstallOptions {
  force?: boolean;             // 强制重新安装
  link?: boolean;              // 开发模式软链接
  offline?: boolean;           // 离线模式
  verify?: boolean;            // 验证签名
}

export interface InstallResult {
  success: boolean;
  skillId?: string;
  version?: string;
  message: string;
  dependencies?: Dependency[];
  error?: string;
}

// 依赖树
export interface DependencyNode {
  id: string;
  version: string;
  resolved: boolean;
  children: DependencyNode[];
}

export interface VersionConflict {
  skill_id: string;
  required_by: string[];
  candidates: string[];
  resolution: 'upgrade' | 'downgrade' | 'isolate' | 'fail';
}

export interface DependencyTree {
  root: DependencyNode;
  conflicts: VersionConflict[];
  install_order: SkillPackage[];
}

export interface ResolutionConstraints {
  strategies: {
    upgrade: 'auto' | 'prompt' | 'reject';
    multi_version: boolean;
    cycle_detection: 'error' | 'warn' | 'allow';
  };
}

// Skill 运行时实例
export interface SkillInstance {
  id: string;
  package: SkillPackage;
  vm?: VMInstance;
  tools: ToolDefinition[];
  status: SkillStatus;
}

export interface VMInstance {
  id: string;
  type: SkillRuntimeType;
  sandbox: SandboxConfig;
  memory: number;
  cpu: number;
}

export interface SandboxConfig {
  permissions: Permission[];
  skillPath: string;
  homePath: string;
  tempPath: string;
}

// 升级结果
export interface UpgradeResult {
  success: boolean;
  oldVersion: string;
  newVersion: string;
  downtime_ms: number;
  rollbackAvailable: boolean;
}

// Prompt 片段（L5 层注入）
export interface PromptFragment {
  section: 'skills';           // 固定为 skills
  content: string;             // Markdown 格式
  trigger_patterns: string[];  // 触发正则/关键词
  context_window: number;
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
  metadata?: Record<string, any>;
}

// ==================== Cron & Heartbeat ====================

export interface ScheduledTask {
  id: string;
  name: string;
  schedule: string;            // crontab 格式
  prompt: string;              // 触发时发送给 AI 的提示词
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  runCount: number;
}

export interface TaskExecutor {
  execute: (prompt: string) => Promise<void>;
}

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

export interface RegistryConfig {
  name: string;
  url: string;
  priority: number;
  auth?: {
    type: 'token' | 'oauth';
    token?: string;
    client_id?: string;
  };
}

export interface SecurityConfig {
  allowed_registries?: string[];
  require_signature?: boolean;
  permission_policy?: {
    deny_permissions?: string[];
    require_approval?: string[];
    max_network_domains?: number;
  };
}

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
  // v1.2 新增
  registries?: RegistryConfig[];
  install?: {
    default_registry: string;
    auto_update: boolean;
    verify_signature: boolean;
  };
  dependency?: {
    resolution: 'auto' | 'conservative' | 'latest';
    allow_multi_version: boolean;
    cache_ttl: string;
  };
  security?: SecurityConfig;
}

// ==================== 错误类型 ====================

export class SkillError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'SkillError';
  }
}

export class CapabilityError extends SkillError {
  constructor(message: string, public permission: string) {
    super(message, 'CAPABILITY_ERROR');
    this.name = 'CapabilityError';
  }
}

export class DependencyError extends SkillError {
  constructor(message: string, public conflicts: VersionConflict[]) {
    super(message, 'DEPENDENCY_ERROR');
    this.name = 'DependencyError';
  }
}

export class InstallError extends SkillError {
  constructor(message: string, public phase: string) {
    super(message, 'INSTALL_ERROR');
    this.name = 'InstallError';
  }
}

// ==================== v1.3: Meta-Skill & SkillHub 类型 ====================

export interface HubSourceConfig {
  name: string;
  endpoint: string;
  priority: number;
  type?: 'http' | 'filesystem';
  public_key?: string;
  trusted?: boolean;
  auth?: {
    type: 'token' | 'oauth';
    env?: string;
    token?: string;
    client_id?: string;
  };
}

export interface SkillSearchRequest {
  query: string;
  filters?: {
    category?: string;
    runtime?: 'javascript' | 'python' | 'wasm';
    trusted_only?: boolean;
  };
  hub_preference?: string[];
}

export interface SkillSearchResult {
  id: string;
  name: string;
  version: string;
  description: string;
  installed_version?: string;
  update_available?: boolean;
  manifest_digest: string;
  capabilities_preview: string[];
  source_hub: string;
  trusted: boolean;
}

export interface SkillCandidate {
  id: string;
  name: string;
  version: string;
  description: string;
  source_hub: string;
}

export interface CapabilityPreview {
  id: string;
  name: string;
  description: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  scope?: string[];
}

export interface InstallIntent {
  skill_hint: string;
  version?: string;
  source_hub?: string;
  force?: boolean;
  offline?: boolean;
}

export interface ActionResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
  requires_confirmation?: boolean;
  confirmation_type?: 'disambiguation' | 'capability' | 'general';
  candidates?: SkillCandidate[];
  capabilities?: CapabilityPreview[];
}

export interface MetaSkill {
  id: string;
  name: string;
  description: string;
  type: 'system' | 'meta';
  permissions: Permission[];
  handle(request: any, context: SessionContext): Promise<ActionResult>;
}

export interface SkillManagementDialog {
  intent: 'skill.install' | 'skill.uninstall' | 'skill.update' | 'skill.query' | 'skill.search' | 'skill.config';
  slots: Record<string, any>;
  disambiguation?: SkillCandidate[];
  confirmation?: CapabilityPreview[];
  result?: ActionResult;
  followUp?: string;
}

export interface SessionContext {
  session: Session;
  recentMessages: string[];
  userPreferences: Record<string, any>;
}

export class TransactionError extends SkillError {
  constructor(message: string, public rollbackSuccess: boolean) {
    super(message, 'TRANSACTION_ERROR');
    this.name = 'TransactionError';
  }
}
