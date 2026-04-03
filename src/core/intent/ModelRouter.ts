/**
 * 意图-模型路由配置
 * 根据意图类型路由到不同成本的模型
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/Logger';

/**
 * 意图-模型映射配置
 */
export interface ModelRoutingConfig {
  intentMappings: {
    [intentId: string]: {
      model: string;           // 如 "deepseek-chat", "deepseek-coder"
      temperature?: number;
      maxTokens?: number;
      priority: number;        // 优先级，用于冲突解决
    };
  };
  defaultModel: string;
  fallbackModel: string;
  dailyQuota: {              // 每日调用配额
    [model: string]: number;
  };
}

/**
 * 模型路由结果
 */
export interface ModelRouteResult {
  model: string;
  temperature: number;
  maxTokens: number;
  priority: number;
  isFallback: boolean;
}

/**
 * 使用统计
 */
export interface UsageStats {
  model: string;
  count: number;
  remainingQuota: number;
}

/**
 * 模型路由器
 * 根据意图ID选择合适的LLM模型
 */
export class ModelRouter {
  private config: ModelRoutingConfig;
  private usageStats: Map<string, number> = new Map();  // 每日使用量
  private lastResetDate: string = '';

  /**
   * 构造函数
   * @param config 路由配置
   */
  constructor(config?: ModelRoutingConfig) {
    this.config = config || this.getDefaultConfig();
    this.resetDailyStatsIfNeeded();
  }

  /**
   * 根据意图获取合适的模型
   * @param intentId 意图ID
   * @returns 模型路由结果
   */
  getModelForIntent(intentId: string): ModelRouteResult {
    this.resetDailyStatsIfNeeded();

    const mapping = this.config.intentMappings[intentId];
    
    if (!mapping) {
      // 使用默认模型
      return {
        model: this.config.defaultModel,
        temperature: 0.7,
        maxTokens: 2048,
        priority: 0,
        isFallback: false,
      };
    }

    // 检查配额
    if (!this.checkQuota(mapping.model)) {
      logger.warn('ModelRouter', `Quota exceeded for model ${mapping.model}, using fallback`);
      return {
        model: this.config.fallbackModel,
        temperature: mapping.temperature ?? 0.7,
        maxTokens: mapping.maxTokens ?? 2048,
        priority: mapping.priority,
        isFallback: true,
      };
    }

    return {
      model: mapping.model,
      temperature: mapping.temperature ?? 0.7,
      maxTokens: mapping.maxTokens ?? 2048,
      priority: mapping.priority,
      isFallback: false,
    };
  }

  /**
   * 检查配额
   * @param model 模型名称
   * @returns 是否在配额内
   */
  checkQuota(model: string): boolean {
    const quota = this.config.dailyQuota[model];
    
    // 如果没有设置配额，视为无限
    if (quota === undefined || quota === -1) {
      return true;
    }

    const used = this.usageStats.get(model) || 0;
    return used < quota;
  }

  /**
   * 获取剩余配额
   * @param model 模型名称
   * @returns 剩余配额数量，-1表示无限
   */
  getRemainingQuota(model: string): number {
    const quota = this.config.dailyQuota[model];
    
    if (quota === undefined || quota === -1) {
      return -1;
    }

    const used = this.usageStats.get(model) || 0;
    return Math.max(0, quota - used);
  }

  /**
   * 记录使用
   * @param model 模型名称
   */
  recordUsage(model: string): void {
    this.resetDailyStatsIfNeeded();
    const current = this.usageStats.get(model) || 0;
    this.usageStats.set(model, current + 1);
  }

  /**
   * 批量记录使用
   * @param model 模型名称
   * @param count 使用次数
   */
  recordBatchUsage(model: string, count: number): void {
    this.resetDailyStatsIfNeeded();
    const current = this.usageStats.get(model) || 0;
    this.usageStats.set(model, current + count);
  }

  /**
   * 加载配置
   * @param configPath 配置文件路径
   */
  async loadConfig(configPath: string): Promise<void> {
    try {
      if (!fs.existsSync(configPath)) {
        logger.warn('ModelRouter', `Config file not found: ${configPath}`);
        return;
      }

      const data = await fs.promises.readFile(configPath, 'utf-8');
      const loadedConfig: ModelRoutingConfig = JSON.parse(data);
      
      // 合并配置
      this.config = {
        ...this.getDefaultConfig(),
        ...loadedConfig,
      };

      logger.debug('ModelRouter', `Config loaded from ${configPath}`);
    } catch (error) {
      logger.error('ModelRouter', `Failed to load config: ${error}`);
      throw error;
    }
  }

  /**
   * 保存配置
   * @param configPath 配置文件路径
   */
  async saveConfig(configPath: string): Promise<void> {
    try {
      // 确保目录存在
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      await fs.promises.writeFile(
        configPath,
        JSON.stringify(this.config, null, 2),
        'utf-8'
      );

      logger.debug('ModelRouter', `Config saved to ${configPath}`);
    } catch (error) {
      logger.error('ModelRouter', `Failed to save config: ${error}`);
      throw error;
    }
  }

  /**
   * 获取使用统计
   * @returns 各模型的使用统计
   */
  getUsageStats(): Record<string, number> {
    this.resetDailyStatsIfNeeded();
    
    const stats: Record<string, number> = {};
    for (const [model, count] of this.usageStats.entries()) {
      stats[model] = count;
    }

    // 包含配额信息
    for (const model of Object.keys(this.config.dailyQuota)) {
      if (!(model in stats)) {
        stats[model] = 0;
      }
    }

    return stats;
  }

  /**
   * 获取详细使用统计
   * @returns 详细统计信息
   */
  getDetailedUsageStats(): UsageStats[] {
    this.resetDailyStatsIfNeeded();
    
    const allModels = new Set([
      ...Object.keys(this.config.dailyQuota),
      ...this.usageStats.keys(),
    ]);

    return Array.from(allModels).map((model) => ({
      model,
      count: this.usageStats.get(model) || 0,
      remainingQuota: this.getRemainingQuota(model),
    }));
  }

  /**
   * 重置每日统计
   */
  resetDailyStats(): void {
    this.usageStats.clear();
    this.lastResetDate = this.getCurrentDate();
    logger.debug('ModelRouter', 'Daily stats reset');
  }

  /**
   * 更新意图映射
   * @param intentId 意图ID
   * @param mapping 模型映射配置
   */
  updateIntentMapping(
    intentId: string,
    mapping: {
      model: string;
      temperature?: number;
      maxTokens?: number;
      priority: number;
    }
  ): void {
    this.config.intentMappings[intentId] = mapping;
    logger.debug('ModelRouter', `Updated mapping for intent ${intentId} -> ${mapping.model}`);
  }

  /**
   * 删除意图映射
   * @param intentId 意图ID
   * @returns 是否成功删除
   */
  removeIntentMapping(intentId: string): boolean {
    const existed = intentId in this.config.intentMappings;
    if (existed) {
      delete this.config.intentMappings[intentId];
      logger.debug('ModelRouter', `Removed mapping for intent ${intentId}`);
    }
    return existed;
  }

  /**
   * 获取所有意图映射
   * @returns 意图映射配置
   */
  getAllMappings(): Record<string, { model: string; temperature?: number; maxTokens?: number; priority: number }> {
    return { ...this.config.intentMappings };
  }

  /**
   * 设置配额
   * @param model 模型名称
   * @param quota 配额数量，-1表示无限
   */
  setQuota(model: string, quota: number): void {
    this.config.dailyQuota[model] = quota;
    logger.debug('ModelRouter', `Set quota for ${model}: ${quota}`);
  }

  /**
   * 获取当前配置
   * @returns 当前路由配置
   */
  getConfig(): ModelRoutingConfig {
    return { ...this.config };
  }

  // ==================== 私有方法 ====================

  /**
   * 获取默认配置
   */
  private getDefaultConfig(): ModelRoutingConfig {
    const defaultModel = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    const codeModel = process.env.LLM_MODEL_CODE || defaultModel;

    return {
      intentMappings: {
        code_generation: {
          model: codeModel,
          temperature: 0.2,
          maxTokens: 4096,
          priority: 10,
        },
        analysis: {
          model: process.env.LLM_MODEL_ANALYSIS || defaultModel,
          temperature: 0.5,
          maxTokens: 2048,
          priority: 9,
        },
        search: {
          model: process.env.LLM_MODEL_SEARCH || defaultModel,
          temperature: 0.7,
          maxTokens: 2048,
          priority: 5,
        },
        explanation: {
          model: process.env.LLM_MODEL_EXPLANATION || defaultModel,
          temperature: 0.7,
          maxTokens: 2048,
          priority: 5,
        },
        general: {
          model: process.env.LLM_MODEL_GENERAL || defaultModel,
          temperature: 0.8,
          maxTokens: 1024,
          priority: 1,
        },
      },
      defaultModel,
      fallbackModel: process.env.LLM_FALLBACK_MODEL || defaultModel,
      dailyQuota: {
        [defaultModel]: 1000,
        [codeModel]: 500,
      },
    };
  }

  /**
   * 获取当前日期字符串
   */
  private getCurrentDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * 如果需要，重置每日统计
   */
  private resetDailyStatsIfNeeded(): void {
    const currentDate = this.getCurrentDate();
    if (this.lastResetDate !== currentDate) {
      this.usageStats.clear();
      this.lastResetDate = currentDate;
    }
  }
}

// 单例导出
export const modelRouter = new ModelRouter();
