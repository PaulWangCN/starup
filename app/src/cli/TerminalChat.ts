import * as readline from 'readline';
import chalk from 'chalk';
import { Renderer } from './Renderer';
import { StarUpCore } from '../index';
import { PromptAssembler, createDefaultConfig, RuntimeContext } from '../core/prompt/PromptAssembler';

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
  private promptAssembler: PromptAssembler;

  constructor(core?: StarUpCore) {
    this.core = core || new StarUpCore();
    this.renderer = new Renderer();
    
    // 创建 PromptAssembler 用于生成系统提示词
    const promptConfig = createDefaultConfig();
    this.promptAssembler = new PromptAssembler(
      promptConfig,
      this.core.toolRegistry,
      this.core.skillRegistry
    );
  }

  /**
   * 启动终端聊天
   */
  async start(): Promise<void> {
    // 初始化核心（会自动检查并创建配置文件）
    await this.core.initialize();

    // 生成系统提示词（七层 Prompt）
    const systemPrompt = await this.generateSystemPrompt();

    // 设置系统提示词（同时用于心跳会话）
    this.core.setSystemPrompt(systemPrompt);

    // 初始化主会话，传入系统提示词
    const mainSession = this.core.sessionManager.initializeMainSession(systemPrompt);
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
      try {
        await this.handleInput(input);
      } catch (error: any) {
        this.renderer.error(`输入处理错误: ${error?.message || error}`);
      }
      // 无论成功与否，都确保重新显示提示符
      if (this.running && this.rl) {
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
   * 生成系统提示词
   */
  private async generateSystemPrompt(): Promise<string> {
    try {
      const runtimeContext: RuntimeContext = {
        timestamp: Date.now(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        activeSessions: this.core.sessionManager.getActiveSessions().length,
        systemStatus: 'healthy',
        memoryUsage: {
          used: process.memoryUsage().heapUsed,
          total: process.memoryUsage().heapTotal,
        },
        requestId: Math.random().toString(36).substring(7),
      };

      console.log('[TerminalChat] Generating system prompt...');
      const assembled = await this.promptAssembler.assemble('default', runtimeContext);
      console.log(`[TerminalChat] System prompt generated, layers: ${Object.entries(assembled.layers).filter(([k,v]) => v).map(([k,v]) => k).join(', ')}`);
      
      // 验证关键层是否加载成功
      if (!assembled.layers.L0_AGENTS || !assembled.layers.L1_SOUL) {
        console.error('[TerminalChat] Critical layers missing! Falling back to default.');
        return this.getDefaultSystemPrompt();
      }
      
      return assembled.content;
    } catch (error) {
      console.error('[TerminalChat] Failed to generate system prompt:', error);
      return this.getDefaultSystemPrompt();
    }
  }

  /**
   * 获取默认系统提示词（fallback）
   * 当 PromptAssembler 失败时使用极简提示词
   */
  private getDefaultSystemPrompt(): string {
    return '你是 StarUp，一个专业的 AI 助手。请检查 ./.starup/ 目录下的配置文件。';
  }

  /**
   * 停止终端聊天
   */
  stop(): void {
    this.stopSpinner();
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

    // 处理消息
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
        console.log('ℹ️ Skills are auto-loaded from app/skills/ and ./.starup/skills/');
        return true;

      case 'tools':
        this.showTools();
        return true;

      default:
        this.renderer.error(`未知命令: ${cmd}`);
        return true;
    }
  }

  private spinnerTimer: NodeJS.Timeout | null = null;
  private spinnerFrame = 0;
  private readonly spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  /**
   * 启动简单文字加载动画（不干扰 readline）
   */
  private startSpinner(text: string): void {
    this.stopSpinner();
    this.spinnerFrame = 0;
    process.stdout.write(chalk.cyan(`${this.spinnerChars[0]} ${text}`));
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % this.spinnerChars.length;
      process.stdout.write(`\r${chalk.cyan(this.spinnerChars[this.spinnerFrame] + ' ' + text)}`);
    }, 80);
  }

  /**
   * 停止加载动画
   */
  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
      // 清除行
      process.stdout.write('\r' + ' '.repeat(50) + '\r');
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

    const thinkingLines: string[] = [];
    let streamStarted = false;

    const printThinking = () => {
      if (thinkingLines.length === 0) return;
      console.log(chalk.gray('┌─ 思考过程 ──────────────────────'));
      for (let i = 0; i < thinkingLines.length; i++) {
        const line = thinkingLines[i];
        const isLast = i === thinkingLines.length - 1;
        const prefix = isLast ? '└─> ' : '├─ ';
        const summary = line.slice(0, 60).replace(/\n/g, ' ');
        console.log(chalk.gray(`${prefix}${summary}${line.length > 60 ? '...' : ''}`));
      }
      console.log();
    };

    // 暂停 readline 以避免与流式输出冲突
    if (this.rl) {
      this.rl.pause();
    }

    // 启动加载动画
    this.startSpinner('AI 思考中...');

    try {
      const result = await this.core.processMessage(
        this.mainSessionId,
        message,
        {
          onThinking: (content) => {
            thinkingLines.push(content);
          },
          onToolCall: (name, args) => {
            this.stopSpinner();
            console.log(chalk.yellow(`  → 调用工具: ${name}`));
          },
          onToolResult: (name, result) => {
            const success = result.success !== false;
            console.log(success ? chalk.green('  ✓ 完成') : chalk.red('  ✗ 失败'));
            // 重新开始加载动画
            this.startSpinner('AI 继续思考...');
          },
          onIterationStart: (iteration) => {
            streamStarted = false;
          },
          onStreamChunk: (chunk) => {
            if (!streamStarted) {
              this.stopSpinner();
              printThinking();
              streamStarted = true;
              console.log(chalk.green('🤖 AI:'));
            }
            process.stdout.write(chunk);
          },
        }
      );

      this.stopSpinner();

      if (!streamStarted) {
        // 流式未触发，回退到原有一次性显示逻辑
        printThinking();
        console.log(chalk.green('🤖 AI:'));
        console.log(result.finalReply);
        console.log();
      } else {
        // 流式已输出完毕，补换行
        console.log();
        console.log();
      }

    } catch (error: any) {
      this.stopSpinner();
      this.renderer.error(`处理消息失败: ${error?.message || error}`);
      console.log();
    } finally {
      // 恢复 readline
      if (this.rl) {
        this.rl.resume();
      }
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
