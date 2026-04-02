#!/usr/bin/env node
/**
 * StarUp CLI 入口
 * 简化版：只保留聊天功能
 */

import * as dotenv from 'dotenv';
import { TerminalChat } from './cli/TerminalChat';

// 加载环境变量
dotenv.config();

/**
 * 主函数
 */
async function main(): Promise<void> {
  const terminalChat = new TerminalChat();
  await terminalChat.start();
}

// 运行主函数
main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
