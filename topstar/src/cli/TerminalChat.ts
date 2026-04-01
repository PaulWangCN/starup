import * as readline from 'readline';
import { Renderer } from './Renderer';
import { CommandManager } from './commands';
import { StarUpCore } from '../index';
import ora from 'ora';

/**
 * 终端聊天界面
 * 提供交互式命令行对话体验
 */
export class TerminalChat {
  private core: StarUpCore;
  private renderer: Renderer;
  private commands: CommandManager;
  private rl: readline.Interface | null = null;
  private running: boolean = false;
  private mainSessionId: string | null = null;

  constructor(core: StarUpCore) {
    this.core = core;
    this.renderer = new Renderer();
    this.commands = new CommandManager(core, this.renderer);
  }

  /**
   * 启动终端聊天
   */
  async start(): Promise<void> {
    // 初始化核心
    await this.core.initialize();

    // 获取主会话
    const mainSession = this.core.getSessionManager().getMainSession();
    if (!mainSession) {
      throw new Error('Failed to initialize main session');
    }
    this.mainSessionId = mainSession.id;

    // 显示欢迎界面
    this.renderer.showWelcome();
    this.renderer.system(`已加载 ${this.core.getStatus().skills} 个 Skills, ${this.core.getStatus().tools} 个工具`);
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
    if (this.commands.isCommand(trimmed)) {
      const shouldContinue = await this.commands.execute(trimmed);
      if (!shouldContinue) {
        this.stop();
      }
      return;
    }

    // 处理消息（用户输入已由 readline 显示）
    await this.processMessage(trimmed);
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
      // 处理消息（带工具调用拦截）
      const result = await this.processMessageWithTools(message);
      
      spinner.stop();
      
      // 显示 AI 回复
      this.renderer.ai(result);
    } catch (error) {
      spinner.stop();
      this.renderer.error(`处理消息失败: ${error}`);
    }
  }

  /**
   * 处理消息并拦截工具调用
   */
  private async processMessageWithTools(message: string): Promise<string> {
    if (!this.mainSessionId) {
      throw new Error('Session not initialized');
    }

    const session = this.core.getSessionManager().getSession(this.mainSessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // 添加用户消息
    this.core.getSessionManager().addMessage(this.mainSessionId, {
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    // 这里需要访问 LLMService，但由于它是私有的，我们需要通过 processMessage 来处理
    // 暂时使用核心 processMessage 方法
    return await this.core.processMessage(this.mainSessionId, message);
  }

  /**
   * 自动补全
   */
  private completer(line: string): [string[], string] {
    const completions = this.commands.getCommandList().map((c) => `/${c}`);
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

// 导入 chalk 用于 prompt
import chalk from 'chalk';
