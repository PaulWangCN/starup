#!/usr/bin/env node
/**
 * StarUp Gateway 服务入口
 * 统一控制平面与通信枢纽
 */

import * as dotenv from 'dotenv';
import { Gateway } from './gateway';

// 加载环境变量
dotenv.config();

async function main(): Promise<void> {
  const gateway = new Gateway();

  // 优雅退出
  const shutdown = async () => {
    console.log('\n[GatewayServer] Received shutdown signal, stopping gracefully...');
    await gateway.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 加载默认适配器
  await gateway.loadDefaultAdapters();

  // 启动
  await gateway.start();
}

main().catch((error) => {
  console.error('[GatewayServer] Fatal error:', error);
  process.exit(1);
});
