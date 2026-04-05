/**
 * AutoDream 记忆整合系统
 * 
 * 核心功能：
 * 1. 后台记忆整合
 * 2. 合并观察结果
 * 3. 消除矛盾
 * 4. 转换为绝对事实
 * 
 * 参考：Claude Code泄漏代码中的autoDream功能
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/Logger';

/** 记忆观察 */
export interface Observation {
  id: string;
  timestamp: number;
  content: string;
  source: string;
  confidence: number;
  topics: string[];
}

/** 记忆洞察 */
export interface Insight {
  id: string;
  observationIds: string[];
  content: string;
  confidence: number;
  createdAt: number;
}

/** 绝对事实 */
export interface Fact {
  id: string;
  content: string;
  sources: string[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

/** 矛盾记录 */
export interface Contradiction {
  id: string;
  factId1: string;
  factId2: string;
  description: string;
  resolution?: string;
  detectedAt: number;
}

/**
 * AutoDream 记忆整合
 */
export class AutoDream extends EventEmitter {
  private observations: Map<string, Observation> = new Map();
  private insights: Map<string, Insight> = new Map();
  private facts: Map<string, Fact> = new Map();
  private contradictions: Map<string, Contradiction> = new Map();
  
  private consolidationInterval: number = 5 * 60 * 1000; // 5分钟
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * 开始后台整合
   */
  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.consolidate();
    }, this.consolidationInterval);
    (this.timer as any).unref(); // 不阻止进程退出

    logger.info('AutoDream', 'Started background consolidation');
    this.emit('started');
  }

  /**
   * 停止后台整合
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info('AutoDream', 'Stopped background consolidation');
    this.emit('stopped');
  }

  /**
   * 添加观察
   */
  addObservation(observation: Omit<Observation, 'id'>): Observation {
    const obs: Observation = {
      ...observation,
      id: `obs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    this.observations.set(obs.id, obs);
    logger.debug('AutoDream', `Added observation: ${obs.id}`);
    this.emit('observation_added', obs);

    return obs;
  }

  /**
   * 执行记忆整合
   */
  consolidate(): void {
    logger.info('AutoDream', 'Starting memory consolidation');
    this.emit('consolidation_started');

    try {
      // 1. 合并相似的观察
      const mergedInsights = this.mergeObservations(
        Array.from(this.observations.values())
      );

      // 2. 消除矛盾
      this.resolveContradictions();

      // 3. 转换为事实
      const newFacts = this.convertToFacts(
        Array.from(this.insights.values())
      );

      logger.info('AutoDream', 
        `Consolidation complete: ${mergedInsights.length} insights, ${newFacts.length} facts`
      );

      this.emit('consolidation_complete', {
        insights: mergedInsights.length,
        facts: newFacts.length
      });

    } catch (error) {
      logger.error('AutoDream', `Consolidation failed: ${error}`);
      this.emit('consolidation_error', error);
    }
  }

  /**
   * 合并观察
   */
  mergeObservations(observations: Observation[]): Insight[] {
    const newInsights: Insight[] = [];
    const processed = new Set<string>();

    // 按主题分组
    const byTopic = new Map<string, Observation[]>();
    for (const obs of observations) {
      for (const topic of obs.topics) {
        if (!byTopic.has(topic)) {
          byTopic.set(topic, []);
        }
        byTopic.get(topic)!.push(obs);
      }
    }

    // 合并相似观察
    for (const [topic, topicObservations] of byTopic) {
      if (topicObservations.length < 2) continue;

      // 简单的相似度检查（基于内容相似性）
      for (let i = 0; i < topicObservations.length; i++) {
        for (let j = i + 1; j < topicObservations.length; j++) {
          const obs1 = topicObservations[i];
          const obs2 = topicObservations[j];

          if (processed.has(obs1.id) || processed.has(obs2.id)) continue;

          const similarity = this.calculateSimilarity(obs1.content, obs2.content);
          
          if (similarity > 0.7) { // 阈值
            const insight: Insight = {
              id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              observationIds: [obs1.id, obs2.id],
              content: this.mergeContent(obs1.content, obs2.content),
              confidence: (obs1.confidence + obs2.confidence) / 2 * similarity,
              createdAt: Date.now()
            };

            this.insights.set(insight.id, insight);
            newInsights.push(insight);
            
            processed.add(obs1.id);
            processed.add(obs2.id);

            this.emit('insight_created', insight);
          }
        }
      }
    }

    return newInsights;
  }

  /**
   * 消除矛盾
   */
  resolveContradictions(): void {
    const facts = Array.from(this.facts.values());

    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        const fact1 = facts[i];
        const fact2 = facts[j];

        if (this.isContradictory(fact1, fact2)) {
          const contradiction: Contradiction = {
            id: `contradiction-${Date.now()}`,
            factId1: fact1.id,
            factId2: fact2.id,
            description: `Contradiction between ${fact1.id} and ${fact2.id}`,
            detectedAt: Date.now()
          };

          this.contradictions.set(contradiction.id, contradiction);
          this.emit('contradiction_detected', contradiction);

          // 简单的解决策略：保留置信度更高的事实
          if (fact1.confidence > fact2.confidence) {
            fact2.confidence *= 0.5; // 降低置信度
          } else {
            fact1.confidence *= 0.5;
          }

          contradiction.resolution = 'Resolved by confidence comparison';
        }
      }
    }
  }

  /**
   * 转换为事实
   */
  convertToFacts(insights: Insight[]): Fact[] {
    const newFacts: Fact[] = [];

    for (const insight of insights) {
      // 只转换高置信度的洞察
      if (insight.confidence > 0.8) {
        const fact: Fact = {
          id: `fact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          content: insight.content,
          sources: insight.observationIds,
          confidence: insight.confidence,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        this.facts.set(fact.id, fact);
        newFacts.push(fact);
        
        this.emit('fact_created', fact);
      }
    }

    return newFacts;
  }

  /**
   * 获取所有事实
   */
  getFacts(): Fact[] {
    return Array.from(this.facts.values())
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 获取洞察
   */
  getInsights(): Insight[] {
    return Array.from(this.insights.values());
  }

  /**
   * 获取矛盾
   */
  getContradictions(): Contradiction[] {
    return Array.from(this.contradictions.values());
  }

  /**
   * 查询相关事实
   */
  queryFacts(query: string, limit: number = 5): Fact[] {
    // 简单的关键词匹配
    const keywords = query.toLowerCase().split(' ');
    
    return this.getFacts()
      .map(fact => ({
        fact,
        score: keywords.filter(kw => fact.content.toLowerCase().includes(kw)).length
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.fact);
  }

  /**
   * 导出记忆
   */
  exportMemory(): {
    observations: Observation[];
    insights: Insight[];
    facts: Fact[];
    contradictions: Contradiction[];
  } {
    return {
      observations: Array.from(this.observations.values()),
      insights: Array.from(this.insights.values()),
      facts: Array.from(this.facts.values()),
      contradictions: Array.from(this.contradictions.values())
    };
  }

  /**
   * 清除所有记忆
   */
  clear(): void {
    this.observations.clear();
    this.insights.clear();
    this.facts.clear();
    this.contradictions.clear();
    
    logger.info('AutoDream', 'Memory cleared');
    this.emit('memory_cleared');
  }

  // ==================== 私有方法 ====================

  private calculateSimilarity(str1: string, str2: string): number {
    // 简单的Jaccard相似度
    const set1 = new Set(str1.toLowerCase().split(' '));
    const set2 = new Set(str2.toLowerCase().split(' '));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  private mergeContent(content1: string, content2: string): string {
    // 简单的合并：取较长的内容
    return content1.length > content2.length ? content1 : content2;
  }

  private isContradictory(fact1: Fact, fact2: Fact): boolean {
    // 简单的矛盾检测：检查是否有相反的关键词
    const negations = ['not', 'no', 'never', 'false', 'disabled'];
    const hasNegation1 = negations.some(n => fact1.content.toLowerCase().includes(n));
    const hasNegation2 = negations.some(n => fact2.content.toLowerCase().includes(n));
    
    // 如果一个是肯定一个是否定，且内容相似，则可能存在矛盾
    if (hasNegation1 !== hasNegation2) {
      const similarity = this.calculateSimilarity(fact1.content, fact2.content);
      return similarity > 0.5;
    }
    
    return false;
  }
}

export const autoDream = new AutoDream();
export default AutoDream;
