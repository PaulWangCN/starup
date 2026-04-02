/**
 * MCP 集成类型定义
 */

export interface MCPServerConfig {
  /** Server 标识名，会作为工具前缀 */
  name: string;
  /** 传输方式 */
  transport: 'stdio' | 'sse' | 'streamableHttp';
  /** stdio 模式下要执行的命令 */
  command?: string;
  /** stdio 模式下命令参数 */
  args?: string[];
  /** stdio 模式下环境变量（支持 ${ENV} 占位符） */
  env?: Record<string, string>;
  /** stdio 模式下工作目录 */
  cwd?: string;
  /** sse / streamableHttp 模式下服务端点 */
  url?: string;
  /** 是否自动注册其工具到 ToolRegistry（默认 true） */
  autoRegister?: boolean;
  /** 是否禁用该 server */
  disabled?: boolean;
}

export interface MCPGlobalConfig {
  servers: MCPServerConfig[];
}

export interface MCPConnection {
  name: string;
  config: MCPServerConfig;
  client: any; // Client from @modelcontextprotocol/sdk
  connected: boolean;
  tools: string[];
  error?: string;
}
