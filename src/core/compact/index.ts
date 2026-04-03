/**
 * 会话压缩模块
 * 导出所有压缩相关功能
 */

export {
  roughTokenCountEstimation,
  estimateMessageTokens,
  estimateMessagesTokens,
} from './tokens';

export { groupMessagesByApiRound } from './grouping';

export {
  formatCompactSummary,
  getCompactUserSummaryMessage,
  BASE_COMPACT_PROMPT,
  NO_TOOLS_PREAMBLE,
  DETAILED_COMPACT_PROMPT,
  QUICK_COMPACT_PROMPT,
  selectCompactPrompt,
  analyzeComplexity,
  type ComplexityAnalysis,
} from './prompt';

export { applyMicroCompact } from './microCompact';

export {
  compactConversation,
  adjustIndexToPreserveAPIInvariants,
} from './compact';

export {
  autoCompactIfNeeded,
  reactiveCompact,
  getAutoCompactThreshold,
} from './autoCompact';
