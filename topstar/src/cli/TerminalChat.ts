import * as readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { Renderer } from './Renderer';
import { commands } from './commands';
import { StarUpCore } from '../index';

/**
 * 终端聊天界面
 * 提供交互式命令行对话体验
 */
export class TerminalChat {
  private core: StarUpCore;
  private renderer: Renderer;
  private rl: readline.Interface | null = null;
  private running: boolean = false;
  private mainSessionId: string | null = null;

  constructor(core?: StarUpCore) {
    this.core = core || new StarUpCore();
    this.renderer = new Renderer();
  }

  /**
   * 启动终端聊天
   */
  async start(): Promise<void> {
    // 初始化核心
    await this.core.initialize();

    // 初始化主会话
    const mainSession = this.core.sessionManager.initializeMainSession();
    this.mainSessionId = mainSession.id;

    // 显示欢迎界面
    this.renderer.showWelcome();
    const status = this.core.getStatus();
    this.renderer.system(`已加载 ${status.skills} 个 Skills, ${status.tools} 个工具`);
    this.renderer.system(`会话: ${mainSession.id.substring(0, 8)}... 已初始化`);
    this.renderer.separator();

    // 创建 readline 接口
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('> '),
      completer: (line: string) => this.completer(line),
    });

    this.running = true;

    // 显示提示
    this.showPrompt();

    // 处理输入
    this.rl.on('line', async (input) => {
      await this.handleInput(input);
      if (this.running) {
        this.showPrompt();
      }
    });

    // 处理退出
    this.rl.on('close', () => {
      if (this.running) {
        this.renderer.showGoodbye();
        process.exit(0);
      }
    });

    // 处理 Ctrl+C
    process.on('SIGINT', () => {
      this.stop();
    });
  }

  /**
   * 停止终端聊天
   */
  stop(): void {
    this.running = false;
    if (this.rl) {
      this.rl.close();
    }
    this.renderer.showGoodbye();
    process.exit(0);
  }

  /**
   * 处理用户输入
   */
  private async handleInput(input: string): Promise<void> {
    const trimmed = input.trim();

    if (!trimmed) {
      return;
    }

    // 检查是否是命令
    if (trimmed.startsWith('/')) {
      const shouldContinue = await this.handleCommand(trimmed);
      if (!shouldContinue) {
        this.stop();
      }
      return;
    }

    // 处理消息（用户输入已由 readline 显示）
    await this.processMessage(trimmed);
  }

  /**
   * 处理命令
   */
  private async handleCommand(input: string): Promise<boolean> {
    const parts = input.slice(1).split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    switch (cmd) {
      case 'exit':
      case 'quit':
        return false;

      case 'help':
        this.showHelp();
        return true;

      case 'status':
        this.showStatus();
        return true;

      case 'skills':
        await commands.list(['--verbose']);
        return true;

      case 'tools':
        this.showTools();
        return true;

      default:
        this.renderer.error(`未知命令: ${cmd}`);
        return true;
    }
  }

  /**
   * 处理消息并与 AI 对话
   */
  private async processMessage(message: string): Promise<void> {
    if (!this.mainSessionId) {
      this.renderer.error('会话未初始化');
      return;
    }

    // 创建 loading 动画
    const spinner = ora({
      text: '思考中...',
      color: 'cyan',
    }).start();

    try {
      // 处理消息
      const result = await this.core.processMessage(this.mainSessionId, message);

      spinner.stop();

      // 显示 AI 回复
      this.renderer.ai(result);
    } catch (error) {
      spinner.stop();
      this.renderer.error(`处理消息失败: ${error}`);
    }
  }

  /**
   * 显示帮助
   */
  private showHelp(): void {
    console.log(`
可用命令:
  /exit, /quit    退出程序
  /help           显示帮助
  /status         显示系统状态
  /skills         列出已加载的 Skills
  /tools          列出可用工具

直接输入消息与 AI 对话。
`);
  }

  /**
   * 显示系统状态
   */
  private showStatus(): void {
    const status = this.core.getStatus();
    const stats = this.core.sessionManager.getStats();

    console.log(`
系统状态:
  Skills: ${status.skills}
  工具: ${status.tools}
  会话: ${stats.total} (活跃: ${stats.active}, 子代理: ${stats.subAgents})
`);
  }

  /**
   * 显示工具列表
   */
  private showTools(): void {
    const tools = this.core.toolRegistry.getAll();
    console.log('\n可用工具:');
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }
    console.log();
  }

  /**
   * 自动补全
   */
  private completer(line: string): [string[], string] {
    const completions = ['/exit', '/quit', '/help', '/status', '/skills', '/tools'];
    const hits = completions.filter((c) => c.startsWith(line));
    return [hits.length ? hits : completions, line];
  }

  /**
   * 显示提示符
   */
  private showPrompt(): void {
    if (this.rl) {
      this.rl.prompt();
    }
  }
}
