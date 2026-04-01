/**
 * 意图识别引擎（简化版）
 * 完全由 LLM 通过 Prompt 进行意图分类
 */

export {
  IntentRouter,
  intentRouter,
  type IntentRecognition,
} from './IntentRouter';

export {
  calculateSimilarity,
  jaccardSimilarity,
  cosineSimilarity,
  extractKeywords,
  extractEntities,
  extractSlots,
  preprocessText,
  textToVector,
  fuzzyMatch,
  detectLanguage,
  splitSentences,
  calculateComplexity,
} from './IntentUtils';

export {
  ModelRouter,
  modelRouter,
  type ModelRoutingConfig,
  type ModelRouteResult,
  type UsageStats,
} from './ModelRouter';
