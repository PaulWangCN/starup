/**
 * 记忆系统统一导出
 * 
 * 架构：
 * - MemoryManager: 文件式记忆管理（Markdown）
 * - AutoDream: 自动记忆整合（观察→洞察→事实）
 * - AutoDreamPersistence: AutoDream 持久化层
 * - ConversationObserver: 对话观察器
 */

export { MemoryManager, memoryManager } from './MemoryManager';

export { 
  AutoDream,
  autoDream,
  type Observation,
  type Insight,
  type Fact,
  type Contradiction,
  type AutoDreamConfig,
  type AutoDreamPersistence as IAutoDreamPersistence,
} from './AutoDream';

export { 
  AutoDreamPersistence 
} from './AutoDreamPersistence';

export { 
  ConversationObserver,
  type ConversationMessage,
  type ObservationRule,
} from './ConversationObserver';
