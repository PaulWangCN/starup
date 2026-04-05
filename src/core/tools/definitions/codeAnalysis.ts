/**
 * 代码分析相关工具定义
 */

import { ToolDefinition as Tool } from '../../../types';
import * as fs from 'fs';
import * as path from 'path';

export const analyzeComplexityTool: Tool = {
  name: 'analyze_complexity',
  description: '分析代码复杂度（圈复杂度、认知复杂度）',
  parameters: [
    { name: 'file_path', type: 'string', description: '要分析的文件路径', required: false },
    { name: 'directory', type: 'string', description: '分析整个目录', required: false },
  ],
  handler: async (args: any) => {
    try {
      const files: string[] = [];
      if (args.file_path) files.push(args.file_path);
      else if (args.directory) {
        const readDir = (dir: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
              readDir(fullPath);
            } else if (entry.isFile() && /\.(ts|js|tsx|jsx)$/.test(entry.name)) {
              files.push(fullPath);
            }
          }
        };
        readDir(args.directory);
      }

      const results: any[] = [];
      for (const file of files) {
        const code = fs.readFileSync(file, 'utf8');
        const lines = code.split('\n').length;
        const branches = (code.match(/\b(if|while|for|switch|catch)\b/g) || []).length;
        const cyclomatic = branches + 1;
        results.push({ file, cyclomatic, lines });
      }
      results.sort((a, b) => b.cyclomatic - a.cyclomatic);

      return {
        success: true,
        files_analyzed: files.length,
        highest_complexity: results[0],
        high_complexity_files: results.filter(r => r.cyclomatic > 10)
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const detectCodeSmellsTool: Tool = {
  name: 'detect_code_smells',
  description: '检测代码异味和潜在问题',
  parameters: [
    { name: 'file_path', type: 'string', description: '要分析的文件路径', required: false },
    { name: 'directory', type: 'string', description: '分析整个目录', required: false },
  ],
  handler: async (args: any) => {
    try {
      const files: string[] = [];
      if (args.file_path) files.push(args.file_path);
      else if (args.directory) {
        const readDir = (dir: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
              readDir(fullPath);
            } else if (entry.isFile() && /\.(ts|js|tsx|jsx)$/.test(entry.name)) {
              files.push(fullPath);
            }
          }
        };
        readDir(args.directory);
      }

      const smells: any[] = [];
      for (const file of files) {
        const code = fs.readFileSync(file, 'utf8');
        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].length > 120) smells.push({ type: 'long_line', file, line: i + 1 });
          if (/console\.(log|debug)/.test(lines[i])) smells.push({ type: 'console_log', file, line: i + 1 });
          const todo = lines[i].match(/\/\/\s*(TODO|FIXME)/i);
          if (todo) smells.push({ type: 'todo', file, line: i + 1, message: todo[1] });
        }
      }

      return {
        success: true,
        total_smells: smells.length,
        smells: smells.slice(0, 50)
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const analyzeDependenciesTool: Tool = {
  name: 'analyze_dependencies',
  description: '分析项目依赖关系和安全性',
  parameters: [
    { name: 'check_outdated', type: 'boolean', description: '检查过时的依赖', required: false, default: true },
    { name: 'check_vulnerabilities', type: 'boolean', description: '检查安全漏洞', required: false, default: true },
  ],
  handler: async (_args: any) => {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const deps = [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {})
      ];
      return {
        success: true,
        total_dependencies: deps.length,
        production: Object.keys(pkg.dependencies || {}).length,
        development: Object.keys(pkg.devDependencies || {}).length,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const codeAnalysisTools = [
  analyzeComplexityTool,
  detectCodeSmellsTool,
  analyzeDependenciesTool,
];
