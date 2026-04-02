import { ToolDefinition } from '../../../types';
import * as fs from 'fs/promises';
import * as path from 'path';

export const createReadTool = (workingDir: string): ToolDefinition => ({
  name: 'read',
  description: '读取文本文件或图片文件内容。支持自动检测文件类型并进行相应处理（图片会进行OCR或视觉描述）。',
  parameters: [
    { name: 'path', type: 'string', description: '文件路径', required: true },
    { name: 'offset', type: 'number', description: '起始行号', required: false, default: 1 },
    { name: 'limit', type: 'number', description: '读取行数', required: false, default: 1000 },
  ],
  handler: async (args) => {
    const filePath = path.resolve(workingDir, args.path);
    const localStarupDir = path.join(workingDir, '.starup');
    if (!filePath.startsWith(workingDir) && !filePath.startsWith(localStarupDir)) {
      return { success: false, error: 'Access denied: path outside allowed directories' };
    }
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const offset = (args.offset || 1) - 1;
      const limit = args.limit || 1000;
      const selectedLines = lines.slice(offset, offset + limit);
      return {
        success: true,
        data: { content: selectedLines.join('\n'), totalLines: lines.length, readLines: selectedLines.length },
      };
    } catch (error) {
      return { success: false, error: `Failed to read file: ${error}` };
    }
  },
});
