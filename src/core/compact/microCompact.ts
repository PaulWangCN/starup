/**
 * 第1层：微压缩（Microcompact）
 * 核心思想：不调用 LLM，纯规则操作——清理旧的、大块的工具输出结果。
 */

import { ConversationMessage } from '../../types';

const COMPACTABLE_TOOLS = new Set([
  'read',
  'write',
  'edit',
  'exec',
  'fetch',
  'web_fetch',
  'grep',
]);

const KEEP_RECENT_TOOL_RESULTS = 3;
const OLD_TOOL_RESULT_MARKER = '[Old tool result content cleared]';

/**
 * 从 assistant 的 tool_calls 中提取可压缩的 tool_use ID 和对应的工具名
 */
function extractCompactableToolCalls(msg: ConversationMessage): { id: string; name: string }[] {
  if (!msg.tool_calls) return [];
  return msg.tool_calls
    .filter((tc) => COMPACTABLE_TOOLS.has(tc.function.name))
    .map((tc) => ({ id: tc.id, name: tc.function.name }));
}

/**
 * 执行微压缩：
 * 1. 扫描所有 assistant 消息中的 tool_calls，收集可压缩的 tool_call_id
 * 2. 保留最近 N 个 tool 结果
 * 3. 将更早的 tool role 消息内容替换为占位符
 *
 * 注意：不修改 tool_calls 本身，保持 API 配对完整性
 */
export function applyMicroCompact(messages: ConversationMessage[]): {
  modified: boolean;
  clearedCount: number;
} {
  // 收集所有可压缩的 tool_call_id（按出现顺序）
  const compactableToolIds: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      const calls = extractCompactableToolCalls(msg);
      for (const c of calls) {
        compactableToolIds.push(c.id);
      }
    }
  }

  if (compactableToolIds.length <= KEEP_RECENT_TOOL_RESULTS) {
    return { modified: false, clearedCount: 0 };
  }

  // 决定要清理的 tool_call_id 集合
  const idsToClear = new Set(
    compactableToolIds.slice(0, compactableToolIds.length - KEEP_RECENT_TOOL_RESULTS)
  );

  let clearedCount = 0;
  const modifiedMessages = messages.map((msg) => {
    if (msg.role === 'tool' && msg.tool_call_id && idsToClear.has(msg.tool_call_id)) {
      if (msg.content !== OLD_TOOL_RESULT_MARKER) {
        clearedCount++;
        return { ...msg, content: OLD_TOOL_RESULT_MARKER };
      }
    }
    return msg;
  });

  // 将修改写回原始数组（保持引用）
  for (let i = 0; i < messages.length; i++) {
    if (messages[i] !== modifiedMessages[i]) {
      messages[i] = modifiedMessages[i];
    }
  }

  return { modified: clearedCount > 0, clearedCount };
}
