/**
 * Web/API 相关工具定义
 */

import { ToolDefinition as Tool } from '../../../types';

export const parseHtmlTool: Tool = {
  name: 'parse_html',
  description: '解析HTML提取信息',
  parameters: [
    { name: 'html', type: 'string', description: 'HTML内容', required: true },
    { name: 'selector', type: 'string', description: 'CSS选择器', required: true },
  ],
  handler: async (args: any) => {
    try {
      const regex = new RegExp(`<${args.selector}[^>]*>(.*?)</${args.selector}>`, 'gi');
      const results: string[] = [];
      let match;
      while ((match = regex.exec(args.html)) !== null) {
        results.push(match[1].replace(/<[^>]+>/g, '').trim());
      }
      return { success: true, results: results.slice(0, 20), count: results.length };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const apiRequestTool: Tool = {
  name: 'api_request',
  description: '发送结构化API请求',
  parameters: [
    { name: 'url', type: 'string', description: 'API端点', required: true },
    { name: 'method', type: 'string', description: 'HTTP方法', required: false, default: 'GET' },
    { name: 'json_body', type: 'object', description: 'JSON请求体', required: false },
    { name: 'auth_token', type: 'string', description: 'Bearer token', required: false },
  ],
  handler: async (args: any) => {
    try {
      const fetch = require('node-fetch');
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (args.auth_token) headers['Authorization'] = `Bearer ${args.auth_token}`;
      if (args.json_body) headers['Content-Type'] = 'application/json';
      
      const response = await fetch(args.url, {
        method: args.method || 'GET',
        headers,
        body: args.json_body ? JSON.stringify(args.json_body) : undefined
      });
      
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json() : await response.text();
      return { success: response.ok, status: response.status, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const checkUrlTool: Tool = {
  name: 'check_url',
  description: '检查URL可访问性和响应时间',
  parameters: [
    { name: 'url', type: 'string', description: '要检查的URL', required: true },
    { name: 'retries', type: 'number', description: '重试次数', required: false, default: 1 },
  ],
  handler: async (args: any) => {
    try {
      const fetch = require('node-fetch');
      const startTime = Date.now();
      const response = await fetch(args.url, { method: 'HEAD', timeout: 10000 });
      return {
        success: response.ok,
        status: response.status,
        response_time_ms: Date.now() - startTime
      };
    } catch (error: any) {
      return { success: false, url: args.url, error: error.message };
    }
  }
};

export const webTools = [
  parseHtmlTool,
  apiRequestTool,
  checkUrlTool,
];
