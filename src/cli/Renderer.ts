import chalk from 'chalk';
import { safeStringify } from '../utils/Logger';

/**
 * 终端渲染器
 * 负责美化输出格式
 */
export class Renderer {
  private colors = {
    user: chalk.cyan,
    ai: chalk.green,
    system: chalk.gray,
    tool: chalk.yellow,
    error: chalk.red,
    success: chalk.green,
    info: chalk.blue,
    border: chalk.dim,
  };

  /**
   * 显示欢迎界面
   */
  showWelcome(): void {
    console.clear();
    const version = '1.0.0';
    console.log(this.colors.border('╔══════════════════════════════════════════╗'));
    console.log(this.colors.border('║') + chalk.bold.cyan('    🤖 StarUp - AI Terminal Assistant    ') + this.colors.border('║'));
    console.log(this.colors.border('║') + chalk.gray(`           Version: ${version}            `.padEnd(41)) + this.colors.border('║'));
    console.log(this.colors.border('╠══════════════════════════════════════════╣'));
    console.log(this.colors.border('║') + '  输入 /help 查看可用命令                ' + this.colors.border('║'));
    console.log(this.colors.border('║') + '  输入 /exit 退出程序                    ' + this.colors.border('║'));
    console.log(this.colors.border('╚══════════════════════════════════════════╝'));
    console.log();
  }

  /**
   * 显示系统消息
   */
  system(message: string): void {
    console.log(this.colors.system(`[SYSTEM] ${message}`));
  }

  /**
   * 显示用户输入
   */
  user(message: string): void {
    console.log(this.colors.user(`> ${message}`));
    console.log();
  }

  /**
   * 显示 AI 回复
   */
  ai(message: string): void {
    console.log(this.colors.ai('AI:') + ' ' + this.formatMessage(message));
    console.log();
  }

  /**
   * 显示工具调用开始
   */
  toolStart(name: string, args: any): void {
    console.log(this.colors.tool(`  → 调用工具: ${name}`));
    console.log(this.colors.tool(`  → 参数: ${safeStringify(args, 2).split('\n').join('\n     ')}`));
  }

  /**
   * 显示工具调用结果
   */
  toolEnd(success: boolean, result?: any): void {
    if (success) {
      console.log(this.colors.success('  ✓ 工具执行成功'));
    } else {
      console.log(this.colors.error('  ✗ 工具执行失败'));
    }
    console.log();
  }

  /**
   * 显示错误
   */
  error(message: string): void {
    console.log(this.colors.error(`[ERROR] ${message}`));
  }

  /**
   * 显示提示
   */
  info(message: string): void {
    console.log(this.colors.info(`[INFO] ${message}`));
  }

  /**
   * 显示分隔线
   */
  separator(): void {
    console.log(this.colors.border('─'.repeat(50)));
  }

  /**
   * 格式化消息（基础 Markdown 支持）
   */
  private formatMessage(message: string): string {
    return (
      message
        // 代码块
        .replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
          return '\n' + this.colors.border('```' + (lang || '')) + '\n' + chalk.white(code) + this.colors.border('```');
        })
        // 行内代码
        .replace(/`([^`]+)`/g, (match, code) => {
          return chalk.bgGray.white(` ${code} `);
        })
        // 加粗
        .replace(/\*\*([^*]+)\*\*/g, (match, text) => {
          return chalk.bold(text);
        })
    );
  }

  /**
   * 显示帮助信息
   */
  showHelp(): void {
    console.log();
    console.log(chalk.bold('可用命令:'));
    console.log(`  ${chalk.cyan('/help')}     - 显示此帮助信息`);
    console.log(`  ${chalk.cyan('/exit')}     - 退出程序`);
    console.log(`  ${chalk.cyan('/quit')}     - 退出程序`);
    console.log(`  ${chalk.cyan('/tools')}    - 列出可用工具`);
    console.log(`  ${chalk.cyan('/skills')}   - 列出已加载的 Skills`);
    console.log(`  ${chalk.cyan('/status')}   - 显示系统状态`);
    console.log(`  ${chalk.cyan('/clear')}    - 清空屏幕`);
    console.log(`  ${chalk.cyan('/history')}  - 显示对话历史`);
    console.log();
    console.log(chalk.bold('快捷键:'));
    console.log(`  ${chalk.gray('↑/↓')}       - 浏览命令历史`);
    console.log(`  ${chalk.gray('Tab')}       - 自动补全`);
    console.log(`  ${chalk.gray('Shift+Enter')} - 换行（多行输入）`);
    console.log(`  ${chalk.gray('Ctrl+J')}    - 换行（多行输入）`);
    console.log(`  ${chalk.gray('Ctrl+C')}    - 取消输入 / 退出程序`);
    console.log(`  ${chalk.gray('粘贴')}      - 支持直接粘贴多行文本`);
    console.log();
  }

  /**
   * 显示工具列表
   */
  showTools(tools: { name: string; description: string }[]): void {
    console.log();
    console.log(chalk.bold('可用工具:'));
    for (const tool of tools) {
      console.log(`  ${chalk.yellow('•')} ${chalk.cyan(tool.name.padEnd(12))} - ${tool.description}`);
    }
    console.log();
  }

  /**
   * 显示 Skill 列表
   */
  showSkills(skills: { name: string; description: string }[]): void {
    console.log();
    console.log(chalk.bold('已加载 Skills:'));
    if (skills.length === 0) {
      console.log(chalk.gray('  (无)'));
    } else {
      for (const skill of skills) {
        const shortDesc = skill.description.length > 50 
          ? skill.description.substring(0, 50) + '...' 
          : skill.description;
        console.log(`  ${chalk.green('•')} ${chalk.cyan(skill.name)}`);
        console.log(`    ${chalk.gray(shortDesc)}`);
      }
    }
    console.log();
  }

  /**
   * 显示状态
   */
  showStatus(status: {
    initialized: boolean;
    sessions: number;
    skills: number;
    tools: number;
  }): void {
    console.log();
    console.log(chalk.bold('系统状态:'));
    console.log(`  初始化: ${status.initialized ? chalk.green('✓') : chalk.red('✗')}`);
    console.log(`  会话数: ${chalk.cyan(status.sessions)}`);
    console.log(`  Skills: ${chalk.cyan(status.skills)}`);
    console.log(`  工具数: ${chalk.cyan(status.tools)}`);
    console.log();
  }

  /**
   * 显示对话历史
   */
  showHistory(messages: { role: string; content: string }[]): void {
    console.log();
    console.log(chalk.bold('对话历史:'));
    console.log(this.colors.border('─'.repeat(50)));
    
    for (const msg of messages) {
      if (msg.role === 'user') {
        console.log(this.colors.user(`> ${msg.content}`));
      } else if (msg.role === 'assistant') {
        console.log(this.colors.ai(`AI: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`));
      }
    }
    
    console.log(this.colors.border('─'.repeat(50)));
    console.log();
  }

  /**
   * 显示退出消息
   */
  showGoodbye(): void {
    console.log();
    console.log(this.colors.info('感谢使用 StarUp！再见！'));
    console.log();
  }
}
