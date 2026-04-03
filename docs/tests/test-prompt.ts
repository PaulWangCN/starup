/**
 * 提示词分析测试脚本
 * 输出实际发送给大模型的完整系统提示词
 * 不调用大模型，仅输出提示词内容进行分析
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { PromptAssembler, createDefaultConfig, RuntimeContext } from '../../src/core/prompt/PromptAssembler';
import { toolRegistry } from '../../src/core/tools/ToolRegistry';
import { skillRegistry } from '../../src/core/skills/SkillRegistry';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function printHeader(title: string, color: string = colors.cyan) {
  console.log('\n' + color + '═'.repeat(80) + colors.reset);
  console.log(color + '  ' + title + colors.reset);
  console.log(color + '═'.repeat(80) + colors.reset);
}

function printSubHeader(title: string) {
  console.log('\n' + colors.yellow + '▶ ' + title + colors.reset);
  console.log(colors.dim + '─'.repeat(60) + colors.reset);
}

function printContent(content: string, maxLines: number = 50) {
  const lines = content.split('\n');
  const displayLines = lines.slice(0, maxLines);
  
  displayLines.forEach((line) => {
    if (line.includes('<!--')) {
      console.log(colors.dim + line + colors.reset);
    } else if (line.startsWith('#')) {
      console.log(colors.green + line + colors.reset);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      console.log('  ' + colors.cyan + '•' + colors.reset + line.substring(1));
    } else {
      console.log(line);
    }
  });
  
  if (lines.length > maxLines) {
    console.log(colors.dim + `\n... (${lines.length - maxLines} 行省略) ...` + colors.reset);
  }
}

async function analyzePrompt() {
  console.log(colors.bright + colors.green);
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    StarUp 系统提示词分析工具                                  ║');
  console.log('║          分析发送给大模型的完整系统提示词结构                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log(colors.reset);

  // 1. 检查必要的文件是否存在
  printHeader('第一层：文件存在性检查', colors.magenta);
  
  const requiredFiles = [
    { name: 'AGENTS.md (L0 - 工作区指南)', path: '.starup/AGENTS.md', required: true },
    { name: 'SOUL.md (L1 - 灵魂/人格)', path: '.starup/SOUL.md', required: true },
    { name: 'IDENTITY.md (L2 - 身份标识)', path: '.starup/IDENTITY.md', required: true },
    { name: 'USER.md (L3 - 用户画像)', path: '.starup/USER.md', required: true },
    { name: 'skills_index.md (L5 - 技能索引)', path: '.starup/skills_index.md', required: false },
  ];

  for (const file of requiredFiles) {
    try {
      await fs.access(file.path);
      const stat = await fs.stat(file.path);
      console.log(`${colors.green}✓${colors.reset} ${file.name}`);
      console.log(`   路径: ${path.resolve(file.path)}`);
      console.log(`   大小: ${stat.size} 字节`);
    } catch {
      if (file.required) {
        console.log(`${colors.red}✗${colors.reset} ${file.name} ${colors.red}[必需但缺失]${colors.reset}`);
      } else {
        console.log(`${colors.yellow}⚠${colors.reset} ${file.name} ${colors.yellow}[可选，缺失]${colors.reset}`);
      }
    }
  }

  // 2. 显示各层级内容预览
  printHeader('第二层：各层级内容预览', colors.magenta);

  // L0: AGENTS.md
  printSubHeader('L0: AGENTS.md (工作区指南)');
  try {
    const agentsContent = await fs.readFile('.starup/AGENTS.md', 'utf-8');
    if (agentsContent.trim()) {
      printContent(agentsContent, 30);
    } else {
      console.log(colors.yellow + '[文件存在但内容为空]' + colors.reset);
    }
  } catch {
    console.log(colors.red + '[文件不存在]' + colors.reset);
  }

  // L1: SOUL.md
  printSubHeader('L1: SOUL.md (灵魂/人格)');
  try {
    const soulContent = await fs.readFile('.starup/SOUL.md', 'utf-8');
    if (soulContent.trim()) {
      printContent(soulContent, 30);
    } else {
      console.log(colors.yellow + '[文件存在但内容为空]' + colors.reset);
    }
  } catch {
    console.log(colors.red + '[文件不存在]' + colors.reset);
  }

  // L2: IDENTITY.md
  printSubHeader('L2: IDENTITY.md (身份标识)');
  try {
    const identityContent = await fs.readFile('.starup/IDENTITY.md', 'utf-8');
    if (identityContent.trim()) {
      printContent(identityContent, 30);
    } else {
      console.log(colors.yellow + '[文件存在但内容为空]' + colors.reset);
    }
  } catch {
    console.log(colors.red + '[文件不存在]' + colors.reset);
  }

  // L3: USER.md
  printSubHeader('L3: USER.md (用户画像)');
  try {
    const userContent = await fs.readFile('.starup/USER.md', 'utf-8');
    if (userContent.trim()) {
      printContent(userContent, 30);
    } else {
      console.log(colors.yellow + '[文件存在但内容为空]' + colors.reset);
    }
  } catch {
    console.log(colors.red + '[文件不存在]' + colors.reset);
  }

  // 3. 工具列表
  printHeader('第三层：可用工具列表 (L4)', colors.magenta);
  const tools = toolRegistry.getAll();
  console.log(`共注册 ${tools.length} 个工具:\n`);
  tools.forEach((tool, idx) => {
    console.log(`${idx + 1}. ${colors.cyan}${tool.name}${colors.reset}`);
    console.log(`   描述: ${tool.description.substring(0, 80)}${tool.description.length > 80 ? '...' : ''}`);
    console.log(`   参数: ${tool.parameters?.map(p => p.name).join(', ') || '无'}`);
    console.log();
  });

  // 4. 技能列表
  printHeader('第四层：技能列表 (L5)', colors.magenta);
  await skillRegistry.initialize();
  const skills = skillRegistry.getAll();
  console.log(`共加载 ${skills.length} 个技能:\n`);
  skills.forEach((skill, idx) => {
    console.log(`${idx + 1}. ${colors.cyan}${skill.metadata.name}${colors.reset}`);
    console.log(`   描述: ${skill.metadata.description || '无描述'}`);
    console.log(`   路径: ${skill.path}`);
    console.log();
  });

  // 5. 组装完整提示词
  printHeader('第五层：完整提示词组装', colors.magenta);

  // 创建 PromptAssembler 实例
  const config = createDefaultConfig();
  const assembler = new PromptAssembler(config, toolRegistry, skillRegistry);

  // 创建运行时上下文
  const runtimeContext: RuntimeContext = {
    timestamp: Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    activeSessions: 1,
    systemStatus: 'healthy',
    memoryUsage: {
      used: process.memoryUsage().heapUsed,
      total: process.memoryUsage().heapTotal,
    },
    requestId: `test-${Date.now()}`,
  };

  try {
    const assembledPrompt = await assembler.assemble('default', runtimeContext);

    console.log(`${colors.green}✓ 提示词组装成功${colors.reset}`);
    console.log(`\n版本: ${assembledPrompt.version}`);
    console.log(`Token 估算: ${assembledPrompt.tokenCount}`);
    console.log(`\n各层状态:`);
    Object.entries(assembledPrompt.layers).forEach(([layer, active]) => {
      const status = active ? colors.green + '✓ 已加载' + colors.reset : colors.red + '✗ 缺失' + colors.reset;
      console.log(`  ${layer}: ${status}`);
    });

    // 输出完整提示词到文件
    const outputPath = 'test-prompt-output.md';
    await fs.writeFile(outputPath, assembledPrompt.content, 'utf-8');
    console.log(`\n${colors.green}✓ 完整提示词已保存到: ${path.resolve(outputPath)}${colors.reset}`);

    // 显示提示词预览
    printSubHeader('完整提示词预览 (前100行)');
    printContent(assembledPrompt.content, 100);

    // 分析提示词结构
    printHeader('第六层：提示词结构分析', colors.magenta);
    
    const layerPattern = /<!-- LAYER: (\w+) -->/g;
    const layers: string[] = [];
    let match;
    while ((match = layerPattern.exec(assembledPrompt.content)) !== null) {
      layers.push(match[1]);
    }
    
    console.log('检测到的层级:');
    layers.forEach((layer, idx) => {
      console.log(`  ${idx + 1}. ${colors.cyan}${layer}${colors.reset}`);
    });

    // 统计信息
    printHeader('第七层：统计信息', colors.magenta);
    const stats = {
      '总字符数': assembledPrompt.content.length,
      '估算 Token 数': assembledPrompt.tokenCount,
      '总行数': assembledPrompt.content.split('\n').length,
      '已加载层数': Object.values(assembledPrompt.layers).filter(Boolean).length,
      '总层数': Object.keys(assembledPrompt.layers).length,
    };
    
    Object.entries(stats).forEach(([key, value]) => {
      console.log(`  ${key}: ${colors.cyan}${value}${colors.reset}`);
    });

  } catch (error) {
    console.log(`${colors.red}✗ 提示词组装失败${colors.reset}`);
    console.log(`错误: ${error}`);
    
    printHeader('错误分析', colors.red);
    console.log('可能的原因:');
    console.log('  1. AGENTS.md 文件不存在或为空（必需）');
    console.log('  2. SOUL.md 文件不存在或为空（必需）');
    console.log('  3. IDENTITY.md 文件不存在或为空（必需）');
    console.log('  4. USER.md 文件不存在（可选但推荐）');
    console.log('\n建议:');
    console.log('  请先创建 .starup/ 目录下的配置文件');
  }

  console.log('\n' + colors.green + '═'.repeat(80) + colors.reset);
  console.log(colors.green + '  分析完成' + colors.reset);
  console.log(colors.green + '═'.repeat(80) + colors.reset + '\n');
}

analyzePrompt().catch(console.error);
