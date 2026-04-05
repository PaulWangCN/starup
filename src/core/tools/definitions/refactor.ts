/**
 * 代码重构相关工具定义
 */

import { ToolDefinition as Tool } from '../../../types';
import * as fs from 'fs';

export const suggestRefactoringTool: Tool = {
  name: 'suggest_refactoring',
  description: '分析代码并提供重构建议',
  parameters: [
    { name: 'file_path', type: 'string', description: '要分析的文件路径', required: false },
    { name: 'code', type: 'string', description: '直接传入代码内容', required: false },
  ],
  handler: async (args: any) => {
    try {
      let code: string;
      if (args.file_path) {
        code = fs.readFileSync(args.file_path, 'utf8');
      } else if (args.code) {
        code = args.code;
      } else {
        return { success: false, error: 'Must provide file_path or code' };
      }

      const suggestions: any[] = [];
      const lines = code.split('\n');

      // 检测长行
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 120) {
          suggestions.push({ type: 'long_line', line: i + 1, message: 'Line exceeds 120 characters' });
        }
      }

      // 检测长函数
      for (let i = 0; i < lines.length; i++) {
        if (/function\s+\w+\s*\(/.test(lines[i])) {
          let braceCount = 0;
          let funcLines = 0;
          for (let j = i; j < lines.length && funcLines < 100; j++) {
            braceCount += (lines[j].match(/\{/g) || []).length;
            braceCount -= (lines[j].match(/\}/g) || []).length;
            funcLines++;
            if (braceCount === 0 && j > i) break;
          }
          if (funcLines > 30) {
            suggestions.push({ type: 'long_function', line: i + 1, message: `Function is ${funcLines} lines` });
          }
        }
      }

      return {
        success: true,
        total_suggestions: suggestions.length,
        suggestions: suggestions.slice(0, 20)
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const extractMethodTool: Tool = {
  name: 'extract_method',
  description: '提取选中代码为新方法',
  parameters: [
    { name: 'file_path', type: 'string', description: '文件路径', required: true },
    { name: 'start_line', type: 'number', description: '开始行号', required: true },
    { name: 'end_line', type: 'number', description: '结束行号', required: true },
    { name: 'method_name', type: 'string', description: '新方法名称', required: true },
  ],
  handler: async (args: any) => {
    try {
      const code = fs.readFileSync(args.file_path, 'utf8');
      const lines = code.split('\n');
      const selectedCode = lines.slice(args.start_line - 1, args.end_line).join('\n');
      return {
        success: true,
        extracted_method: args.method_name,
        original_code: selectedCode,
        suggestion: `function ${args.method_name}() {\n${selectedCode}\n}`
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const refactorTools = [
  suggestRefactoringTool,
  extractMethodTool,
];
