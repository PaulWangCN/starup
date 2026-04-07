import * as readline from 'readline';
import chalk from 'chalk';
import { Renderer } from './Renderer';
import { StarUpCore } from '../index';
import { PromptAssembler, createDefaultConfig, RuntimeContext } from '../core/prompt/PromptAssembler';
import { logger } from '../utils/Logger';
import { metricService } from '../core/metrics/MetricService';

/**
 * 终端聊天界面
 * 提供交互式命令行对话体验
 */
export class TerminalChat {
  private core: StarUpCore;
  private renderer: Renderer;
  private rl: readline.Interface | null = null;
  private running: boolean = false;
  private isProcessing: boolean = false;
  private mainSessionId: string | null = null;
  private promptAssembler: PromptAssembler;
  private notifications: string[] = [];
  
  // 多行输入支持
  private multiLineBuffer: string[] = [];
  private isMultiLineMode: boolean = false;

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
    // 显示启动横幅
    logger.printBanner('CLI', '1.0.0');
    
    // 初始化核心（会自动检查并创建配置文件）
    await this.core.initialize();

    // 生成系统提示词（七层 Prompt）
    const systemPrompt = await this.generateSystemPrompt();

    // 设置系统提示词（同时用于心跳会话）
    this.core.setSystemPrompt(systemPrompt);

    // 初始化主会话，传入系统提示词
    const mainSession = this.core.sessionManager.initializeMainSession(systemPrompt);
    this.mainSessionId = mainSession.id;

    // 注册定时任务结果回调：把后台任务结果投递到通知队列
    this.core.onScheduledTaskComplete = (content) => {
      this.notifications.push(content);
      // 如果当前没有在对话中（没有 spinner），立即显示；否则排队等待当前轮次结束
      if (!this.spinnerTimer) {
        this.flushNotifications();
      }
    };

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

    // 启用 keypress 事件以捕获组合键（如 Shift+Enter）
    readline.emitKeypressEvents(process.stdin);
    
    // 启用 raw mode 以捕获组合键
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    // 监听 keypress 事件以支持 Shift+Enter 换行
    process.stdin.on('keypress', (str, key) => {
      if (!key) return;
      
      // 在多行模式下，累积输入
      if (this.isMultiLineMode) {
        // Ctrl+J: 在当前位置继续添加新行（Ctrl+J 比 Shift+Enter 更可靠）
        if (key.ctrl && key.name === 'j') {
          // 将当前行添加到缓冲区
          this.multiLineBuffer.push(this.rl?.line || '');
          process.stdout.write('\n');
          // 重置 readline 的当前行
          if (this.rl) {
            (this.rl as any).line = '';
            (this.rl as any).cursor = 0;
          }
          return;
        }
        
        // 普通 Enter: 提交多行输入
        if (key.name === 'return' || key.name === 'enter') {
          // 添加最后一行
          this.multiLineBuffer.push(this.rl?.line || '');
          const finalInput = this.multiLineBuffer.join('\n');
          this.multiLineBuffer = [];
          this.isMultiLineMode = false;
          
          process.stdout.write('\n');
          
          // 如果正在处理中，忽略新输入
          if (this.isProcessing) {
            this.renderer.system('AI 正在处理中，请稍候...');
            return;
          }
          
          // 处理输入
          this.handleInputAsync(finalInput);
          return;
        }
        
        // Ctrl+C: 取消多行输入
        if (key.ctrl && key.name === 'c') {
          this.multiLineBuffer = [];
          this.isMultiLineMode = false;
          process.stdout.write('^C\n');
          process.stdout.write(chalk.gray('[已取消多行输入]\n'));
          if (this.rl) {
            (this.rl as any).line = '';
            (this.rl as any).cursor = 0;
          }
          this.showPrompt();
          return;
        }
        
        return; // 多行模式下，让其他键正常处理
      }
      
      // 普通模式下（非多行）
      
      // Ctrl+J: 进入多行模式（Ctrl+J 比 Shift+Enter 更可靠）
      if (key.ctrl && key.name === 'j') {
        this.multiLineBuffer = [this.rl?.line || ''];
        this.isMultiLineMode = true;
        process.stdout.write('\n');
        // 显示多行模式提示
        process.stdout.write(chalk.gray('[多行模式 - Ctrl+J 换行, Enter 发送, Ctrl+C 取消]\n'));
        // 重置 readline 当前行
        if (this.rl) {
          (this.rl as any).line = '';
          (this.rl as any).cursor = 0;
        }
        return;
      }
      
      // 普通 Enter: 正常提交（让 readline 处理）
      // 不拦截，让 readline 触发 'line' 事件
      
      // Ctrl+C: 退出程序
      if (key.ctrl && key.name === 'c') {
        // 如果有输入内容，先清空
        if (this.rl && this.rl.line.length > 0) {
          if (this.rl) {
            (this.rl as any).line = '';
            (this.rl as any).cursor = 0;
          }
          process.stdout.write('\n');
          this.showPrompt();
          return;
        }
        this.stop();
        return;
      }
    });

    // 处理 readline line 事件（单行输入和粘贴的多行文本）
    this.rl.on('line', async (input) => {
      // 如果正在处理中，忽略新输入并提示用户
      if (this.isProcessing) {
        this.renderer.system('AI 正在处理中，请稍候...');
        return;
      }
      
      // 如果处于多行模式，不在这里处理（已经在 keypress 中处理）
      if (this.isMultiLineMode) {
        return;
      }
      
      // 检查是否是粘贴的多行文本（包含换行符）
      if (input.includes('\n')) {
        // 粘贴的多行文本，直接处理
        try {
          await this.handleInput(input);
        } catch (error: any) {
          this.renderer.error(`输入处理错误: ${error?.message || error}`);
        }
        if (this.running && this.rl) {
          this.showPrompt();
        }
        return;
      }
      
      // 普通单行输入
      if (input.trim()) {
        try {
          await this.handleInput(input);
        } catch (error: any) {
          this.renderer.error(`输入处理错误: ${error?.message || error}`);
        }
        if (this.running && this.rl) {
          this.showPrompt();
        }
      }
    });

    // 处理退出
    this.rl.on('close', () => {
      if (this.running) {
        this.renderer.showGoodbye();
        process.exit(0);
      }
    });

    // 处理 Ctrl+C (SIGINT)
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
      logger?.debug('TerminalChat', `System prompt generated, layers: ${Object.entries(assembled.layers).filter(([k,v]) => v).map(([k,v]) => k).join(', ')}`);
      
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
    
    // 恢复终端 raw mode 状态
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    
    if (this.rl) {
      this.rl.close();
    }
    this.renderer.showGoodbye();
    process.exit(0);
  }

  /**
   * 异步处理输入（用于 keypress 事件）
   */
  private async handleInputAsync(input: string): Promise<void> {
    try {
      await this.handleInput(input);
    } catch (error: any) {
      this.renderer.error(`输入处理错误: ${error?.message || error}`);
    }
    // 重新启用 raw mode 并显示提示符
    if (this.running && this.rl) {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      this.showPrompt();
    }
  }

  /**
   * 处理用户输入
   */
  private async handleInput(input: string): Promise<void> {
    const trimmed = input.trim();

    if (!trimmed) {
      return;
    }

    // 检查是否是命令（多行输入不支持命令）
    if (trimmed.startsWith('/') && !trimmed.includes('\n')) {
      const shouldContinue = await this.handleCommand(trimmed);
      if (!shouldContinue) {
        this.stop();
      }
      return;
    }

    // 处理消息
    await this.processMessage(input);
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
        console.log('ℹ️ Skills are loaded from ./.starup/skills/');
        return true;

      case 'tools':
        this.showTools();
        return true;

      case 'tasks':
        this.showTasks();
        return true;

      case 'clear':
        this.clearScreen();
        return true;

      case 'history':
        this.showHistory(parseInt(args[0]) || 10);
        return true;

      case 'agents':
      case 'team':
        await this.showAgentTeamStatus();
        return true;

      case 'analyze':
        if (args.length === 0) {
          this.renderer.error('用法: /analyze <任务描述> - 分析任务复杂度');
        } else {
          await this.analyzeTaskComplexity(args.join(' '));
        }
        return true;

      case 'm':
      case 'multi':
        await this.enterMultiLineMode();
        return true;

      case 'metrics':
        this.showMetrics(args);
        return true;

      case 'prompt':
      case 'system':
        await this.showSystemPrompt();
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

    // 标记正在处理中，防止并发输入
    this.isProcessing = true;
    // 先清除当前 readline 行并换行，避免流式输出与 readline 状态冲突
    if (this.rl) {
      process.stdout.write('\r' + ' '.repeat(80) + '\r\n');
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
            // 显示具体参数
            if (args && Object.keys(args).length > 0) {
              const formattedArgs = this.formatToolArgs(name, args);
              console.log(chalk.gray(`     ${formattedArgs}`));
            }
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
      // 标记处理完成
      this.isProcessing = false;
    }
  }

  /**
   * 进入多行输入模式（通过命令）
   * 简单的异步循环实现，输入空行结束
   */
  private async enterMultiLineMode(): Promise<void> {
    console.log();
    console.log(chalk.cyan('进入多行输入模式'));
    console.log(chalk.gray('  输入空行结束，Ctrl+C 取消'));
    console.log(chalk.gray('  提示: 你也可以直接粘贴多行文本，无需进入此模式'));
    console.log();
    
    const buffer: string[] = [];
    
    // 使用 question 逐行读取
    const askLine = (): Promise<string | null> => {
      return new Promise((resolve) => {
        this.rl?.question(chalk.gray('... '), (answer) => {
          resolve(answer);
        });
      });
    };
    
    while (true) {
      try {
        const line = await askLine();
        
        // Ctrl+C 会导致 line 为 null 或 undefined
        if (line === null || line === undefined) {
          console.log(chalk.gray('[已取消多行输入]'));
          break;
        }
        
        // 空行表示结束
        if (line.trim() === '') {
          const finalInput = buffer.join('\n');
          
          if (finalInput.trim()) {
            console.log(chalk.gray('[发送多行输入...]'));
            await this.handleInput(finalInput);
          } else {
            console.log(chalk.gray('[已取消多行输入]'));
          }
          break;
        }
        
        buffer.push(line);
      } catch (e) {
        console.log(chalk.gray('[已取消多行输入]'));
        break;
      }
    }
    
    // 恢复提示符
    this.showPrompt();
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
  /tasks          列出定时任务
  /clear          清空屏幕
  /history [n]    显示最近 n 条对话历史 (默认 10)
  /agents, /team  显示 Agent Team 状态
  /analyze <任务> 分析任务复杂度
  /m, /multi      进入多行输入模式
  /metrics [days] 显示监控统计 (默认 7 天)
  /prompt, /system 输出当前完整系统提示词

直接输入消息与 AI 对话。
复杂任务将自动组建 Agent Team 协作处理。

输入技巧:
  直接粘贴        支持粘贴多行文本
  /m, /multi      进入多行输入模式（输入空行结束）
  Ctrl+J          临时换行（部分终端支持）
  Ctrl+C          取消当前输入 / 退出程序
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
   * 显示定时任务列表
   */
  private showTasks(): void {
    const tasks = this.core.scheduler.getTasks();
    if (tasks.length === 0) {
      console.log('\n暂无定时任务。');
      return;
    }
    console.log('\n定时任务列表:');
    for (const task of tasks) {
      const status = task.enabled ? '✅ 启用' : '⏸️ 停用';
      const lastRun = task.lastRun ? new Date(task.lastRun).toLocaleString() : '从未';
      console.log(`  - ${task.name} (${status})`);
      console.log(`    ID: ${task.id}`);
      console.log(`    Cron: ${task.schedule}`);
      console.log(`    已执行: ${task.runCount} 次, 上次执行: ${lastRun}`);
      console.log(`    Prompt: ${task.prompt.slice(0, 50)}${task.prompt.length > 50 ? '...' : ''}`);
    }
    console.log();
  }

  /**
   * 清空屏幕
   */
  private clearScreen(): void {
    console.clear();
    this.renderer.showWelcome();
    const status = this.core.getStatus();
    this.renderer.system(`已加载 ${status.skills} 个 Skills, ${status.tools} 个工具`);
    this.renderer.system(`会话: ${this.mainSessionId?.substring(0, 8)}... 已初始化`);
    this.renderer.separator();
  }

  /**
   * 显示对话历史
   */
  private showHistory(limit: number = 10): void {
    if (!this.mainSessionId) {
      this.renderer.error('会话未初始化');
      return;
    }

    const session = this.core.sessionManager.getSession(this.mainSessionId);
    if (!session) {
      this.renderer.error('会话不存在');
      return;
    }

    const messages = session.context.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-limit);

    if (messages.length === 0) {
      console.log('\n暂无对话历史。');
      return;
    }

    console.log(`\n${chalk.bold('对话历史')} (最近 ${messages.length} 条):`);
    console.log(chalk.gray('─'.repeat(50)));

    for (const msg of messages) {
      if (msg.role === 'user') {
        console.log(chalk.cyan(`> ${msg.content}`));
      } else if (msg.role === 'assistant') {
        const content = msg.content.substring(0, 80);
        const suffix = msg.content.length > 80 ? '...' : '';
        console.log(chalk.green(`🤖 ${content}${suffix}`));
      }
    }

    console.log(chalk.gray('─'.repeat(50)));
    console.log();
  }

  /**
   * 显示 Agent Team 状态
   */
  private async showAgentTeamStatus(): Promise<void> {
    if (!this.core.agentOrchestrator) {
      console.log('\n❌ Agent Team 功能未启用（LLM 未配置）');
      return;
    }

    const missions = this.core.agentOrchestrator.getActiveMissions();
    
    console.log(`\n${chalk.bold('🤖 Agent Team 状态')}`);
    console.log(chalk.gray('─'.repeat(50)));
    
    if (missions.length === 0) {
      console.log('当前没有正在执行的 Agent Team 任务。');
    } else {
      console.log(`正在执行的任务: ${missions.length} 个\n`);
      
      for (const mission of missions) {
        console.log(chalk.cyan(`📋 任务: ${mission.id}`));
        console.log(`   状态: ${mission.status}`);
        console.log(`   复杂度: ${mission.complexity.level} (${mission.complexity.score}/100)`);
        console.log(`   子任务: ${mission.subtasks?.length || 0} 个`);
        console.log(`   Agent 数: ${mission.agents?.size || 0} 个`);
        
        if (mission.agents && mission.agents.size > 0) {
          console.log('   参与的 Agent:');
          for (const [_, agent] of mission.agents) {
            const status = agent.status === 'working' ? '⏳' : agent.status === 'idle' ? '⏸️' : '✅';
            console.log(`      ${status} ${agent.name} (${agent.role})`);
          }
        }
        
        console.log();
      }
    }
    
    console.log(chalk.gray('提示: Agent Team 会在处理复杂任务时自动组建'));
    console.log(chalk.gray('使用 /analyze <任务> 分析任务复杂度'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log();
  }

  /**
   * 分析任务复杂度
   */
  private async analyzeTaskComplexity(task: string): Promise<void> {
    if (!this.core.agentOrchestrator) {
      console.log('\n❌ Agent Team 功能未启用（LLM 未配置）');
      return;
    }

    console.log('\n🔍 正在分析任务复杂度...');
    
    try {
      const complexity = await this.core.agentOrchestrator.analyzeComplexity(task);
      
      console.log(`\n${chalk.bold('📊 复杂度分析报告')}`);
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`任务: ${task.substring(0, 50)}${task.length > 50 ? '...' : ''}`);
      console.log(`复杂度等级: ${chalk.cyan(complexity.level)} (${complexity.score}/100)`);
      console.log(`建议团队规模: ${complexity.suggestedTeamSize} 人`);
      console.log(`预计耗时: ${complexity.estimatedDuration}`);
      console.log(`可并行化: ${complexity.canParallelize ? '✅ 是' : '❌ 否'}`);
      
      if (complexity.reasons.length > 0) {
        console.log('\n分析原因:');
        complexity.reasons.forEach((reason, i) => {
          console.log(`  ${i + 1}. ${reason}`);
        });
      }
      
      if (complexity.suggestedRoles.length > 0) {
        console.log(`\n建议角色: ${complexity.suggestedRoles.join(', ')}`);
      }
      
      const willUseTeam = this.core.agentOrchestrator.shouldUseAgentTeam(complexity);
      console.log(`\n${willUseTeam ? chalk.green('✅ 将自动组建 Agent Team 处理') : chalk.yellow('⚡ 将直接处理（复杂度较低）')}`);
      
      console.log(chalk.gray('─'.repeat(50)));
      console.log();
    } catch (error) {
      this.renderer.error(`分析失败: ${error}`);
    }
  }

  /**
   * 格式化工具参数显示
   */
  private formatToolArgs(toolName: string, args: any): string {
    if (!args || typeof args !== 'object') {
      return '';
    }

    // 针对不同工具的格式化
    switch (toolName) {
      case 'Shell':
      case 'exec':
        return `命令: ${args.command || args.cmd || ''}`;
      
      case 'ReadFile':
      case 'read':
        return `文件: ${args.path || args.file || ''}`;
      
      case 'WriteFile':
      case 'write':
        return `写入: ${args.path || args.file || ''}`;
      
      case 'Grep':
      case 'grep':
        return `搜索: "${args.pattern || ''}" ${args.path ? `in ${args.path}` : ''}`;
      
      case 'Glob':
      case 'glob':
        return `匹配: ${args.pattern || ''}`;
      
      case 'StrReplaceFile':
      case 'edit':
        return `编辑: ${args.path || ''}`;
      
      case 'FetchURL':
      case 'fetch':
        return `URL: ${args.url || ''}`;
      
      case 'SearchWeb':
      case 'web':
      case 'web_search':
        return `查询: "${args.query || ''}"`;
      
      case 'Agent':
        return `子代理: ${args.description || args.agent_id || ''}`;
      
      default:
        // 默认显示关键参数
        const keyParams = ['path', 'file', 'command', 'cmd', 'pattern', 'query', 'url', 'name'];
        for (const key of keyParams) {
          if (args[key]) {
            return `${key}: ${args[key]}`;
          }
        }
        // 如果没有关键参数，显示第一个参数
        const firstKey = Object.keys(args)[0];
        if (firstKey) {
          const value = args[firstKey];
          if (typeof value === 'string' && value.length > 50) {
            return `${firstKey}: ${value.substring(0, 50)}...`;
          }
          return `${firstKey}: ${value}`;
        }
        return '';
    }
  }

  /**
   * 自动补全
   */
  /**
   * 显示监控统计
   */
  private showMetrics(args: string[]): void {
    const days = parseInt(args[0]) || 7;
    
    console.log();
    console.log(chalk.bold('📊 StarUp 监控统计'));
    console.log(chalk.gray('─'.repeat(60)));
    
    // 工具统计
    const toolStats = metricService.getToolStats(days);
    console.log(chalk.cyan('\n🔧 工具调用统计'));
    console.log(`   统计周期: 最近 ${days} 天`);
    console.log(`   总计: ${toolStats.total} 次调用`);
    console.log(`   成功: ${chalk.green(toolStats.success)} (${((toolStats.success/toolStats.total)*100).toFixed(1)}%)`);
    console.log(`   失败: ${chalk.red(toolStats.failed)} (${((toolStats.failed/toolStats.total)*100).toFixed(1)}%)`);
    
    if (toolStats.byTool.length > 0) {
      console.log(chalk.gray('\n   工具使用排行:'));
      console.log(chalk.gray('   ' + '─'.repeat(50)));
      console.log(chalk.gray(`   ${'排名'.padEnd(4)} ${'工具名'.padEnd(20)} ${'调用次数'.padEnd(10)} ${'失败率'.padEnd(10)} ${'平均耗时'.padEnd(10)}`));
      console.log(chalk.gray('   ' + '─'.repeat(50)));
      
      toolStats.byTool.slice(0, 10).forEach((tool, i) => {
        const failRate = tool.fail_count > 0 
          ? chalk.red(`${((tool.fail_count/tool.total_calls)*100).toFixed(1)}%`) 
          : chalk.green('0%');
        const avgTime = `${Math.round(tool.avg_duration_ms)}ms`;
        console.log(`   ${String(i+1).padEnd(4)} ${tool.tool_name.padEnd(20)} ${String(tool.total_calls).padEnd(10)} ${failRate.padEnd(10)} ${avgTime.padEnd(10)}`);
      });
    }
    
    if (toolStats.errors.length > 0) {
      console.log(chalk.yellow('\n   ⚠️ 主要错误类型:'));
      toolStats.errors.slice(0, 5).forEach((err, i) => {
        console.log(`      ${i+1}. ${chalk.red(err.error_type)}: ${err.error_count} 次`);
        console.log(`         影响工具: ${err.affected_tools}`);
      });
    }
    
    // Skill 统计
    const skillStats = metricService.getSkillStats(days);
    console.log(chalk.cyan('\n\n🎯 Skill 执行统计'));
    console.log(`   总计: ${skillStats.total} 次执行`);
    console.log(`   成功: ${chalk.green(skillStats.success)} (${((skillStats.success/skillStats.total)*100).toFixed(1)}%)`);
    console.log(`   失败: ${chalk.red(skillStats.failed)} (${((skillStats.failed/skillStats.total)*100).toFixed(1)}%)`);
    
    if (skillStats.byRole.length > 0) {
      console.log(chalk.gray('\n   Subagent 角色效率:'));
      console.log(chalk.gray('   ' + '─'.repeat(55)));
      console.log(chalk.gray(`   ${'角色'.padEnd(15)} ${'执行次数'.padEnd(10)} ${'平均步数'.padEnd(10)} ${'平均工具'.padEnd(10)} ${'成功率'.padEnd(10)}`));
      console.log(chalk.gray('   ' + '─'.repeat(55)));
      
      skillStats.byRole.forEach((role) => {
        const successRate = role.success_rate >= 80 
          ? chalk.green(`${role.success_rate}%`)
          : role.success_rate >= 50 
            ? chalk.yellow(`${role.success_rate}%`)
            : chalk.red(`${role.success_rate}%`);
        console.log(`   ${role.subagent_role.padEnd(15)} ${String(role.total_executions).padEnd(10)} ${String(role.avg_steps).padEnd(10)} ${String(role.avg_tool_calls).padEnd(10)} ${successRate.padEnd(10)}`);
      });
    }
    
    console.log();
    console.log(chalk.gray('提示: 使用 /metrics <天数> 查看指定周期的统计'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();
  }

  /**
   * 显示当前系统提示词（完整七层 Prompt）
   */
  private async showSystemPrompt(): Promise<void> {
    console.log();
    console.log(chalk.bold('📝 当前系统提示词（完整七层 Prompt）'));
    console.log(chalk.gray('═'.repeat(70)));

    try {
      const runtimeContext: RuntimeContext = {
        timestamp: Date.now(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        activeSessions: this.core.sessionManager.getStats().active,
        systemStatus: 'healthy',
        memoryUsage: {
          used: process.memoryUsage().heapUsed,
          total: process.memoryUsage().heapTotal,
        },
        requestId: Math.random().toString(36).substring(7),
      };

      const assembled = await this.promptAssembler.assemble('default', runtimeContext);

      // 输出每层信息
      console.log(chalk.cyan(`\n📦 Prompt 版本: ${assembled.version}`));
      console.log(chalk.cyan(`📊 Token 估算: ~${assembled.tokenCount} tokens`));
      console.log(chalk.cyan(`🔧 已启用层:`));
      Object.entries(assembled.layers).forEach(([layer, enabled]) => {
        const status = enabled ? chalk.green('✓') : chalk.gray('✗');
        console.log(`   ${status} ${layer}`);
      });

      console.log(chalk.gray('\n' + '─'.repeat(70)));
      console.log(chalk.yellow('📄 完整提示词内容：'));
      console.log(chalk.gray('─'.repeat(70)));
      console.log(assembled.content);
      console.log(chalk.gray('─'.repeat(70)));
      console.log(chalk.gray(`\n💡 提示: 此提示词包含 ${Object.values(assembled.layers).filter(Boolean).length} 层上下文（L0-L6）`));
      console.log();
    } catch (error) {
      this.renderer.error(`获取系统提示词失败: ${error}`);
    }
  }

  private completer(line: string): [string[], string] {
    const completions = ['/exit', '/quit', '/help', '/status', '/skills', '/tools', '/tasks', '/clear', '/history', '/agents', '/team', '/analyze', '/m', '/multi', '/metrics', '/prompt', '/system'];
    const hits = completions.filter((c) => c.startsWith(line));
    return [hits.length ? hits : completions, line];
  }

  /**
   * 显示提示符
   */
  private showPrompt(): void {
    this.flushNotifications();
    if (this.rl) {
      this.rl.prompt();
    }
  }

  /**
   * 刷出通知队列中的定时任务消息
   */
  private flushNotifications(): void {
    if (this.notifications.length === 0) return;
    // 清除当前行，避免和 spinner 或 readline 冲突
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
    for (const msg of this.notifications) {
      console.log(chalk.yellow('⏰ 定时任务消息'));
      console.log(msg);
      console.log();
    }
    this.notifications = [];
  }
}
