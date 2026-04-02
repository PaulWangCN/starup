/**
 * 消息分组算法
 * 按 API 轮次分组，同一轮 assistant + 后续 tool 结果为一组
 */

import { ConversationMessage } from '../../types';

export interface MessageGroup {
  messages: ConversationMessage[];
  estimatedTokens: number;
}

/**
 * 按 API 轮次分组消息
 * 设计细节：
 * - 新的 assistant 消息（与上一组不同标识）开始新的一组
 * - 同一 assistant 后的 tool 结果跟随该组
 * - 简单实现：以 assistant 为组头，收集直到下一个 assistant
 */
export function groupMessagesByApiRound(messages: ConversationMessage[]): ConversationMessage[][] {
  const groups: ConversationMessage[][] = [];
  let current: ConversationMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'assistant' && current.length > 0) {
      // 遇到新的 assistant，先把当前组结束
      groups.push(current);
      current = [msg];
    } else {
      current.push(msg);
    }
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}
