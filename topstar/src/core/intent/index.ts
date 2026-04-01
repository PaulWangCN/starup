/**
 * 意图识别引擎
 * StarUp AI 系统的双层意图识别架构 - 网关层实现
 */

// 导出核心类和类型
export {
  IntentRouter,
  intentRouter,
  type IntentRecognition,
  type IntentPattern,
  type SkillIntentDef,
  type SessionContext,
} from './IntentRouter';

// 导出工具函数
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

// 导出模型路由
export {
  ModelRouter,
  modelRouter,
  type ModelRoutingConfig,
  type ModelRouteResult,
  type UsageStats,
} from './ModelRouter';
