/**
 * 压缩提示词模板
 * 提供两种模式：完整模式(A)和快速模式(B)
 */

export const NO_TOOLS_PREAMBLE = `【关键指令】仅返回文本，禁止调用任何工具。

- 禁止使用 Read、Bash、Grep、Glob、Edit、Write 等任何工具
- 你已拥有对话中的全部上下文
- 工具调用将被拒绝且浪费回合
- 必须纯文本输出：<analysis> 分析块 + <summary> 摘要块
`;

// ========== 模式 A：完整压缩（适合复杂技术项目） ==========
export const DETAILED_COMPACT_PROMPT = `${NO_TOOLS_PREAMBLE}

任务：将对话历史整理为结构化摘要，用于替换早期消息上下文，必须完整且自包含。

首先，撰写 <analysis> 分析块：
- 按时间顺序梳理消息
- 识别用户意图、技术决策、代码模式、错误与修复
- 重点关注用户反馈（用户要求你改的地方）
- 复核技术准确性和完整性

然后，撰写 <summary> 摘要块，包含以下章节：

1. 主要请求与意图：
   [用户所有请求和意图的详细描述]

2. 关键技术概念：
   - [概念1]
   - [概念2]

3. 文件与代码片段：
   - [文件名]
     - [重要性说明]
     - [相关代码片段]

4. 错误与修复：
   - [错误描述]：
     - [修复方式]
     - [用户反馈]

5. 问题解决过程：
   [问题排查和解决过程]

6. 所有用户消息：
   - [列出所有非工具类的用户消息原文或概括]

7. 待办任务：
   - [待办1]
   - [待办2]

8. 当前工作：
   [当前工作的精确描述，含文件名和代码片段]

9. 下一步（可选）：
   [计划下一步，可引用最近消息原文]

注意：<analysis> 是草稿会被丢弃，<summary> 才是关键内容。
`;

// ========== 模式 B：快速压缩（适合简单场景） ==========
export const QUICK_COMPACT_PROMPT = `${NO_TOOLS_PREAMBLE}

将对话概括为4个部分，简洁但完整。

格式：
<summary>
1. 请求：[用户主要请求，1-2句话]

2. 文件：[关键文件列表及简要上下文]

3. 状态：[当前进度、已做决策、遇到的错误及修复]

4. 下一步：[如有明确计划，说明下一步]
</summary>

规则：
- 控制在400字以内
- 聚焦事实，而非过程
- 仅关键时才包含文件路径和代码片段
- 除非重要，否则省略工具调用细节
`;

/**
 * 会话复杂度分析结果
 */
export interface ComplexityAnalysis {
  messageCount: number;
  fileCount: number;
  hasErrors: boolean;
  hasCodeBlocks: boolean;
  complexity: 'low' | 'medium' | 'high';
}

/**
 * 分析会话复杂度，决定使用哪种压缩策略
 */
export function analyzeComplexity(messages: Array<{ role: string; content: string }>): ComplexityAnalysis {
  const messageCount = messages.length;
  
  // 提取文件路径（简单启发式：匹配常见的代码文件路径模式）
  const filePathRegex = /(?:[\w-]+\/)+[\w-]+\.(ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|json|md|yml|yaml)/gi;
  const uniqueFiles = new Set<string>();
  let hasCodeBlocks = false;
  let hasErrors = false;
  
  for (const msg of messages) {
    const content = msg.content || '';
    
    // 提取文件路径
    const matches = content.match(filePathRegex);
    if (matches) {
      matches.forEach(m => uniqueFiles.add(m.toLowerCase()));
    }
    
    // 检测代码块
    if (content.includes('```')) {
      hasCodeBlocks = true;
    }
    
    // 检测错误/修复相关关键词
    const errorKeywords = ['error', 'fix', 'bug', 'failed', 'exception', 'crash', 'broken'];
    if (errorKeywords.some(kw => content.toLowerCase().includes(kw))) {
      hasErrors = true;
    }
  }
  
  // 复杂度判定逻辑
  let complexity: 'low' | 'medium' | 'high' = 'low';
  
  if (messageCount > 30 || uniqueFiles.size > 5 || (hasErrors && hasCodeBlocks)) {
    complexity = 'high';
  } else if (messageCount > 15 || uniqueFiles.size > 2) {
    complexity = 'medium';
  }
  
  return {
    messageCount,
    fileCount: uniqueFiles.size,
    hasErrors,
    hasCodeBlocks,
    complexity,
  };
}

/**
 * 根据会话特征选择合适的压缩提示词
 * 
 * 策略规则：
 * - 高复杂度（多文件、多轮对话、有错误）：使用详细模式，确保上下文不丢失
 * - 低复杂度（简单对话、少文件）：使用快速模式，减少 LLM 处理时间
 */
export function selectCompactPrompt(
  messages: Array<{ role: string; content: string }>,
  forceMode?: 'detailed' | 'quick'
): { prompt: string; mode: 'detailed' | 'quick'; analysis: ComplexityAnalysis } {
  // 强制模式
  if (forceMode) {
    return {
      prompt: forceMode === 'detailed' ? DETAILED_COMPACT_PROMPT : QUICK_COMPACT_PROMPT,
      mode: forceMode,
      analysis: analyzeComplexity(messages),
    };
  }
  
  const analysis = analyzeComplexity(messages);
  
  // 自动选择逻辑
  // 详细模式的触发条件（满足任一即触发）：
  // 1. 高复杂度判定
  // 2. 有错误记录且包含代码（调试场景必须保留详细信息）
  // 3. 涉及 4+ 个文件的多文件编辑
  const useDetailed = 
    analysis.complexity === 'high' ||
    (analysis.hasErrors && analysis.hasCodeBlocks) ||
    analysis.fileCount >= 4;
  
  return {
    prompt: useDetailed ? DETAILED_COMPACT_PROMPT : QUICK_COMPACT_PROMPT,
    mode: useDetailed ? 'detailed' : 'quick',
    analysis,
  };
}

// 为了保持向后兼容，BASE_COMPACT_PROMPT 默认指向详细模式
export const BASE_COMPACT_PROMPT = DETAILED_COMPACT_PROMPT;

/**
 * 格式化压缩后的摘要输出
 */
export function formatCompactSummary(summary: string): string {
  // 提取 <summary> 内容
  const match = summary.match(/<summary>([\s\S]*?)<\/summary>/);
  if (match) {
    summary = match[1].trim();
  }

  // 清理多余空行和标签
  summary = summary.replace(/\n\n+/g, '\n\n');
  return summary.trim();
}

/**
 * 生成压缩后注入到上下文中的 user 摘要消息
 */
export function getCompactUserSummaryMessage(
  summary: string,
  options: {
    suppressFollowUp?: boolean;
    recentMessagesPreserved?: boolean;
  } = {}
): string {
  let msg = `本会话从之前的对话延续而来（上下文已满）。\n以下摘要涵盖早期对话内容。\n\n${formatCompactSummary(summary)}`;

  if (options.recentMessagesPreserved) {
    msg += `\n\n最近消息已完整保留。`;
  }

  if (options.suppressFollowUp) {
    msg += `\n\n直接继续对话，不要向用户提问。直接恢复任务，不要确认摘要、不要回顾发生了什么、不要用"我继续"等开场白。从中断处无缝继续。`;
  }

  return msg;
}
