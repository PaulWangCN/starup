/**
 * 压缩提示词模板
 * 提供两种模式：完整模式(A)和快速模式(B)
 */

export const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.
`;

// ========== 模式 A：完整压缩（适合复杂技术项目） ==========
export const DETAILED_COMPACT_PROMPT = `${NO_TOOLS_PREAMBLE}

Your task is to summarize the conversation so far into a structured summary.
This summary will replace the earlier messages in the conversation context, so it must be COMPLETE and SELF-CONTAINED.

First, write an <analysis> block:
- Walk through the messages in chronological order.
- Identify user intents, technical decisions, code patterns, errors and fixes.
- Pay special attention to user feedback (where the user told you to do something differently).
- Double-check technical accuracy and completeness.

Then, write a <summary> block with the following sections:

1. Primary Request and Intent:
   [Detailed description of all user requests and intentions]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]

3. Files and Code Sections:
   - [file name]
     - [why it matters]
     - [code snippet if relevant]

4. Errors and fixes:
   - [error description]:
     - [how it was fixed]
     - [user feedback]

5. Problem Solving:
   [Problem solving process]

6. All user messages:
   - [List all non-tool user messages verbatim or paraphrased]

7. Pending Tasks:
   - [Pending task 1]
   - [Pending task 2]

8. Current Work:
   [Precise description of current work, including file names and code snippets]

9. Optional Next Step:
   [Next planned step, including direct quotes from recent messages]

Remember: the <analysis> block is scratch paper and will be discarded. The <summary> block is what matters.
`;

// ========== 模式 B：快速压缩（适合简单场景） ==========
export const QUICK_COMPACT_PROMPT = `${NO_TOOLS_PREAMBLE}

Summarize the conversation into 4 sections. Be concise but complete.

Format:
<summary>
1. Request: [User's main request in 1-2 sentences]

2. Files: [List key files with brief context]

3. Status: [Current progress, decisions made, errors encountered and fixed]

4. Next: [What to do next, if clear]
</summary>

Rules:
- Keep it under 400 words
- Focus on facts, not process
- Include file paths and code snippets only if critical
- Omit tool call details unless they matter
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
  let msg = `This session is being continued from a previous conversation that ran out of context.\nThe summary below covers the earlier portion of the conversation.\n\n${formatCompactSummary(summary)}`;

  if (options.recentMessagesPreserved) {
    msg += `\n\nRecent messages are preserved verbatim.`;
  }

  if (options.suppressFollowUp) {
    msg += `\n\nContinue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`;
  }

  return msg;
}
