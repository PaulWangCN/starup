import { ToolDefinition } from '../../../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const createExecTool = (workingDir: string): ToolDefinition => ({
  name: 'exec',
  description: '执行本地系统shell命令（自动适配 Windows/Mac/Linux）。这是通用系统命令工具，仅用于执行本地文件/系统操作。\n注意：如果某个skill已经提供了专门工具（如web_search、weather），请优先使用该skill的工具，不要用exec去模拟实现相同功能。',
  parameters: [
    { name: 'command', type: 'string', description: '要执行的命令。Windows: 用dir/cd; Mac/Linux: 用ls/pwd', required: true },
    { name: 'timeout', type: 'number', description: '超时时间（秒）', required: false, default: 60 },
  ],
  handler: async (args) => {
    const timeout = Math.min(args.timeout || 60, 300);
    const dangerousPatterns = [
      /\brm\s+-rf\s+\/\b/,
      /\bmkfs\b/,
      /\bdd\s+if=\/dev\/zero/,
      /\bformat\s+(C:|D:|E:|F:)/i,
      /\bdel\s+\/f\s+\/s\s+\/q\s+\\/i,
    ];
    for (const pattern of dangerousPatterns) {
      if (pattern.test(args.command)) {
        return { success: false, error: 'Dangerous command blocked for security' };
      }
    }
    try {
      let command = args.command;
      if (process.platform === 'win32') {
        command = command
          .replace(/^ls\s+-la$/i, 'dir')
          .replace(/^ls\s+(-[a-z]+)?\s*/i, 'dir ')
          .replace(/^pwd$/i, 'cd')
          .replace(/^cat\s+/i, 'type ')
          .replace(/^cp\s+/i, 'copy ')
          .replace(/^mv\s+/i, 'move ')
          .replace(/^rm\s+/i, 'del ')
          .replace(/^touch\s+/i, 'type nul > ');
        const isPythonCommand = command.includes('python') && (command.includes('-c') || command.includes('.py'));
        if (isPythonCommand) {
          const escapedCommand = command.replace(/"/g, '\\"');
          command = `powershell -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${escapedCommand}"`;
        } else {
          command = `chcp 65001 >nul && ${command}`;
        }
      }
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeout * 1000,
        cwd: workingDir,
        encoding: 'utf8',
        windowsHide: true,
        shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
      });
      let output = (stdout || '').replace(/^Active code page: \d+\r?\n?/i, '').trim();
      let errOutput = (stderr || '').trim();
      const maxLen = 3000;
      if (output.length > maxLen) output = output.substring(0, maxLen) + '\n... (output truncated)';
      if (errOutput.length > maxLen) errOutput = errOutput.substring(0, maxLen) + '\n... (stderr truncated)';
      return {
        success: true,
        data: { stdout: output || '(no output)', stderr: errOutput || '(no stderr)', exitCode: 0, platform: process.platform },
      };
    } catch (error: any) {
      let errorMsg = error.message;
      let stdout = (error.stdout || '').toString();
      let stderr = (error.stderr || '').toString();
      stdout = stdout.replace(/^Active code page: \d+\r?\n?/i, '').trim();
      stderr = stderr.replace(/^Active code page: \d+\r?\n?/i, '').trim();
      if (process.platform === 'win32' && error.code === 'ENOENT') {
        errorMsg = `Command not found. On Windows, try using "dir" instead of "ls", "cd" instead of "pwd"`;
      }
      return {
        success: false,
        error: errorMsg,
        data: { stdout: stdout.substring(0, 3000), stderr: stderr.substring(0, 3000), exitCode: error.code || 1, platform: process.platform },
      };
    }
  },
});
