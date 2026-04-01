#!/usr/bin/env node
import 'dotenv/config';
import { StarUpCore } from './index';
import { TerminalChat } from './cli/TerminalChat';

/**
 * CLI 入口
 * 运行: npm run chat
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

main();
