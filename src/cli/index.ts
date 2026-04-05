#!/usr/bin/env node
import 'dotenv/config';
import { StarUpCore } from '../index';
import { TerminalChat } from './TerminalChat';

/**
 * CLI 入口
 */
async function main() {
  try {
    const core = new StarUpCore();
    const chat = new TerminalChat(core);
    await chat.start();
  } catch (error) {
    console.error('Failed to start CLI:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  main();
}

export { TerminalChat };
