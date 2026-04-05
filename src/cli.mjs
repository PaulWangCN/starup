#!/usr/bin/env node
/**
 * StarUp CLI 入口
 * 现代化 Ink UI 界面
 */

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');

// 创建日志文件
const logFile = join(projectRoot, '.starup', 'cli.log');
if (!fs.existsSync(join(projectRoot, '.starup'))) {
  fs.mkdirSync(join(projectRoot, '.starup'), { recursive: true });
}
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.log(line.trim());
}

log('CLI starting...');

// 先构建主项目
console.log('🔧 构建主项目...');
const buildMain = spawn('npm', ['run', 'build'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true
});

buildMain.on('close', (code) => {
  log(`Build main exited with code ${code}`);
  if (code !== 0) {
    console.error('❌ 主项目构建失败');
    process.exit(1);
  }
  
  // 编译 Ink UI
  console.log('🎨 编译 Ink UI...');
  const buildInk = spawn('npx', ['tsc', '-p', 'tsconfig.ink.json', '--outDir', 'dist-ink'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true
  });
  
  buildInk.on('close', (code2) => {
    log(`Build ink exited with code ${code2}`);
    if (code2 !== 0) {
      console.error('❌ Ink UI 编译失败');
      process.exit(1);
    }
    
    // 运行 Ink UI
    console.log('🚀 启动 Ink UI...');
    const inkPath = join(projectRoot, 'dist-ink/ink-ui/main.js');
    log(`Starting Ink UI: ${inkPath}`);
    
    const inkProcess = spawn('node', [inkPath], {
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    
    log(`Ink process spawned with PID: ${inkProcess.pid}`);
    
    // 监听所有可能的退出事件
    inkProcess.on('exit', (code3, signal) => {
      log(`Ink process exited with code ${code3}, signal ${signal}`);
      process.exit(code3 || 0);
    });
    
    inkProcess.on('close', (code3, signal) => {
      log(`Ink process closed with code ${code3}, signal ${signal}`);
    });
    
    inkProcess.on('error', (err) => {
      log(`Ink process error: ${err}`);
    });
    
    inkProcess.on('disconnect', () => {
      log('Ink process disconnected');
    });
    
    // 处理父进程信号
    process.on('SIGINT', () => {
      log('CLI received SIGINT, forwarding to Ink...');
      inkProcess.kill('SIGINT');
    });
    
    process.on('SIGTERM', () => {
      log('CLI received SIGTERM, forwarding to Ink...');
      inkProcess.kill('SIGTERM');
    });
  });
});
