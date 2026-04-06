import { ToolDefinition } from '../../../types';
import * as fs from 'fs/promises';
import * as path from 'path';

interface SingleEdit {
  old: string;
  new: string;
  replace_all?: boolean;
}

export const createEditTool = (workingDir: string): ToolDefinition => ({
  name: 'edit',
  description: '基于精确匹配和替换的文本编辑工具。支持单次编辑或批量多编辑。',
  parameters: [
    { name: 'path', type: 'string', description: '文件路径', required: true },
    { name: 'old', type: 'string', description: '要替换的旧文本（单编辑模式）', required: false },
    { name: 'new', type: 'string', description: '新文本（单编辑模式）', required: false },
    { name: 'replace_all', type: 'boolean', description: '是否替换所有匹配（单编辑模式）', required: false, default: false },
    { name: 'edit', type: 'array', description: '批量编辑列表，每个元素包含 {old, new, replace_all?}', required: false },
  ],
  handler: async (args) => {
    const filePath = path.resolve(workingDir, args.path);
    const localStarupDir = path.join(workingDir, '.starup');
    
    if (!filePath.startsWith(workingDir) && !filePath.startsWith(localStarupDir)) {
      return { success: false, error: '访问被拒绝：路径超出允许目录' };
    }

    try {
      let content = await fs.readFile(filePath, 'utf-8');
      const originalContent = content;
      
      // 构建编辑列表
      let edits: SingleEdit[] = [];
      
      // 批量编辑模式
      if (args.edit && Array.isArray(args.edit) && args.edit.length > 0) {
        edits = args.edit.map((e: any) => ({
          old: e.old,
          new: e.new,
          replace_all: e.replace_all || false,
        }));
      }
      // 单编辑模式（向后兼容）
      else if (args.old !== undefined) {
        edits = [{
          old: args.old,
          new: args.new,
          replace_all: args.replace_all || false,
        }];
      } else {
        return { success: false, error: '请提供 edit 数组或 old/new 参数' };
      }

      // 验证所有编辑项
      const notFoundEdits: number[] = [];
      for (let i = 0; i < edits.length; i++) {
        if (!content.includes(edits[i].old)) {
          notFoundEdits.push(i);
        }
      }
      
      if (notFoundEdits.length > 0) {
        const details = notFoundEdits.map(i => {
          const preview = edits[i].old.substring(0, 50).replace(/\n/g, '\\n');
          return `  #${i + 1}: "${preview}${edits[i].old.length > 50 ? '...' : ''}"`;
        }).join('\n');
        return { 
          success: false, 
          error: `以下 ${notFoundEdits.length} 个编辑项在文件中未找到匹配文本：\n${details}` 
        };
      }

      // 执行所有编辑
      let totalReplacements = 0;
      const editResults: { index: number; old: string; replacements: number }[] = [];
      
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        let replacements = 0;
        
        if (edit.replace_all) {
          const parts = content.split(edit.old);
          replacements = parts.length - 1;
          content = parts.join(edit.new);
        } else {
          if (content.includes(edit.old)) {
            content = content.replace(edit.old, edit.new);
            replacements = 1;
          }
        }
        
        totalReplacements += replacements;
        editResults.push({ index: i + 1, old: edit.old.substring(0, 30), replacements });
      }

      // 检查内容是否真的改变了
      if (content === originalContent) {
        return { success: false, error: '文件内容未发生任何改变' };
      }

      await fs.writeFile(filePath, content, 'utf-8');
      
      return {
        success: true,
        data: { 
          path: filePath, 
          totalEdits: edits.length,
          totalReplacements,
          details: editResults,
        },
      };
    } catch (error) {
      return { success: false, error: `编辑文件失败：${error}` };
    }
  },
});
