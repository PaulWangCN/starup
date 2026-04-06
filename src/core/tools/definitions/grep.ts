import { ToolDefinition } from '../../../types';
import * as fs from 'fs/promises';
import * as path from 'path';

export const createGrepTool = (workingDir: string): ToolDefinition => ({
  name: 'grep',
  description: '类ripgrep风格的文件搜索工具。支持正则表达式搜索、多行匹配、文件过滤等功能。用于在代码库中查找特定模式。',
  parameters: [
    { name: 'pattern', type: 'string', description: '搜索的正则表达式模式', required: true },
    { name: 'path', type: 'string', description: '搜索路径（文件或目录），默认为当前工作目录', required: false, default: '.' },
    { name: 'glob', type: 'string', description: '文件过滤模式，如 *.ts, *.{js,ts}', required: false },
    { name: 'output_mode', type: 'string', description: '输出模式: content(显示匹配行), files_with_matches(仅显示文件路径), count_matches(统计匹配数)', required: false, default: 'content' },
    { name: '-i', type: 'boolean', description: '忽略大小写', required: false, default: false },
    { name: '-n', type: 'boolean', description: '显示行号', required: false, default: true },
    { name: '-C', type: 'number', description: '显示匹配行前后N行上下文', required: false, default: 0 },
    { name: 'multiline', type: 'boolean', description: '启用多行模式，允许.匹配换行符', required: false, default: false },
    { name: 'head_limit', type: 'number', description: '限制返回的最大行数/文件数', required: false },
  ],
  handler: async (args) => {
    try {
      const searchPath = args.path ? path.resolve(workingDir, args.path) : workingDir;
      const localStarupDir = path.join(workingDir, '.starup');
      
      if (!searchPath.startsWith(workingDir) && !searchPath.startsWith(localStarupDir)) {
        return { success: false, error: '访问被拒绝：路径超出允许目录' };
      }

      const pattern = args.pattern;
      const outputMode = args.output_mode || 'content';
      const ignoreCase = args['-i'] || false;
      const showLineNumbers = args['-n'] !== false;
      const contextLines = args['-C'] || 0;
      const multiline = args.multiline || false;
      const headLimit = args.head_limit;
      const globPattern = args.glob;

      let isFile = false;
      try {
        const stat = await fs.stat(searchPath);
        isFile = stat.isFile();
      } catch {
        // 路径不存在或无法访问，按目录处理
      }

      let filesToSearch: string[] = [];
      if (isFile) {
        filesToSearch = [searchPath];
      } else {
        const getAllFiles = async (dir: string): Promise<string[]> => {
          const files: string[] = [];
          try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                if (['node_modules', '.git', 'dist', '.clawhub', '.openclaw', '.starup'].includes(entry.name)) {
                  continue;
                }
                files.push(...await getAllFiles(fullPath));
              } else if (entry.isFile()) {
                if (globPattern) {
                  const globRegex = new RegExp(
                    '^' + globPattern
                      .replace(/\./g, '\\.')
                      .replace(/\*\*/g, '{{GLOBSTAR}}')
                      .replace(/\*/g, '[^/\\\\]*')
                      .replace(/\{\{GLOBSTAR\}\}/g, '.*')
                      .replace(/\?/g, '.')
                      .replace(/\{([^}]+)\}/g, '($1)'.replace(/,/g, '|')) + '$'
                  );
                  if (!globRegex.test(entry.name)) {
                    continue;
                  }
                }
                files.push(fullPath);
              }
            }
          } catch {
            // 忽略无法访问的目录
          }
          return files;
        };
        filesToSearch = await getAllFiles(searchPath);
      }

      let regex: RegExp;
      try {
        const flags = ['g', ignoreCase ? 'i' : '', multiline ? 'm' : ''].join('');
        regex = new RegExp(pattern, flags);
      } catch (e) {
        return { success: false, error: `无效的正则表达式：${e}` };
      }

      interface Match {
        file: string;
        line?: number;
        content?: string;
        matches?: number;
      }
      const results: Match[] = [];

      for (const filePath of filesToSearch) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split('\n');
          const relativePath = path.relative(workingDir, filePath);
          
          if (outputMode === 'files_with_matches') {
            regex.lastIndex = 0;
            if (regex.test(content)) {
              results.push({ file: relativePath });
              if (headLimit && results.length >= headLimit) break;
            }
          } else if (outputMode === 'count_matches') {
            regex.lastIndex = 0;
            const matches = (content.match(regex) || []).length;
            if (matches > 0) {
              results.push({ file: relativePath, matches });
            }
          } else {
            const fileMatches: Match[] = [];
            
            for (let i = 0; i < lines.length; i++) {
              regex.lastIndex = 0;
              if (regex.test(lines[i])) {
                const lineNum = i + 1;
                
                if (contextLines > 0) {
                  const startLine = Math.max(0, i - contextLines);
                  const endLine = Math.min(lines.length - 1, i + contextLines);
                  const contextContent: string[] = [];
                  for (let j = startLine; j <= endLine; j++) {
                    const prefix = showLineNumbers ? `${j + 1}: ` : '';
                    const marker = j === i ? '>' : ' ';
                    contextContent.push(`${marker}${prefix}${lines[j]}`);
                  }
                  fileMatches.push({
                    file: relativePath,
                    line: lineNum,
                    content: contextContent.join('\n'),
                  });
                } else {
                  const prefix = showLineNumbers ? `${lineNum}: ` : '';
                  fileMatches.push({
                    file: relativePath,
                    line: lineNum,
                    content: `${prefix}${lines[i]}`,
                  });
                }
              }
            }
            
            results.push(...fileMatches);
            if (headLimit && results.length >= headLimit) break;
          }
        } catch {
          // 忽略无法读取的文件（如二进制文件）
        }
      }

      return {
        success: true,
        data: {
          pattern,
          path: args.path || '.',
          totalMatches: results.length,
          results: headLimit ? results.slice(0, headLimit) : results,
          truncated: headLimit ? results.length > headLimit : false,
        },
      };
    } catch (error: any) {
      return { success: false, error: `搜索失败：${error.message}` };
    }
  },
});
