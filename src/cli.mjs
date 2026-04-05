#!/usr/bin/env node
/**
 * StarUp CLI 入口
 * 现代化 Ink UI 界面
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');

// 先构建主项目
console.log('🔧 构建主项目...');
const buildMain = spawn('npm', ['run', 'build'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true
});

buildMain.on('close', (code) => {
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
    if (code2 !== 0) {
      console.error('❌ Ink UI 编译失败');
      process.exit(1);
    }
    
    // 运行 Ink UI
    console.log('🚀 启动 Ink UI...');
    const inkPath = join(projectRoot, 'dist-ink/ink-ui/main.js');
    const inkProcess = spawn('node', [inkPath], {
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    
    inkProcess.on('exit', (code3) => {
      process.exit(code3 || 0);
    });
  });
});
