import * as readline from 'readline';
import chalk from 'chalk';
import { Renderer } from './Renderer';
import { StarUpCore } from '../index';
import { PromptAssembler, createDefaultConfig, RuntimeContext } from '../core/prompt/PromptAssembler';
import { logger } from '../utils/Logger';

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
  private notifications: string[] = [];

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
  /tasks          列出定时任务
  /clear          清空屏幕
  /history [n]    显示最近 n 条对话历史 (默认 10)
  /agents, /team  显示 Agent Team 状态
  /analyze <任务> 分析任务复杂度

直接输入消息与 AI 对话。
复杂任务将自动组建 Agent Team 协作处理。
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
  private completer(line: string): [string[], string] {
    const completions = ['/exit', '/quit', '/help', '/status', '/skills', '/tools', '/tasks', '/clear', '/history', '/agents', '/team', '/analyze'];
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
