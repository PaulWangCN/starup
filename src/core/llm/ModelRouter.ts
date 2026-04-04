/**
 * 模型路由器
 * 根据任务类型选择最优模型，实现成本-质量平衡
 */

import { LLMConfig, LLMProvider, ConversationMessage } from '../../types';
import { BaseLLMProvider, createLLMProvider, getModelCapabilities, SUPPORTED_MODELS } from './LLMProviders';
import { logger } from '../../utils/Logger';

export type TaskType = 'chat' | 'coding' | 'analysis' | 'creative' | 'summarization' | 'translation';

export interface RoutingStrategy {
  taskType: TaskType;
  priority: 'quality' | 'speed' | 'cost';
  preferredProvider?: LLMProvider;
  requiredCapabilities?: string[];
}

export interface ModelSelection {
  provider: LLMProvider;
  model: string;
  reason: string;
  estimatedCost: 'low' | 'medium' | 'high';
}

/**
 * 模型路由器
 */
export class ModelRouter {
  private providers: Map<LLMProvider, BaseLLMProvider> = new Map();
  private configs: Map<LLMProvider, LLMConfig> = new Map();
  private defaultProvider: LLMProvider | null = null;
  private routingHistory: Array<{
    timestamp: number;
    taskType: TaskType;
    selected: ModelSelection;
    success: boolean;
  }> = [];

  /**
   * 注册提供商配置
   */
  registerProvider(config: LLMConfig, isDefault: boolean = false): void {
    this.configs.set(config.provider, config);
    
    if (isDefault || !this.defaultProvider) {
      this.defaultProvider = config.provider;
    }

    logger.info('ModelRouter', `Registered provider: ${config.provider} (${config.model})`);
  }

  /**
   * 获取提供商实例
   */
  private getProvider(provider: LLMProvider): BaseLLMProvider {
    if (!this.providers.has(provider)) {
      const config = this.configs.get(provider);
      if (!config) {
        throw new Error(`Provider ${provider} not configured`);
      }
      this.providers.set(provider, createLLMProvider(config));
    }
    return this.providers.get(provider)!;
  }

  /**
   * 选择最佳模型
   */
  selectModel(strategy: RoutingStrategy): ModelSelection {
    const availableProviders = Array.from(this.configs.keys());
    
    if (availableProviders.length === 0) {
      throw new Error('No LLM providers configured');
    }

    // 如果有首选提供商，优先使用
    if (strategy.preferredProvider && this.configs.has(strategy.preferredProvider)) {
      const config = this.configs.get(strategy.preferredProvider)!;
      return {
        provider: strategy.preferredProvider,
        model: config.model,
        reason: 'User preferred provider',
        estimatedCost: getModelCapabilities(strategy.preferredProvider, config.model).cost,
      };
    }

    // 根据任务类型和优先级选择
    const candidates: Array<{ provider: LLMProvider; model: string; score: number; cost: 'low' | 'medium' | 'high' }> = [];

    for (const provider of availableProviders) {
      const config = this.configs.get(provider)!;
      const capabilities = getModelCapabilities(provider, config.model);

      let score = 0;

      // 根据任务类型评分
      switch (strategy.taskType) {
        case 'coding':
          score += capabilities.coding * 10;
          break;
        case 'analysis':
          score += capabilities.reasoning * 10;
          break;
        case 'creative':
          score += capabilities.reasoning * 8;
          break;
        case 'summarization':
          score += capabilities.contextWindow / 10000;
          break;
        default:
          score += (capabilities.coding + capabilities.reasoning) * 5;
      }

      // 根据优先级调整
      switch (strategy.priority) {
        case 'cost':
          if (capabilities.cost === 'low') score += 50;
          else if (capabilities.cost === 'medium') score += 20;
          break;
        case 'quality':
          score += (capabilities.coding + capabilities.reasoning) * 5;
          break;
        case 'speed':
          // 假设小模型更快
          if (config.model.includes('mini') || config.model.includes('flash')) score += 30;
          break;
      }

      candidates.push({
        provider,
        model: config.model,
        score,
        cost: capabilities.cost,
      });
    }

    // 排序并选择最佳
    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates[0];

    const selection: ModelSelection = {
      provider: selected.provider,
      model: selected.model,
      reason: `${strategy.taskType} task with ${strategy.priority} priority`,
      estimatedCost: selected.cost,
    };

    logger.debug('ModelRouter', `Selected ${selected.provider}/${selected.model} for ${strategy.taskType}`);

    return selection;
  }

  /**
   * 执行对话（自动路由）
   */
  async chat(
    messages: ConversationMessage[],
    strategy: RoutingStrategy,
    tools?: any[],
    options?: { maxTokens?: number }
  ): Promise<{ content: string; tool_calls?: any[]; selection: ModelSelection }> {
    const selection = this.selectModel(strategy);
    const provider = this.getProvider(selection.provider);

    try {
      const result = await provider.chat(messages, tools, options);
      
      this.routingHistory.push({
        timestamp: Date.now(),
        taskType: strategy.taskType,
        selected: selection,
        success: true,
      });

      return { ...result, selection };
    } catch (error) {
      this.routingHistory.push({
        timestamp: Date.now(),
        taskType: strategy.taskType,
        selected: selection,
        success: false,
      });

      // 如果失败，尝试回退到其他提供商
      if (this.configs.size > 1) {
        logger.warn('ModelRouter', `Provider ${selection.provider} failed, trying fallback`);
        return this.fallbackChat(messages, strategy, selection.provider, tools, options);
      }

      throw error;
    }
  }

  /**
   * 流式对话（自动路由）
   */
  async chatStream(
    messages: ConversationMessage[],
    strategy: RoutingStrategy,
    callbacks?: { onChunk?: (chunk: string) => void },
    tools?: any[],
    options?: { maxTokens?: number }
  ): Promise<{ content: string; tool_calls?: any[]; selection: ModelSelection }> {
    const selection = this.selectModel(strategy);
    const provider = this.getProvider(selection.provider);

    try {
      const result = await provider.chatStream(messages, tools, callbacks);
      
      this.routingHistory.push({
        timestamp: Date.now(),
        taskType: strategy.taskType,
        selected: selection,
        success: true,
      });

      return { ...result, selection };
    } catch (error) {
      this.routingHistory.push({
        timestamp: Date.now(),
        taskType: strategy.taskType,
        selected: selection,
        success: false,
      });

      if (this.configs.size > 1) {
        logger.warn('ModelRouter', `Provider ${selection.provider} failed, trying fallback`);
        return this.fallbackChat(messages, strategy, selection.provider, tools, options);
      }

      throw error;
    }
  }

  /**
   * 回退聊天
   */
  private async fallbackChat(
    messages: ConversationMessage[],
    strategy: RoutingStrategy,
    failedProvider: LLMProvider,
    tools?: any[],
    options?: { maxTokens?: number }
  ): Promise<{ content: string; tool_calls?: any[]; selection: ModelSelection }> {
    // 选择另一个提供商
    for (const [provider, config] of this.configs) {
      if (provider !== failedProvider) {
        try {
          const p = this.getProvider(provider);
          const result = await p.chat(messages, tools, options);
          
          const selection: ModelSelection = {
            provider,
            model: config.model,
            reason: `Fallback after ${failedProvider} failed`,
            estimatedCost: getModelCapabilities(provider, config.model).cost,
          };

          return { ...result, selection };
        } catch {
          continue;
        }
      }
    }

    throw new Error('All providers failed');
  }

  /**
   * 快速聊天（使用默认提供商）
   */
  async quickChat(
    messages: ConversationMessage[],
    tools?: any[],
    options?: { maxTokens?: number }
  ): Promise<{ content: string; tool_calls?: any[] }> {
    if (!this.defaultProvider) {
      throw new Error('No default provider configured');
    }

    const provider = this.getProvider(this.defaultProvider);
    return provider.chat(messages, tools, options);
  }

  /**
   * 获取路由统计
   */
  getStats(): {
    totalRequests: number;
    successRate: number;
    providerUsage: Record<LLMProvider, number>;
    averageCost: 'low' | 'medium' | 'high';
  } {
    const total = this.routingHistory.length;
    if (total === 0) {
      return {
        totalRequests: 0,
        successRate: 0,
        providerUsage: {} as Record<LLMProvider, number>,
        averageCost: 'low',
      };
    }

    const successful = this.routingHistory.filter(h => h.success).length;
    
    const providerUsage: Record<string, number> = {};
    for (const entry of this.routingHistory) {
      const key = entry.selected.provider;
      providerUsage[key] = (providerUsage[key] || 0) + 1;
    }

    // 计算平均成本
    const costScores = this.routingHistory.map(h => {
      switch (h.selected.estimatedCost) {
        case 'low': return 1;
        case 'medium': return 2;
        case 'high': return 3;
      }
    });
    const avgCost = costScores.reduce((a, b) => a + b, 0) / costScores.length;

    return {
      totalRequests: total,
      successRate: successful / total,
      providerUsage: providerUsage as Record<LLMProvider, number>,
      averageCost: avgCost < 1.5 ? 'low' : avgCost < 2.5 ? 'medium' : 'high',
    };
  }

  /**
   * 获取可用提供商列表
   */
  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.configs.keys());
  }

  /**
   * 获取支持的模型
   */
  getSupportedModels(provider: LLMProvider): string[] {
    return SUPPORTED_MODELS[provider] || [];
  }

  /**
   * 清除历史
   */
  clearHistory(): void {
    this.routingHistory = [];
  }
}

// 单例导出
export const modelRouter = new ModelRouter();
