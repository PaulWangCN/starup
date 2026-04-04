#!/usr/bin/env node
/**
 * 增强版终端聊天界面
 * 基于 chalk + boxen 的现代化 UI（CommonJS 兼容）
 */

import * as readline from 'readline';
import chalk from 'chalk';
import boxen from 'boxen';
import * as dotenv from 'dotenv';
import { StarUpCore } from '../index';
import { logger } from '../utils/Logger';

// 加载环境变量
dotenv.config();

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  metadata?: {
    toolName?: string;
    thinking?: boolean;
  };
}

/**
 * 增强版终端聊天
 */
class EnhancedChat {
  private core: StarUpCore;
  private rl: readline.Interface | null = null;
  private running: boolean = false;
  private mainSessionId: string | null = null;
  private messages: Message[] = [];
  private isProcessing: boolean = false;

  constructor(core?: StarUpCore) {
    this.core = core || new StarUpCore();
  }

  /**
   * 启动增强版聊天
   */
  async start(): Promise<void> {
    // 显示现代化启动界面
    this.showSplashScreen();

    // 初始化核心
    await this.core.initialize();

    // 创建主会话
    const mainSession = this.core.sessionManager.initializeMainSession();
    this.mainSessionId = mainSession.id;
    this.core.registerSession(mainSession.id);

    // 创建 readline 接口
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.running = true;

    // 显示欢迎信息
    this.showWelcome();

    // 处理输入
    this.rl.on('line', async (input) => {
      await this.handleInput(input);
    });

    this.rl.on('close', () => {
      this.showGoodbye();
      process.exit(0);
    });
  }

  /**
   * 显示启动画面
   */
  private showSplashScreen(): void {
    console.clear();
    const logo = `
    ███████╗████████╗ █████╗ ██████╗ ██╗   ██╗██████╗ 
    ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗██║   ██║██╔══██╗
    ███████╗   ██║   ███████║██████╔╝██║   ██║██████╔╝
    ╚════██║   ██║   ██╔══██║██╔══██╗██║   ██║██╔═══╝ 
    ███████║   ██║   ██║  ██║██║  ██║╚██████╔╝██║     
    ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     
    `;

    console.log(
      boxen(chalk.cyan(logo) + chalk.white('\n    🤖 AI Agent Terminal v2.0'), {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
        backgroundColor: '#0f0f23',
      })
    );
  }

  /**
   * 显示欢迎信息
   */
  private showWelcome(): void {
    const status = this.core.getStatus();
    const stats = this.core.sessionManager.getStats();

    const infoBox = boxen(
      `${chalk.gray('系统状态')}\n` +
      `${chalk.green('●')} Skills: ${status.skills}\n` +
      `${chalk.blue('●')} Tools: ${status.tools}\n` +
      `${chalk.yellow('●')} Sessions: ${stats.total}\n` +
      `${chalk.cyan('●')} Session ID: ${this.mainSessionId?.slice(0, 8)}...`,
      {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'gray',
        dimBorder: true,
      }
    );

    console.log(infoBox);
    console.log(chalk.gray('\n输入 /help 查看帮助，/exit 退出\n'));
    this.showPrompt();
  }

  /**
   * 显示提示符
   */
  private showPrompt(): void {
    if (!this.running) return;
    process.stdout.write(chalk.cyan('\n❯ '));
  }

  /**
   * 处理输入
   */
  private async handleInput(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) {
      this.showPrompt();
      return;
    }

    // 处理命令
    if (trimmed.startsWith('/')) {
      await this.handleCommand(trimmed);
      return;
    }

    // 显示用户消息
    this.addMessage({
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    });

    // 处理消息
    await this.processMessage(trimmed);
  }

  /**
   * 处理命令
   */
  private async handleCommand(input: string): Promise<void> {
    const parts = input.slice(1).split(' ');
    const cmd = parts[0];

    switch (cmd) {
      case 'exit':
      case 'quit':
        this.running = false;
        this.rl?.close();
        return;

      case 'help':
        this.showHelp();
        break;

      case 'clear':
        console.clear();
        this.showSplashScreen();
        break;

      case 'status':
        this.showStatus();
        break;

      case 'agents':
      case 'team':
        await this.showAgentTeamStatus();
        break;

      case 'project':
        await this.showProjectInfo();
        break;

      default:
        console.log(chalk.red(`未知命令: ${cmd}`));
    }

    this.showPrompt();
  }

  /**
   * 处理消息
   */
  private async processMessage(message: string): Promise<void> {
    if (!this.mainSessionId) return;

    this.isProcessing = true;
    let responseContent = '';

    try {
      // 显示思考中动画
      this.showThinking();

      const result = await this.core.processMessage(
        this.mainSessionId,
        message,
        {
          onStreamChunk: (chunk) => {
            responseContent += chunk;
            this.updateAssistantMessage(responseContent);
          },
          onToolCall: (name) => {
            this.showToolCall(name);
          },
        }
      );

      // 清除思考动画
      this.clearThinking();

      // 显示最终回复
      this.addMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.finalReply,
        timestamp: Date.now(),
      });

    } catch (error: any) {
      this.clearThinking();
      this.addMessage({
        id: `error-${Date.now()}`,
        role: 'system',
        content: `错误: ${error.message}`,
        timestamp: Date.now(),
      });
    }

    this.isProcessing = false;
    this.showPrompt();
  }

  /**
   * 添加消息
   */
  private addMessage(message: Message): void {
    this.messages.push(message);
    this.renderMessage(message);
  }

  /**
   * 渲染单条消息
   */
  private renderMessage(message: Message): void {
    const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });

    switch (message.role) {
      case 'user':
        console.log(
          boxen(chalk.white(message.content), {
            padding: 1,
            margin: { top: 0, bottom: 0, left: 20, right: 0 },
            borderStyle: 'round',
            borderColor: 'blue',
            title: chalk.gray(`${time} You`),
            titleAlignment: 'right',
          })
        );
        break;

      case 'assistant':
        console.log(
          boxen(chalk.white(message.content), {
            padding: 1,
            margin: { top: 0, bottom: 0, left: 0, right: 0 },
            borderStyle: 'round',
            borderColor: 'green',
            title: chalk.gray(`${time} AI`),
            titleAlignment: 'left',
          })
        );
        break;

      case 'system':
        console.log(chalk.yellow(`⚡ ${message.content}`));
        break;

      case 'tool':
        console.log(chalk.gray(`🔧 ${message.metadata?.toolName}: ${message.content.slice(0, 50)}...`));
        break;
    }
  }

  /**
   * 更新助手消息（流式）
   */
  private updateAssistantMessage(content: string): void {
    // 在流式输出时更新最后一条消息
    // 实际实现可能需要更复杂的终端控制
  }

  /**
   * 显示思考中
   */
  private showThinking(): void {
    process.stdout.write(chalk.yellow('\n🤔 思考中...'));
  }

  /**
   * 清除思考动画
   */
  private clearThinking(): void {
    process.stdout.write('\r' + ' '.repeat(20) + '\r');
  }

  /**
   * 显示工具调用
   */
  private showToolCall(name: string): void {
    console.log(chalk.cyan(`\n  🔧 调用工具: ${name}`));
  }

  /**
   * 显示帮助
   */
  private showHelp(): void {
    const helpBox = boxen(
      `${chalk.white.bold('可用命令')}\n\n` +
      `${chalk.cyan('/exit')}      退出程序\n` +
      `${chalk.cyan('/clear')}     清空屏幕\n` +
      `${chalk.cyan('/status')}    显示系统状态\n` +
      `${chalk.cyan('/agents')}    显示 Agent Team 状态\n` +
      `${chalk.cyan('/project')}   显示项目信息\n` +
      `${chalk.cyan('/help')}      显示此帮助`,
      {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
      }
    );
    console.log(helpBox);
  }

  /**
   * 显示状态
   */
  private showStatus(): void {
    const status = this.core.getStatus();
    const stats = this.core.sessionManager.getStats();

    const statusBox = boxen(
      `${chalk.white.bold('系统状态')}\n\n` +
      `${chalk.green('●')} Skills: ${status.skills}\n` +
      `${chalk.blue('●')} Tools: ${status.tools}\n` +
      `${chalk.yellow('●')} 总会话: ${stats.total}\n` +
      `${chalk.yellow('●')} 活跃: ${stats.active}\n` +
      `${chalk.yellow('●')} 子代理: ${stats.subAgents}`,
      {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'green',
      }
    );
    console.log(statusBox);
  }

  /**
   * 显示 Agent Team 状态
   */
  private async showAgentTeamStatus(): Promise<void> {
    if (!this.core.agentOrchestrator) {
      console.log(chalk.red('❌ Agent Team 未启用'));
      return;
    }

    const missions = this.core.agentOrchestrator.getActiveMissions();

    const teamBox = boxen(
      `${chalk.white.bold('🤖 Agent Team 状态')}\n\n` +
      `活跃任务: ${missions.length}\n` +
      missions.map(m => 
        `${chalk.cyan('●')} ${m.id} - ${m.status}`
      ).join('\n') || chalk.gray('无活跃任务'),
      {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'magenta',
      }
    );
    console.log(teamBox);
  }

  /**
   * 显示项目信息
   */
  private async showProjectInfo(): Promise<void> {
    if (!this.core.projectUnderstanding) {
      console.log(chalk.red('❌ 项目理解引擎未就绪'));
      return;
    }

    const context = this.core.projectUnderstanding.getContext();
    if (!context) {
      console.log(chalk.yellow('⏳ 项目分析中...'));
      return;
    }

    const m = context.metadata;

    const projectBox = boxen(
      `${chalk.white.bold('📊 项目信息')}\n\n` +
      `${chalk.cyan('名称:')} ${context.name}\n` +
      `${chalk.cyan('类型:')} ${context.type}\n` +
      `${chalk.cyan('语言:')} ${context.language}\n` +
      `${chalk.cyan('框架:')} ${context.framework || '未知'}\n\n` +
      `${chalk.gray('文件数:')} ${m.totalFiles}\n` +
      `${chalk.gray('代码行:')} ${m.totalLines.toLocaleString()}\n` +
      `${chalk.gray('模块数:')} ${m.modules.length}\n` +
      `${chalk.gray('API数:')} ${m.apiEndpoints?.length || 0}`,
      {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'blue',
      }
    );
    console.log(projectBox);
  }

  /**
   * 显示退出画面
   */
  private showGoodbye(): void {
    console.log(
      boxen(chalk.white('👋 再见！'), {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
      })
    );
  }
}

// 启动函数
async function main() {
  const chat = new EnhancedChat();
  await chat.start();
}

main().catch(console.error);
