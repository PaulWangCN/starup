#!/usr/bin/env node
/**
 * StarUp CLI 入口
 * v1.2: 支持 Skill 管理命令
 */

import * as dotenv from 'dotenv';
import { commands } from './cli/commands';
import { TerminalChat } from './cli/TerminalChat';
import { skillRegistry } from './core/skills/SkillRegistry';

// 加载环境变量
dotenv.config();

/**
 * 主函数
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  // 初始化 SkillRegistry（大多数命令需要）
  if (command && command !== 'chat' && command !== 'help') {
    await skillRegistry.initialize();
  }

  switch (command) {
    case 'install':
      await commands.install(commandArgs);
      break;

    case 'uninstall':
    case 'remove':
      await commands.uninstall(commandArgs);
      break;

    case 'list':
    case 'ls':
      await commands.list(commandArgs);
      break;

    case 'info':
    case 'show':
      await commands.info(commandArgs);
      break;

    case 'upgrade':
    case 'update':
      await commands.upgrade(commandArgs);
      break;

    case 'enable':
      await commands.enable(commandArgs);
      break;

    case 'disable':
      await commands.disable(commandArgs);
      break;

    case 'deps':
    case 'dependencies':
      await commands.deps(commandArgs);
      break;

    case 'pack':
      await commands.pack(commandArgs);
      break;

    case 'verify':
      await commands.verify(commandArgs);
      break;

    case 'chat':
      // 启动终端聊天界面
      const chat = new TerminalChat();
      await chat.start();
      break;

    case 'help':
    case '--help':
    case '-h':
    default:
      commands.help();
      break;
  }
}

// 运行主函数
main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
