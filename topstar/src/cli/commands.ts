import { Renderer } from './Renderer';
import { StarUpCore } from '../index';

/**
 * 命令处理器类型
 */
type CommandHandler = (args: string[], core: StarUpCore, renderer: Renderer) => Promise<boolean>;

/**
 * 命令定义
 */
interface Command {
  name: string;
  aliases?: string[];
  description: string;
  handler: CommandHandler;
}

/**
 * 命令管理器
 */
export class CommandManager {
  private commands: Map<string, Command> = new Map();
  private renderer: Renderer;
  private core: StarUpCore;

  constructor(core: StarUpCore, renderer: Renderer) {
    this.core = core;
    this.renderer = renderer;
    this.registerCommands();
  }

  /**
   * 注册所有命令
   */
  private registerCommands(): void {
    // /help - 显示帮助
    this.register({
      name: 'help',
      description: '显示帮助信息',
      handler: async () => {
        this.renderer.showHelp();
        return true;
      },
    });

    // /exit, /quit - 退出程序
    this.register({
      name: 'exit',
      aliases: ['quit', 'q'],
      description: '退出程序',
      handler: async () => {
        this.renderer.showGoodbye();
        return false; // 返回 false 表示退出
      },
    });

    // /tools - 列出工具
    this.register({
      name: 'tools',
      description: '列出可用工具',
      handler: async () => {
        const tools = this.core.getToolRegistry().getAll().map((t) => ({
          name: t.name,
          description: t.description,
        }));
        this.renderer.showTools(tools);
        return true;
      },
    });

    // /skills - 列出 Skills
    this.register({
      name: 'skills',
      description: '列出已加载的 Skills',
      handler: async () => {
        const skills = this.core.getSkillRegistry().getSkillDescriptions();
        this.renderer.showSkills(skills);
        return true;
      },
    });

    // /status - 显示状态
    this.register({
      name: 'status',
      description: '显示系统状态',
      handler: async () => {
        this.renderer.showStatus(this.core.getStatus());
        return true;
      },
    });

    // /clear - 清空屏幕
    this.register({
      name: 'clear',
      aliases: ['cls'],
      description: '清空屏幕',
      handler: async () => {
        console.clear();
        this.renderer.showWelcome();
        return true;
      },
    });

    // /history - 显示历史
    this.register({
      name: 'history',
      description: '显示对话历史',
      handler: async () => {
        const mainSession = this.core.getSessionManager().getMainSession();
        if (mainSession) {
          const messages = mainSession.context.messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role, content: m.content }));
          this.renderer.showHistory(messages);
        }
        return true;
      },
    });

    // /spawn - 创建子代理
    this.register({
      name: 'spawn',
      description: '创建子代理执行任务',
      handler: async (args) => {
        const task = args.join(' ');
        if (!task) {
          this.renderer.error('请提供任务描述，例如: /spawn 分析当前目录的代码结构');
          return true;
        }

        const mainSession = this.core.getSessionManager().getMainSession();
        if (!mainSession) {
          this.renderer.error('主会话未初始化');
          return true;
        }

        this.renderer.system(`创建子代理执行任务: ${task}`);
        
        try {
          const subAgent = await this.core.spawnSubAgent(mainSession.id, {
            task,
            tools: ['read', 'web_search'],
            timeout: 300,
            parent_callback: true,
          });
          
          this.renderer.system(`子代理已创建: ${subAgent.id}`);
        } catch (error) {
          this.renderer.error(`创建子代理失败: ${error}`);
        }
        
        return true;
      },
    });
  }

  /**
   * 注册命令
   */
  private register(command: Command): void {
    this.commands.set(command.name, command);
    
    // 注册别名
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias, command);
      }
    }
  }

  /**
   * 执行命令
   * @returns true 继续运行, false 退出程序
   */
  async execute(input: string): Promise<boolean> {
    const trimmed = input.trim();
    
    if (!trimmed.startsWith('/')) {
      return true; // 不是命令，继续
    }

    const parts = trimmed.slice(1).split(' ');
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    const command = this.commands.get(commandName);
    
    if (!command) {
      this.renderer.error(`未知命令: /${commandName}`);
      this.renderer.info('输入 /help 查看可用命令');
      return true;
    }

    return await command.handler(args, this.core, this.renderer);
  }

  /**
   * 获取命令列表（用于自动补全）
   */
  getCommandList(): string[] {
    const commands = new Set<string>();
    for (const [name, cmd] of this.commands) {
      commands.add(cmd.name);
    }
    return Array.from(commands).sort();
  }

  /**
   * 检查输入是否是命令
   */
  isCommand(input: string): boolean {
    return input.trim().startsWith('/');
  }
}
