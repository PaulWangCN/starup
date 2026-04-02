import * as fs from 'fs/promises';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ToolRegistry } from '../tools/ToolRegistry';
import { MCPServerConfig, MCPGlobalConfig, MCPConnection } from './types';
import { convertMCPToolToStarUp } from './MCPToolBridge';

/**
 * MCP Client 管理器
 * 负责连接 MCP Server、发现工具、桥接到 StarUp ToolRegistry
 */
export class MCPClientManager {
  private toolRegistry: ToolRegistry;
  private connections: Map<string, MCPConnection> = new Map();
  private configPath: string;

  constructor(toolRegistry: ToolRegistry, configPath?: string) {
    this.toolRegistry = toolRegistry;
    this.configPath = configPath || path.join(process.cwd(), '.starup', 'mcp.json');
  }

  /**
   * 加载配置并连接所有启用的 MCP Server
   */
  async connectAll(): Promise<void> {
    let config: MCPGlobalConfig;
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      config = JSON.parse(raw);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('[MCPClientManager] mcp.json not found, skipping MCP integration');
        return;
      }
      console.error('[MCPClientManager] Failed to parse mcp.json:', error.message);
      return;
    }

    if (!config.servers || !Array.isArray(config.servers)) {
      console.warn('[MCPClientManager] Invalid mcp.json: missing servers array');
      return;
    }

    for (const serverConfig of config.servers) {
      if (serverConfig.disabled) {
        console.log(`[MCPClientManager] Skipping disabled server: ${serverConfig.name}`);
        continue;
      }
      await this.connectServer(serverConfig);
    }

    const connected = Array.from(this.connections.values()).filter((c) => c.connected);
    console.log(`[MCPClientManager] ${connected.length}/${config.servers.length} servers connected, ${connected.reduce((sum, c) => sum + c.tools.length, 0)} tools registered`);
  }

  /**
   * 断开所有 MCP Server 连接
   */
  async disconnectAll(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.client.close();
        console.log(`[MCPClientManager] Disconnected: ${name}`);
      } catch (error: any) {
        console.error(`[MCPClientManager] Error disconnecting ${name}:`, error.message);
      }
    }
    this.connections.clear();
  }

  /**
   * 获取所有连接状态
   */
  getConnections(): MCPConnection[] {
    return Array.from(this.connections.values());
  }

  // ==================== 私有方法 ====================

  private async connectServer(config: MCPServerConfig): Promise<void> {
    const client = new Client(
      { name: `starup-mcp-client-${config.name}`, version: '1.0.0' },
      { capabilities: {} }
    );

    const conn: MCPConnection = {
      name: config.name,
      config,
      client,
      connected: false,
      tools: [],
    };
    this.connections.set(config.name, conn);

    try {
      const transport = this.createTransport(config);
      await client.connect(transport);
      conn.connected = true;
      console.log(`[MCPClientManager] Connected to server: ${config.name}`);

      if (config.autoRegister !== false) {
        await this.registerTools(conn);
      }
    } catch (error: any) {
      conn.error = error.message || String(error);
      console.error(`[MCPClientManager] Failed to connect ${config.name}:`, conn.error);
    }
  }

  private createTransport(config: MCPServerConfig): any {
    switch (config.transport) {
      case 'stdio': {
        if (!config.command) {
          throw new Error(`Missing command for stdio transport: ${config.name}`);
        }
        return new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: this.resolveEnv(config.env),
          cwd: config.cwd,
          stderr: 'inherit',
        });
      }
      case 'sse': {
        if (!config.url) {
          throw new Error(`Missing url for sse transport: ${config.name}`);
        }
        return new SSEClientTransport(new URL(config.url));
      }
      case 'streamableHttp':
        // 如需支持 streamableHttp，可后续扩展
        throw new Error(`Transport 'streamableHttp' not yet supported for server: ${config.name}`);
      default:
        throw new Error(`Unknown transport '${(config as any).transport}' for server: ${config.name}`);
    }
  }

  private async registerTools(conn: MCPConnection): Promise<void> {
    try {
      const toolsResult = await conn.client.listTools();
      const mcpTools = toolsResult.tools || [];

      for (const mcpTool of mcpTools) {
        const toolDef = convertMCPToolToStarUp(conn.name, mcpTool, (name, args) =>
          conn.client.callTool({ name, arguments: args })
        );
        this.toolRegistry.register(toolDef, `mcp:${conn.name}`);
        conn.tools.push(toolDef.name);
      }

      console.log(`[MCPClientManager] Registered ${conn.tools.length} tools from ${conn.name}`);
    } catch (error: any) {
      console.error(`[MCPClientManager] Failed to list tools from ${conn.name}:`, error.message);
    }
  }

  private resolveEnv(env?: Record<string, string>): Record<string, string> | undefined {
    if (!env) return undefined;
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      resolved[key] = value.replace(/\$\{([^}]+)\}/g, (_, varName) => process.env[varName] || '');
    }
    return resolved;
  }
}
