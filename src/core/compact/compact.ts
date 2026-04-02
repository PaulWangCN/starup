/**
 * 第3层：传统压缩（Full Compact）
 * 使用 Fork Agent（spawnSubAgent）生成结构化摘要
 */

import { ConversationMessage, Session, LLMConfig } from '../../types';
import { SessionManager } from '../session/SessionManager';
import { LLMService } from '../llm/LLMService';
import { estimateMessagesTokens, roughTokenCountEstimation } from './tokens';
import { groupMessagesByApiRound } from './grouping';
import { BASE_COMPACT_PROMPT, formatCompactSummary, getCompactUserSummaryMessage } from './prompt';
import { calculateMessagesToKeepIndex } from './autoCompact';

const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 8_000;
const MAX_PTL_RETRIES = 1;

/**
 * 格式化消息历史为文本，供压缩 prompt 使用
 */
function formatMessagesForCompact(messages: ConversationMessage[]): string {
  return messages
    .map((m) => {
      const prefix = m.role.toUpperCase();
      let body = m.content;
      if (m.tool_calls) {
        body += '\n[tool_calls: ' + m.tool_calls.map((tc) => `${tc.function.name}(${tc.id})`).join(', ') + ']';
      }
      if (m.tool_call_id) {
        body += `\n[tool_call_id: ${m.tool_call_id}]`;
      }
      return `--- ${prefix} ---\n${body}`;
    })
    .join('\n\n');
}

function stripImagesFromMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.map((m) => ({
    ...m,
    content: m.content.replace(/!\[.*?\]\(.*?\)/g, '[image]'),
  }));
}

function normalizeMessagesForAPI(messages: ConversationMessage[]): ConversationMessage[] {
  const result = [...messages];
  if (result.length > 0 && result[0].role === 'assistant') {
    result.unshift({
      role: 'user',
      content: '[Conversation start]',
      timestamp: Date.now(),
    });
  }
  return result;
}

/**
 * 裁剪最旧的消息组用于 PTL 重试
 */
function truncateHeadForPTLRetry(messages: ConversationMessage[]): ConversationMessage[] | null {
  const groups = groupMessagesByApiRound(messages);
  if (groups.length < 2) return null;

  const dropCount = Math.max(1, Math.floor(groups.length * 0.2));
  const remaining = groups.slice(dropCount).flat();

  if (remaining.length === 0) return null;
  if (remaining[0].role === 'assistant') {
    return [
      { role: 'user', content: '[Previous conversation truncated]', timestamp: Date.now() },
      ...remaining,
    ];
  }
  return remaining;
}

/**
 * 调整索引以保留 API 不变量：不切断 tool_calls/tool 配对
 */
export function adjustIndexToPreserveAPIInvariants(
  messages: ConversationMessage[],
  startIndex: number
): number {
  let index = Math.max(0, startIndex);

  // 如果 index 指向一个 tool 消息，向前找到它对应的 assistant
  if (messages[index]?.role === 'tool' && messages[index].tool_call_id) {
    for (let i = index - 1; i >= 0; i--) {
      if (
        messages[i].role === 'assistant' &&
        messages[i].tool_calls?.some((tc) => tc.id === messages[index].tool_call_id)
      ) {
        index = i;
        break;
      }
    }
  }

  // 确保 [index, end] 内所有 tool_call_id 都有对应的 tool_calls
  while (index > 0) {
    let needExpand = false;
    for (let i = index; i < messages.length; i++) {
      if (messages[i].role === 'tool' && messages[i].tool_call_id) {
        const id = messages[i].tool_call_id!;
        const hasCallInRange = messages
          .slice(index, i + 1)
          .some((m) => m.role === 'assistant' && m.tool_calls?.some((tc) => tc.id === id));
        if (!hasCallInRange) {
          needExpand = true;
          break;
        }
      }
    }
    if (!needExpand) break;
    index--;
  }

  // 确保 [index, end] 内所有 assistant 的 tool_calls 的 tool 结果也都在范围内
  // 这部分通常由上面的检查覆盖，但再保险一次
  while (index > 0) {
    let needExpand = false;
    for (let i = index; i < messages.length; i++) {
      const msg = messages[i];
      if (msg && msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const hasResultInRange = messages
            .slice(index)
            .some((m) => m.role === 'tool' && m.tool_call_id === tc.id);
          const hasResultBefore = messages
            .slice(0, index)
            .some((m) => m.role === 'tool' && m.tool_call_id === tc.id);
          if (hasResultBefore && !hasResultInRange) {
            needExpand = true;
            break;
          }
        }
      }
      if (needExpand) break;
    }
    if (!needExpand) break;
    index--;
  }

  return Math.max(0, index);
}

/**
 * 执行传统压缩
 */
export async function compactConversation(
  session: Session,
  messages: ConversationMessage[],
  llmService: LLMService,
  sessionManager: SessionManager
): Promise<{
  success: boolean;
  newMessages?: ConversationMessage[];
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
}> {
  let normalized = normalizeMessagesForAPI(stripImagesFromMessages(messages));

  for (let retry = 0; retry <= MAX_PTL_RETRIES; retry++) {
    const historyText = formatMessagesForCompact(normalized);
    const task = `${BASE_COMPACT_PROMPT}\n\nHere is the conversation history:\n${historyText}`;

    const forkSession = sessionManager.spawnSubAgent(session.id, {
      task,
      tools: [],
      memory_access: 'none',
      parent_callback: false,
    });

    try {
      const response = await llmService.chat(forkSession.context.messages);
      const summary = formatCompactSummary(response.content);

      const tokensBefore = estimateMessagesTokens(messages);

      const compactBoundary: ConversationMessage = {
        role: 'system',
        content: `[CompactBoundary] trigger=full_compact tokens_before=${tokensBefore}`,
        timestamp: Date.now(),
      };

      const summaryMsg: ConversationMessage = {
        role: 'user',
        content: getCompactUserSummaryMessage(summary, { suppressFollowUp: true }),
        timestamp: Date.now(),
      };

      // 保留最近的消息，确保上下文不丢失
      const keepIndex = calculateMessagesToKeepIndex(messages, 0);
      const preserved = messages.slice(keepIndex);

      const newMessages = [compactBoundary, summaryMsg, ...preserved];
      const tokensAfter = estimateMessagesTokens(newMessages);

      return {
        success: true,
        newMessages,
        summary,
        tokensBefore,
        tokensAfter,
      };
    } catch (error: any) {
      const errMsg = String(error.message || error);
      const isPTL =
        errMsg.includes('prompt is too long') ||
        errMsg.includes('context length') ||
        errMsg.includes('maximum context length');

      if (isPTL && retry < MAX_PTL_RETRIES) {
        const truncated = truncateHeadForPTLRetry(normalized);
        if (truncated && truncated.length < normalized.length) {
          normalized = truncated;
          continue;
        }
      }

      return { success: false };
    } finally {
      sessionManager.destroySession(forkSession.id);
    }
  }

  return { success: false };
}
