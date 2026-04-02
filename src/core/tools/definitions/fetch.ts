import { ToolDefinition } from '../../../types';

export const fetchTool: ToolDefinition = {
  name: 'fetch',
  description: '发起 HTTP 网络请求，支持 GET/POST/PUT/DELETE 等方法。用于调用外部 API、获取网页内容、下载数据等。\n注意：如果某个 skill 已经提供了专门的工具（如 fetch、weather），请优先使用该 skill 的工具。',
  parameters: [
    { name: 'url', type: 'string', description: '请求的 URL 地址', required: true },
    { name: 'method', type: 'string', description: 'HTTP 方法: GET、POST、PUT、DELETE、PATCH 等，默认为 GET', required: false, default: 'GET' },
    { name: 'headers', type: 'object', description: '请求头对象，如 { "Content-Type": "application/json" }', required: false },
    { name: 'body', type: 'string', description: '请求体（用于 POST/PUT/PATCH），可以是 JSON 字符串或表单数据', required: false },
    { name: 'timeout', type: 'number', description: '超时时间（秒），默认 30 秒，最大 120 秒', required: false, default: 30 },
  ],
  handler: async (args) => {
    try {
      const url = new URL(args.url);
      const timeout = Math.min((args.timeout || 30) * 1000, 120000);
      
      const fetchOptions: RequestInit = {
        method: args.method?.toUpperCase() || 'GET',
        headers: args.headers || {},
      };
      
      if (args.body && !['GET', 'HEAD'].includes(fetchOptions.method as string)) {
        fetchOptions.body = args.body;
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      fetchOptions.signal = controller.signal;
      
      const response = await fetch(url.toString(), fetchOptions);
      clearTimeout(timeoutId);
      
      const contentType = response.headers.get('content-type') || '';
      let data: any;
      
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        const maxLen = 50000;
        data = text.length > maxLen ? text.substring(0, maxLen) + '\n... (content truncated)' : text;
      }
      
      return {
        success: response.ok,
        data: {
          status: response.status,
          statusText: response.statusText,
          headers: (() => {
            const h: Record<string, string> = {};
            response.headers.forEach((value, key) => { h[key] = value; });
            return h;
          })(),
          data: data,
        },
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { success: false, error: 'Request timeout' };
      }
      return { success: false, error: `Request failed: ${error.message}` };
    }
  },
};
