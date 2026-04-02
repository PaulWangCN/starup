/**
 * 压缩提示词模板
 */

export const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.
`;

export const BASE_COMPACT_PROMPT = `${NO_TOOLS_PREAMBLE}

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

/**
 * 格式化压缩后的摘要输出
 */
export function formatCompactSummary(summary: string): string {
  // 删除 <analysis> 块
  summary = summary.replace(/<analysis>[\s\S]*?<\/analysis>/, '');

  // 提取 <summary> 内容
  const match = summary.match(/<summary>([\s\S]*?)<\/summary>/);
  if (match) {
    summary = summary.replace(/<summary>[\s\S]*?<\/summary>/, `Summary:\n${match[1].trim()}`);
  }

  // 清理多余空行
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
