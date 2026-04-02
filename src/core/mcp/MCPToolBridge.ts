import { ToolDefinition, ToolParameter, ToolResult, Session } from '../../types';

/**
 * MCP Tool 类型（简化自 SDK 的 listTools 返回）
 */
export interface MCPSchemaProperty {
  type?: string;
  description?: string;
  default?: any;
  [key: string]: any;
}

export interface MCPInputSchema {
  type: 'object';
  properties?: Record<string, MCPSchemaProperty>;
  required?: string[];
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: MCPInputSchema;
  [key: string]: any;
}

/**
 * 把 MCP 的 inputSchema properties 映射为 StarUp 的 ToolParameter 列表
 */
function mapSchemaToParameters(schema: MCPInputSchema): ToolParameter[] {
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);

  return Object.entries(properties).map(([name, prop]) => ({
    name,
    type: (prop.type as string) || 'string',
    description: prop.description || '',
    required: required.has(name),
    default: prop.default,
  }));
}

/**
 * 把 MCP 的 callTool 结果转换为 StarUp 的 ToolResult
 */
function mapCallResultToToolResult(mcpResult: any): ToolResult {
  if (mcpResult.isError) {
    const text = mcpResult.content
      ?.filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
    return {
      success: false,
      error: text || 'MCP tool execution failed',
    };
  }

  const textParts: string[] = [];
  const data: any = {
    content: mcpResult.content,
    structuredContent: mcpResult.structuredContent,
  };

  for (const item of mcpResult.content || []) {
    if (item.type === 'text') {
      textParts.push(item.text);
    } else if (item.type === 'image') {
      textParts.push(`[Image: ${item.mimeType}]`);
    } else if (item.type === 'resource') {
      textParts.push(`[Resource: ${item.resource?.uri || ''}]`);
    }
  }

  return {
    success: true,
    data: {
      ...data,
      text: textParts.join('\n'),
    },
  };
}

/**
 * 将单个 MCP Tool 转换为 StarUp ToolDefinition
 * @param serverName 用于给工具名加前缀，防止不同 server 的工具冲突
 * @param mcpTool MCP 侧的工具定义
 * @param callTool 实际调用 MCP client.callTool 的闭包函数
 */
export function convertMCPToolToStarUp(
  serverName: string,
  mcpTool: MCPTool,
  callTool: (name: string, args: any) => Promise<any>
): ToolDefinition {
  const prefixedName = `${serverName}_${mcpTool.name}`;

  return {
    name: prefixedName,
    description: `[MCP:${serverName}] ${mcpTool.description || 'No description'}`,
    parameters: mapSchemaToParameters(mcpTool.inputSchema),
    handler: async (args: any, _session: Session): Promise<ToolResult> => {
      try {
        const result = await callTool(mcpTool.name, args);
        return mapCallResultToToolResult(result);
      } catch (error: any) {
        return {
          success: false,
          error: error?.message || String(error),
        };
      }
    },
  };
}
