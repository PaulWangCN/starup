/**
 * 第2层：自动压缩（Auto-Compact）
 * 阈值判断 + 断路器 + Session Memory 优先路径
 */

import { ConversationMessage, Session } from '../../types';
import { SessionManager } from '../session/SessionManager';
import { LLMService } from '../llm/LLMService';
import { SessionSnapshotManager } from '../session/SessionSnapshot';
import { estimateMessageTokens, estimateMessagesTokens } from './tokens';
import { compactConversation, adjustIndexToPreserveAPIInvariants } from './compact';

const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 8_000;
const AUTOCOMPACT_BUFFER_TOKENS = 13_000;
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

// 模型上下文窗口映射（简化版）
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4': 8_192,
};

function getContextWindowForModel(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] || 64_000;
}

function getMaxOutputTokensForModel(_model: string): number {
  return 8_192;
}

function getEffectiveContextWindowSize(model: string): number {
  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  );
  let contextWindow = getContextWindowForModel(model);
  if (process.env.STAR_UP_AUTO_COMPACT_WINDOW) {
    const parsed = parseInt(process.env.STAR_UP_AUTO_COMPACT_WINDOW, 10);
    if (!isNaN(parsed)) {
      contextWindow = Math.min(contextWindow, parsed);
    }
  }
  return contextWindow - reservedTokensForSummary;
}

export function getAutoCompactThreshold(model: string): number {
  return getEffectiveContextWindowSize(model) - AUTOCOMPACT_BUFFER_TOKENS;
}

// 断路器状态
const compactTracking = new Map<
  string,
  { consecutiveFailures: number; lastAttemptAt: number }
>();

function getTracking(sessionId: string) {
  if (!compactTracking.has(sessionId)) {
    compactTracking.set(sessionId, { consecutiveFailures: 0, lastAttemptAt: 0 });
  }
  return compactTracking.get(sessionId)!;
}

function isAutoCompactEnabled(): boolean {
  if (process.env.DISABLE_COMPACT === '1' || process.env.DISABLE_COMPACT === 'true') return false;
  if (process.env.DISABLE_AUTO_COMPACT === '1' || process.env.DISABLE_AUTO_COMPACT === 'true')
    return false;
  return true;
}

function shouldAutoCompact(
  session: Session,
  messages: ConversationMessage[],
  model: string,
  querySource?: string
): boolean {
  // 递归保护：压缩代理自己不能触发压缩
  if (querySource === 'compact') return false;

  // 子代理不触发自动压缩
  if (session.type === 'sub') return false;

  if (!isAutoCompactEnabled()) return false;

  const threshold = getAutoCompactThreshold(model);
  const tokens = estimateMessagesTokens(messages);
  return tokens >= threshold;
}

// Session Memory 压缩配置（简化版）
const SM_COMPACT_CONFIG = {
  minTokens: 10_000,
  minTextBlockMessages: 5,
  maxTokens: 40_000,
};

/**
 * 计算要保留的最近消息的起始索引
 */
export function calculateMessagesToKeepIndex(
  messages: ConversationMessage[],
  lastSummarizedIndex: number
): number {
  let startIndex = lastSummarizedIndex + 1;

  // 计算当前 [startIndex, end] 范围的 token 和文本消息数
  let tokens = 0;
  let textMessages = 0;
  for (let i = startIndex; i < messages.length; i++) {
    const m = messages[i];
    tokens += estimateMessageTokens(m);
    if (m.role === 'user' || m.role === 'assistant') {
      textMessages++;
    }
  }

  if (tokens > SM_COMPACT_CONFIG.maxTokens) {
    return startIndex;
  }

  if (tokens >= SM_COMPACT_CONFIG.minTokens && textMessages >= SM_COMPACT_CONFIG.minTextBlockMessages) {
    return startIndex;
  }

  // 往前扩展
  for (let i = startIndex - 1; i >= 0; i--) {
    const m = messages[i];
    tokens += estimateMessageTokens(m);
    if (m.role === 'user' || m.role === 'assistant') {
      textMessages++;
    }

    if (tokens > SM_COMPACT_CONFIG.maxTokens) {
      return i + 1;
    }
    if (tokens >= SM_COMPACT_CONFIG.minTokens && textMessages >= SM_COMPACT_CONFIG.minTextBlockMessages) {
      return i;
    }
  }

  return 0;
}

/**
 * 尝试 Session Memory 压缩（简化版：利用 Snapshot 摘要）
 */
async function trySessionMemoryCompaction(
  session: Session,
  messages: ConversationMessage[],
  snapshotManager: SessionSnapshotManager,
  model: string
): Promise<{
  success: boolean;
  newMessages?: ConversationMessage[];
  tokensBefore?: number;
  tokensAfter?: number;
}> {
  const snapshots = await snapshotManager.listSnapshots(session.id);
  const recentSnapshot = snapshots
    .filter((s) => Date.now() - s.timestamp < 30 * 60 * 1000)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (!recentSnapshot || !recentSnapshot.summary || recentSnapshot.summary === 'Empty conversation') {
    return { success: false };
  }

  // 使用快照创建时的真实消息边界
  const lastSummarizedIndex = Math.max(0, recentSnapshot.messageCount - 1);
  let startIndex = calculateMessagesToKeepIndex(messages, lastSummarizedIndex);
  startIndex = adjustIndexToPreserveAPIInvariants(messages, startIndex);

  const preserved = messages.slice(startIndex);
  const summaryMsg: ConversationMessage = {
    role: 'user',
    content: `This session is being continued from a previous conversation.\n\nSummary:\n${recentSnapshot.summary}`,
    timestamp: Date.now(),
  };

  const compactBoundary: ConversationMessage = {
    role: 'system',
    content: `[CompactBoundary] trigger=session_memory tokens_before=${estimateMessagesTokens(messages)}`,
    timestamp: Date.now(),
  };

  const newMessages = [compactBoundary, summaryMsg, ...preserved];
  const tokensAfter = estimateMessagesTokens(newMessages);
  const threshold = getAutoCompactThreshold(model);

  if (tokensAfter >= threshold) {
    return { success: false };
  }

  return {
    success: true,
    newMessages,
    tokensBefore: estimateMessagesTokens(messages),
    tokensAfter,
  };
}

/**
 * 自动压缩入口
 */
export async function autoCompactIfNeeded(
  session: Session,
  messages: ConversationMessage[],
  llmService: LLMService,
  sessionManager: SessionManager,
  snapshotManager: SessionSnapshotManager,
  model: string,
  querySource?: string
): Promise<{
  wasCompacted: boolean;
  newMessages?: ConversationMessage[];
  tokensBefore?: number;
  tokensAfter?: number;
  method?: 'session_memory' | 'full_compact';
}> {
  if (process.env.DISABLE_COMPACT === '1' || process.env.DISABLE_COMPACT === 'true') {
    return { wasCompacted: false };
  }

  const tracking = getTracking(session.id);
  if (tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    return { wasCompacted: false };
  }

  if (!shouldAutoCompact(session, messages, model, querySource)) {
    return { wasCompacted: false };
  }

  // 1. 优先尝试 Session Memory 压缩
  const smResult = await trySessionMemoryCompaction(session, messages, snapshotManager, model);
  if (smResult.success && smResult.newMessages) {
    tracking.consecutiveFailures = 0;
    return {
      wasCompacted: true,
      newMessages: smResult.newMessages,
      tokensBefore: smResult.tokensBefore,
      tokensAfter: smResult.tokensAfter,
      method: 'session_memory',
    };
  }

  // 2. 回退到传统压缩
  const fullResult = await compactConversation(session, messages, llmService, sessionManager);
  if (fullResult.success && fullResult.newMessages) {
    tracking.consecutiveFailures = 0;
    return {
      wasCompacted: true,
      newMessages: fullResult.newMessages,
      tokensBefore: fullResult.tokensBefore,
      tokensAfter: fullResult.tokensAfter,
      method: 'full_compact',
    };
  }

  tracking.consecutiveFailures++;
  if (tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    console.warn(`[AutoCompact] Circuit breaker triggered for session ${session.id}`);
  }

  return { wasCompacted: false };
}

/**
 * 响应式压缩：在 API 返回 prompt-too-long 后触发
 */
export async function reactiveCompact(
  session: Session,
  messages: ConversationMessage[],
  llmService: LLMService,
  sessionManager: SessionManager
): Promise<{
  wasCompacted: boolean;
  newMessages?: ConversationMessage[];
}> {
  const result = await compactConversation(session, messages, llmService, sessionManager);
  if (result.success && result.newMessages) {
    return { wasCompacted: true, newMessages: result.newMessages };
  }
  return { wasCompacted: false };
}
