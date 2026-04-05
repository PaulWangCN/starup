/**
 * Git 相关工具定义
 */

import { ToolDefinition as Tool } from '../../../types';
import * as cp from 'child_process';
import * as util from 'util';

const execAsync = util.promisify(cp.exec);

async function execGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git ${args.join(' ')}`, { cwd });
    return stdout.trim();
  } catch (error: any) {
    throw new Error(`Git command failed: ${error.stderr || error.message}`);
  }
}

export const gitStatusTool: Tool = {
  name: 'git_status',
  description: '获取当前Git仓库状态',
  parameters: [],
  handler: async (_args: any, context: any) => {
    try {
      const output = await execGit(['status', '--porcelain'], context?.workingDir);
      const status: { staged: string[]; unstaged: string[]; untracked: string[]; conflicted: string[] } = { staged: [], unstaged: [], untracked: [], conflicted: [] };
      for (const line of output.split('\n').filter(Boolean)) {
        const xy = line.substring(0, 2);
        const file = line.substring(3);
        if (xy === 'UU' || xy === 'AA' || xy === 'DD') status.conflicted.push(file);
        else if (xy[0] !== ' ' && xy[0] !== '?') status.staged.push(file);
        else if (xy[1] !== ' ') status.unstaged.push(file);
        else if (xy === '??') status.untracked.push(file);
      }
      return {
        success: true,
        staged: status.staged,
        unstaged: status.unstaged,
        untracked: status.untracked,
        conflicted: status.conflicted,
        is_clean: status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0 && status.conflicted.length === 0
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const gitLogTool: Tool = {
  name: 'git_log',
  description: '查看Git提交历史',
  parameters: [
    { name: 'max_count', type: 'number', description: '最大返回提交数', required: false, default: 10 },
    { name: 'file_path', type: 'string', description: '只查看特定文件的提交历史', required: false },
    { name: 'author', type: 'string', description: '按作者过滤', required: false },
  ],
  handler: async (args: any, context: any) => {
    try {
      const cmd = ['log', '--pretty=format:%H|%an|%ad|%s', '--date=short'];
      if (args.max_count) cmd.push(`--max-count=${args.max_count}`);
      if (args.author) cmd.push(`--author=${args.author}`);
      if (args.file_path) cmd.push('--', args.file_path);
      const output = await execGit(cmd, context?.workingDir);
      const commits = output.split('\n').filter(Boolean).map(line => {
        const [hash, author, date, ...msgParts] = line.split('|');
        return { hash: hash.substring(0, 7), author, date, message: msgParts.join('|') };
      });
      return { success: true, commits, count: commits.length };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const gitDiffTool: Tool = {
  name: 'git_diff',
  description: '查看工作区与暂存区的差异',
  parameters: [
    { name: 'staged', type: 'boolean', description: '查看暂存区的差异', required: false, default: false },
    { name: 'file_path', type: 'string', description: '只查看特定文件的差异', required: false },
  ],
  handler: async (args: any, context: any) => {
    try {
      const cmd = ['diff'];
      if (args.staged) cmd.push('--cached');
      if (args.file_path) cmd.push('--', args.file_path);
      const output = await execGit(cmd, context?.workingDir);
      return { success: true, diff: output.substring(0, 5000) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const gitBranchTool: Tool = {
  name: 'git_branch',
  description: '列出Git分支',
  parameters: [],
  handler: async (_args: any, context: any) => {
    try {
      const output = await execGit(['branch', '-a'], context?.workingDir);
      const branches = output.split('\n').filter(Boolean).map(line => ({
        name: line.replace(/^\*\s*/, '').trim(),
        current: line.startsWith('*')
      }));
      return { success: true, branches, current: branches.find(b => b.current)?.name };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const gitCommitTool: Tool = {
  name: 'git_commit',
  description: '提交更改',
  parameters: [
    { name: 'message', type: 'string', description: '提交信息', required: true },
    { name: 'files', type: 'array', description: '要提交的文件', required: false },
  ],
  handler: async (args: any, context: any) => {
    try {
      if (args.files && args.files.length > 0) {
        await execGit(['add', ...args.files], context?.workingDir);
      }
      await execGit(['commit', '-m', `"${args.message}"`], context?.workingDir);
      return { success: true, message: 'Created commit' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const gitBlameTool: Tool = {
  name: 'git_blame',
  description: '查看文件逐行作者信息',
  parameters: [
    { name: 'file_path', type: 'string', description: '文件路径', required: true },
    { name: 'line_start', type: 'number', description: '起始行号', required: false },
    { name: 'line_end', type: 'number', description: '结束行号', required: false },
  ],
  handler: async (args: any, context: any) => {
    try {
      const cmd = ['blame', '--line-porcelain'];
      if (args.line_start && args.line_end) {
        cmd.push(`-L ${args.line_start},${args.line_end}`);
      }
      cmd.push(args.file_path);
      const output = await execGit(cmd, context?.workingDir);
      const lines = output.split('\n').filter(l => l.startsWith('author ') || l.startsWith('\t'));
      const authors: Record<string, number> = {};
      for (const line of lines) {
        if (line.startsWith('author ')) {
          const author = line.substring(7);
          authors[author] = (authors[author] || 0) + 1;
        }
      }
      return { success: true, authors };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const gitStashTool: Tool = {
  name: 'git_stash',
  description: '暂存当前更改',
  parameters: [
    { name: 'action', type: 'string', description: '操作: save/pop/list/drop', required: false, default: 'save' },
    { name: 'message', type: 'string', description: '暂存描述', required: false },
  ],
  handler: async (args: any, context: any) => {
    try {
      const action = args.action || 'save';
      if (action === 'save') {
        const cmd = ['stash', 'push'];
        if (args.message) cmd.push('-m', args.message);
        await execGit(cmd, context?.workingDir);
        return { success: true, message: 'Changes stashed' };
      } else if (action === 'pop') {
        await execGit(['stash', 'pop'], context?.workingDir);
        return { success: true, message: 'Stash popped' };
      } else if (action === 'list') {
        const list = await execGit(['stash', 'list'], context?.workingDir);
        return { success: true, stashes: list.split('\n').filter(Boolean) };
      }
      return { success: false, error: 'Unknown action' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const gitTools = [
  gitStatusTool,
  gitLogTool,
  gitDiffTool,
  gitBranchTool,
  gitCommitTool,
  gitBlameTool,
  gitStashTool,
];
