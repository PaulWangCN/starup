/**
 * AutoDream 记忆整合系统（含时间衰减）
 * 
 * 简单实现版本 - 30分钟即可集成
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/Logger';
import { AutoDream, Observation, Insight, Fact } from './AutoDream';

/**
 * 配置选项
 */
export interface DecayConfig {
  halfLife: number;        // 半衰期（毫秒）默认30天
  refreshOnAccess: boolean; // 访问时是否刷新
  refreshBoost: number;    // 访问时置信度提升比例
  minConfidence: number;   // 最低置信度阈值
  cleanupInterval: number; // 清理间隔（毫秒）
}

/**
 * 带时间衰减的增强版 AutoDream
 */
export class AutoDreamWithDecay extends AutoDream {
  private decayConfig: DecayConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<DecayConfig> = {}) {
    super();
    this.decayConfig = {
      halfLife: 30 * 24 * 60 * 60 * 1000,  // 30天
      refreshOnAccess: true,
      refreshBoost: 0.1,                    // 访问提升10%
      minConfidence: 0.1,                   // 低于10%清理
      cleanupInterval: 24 * 60 * 60 * 1000, // 每天清理一次
      ...config
    };
  }

  /**
   * 启动（带清理任务）
   */
  start(): void {
    super.start();
    
    // 启动清理任务
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleFacts();
    }, this.decayConfig.cleanupInterval);
    (this.cleanupTimer as any).unref();

    logger.info('AutoDreamWithDecay', 
      `Started with halfLife=${this.decayConfig.halfLife}ms, ` +
      `minConfidence=${this.decayConfig.minConfidence}`
    );
  }

  /**
   * 停止（清理定时器）
   */
  stop(): void {
    super.stop();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 计算有效置信度（含时间衰减）
   * 
   * 公式：C_eff = C_base * exp(-t / t_half)
   * 
   * 示例：
   * - 30天后：置信度衰减至 50%
   * - 60天后：置信度衰减至 25%
   * - 90天后：置信度衰减至 12.5%
   */
  calculateEffectiveConfidence(fact: Fact): number {
    const age = Date.now() - fact.updatedAt;
    const decayFactor = Math.exp(-age / this.decayConfig.halfLife);
    return fact.confidence * decayFactor;
  }

  /**
   * 获取事实（带衰减计算）
   */
  getFacts(): Fact[] {
    const facts = super.getFacts();
    
    // 计算衰减后的置信度并排序
    return facts
      .map(fact => ({
        fact,
        effectiveConfidence: this.calculateEffectiveConfidence(fact)
      }))
      .sort((a, b) => b.effectiveConfidence - a.effectiveConfidence)
      .map(item => item.fact);
  }

  /**
   * 查询事实（只返回有效置信度高于阈值的事实）
   */
  queryFacts(query: string, limit: number = 5): Fact[] {
    const allFacts = super.getFacts();
    const keywords = query.toLowerCase().split(' ');
    
    return allFacts
      .map(fact => ({
        fact,
        score: keywords.filter(kw => fact.content.toLowerCase().includes(kw)).length,
        effectiveConfidence: this.calculateEffectiveConfidence(fact)
      }))
      .filter(item => 
        item.score > 0 && 
        item.effectiveConfidence >= this.decayConfig.minConfidence
      )
      .sort((a, b) => b.effectiveConfidence - a.effectiveConfidence)
      .slice(0, limit)
      .map(item => item.fact);
  }

  /**
   * 访问事实（刷新衰减）
   */
  accessFact(factId: string): Fact | null {
    // 获取父类的私有字段（通过类型断言）
    const facts = (this as any).facts as Map<string, Fact>;
    const fact = facts.get(factId);
    
    if (!fact) return null;

    // 刷新衰减：略微提升置信度
    if (this.decayConfig.refreshOnAccess) {
      const oldConfidence = fact.confidence;
      fact.confidence = Math.min(1.0, 
        oldConfidence * (1 + this.decayConfig.refreshBoost)
      );
      fact.updatedAt = Date.now();
      
      logger.debug('AutoDreamWithDecay', 
        `Refreshed fact ${factId}: ${oldConfidence.toFixed(3)} -> ${fact.confidence.toFixed(3)}`
      );
    }

    return fact;
  }

  /**
   * 强化事实（新观察证实时大幅提升置信度）
   */
  reinforceFact(factId: string, boost: number = 0.2): boolean {
    const facts = (this as any).facts as Map<string, Fact>;
    const fact = facts.get(factId);
    
    if (!fact) return false;

    const oldConfidence = fact.confidence;
    fact.confidence = Math.min(1.0, oldConfidence + boost);
    fact.updatedAt = Date.now();

    logger.info('AutoDreamWithDecay', 
      `Reinforced fact ${factId}: ${oldConfidence.toFixed(3)} -> ${fact.confidence.toFixed(3)}`
    );

    return true;
  }

  /**
   * 清理过时的事实
   */
  private cleanupStaleFacts(): void {
    const facts = (this as any).facts as Map<string, Fact>;
    const beforeCount = facts.size;
    const staleFacts: string[] = [];

    for (const [id, fact] of facts) {
      const effectiveConfidence = this.calculateEffectiveConfidence(fact);
      if (effectiveConfidence < this.decayConfig.minConfidence) {
        staleFacts.push(id);
      }
    }

    // 删除过时事实
    for (const id of staleFacts) {
      facts.delete(id);
    }

    if (staleFacts.length > 0) {
      logger.info('AutoDreamWithDecay', 
        `Cleaned up ${staleFacts.length} stale facts ` +
        `(${beforeCount} -> ${facts.size})`
      );
      this.emit('facts_cleaned', { count: staleFacts.length, ids: staleFacts });
    }
  }

  /**
   * 获取衰减统计
   */
  getDecayStats(): {
    totalFacts: number;
    freshFacts: number;      // 置信度 > 0.5
    decayingFacts: number;   // 置信度 0.1-0.5
    staleFacts: number;      // 置信度 < 0.1
    avgEffectiveConfidence: number;
  } {
    const facts = super.getFacts();
    const effectiveConfidences = facts.map(f => this.calculateEffectiveConfidence(f));
    
    return {
      totalFacts: facts.length,
      freshFacts: effectiveConfidences.filter(c => c > 0.5).length,
      decayingFacts: effectiveConfidences.filter(c => c >= 0.1 && c <= 0.5).length,
      staleFacts: effectiveConfidences.filter(c => c < 0.1).length,
      avgEffectiveConfidence: effectiveConfidences.reduce((a, b) => a + b, 0) / facts.length || 0
    };
  }
}

/**
 * 使用示例
 * 
 * ```typescript
 * const autoDream = new AutoDreamWithDecay({
 *   halfLife: 7 * 24 * 60 * 60 * 1000,  // 7天半衰期（适合快速变化的项目）
 *   minConfidence: 0.05,                  // 5%阈值
 *   refreshOnAccess: true
 * });
 * 
 * autoDream.start();
 * 
 * // 添加观察
 * autoDream.addObservation({
 *   timestamp: Date.now(),
 *   content: 'User prefers TypeScript',
 *   source: 'conversation',
 *   confidence: 0.9,
 *   topics: ['preference', 'tech-stack']
 * });
 * 
 * // 7天后查询
 * const facts = autoDream.queryFacts('TypeScript');
 * // 置信度已衰减至 0.9 * exp(-1) = 0.33
 * 
 * // 访问刷新
 * autoDream.accessFact('fact-xxx');
 * // 置信度略微提升
 * 
 * // 强化事实
 * autoDream.reinforceFact('fact-xxx', 0.3);
 * // 置信度大幅提升
 * ```
 */

export default AutoDreamWithDecay;
