import { ToolDefinition } from '../../../types';

export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description: '获取网页内容，支持 HTML 到文本/Markdown 的转换和长度限制。专门用于网页抓取和内容提取。',
  parameters: [
    { name: 'url', type: 'string', description: '要获取的网页 URL', required: true },
    { name: 'extractMode', type: 'string', description: '内容提取模式: text（纯文本）、markdown（Markdown 格式），默认为 text', required: false, default: 'text' },
    { name: 'maxChars', type: 'number', description: '最大返回字符数，默认 8000', required: false, default: 8000 },
    { name: 'timeout', type: 'number', description: '超时时间（秒），默认 30 秒', required: false, default: 30 },
  ],
  handler: async (args) => {
    try {
      const timeout = Math.min((args.timeout || 30) * 1000, 120000);
      const maxChars = Math.min(args.maxChars || 8000, 50000);
      const extractMode = args.extractMode || 'text';
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(args.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }
      
      let html = await response.text();
      
      let content = html;
      if (extractMode === 'text' || extractMode === 'markdown') {
        content = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
        content = content.replace(/<(\/p|br|div|h[1-6]|li|tr)[^>]*>/gi, '\n');
        content = content.replace(/<(p|div|h[1-6]|li|td|th)[^>]*>/gi, '\n');
        content = content.replace(/<td[^>]*>/gi, ' ');
        content = content.replace(/<th[^>]*>/gi, ' ');
        content = content.replace(/<tr[^>]*>/gi, '\n');
        content = content.replace(/<[^>]+>/g, '');
        content = content.replace(/&nbsp;/g, ' ');
        content = content.replace(/&amp;/g, '&');
        content = content.replace(/&lt;/g, '<');
        content = content.replace(/&gt;/g, '>');
        content = content.replace(/&quot;/g, '"');
        content = content.replace(/&#39;/g, "'");
        content = content.replace(/&mdash;/g, '—');
        content = content.replace(/&ndash;/g, '–');
        content = content.replace(/&hellip;/g, '...');
        content = content.replace(/&[a-zA-Z]+;/g, '');
        content = content.replace(/\r\n/g, '\n');
        content = content.replace(/\r/g, '\n');
        content = content.replace(/\t/g, ' ');
        content = content.replace(/ +/g, ' ');
        content = content.replace(/\n +/g, '\n');
        content = content.replace(/ +\n/g, '\n');
        content = content.replace(/\n{3,}/g, '\n\n');
        content = content.trim();
      }
      
      const truncated = content.length > maxChars;
      if (truncated) {
        content = content.substring(0, maxChars) + '\n... （内容已截断）';
      }
      
      return {
        success: true,
        data: {
          url: args.url,
          title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim(),
          content: content,
          truncated: truncated,
          length: content.length,
        },
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { success: false, error: '请求超时' };
      }
      return { success: false, error: `获取网页失败：${error.message}` };
    }
  },
};
