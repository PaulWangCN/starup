/**
 * 项目理解相关工具定义
 */

import { ToolDefinition as Tool } from '../../../types';
import * as fs from 'fs';
import * as path from 'path';

export const understandProjectTool: Tool = {
  name: 'project_understand',
  description: '理解项目结构和架构',
  parameters: [
    { name: 'root_path', type: 'string', description: '项目根目录', required: false, default: '.' },
    { name: 'include_contents', type: 'boolean', description: '是否包含文件内容摘要', required: false, default: false },
  ],
  handler: async (args: any) => {
    try {
      const rootPath = args.root_path || '.';
      const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8'));
      
      const directories: string[] = [];
      const files: any[] = [];
      
      const scanDir = (dir: string, depth = 0) => {
        if (depth > 3) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(rootPath, fullPath);
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            directories.push(relPath);
            scanDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const stat = fs.statSync(fullPath);
            files.push({ path: relPath, size: stat.size });
          }
        }
      };
      scanDir(rootPath);

      return {
        success: true,
        project_name: pkg.name || 'Unknown',
        description: pkg.description || '',
        directories: directories.slice(0, 30),
        total_files: files.length,
        dependencies: Object.keys(pkg.dependencies || {}),
        dev_dependencies: Object.keys(pkg.devDependencies || {}),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const findEntryPointsTool: Tool = {
  name: 'find_entry_points',
  description: '查找项目入口文件',
  parameters: [
    { name: 'root_path', type: 'string', description: '项目根目录', required: false, default: '.' },
  ],
  handler: async (args: any) => {
    try {
      const rootPath = args.root_path || '.';
      const entryPoints: any[] = [];
      
      const pkgPath = path.join(rootPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.main) entryPoints.push({ type: 'main', path: pkg.main });
        if (pkg.module) entryPoints.push({ type: 'module', path: pkg.module });
      }
      
      const commonEntries = ['src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js', 'index.ts'];
      for (const entry of commonEntries) {
        if (fs.existsSync(path.join(rootPath, entry))) {
          if (!entryPoints.some(e => e.path === entry)) {
            entryPoints.push({ type: 'detected', path: entry });
          }
        }
      }

      return { success: true, entry_points: entryPoints, count: entryPoints.length };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const summarizeFileTool: Tool = {
  name: 'summarize_file',
  description: '生成文件内容摘要',
  parameters: [
    { name: 'file_path', type: 'string', description: '文件路径', required: true },
  ],
  handler: async (args: any) => {
    try {
      const content = fs.readFileSync(args.file_path, 'utf8');
      const lines = content.split('\n');
      
      const imports: string[] = [];
      const importMatches = content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
      for (const match of importMatches) imports.push(match[1]);

      const exports: string[] = [];
      const exportMatches = content.matchAll(/export\s+(?:default\s+)?(?:const|let|var|function|class|interface)\s+(\w+)/g);
      for (const match of exportMatches) exports.push(match[1]);

      const todos: string[] = [];
      const todoMatches = content.matchAll(/\/\/\s*TODO[\s:]*(.*)/gi);
      for (const match of todoMatches) todos.push(match[1]);

      return {
        success: true,
        file: args.file_path,
        lines: lines.length,
        imports: imports.slice(0, 20),
        exports: exports,
        todos: todos,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const findRelatedFilesTool: Tool = {
  name: 'find_related_files',
  description: '查找与指定文件相关的文件',
  parameters: [
    { name: 'file_path', type: 'string', description: '参考文件路径', required: true },
    { name: 'root_path', type: 'string', description: '搜索根目录', required: false, default: '.' },
  ],
  handler: async (args: any) => {
    try {
      const rootPath = args.root_path || '.';
      const targetFile = args.file_path;
      const baseName = path.basename(targetFile, path.extname(targetFile));
      const dir = path.dirname(targetFile);
      
      const relatedFiles: any[] = [];
      
      // 同目录同名不同扩展名
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const entryBase = path.basename(entry.name, path.extname(entry.name));
          if (entryBase === baseName && entry.name !== path.basename(targetFile)) {
            relatedFiles.push({ path: path.join(dir, entry.name), relation: 'same_base_name' });
          }
        }
      }

      // 测试文件
      const testPatterns = [`${dir}/${baseName}.test.ts`, `${dir}/${baseName}.spec.ts`];
      for (const testPath of testPatterns) {
        if (fs.existsSync(testPath)) {
          relatedFiles.push({ path: testPath, relation: 'test_file' });
        }
      }

      return {
        success: true,
        file: targetFile,
        related_files: relatedFiles.slice(0, 15),
        count: relatedFiles.length
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const projectUnderstandingTools = [
  understandProjectTool,
  findEntryPointsTool,
  summarizeFileTool,
  findRelatedFilesTool,
];
