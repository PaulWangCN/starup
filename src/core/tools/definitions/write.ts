import { ToolDefinition } from '../../../types';
import * as fs from 'fs/promises';
import * as path from 'path';

export const createWriteTool = (workingDir: string): ToolDefinition => ({
  name: 'write',
  description: '创建或覆盖写入文件。对于系统文件或覆盖操作会要求确认。',
  parameters: [
    { name: 'path', type: 'string', description: '文件路径', required: true },
    { name: 'content', type: 'string', description: '文件内容', required: true },
    { name: 'mode', type: 'string', description: '写入模式: write|append', required: false, default: 'write' },
  ],
  handler: async (args) => {
    const filePath = path.resolve(workingDir, args.path);
    const localStarupDir = path.join(workingDir, '.starup');
    if (!filePath.startsWith(workingDir) && !filePath.startsWith(localStarupDir)) {
      return { success: false, error: '访问被拒绝：路径超出允许目录' };
    }
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      if (args.mode === 'append') {
        await fs.appendFile(filePath, args.content, 'utf-8');
      } else {
        await fs.writeFile(filePath, args.content, 'utf-8');
      }
      return { success: true, data: { path: filePath, mode: args.mode } };
    } catch (error) {
      return { success: false, error: `写入文件失败：${error}` };
    }
  },
});
