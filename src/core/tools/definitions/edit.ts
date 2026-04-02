import { ToolDefinition } from '../../../types';
import * as fs from 'fs/promises';
import * as path from 'path';

export const createEditTool = (workingDir: string): ToolDefinition => ({
  name: 'edit',
  description: '基于精确匹配和替换的文本编辑。需要提供old和new字符串进行精确替换。',
  parameters: [
    { name: 'path', type: 'string', description: '文件路径', required: true },
    { name: 'old', type: 'string', description: '要替换的旧文本', required: true },
    { name: 'new', type: 'string', description: '新文本', required: true },
    { name: 'replace_all', type: 'boolean', description: '是否替换所有匹配', required: false, default: false },
  ],
  handler: async (args) => {
    const filePath = path.resolve(workingDir, args.path);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      if (!content.includes(args.old)) {
        return { success: false, error: 'Old text not found in file' };
      }
      let newContent: string;
      if (args.replace_all) {
        newContent = content.split(args.old).join(args.new);
      } else {
        newContent = content.replace(args.old, args.new);
      }
      await fs.writeFile(filePath, newContent, 'utf-8');
      return {
        success: true,
        data: { path: filePath, replacements: args.replace_all ? content.split(args.old).length - 1 : 1 },
      };
    } catch (error) {
      return { success: false, error: `Failed to edit file: ${error}` };
    }
  },
});
