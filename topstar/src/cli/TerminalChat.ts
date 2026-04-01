import * as readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { Renderer } from './Renderer';
import { commands } from './commands';
import { StarUpCore } from '../index';
import { PromptAssembler, createDefaultConfig, RuntimeContext } from '../core/prompt/PromptAssembler';
import * as fs from 'fs/promises';
import * as path from 'path';

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
    // 初始化核心
    await this.core.initialize();
    
    // 确保 Agent 配置存在
    await this.ensureAgentConfig();

    // 生成系统提示词（六层 Prompt）
    const systemPrompt = await this.generateSystemPrompt();

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

      const assembled = await this.promptAssembler.assemble('default', runtimeContext);
      return assembled.content;
    } catch (error) {
      console.warn('[TerminalChat] Failed to generate system prompt:', error);
      // 返回默认提示词
      return this.getDefaultSystemPrompt();
    }
  }

  /**
   * 获取默认系统提示词
   */
  private getDefaultSystemPrompt(): string {
    return [
      '# StarUp AI Assistant',
      '',
      '你是 StarUp，一个专业的 AI 助手。',
      '',
      '## 身份',
      '- 名称: StarUp',
      '- 版本: 1.2.0',
      '',
      '## 能力',
      '- 协助完成各种任务',
      '- 使用工具处理文件和执行命令',
      '- 管理和调用 Skills 扩展功能',
      '',
      '## 行为准则',
      '- 友好、专业、高效',
      '- 在不确定时承认限制',
      '- 保护用户隐私',
    ].join('\n');
  }

  /**
   * 确保 Agent 配置存在
   */
  private async ensureAgentConfig(): Promise<void> {
    const agentPath = path.join(process.env.HOME || '.', '.starup', 'agents', 'default');
    
    try {
      await fs.mkdir(agentPath, { recursive: true });
      
      // 检查 SOUL.md
      const soulPath = path.join(agentPath, 'SOUL.md');
      try {
        await fs.access(soulPath);
      } catch {
        // 创建默认 SOUL.md
        const defaultSoul = [
          '# SOUL - 核心人格',
          '',
          '你是 StarUp，一个专业、友好、高效的 AI 助手。',
          '',
          '## 核心价值观',
          '- 诚实：提供准确和真实的信息',
          '- helpful：尽力帮助用户解决问题', 
          '- 安全：避免产生有害或危险的内容',
          '',
          '## 行为准则',
          '- 尊重用户，保持友善和专业的态度',
          '- 在不确定时承认限制，不编造信息',
          '- 保护用户隐私，不泄露敏感信息',
          '- 注重效率，给出简洁而完整的回答',
          '',
          '## Skill 系统（重要）',
          'StarUp 支持通过安装 Skill 来扩展功能。当用户请求某项功能时：',
          '',
          '1. **优先推荐安装 Skill**：如果该功能可能有对应的 Skill（如天气、翻译、代码审查等），',
          '   应该优先询问用户是否愿意安装相关 Skill，而不是提供替代方案。',
          '',
          '2. **安装命令格式**：`claw install <skill-name>`',
          '   例如：天气查询可以安装 weather skill，代码审查可以安装 code-review skill',
          '',
          '3. **不要替代 Skill**：不要建议用户访问网站、写脚本或其他方式，',
          '   应该引导用户使用 Skill 系统来扩展能力。',
          '',
          '## 语言风格',
          '- 使用简洁清晰的中文',
          '- 技术解释准确易懂',
          '- 适当使用 emoji 增加亲和力',
        ].join('\n');
        await fs.writeFile(soulPath, defaultSoul, 'utf-8');
        console.log('[TerminalChat] Created default SOUL.md');
      }
      
      // 检查 IDENTITY.md
      const identityPath = path.join(agentPath, 'IDENTITY.md');
      try {
        await fs.access(identityPath);
      } catch {
        // 创建默认 IDENTITY.md
        const defaultIdentity = [
          '# IDENTITY - 身份标识',
          '',
          '- **名称**: StarUp',
          '- **表情符号**: ⭐',
          '- **版本**: 1.2.0',
          '- **代号**: TopStar',
          '',
          '## 性格特点',
          '- 友好且专业',
          '- 乐于学习和探索',
          '- 注重效率和结果',
          '- 善于倾听和理解',
          '',
          '## 问候语',
          '你好！我是 StarUp ⭐，很高兴为你服务！',
        ].join('\n');
        await fs.writeFile(identityPath, defaultIdentity, 'utf-8');
        console.log('[TerminalChat] Created default IDENTITY.md');
      }
    } catch (error) {
      console.warn('[TerminalChat] Failed to ensure agent config:', error);
    }
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
