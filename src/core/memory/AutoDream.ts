/**
 * AutoDream 记忆整合系统 v2
 * 
 * 与文件系统深度融合的版本
 * - 支持持久化到 .starup/memory/autodream/
 * - 支持从对话自动提取观察
 * - 支持将 facts 写回记忆文件
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
  sessionId?: string;  // 关联的会话ID
}

/** 记忆洞察 */
export interface Insight {
  id: string;
  observationIds: string[];
  content: string;
  confidence: number;
  createdAt: number;
  sourceSession?: string;
}

/** 绝对事实 */
export interface Fact {
  id: string;
  content: string;
  sources: string[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
  accessCount: number;  // 访问次数，用于衰减计算
  lastAccessedAt: number;
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

/** AutoDream 配置 */
export interface AutoDreamConfig {
  consolidationInterval: number;  // 整合间隔（毫秒），默认5分钟
  halfLife: number;               // 半衰期（毫秒），默认30天
  minConfidence: number;          // 最低置信度，默认0.1
  maxObservations: number;        // 最大观察数，默认1000
  maxFacts: number;               // 最大事实数，默认500
  persistenceEnabled: boolean;    // 是否启用持久化
  persistenceDir: string;         // 持久化目录
}

/**
 * AutoDream 记忆整合 - 文件系统融合版
 */
export class AutoDream extends EventEmitter {
  private observations: Map<string, Observation> = new Map();
  private insights: Map<string, Insight> = new Map();
  private facts: Map<string, Fact> = new Map();
  private contradictions: Map<string, Contradiction> = new Map();
  
  private config: AutoDreamConfig;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private persistence: AutoDreamPersistence | null = null;

  constructor(config: Partial<AutoDreamConfig> = {}) {
    super();
    
    this.config = {
      consolidationInterval: 5 * 60 * 1000,  // 5分钟
      halfLife: 30 * 24 * 60 * 60 * 1000,     // 30天
      minConfidence: 0.1,
      maxObservations: 1000,
      maxFacts: 500,
      persistenceEnabled: true,
      persistenceDir: '.starup/memory/autodream',
      ...config
    };
  }

  /**
   * 设置持久化层
   */
  setPersistence(persistence: AutoDreamPersistence): void {
    this.persistence = persistence;
  }

  /**
   * 启动 AutoDream
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    // 如果启用持久化，先加载已有数据
    if (this.config.persistenceEnabled && this.persistence) {
      await this.loadFromPersistence();
    }
    
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.consolidate();
    }, this.config.consolidationInterval);
    (this.timer as any).unref();

    logger.info('AutoDream', `Started with ${this.observations.size} observations, ${this.facts.size} facts`);
    this.emit('started', {
      observations: this.observations.size,
      facts: this.facts.size
    });
  }

  /**
   * 停止 AutoDream
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    
    // 停止前保存数据
    if (this.config.persistenceEnabled && this.persistence) {
      await this.saveToPersistence();
    }
    
    this.isRunning = false;
    logger.info('AutoDream', 'Stopped');
    this.emit('stopped');
  }

  /**
   * 从持久化加载
   */
  private async loadFromPersistence(): Promise<void> {
    if (!this.persistence) return;
    
    try {
      const data = await this.persistence.load();
      if (data) {
        this.observations = new Map(data.observations.map((o: Observation) => [o.id, o]));
        this.insights = new Map(data.insights.map((i: Insight) => [i.id, i]));
        this.facts = new Map(data.facts.map((f: Fact) => [f.id, f]));
        this.contradictions = new Map(data.contradictions.map((c: Contradiction) => [c.id, c]));
        
        logger.info('AutoDream', `Loaded from persistence: ${this.observations.size} obs, ${this.facts.size} facts`);
      }
    } catch (error) {
      logger.warn('AutoDream', `Failed to load from persistence: ${error}`);
    }
  }

  /**
   * 保存到持久化
   */
  private async saveToPersistence(): Promise<void> {
    if (!this.persistence) return;
    
    try {
      await this.persistence.save({
        observations: Array.from(this.observations.values()),
        insights: Array.from(this.insights.values()),
        facts: Array.from(this.facts.values()),
        contradictions: Array.from(this.contradictions.values())
      });
      
      logger.debug('AutoDream', 'Saved to persistence');
    } catch (error) {
      logger.error('AutoDream', `Failed to save to persistence: ${error}`);
    }
  }

  /**
   * 添加观察
   */
  addObservation(observation: Omit<Observation, 'id'>): Observation {
    // 检查是否达到上限
    if (this.observations.size >= this.config.maxObservations) {
      // 删除最旧的观察
      const oldest = Array.from(this.observations.values())
        .sort((a, b) => a.timestamp - b.timestamp)[0];
      if (oldest) {
        this.observations.delete(oldest.id);
      }
    }
    
    const obs: Observation = {
      ...observation,
      id: `obs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    this.observations.set(obs.id, obs);
    logger.debug('AutoDream', `Added observation: ${obs.id} (total: ${this.observations.size})`);
    this.emit('observation_added', obs);

    return obs;
  }

  /**
   * 批量添加观察
   */
  addObservations(observations: Omit<Observation, 'id'>[]): Observation[] {
    return observations.map(o => this.addObservation(o));
  }

  /**
   * 执行记忆整合
   */
  async consolidate(): Promise<void> {
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

      // 4. 清理低置信度事实
      this.cleanupLowConfidenceFacts();

      logger.info('AutoDream', 
        `Consolidation complete: ${mergedInsights.length} insights, ${newFacts.length} new facts, total facts: ${this.facts.size}`
      );

      this.emit('consolidation_complete', {
        insights: mergedInsights.length,
        facts: newFacts.length,
        totalFacts: this.facts.size
      });

      // 5. 保存到持久化
      if (this.config.persistenceEnabled && this.persistence) {
        await this.saveToPersistence();
      }

    } catch (error) {
      logger.error('AutoDream', `Consolidation failed: ${error}`);
      this.emit('consolidation_error', error);
    }
  }

  /**
   * 手动触发整合（供外部调用）
   */
  async forceConsolidate(): Promise<void> {
    await this.consolidate();
  }

  /**
   * 合并观察
   */
  private mergeObservations(observations: Observation[]): Insight[] {
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

      for (let i = 0; i < topicObservations.length; i++) {
        for (let j = i + 1; j < topicObservations.length; j++) {
          const obs1 = topicObservations[i];
          const obs2 = topicObservations[j];

          if (processed.has(obs1.id) || processed.has(obs2.id)) continue;

          const similarity = this.calculateSimilarity(obs1.content, obs2.content);
          
          if (similarity > 0.7) {
            const insight: Insight = {
              id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              observationIds: [obs1.id, obs2.id],
              content: this.mergeContent(obs1.content, obs2.content),
              confidence: (obs1.confidence + obs2.confidence) / 2 * similarity,
              createdAt: Date.now(),
              sourceSession: obs1.sessionId || obs2.sessionId
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
  private resolveContradictions(): void {
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

          // 保留置信度更高的事实
          if (fact1.confidence > fact2.confidence) {
            fact2.confidence *= 0.5;
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
  private convertToFacts(insights: Insight[]): Fact[] {
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
          updatedAt: Date.now(),
          accessCount: 0,
          lastAccessedAt: Date.now()
        };

        this.facts.set(fact.id, fact);
        newFacts.push(fact);
        
        this.emit('fact_created', fact);
      }
    }

    return newFacts;
  }

  /**
   * 清理低置信度事实
   */
  private cleanupLowConfidenceFacts(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, fact] of this.facts) {
      const effectiveConfidence = this.calculateEffectiveConfidence(fact, now);
      if (effectiveConfidence < this.config.minConfidence) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.facts.delete(id);
    }

    // 如果事实太多，删除最老的
    if (this.facts.size > this.config.maxFacts) {
      const sorted = Array.from(this.facts.values())
        .sort((a, b) => a.updatedAt - b.updatedAt);
      const toRemove = sorted.slice(0, sorted.length - this.config.maxFacts);
      for (const fact of toRemove) {
        this.facts.delete(fact.id);
      }
    }
  }

  /**
   * 计算有效置信度（含时间衰减）
   */
  private calculateEffectiveConfidence(fact: Fact, now: number = Date.now()): number {
    const age = now - fact.updatedAt;
    const decayFactor = Math.exp(-age / this.config.halfLife);
    return fact.confidence * decayFactor;
  }

  /**
   * 获取所有事实（按有效置信度排序）
   */
  getFacts(): Fact[] {
    const now = Date.now();
    return Array.from(this.facts.values())
      .map(fact => ({
        fact,
        effectiveConfidence: this.calculateEffectiveConfidence(fact, now)
      }))
      .sort((a, b) => b.effectiveConfidence - a.effectiveConfidence)
      .map(item => item.fact);
  }

  /**
   * 查询相关事实
   */
  queryFacts(query: string, limit: number = 5): Fact[] {
    const keywords = query.toLowerCase().split(' ').filter(k => k.length > 2);
    const now = Date.now();
    
    return this.getFacts()
      .map(fact => {
        const text = fact.content.toLowerCase();
        const score = keywords.filter(kw => text.includes(kw)).length;
        const effectiveConfidence = this.calculateEffectiveConfidence(fact, now);
        return { fact, score, effectiveConfidence };
      })
      .filter(item => item.score > 0 && item.effectiveConfidence >= this.config.minConfidence)
      .sort((a, b) => {
        // 综合考虑分数和置信度
        const scoreA = a.score * a.effectiveConfidence;
        const scoreB = b.score * b.effectiveConfidence;
        return scoreB - scoreA;
      })
      .slice(0, limit)
      .map(item => {
        // 更新访问统计
        item.fact.accessCount++;
        item.fact.lastAccessedAt = now;
        return item.fact;
      });
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
   * 获取观察
   */
  getObservations(): Observation[] {
    return Array.from(this.observations.values());
  }

  /**
   * 强化事实（新观察证实时调用）
   */
  reinforceFact(factId: string, boost: number = 0.1): boolean {
    const fact = this.facts.get(factId);
    if (!fact) return false;

    const oldConfidence = fact.confidence;
    fact.confidence = Math.min(1.0, oldConfidence + boost);
    fact.updatedAt = Date.now();

    logger.debug('AutoDream', 
      `Reinforced fact ${factId}: ${oldConfidence.toFixed(3)} -> ${fact.confidence.toFixed(3)}`
    );

    return true;
  }

  /**
   * 导出记忆（用于调试/备份）
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

  /**
   * 获取统计信息
   */
  getStats(): {
    observations: number;
    insights: number;
    facts: number;
    contradictions: number;
  } {
    return {
      observations: this.observations.size,
      insights: this.insights.size,
      facts: this.facts.size,
      contradictions: this.contradictions.size
    };
  }

  // ==================== 私有方法 ====================

  private calculateSimilarity(str1: string, str2: string): number {
    const set1 = new Set(str1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const set2 = new Set(str2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    
    if (set1.size === 0 || set2.size === 0) return 0;
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  private mergeContent(content1: string, content2: string): string {
    // 合并策略：取更详细的内容（更长的）
    if (content1.length > content2.length * 1.2) return content1;
    if (content2.length > content1.length * 1.2) return content2;
    // 长度相近时合并
    return `${content1}\n\n（补充）${content2}`;
  }

  private isContradictory(fact1: Fact, fact2: Fact): boolean {
    const negations = ['not', 'no', 'never', 'false', 'disabled', '不', '没有', '未'];
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

// ==================== 持久化层接口 ====================

export interface AutoDreamPersistence {
  load(): Promise<{
    observations: Observation[];
    insights: Insight[];
    facts: Fact[];
    contradictions: Contradiction[];
  } | null>;
  
  save(data: {
    observations: Observation[];
    insights: Insight[];
    facts: Fact[];
    contradictions: Contradiction[];
  }): Promise<void>;
}

// 单例导出
export const autoDream = new AutoDream();
export default AutoDream;
