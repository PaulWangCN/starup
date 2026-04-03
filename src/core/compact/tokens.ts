/**
 * Token 估算工具
 * 贯穿所有压缩路径的核心辅助
 */

import { ConversationMessage } from '../../types';

/**
 * 粗略估算单条文本的 token 数
 * 中文按 1.5 token/字，其他字符按 4 字符/token
 */
export function roughTokenCountEstimation(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 1.5 + otherChars / 4);
}

/**
 * 估算单条消息的 token 数
 */
export function estimateMessageTokens(message: ConversationMessage): number {
  let total = roughTokenCountEstimation(message.content);

  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      total += roughTokenCountEstimation(
        tc.function.name + tc.function.arguments
      );
    }
  }

  // tool_call_id 只算少量开销
  if (message.tool_call_id) {
    total += 4;
  }

  return total;
}

/**
 * 估算消息列表的 token 总数
 * 注：移除了 33% 的保守填充，因为系统提示词本身已经很大，
 * 过度估算会导致过早触发压缩
 */
export function estimateMessagesTokens(messages: ConversationMessage[]): number {
  const raw = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  // 仅保留 10% 的小缓冲，用于消息格式开销
  return Math.ceil(raw * 1.1);
}
