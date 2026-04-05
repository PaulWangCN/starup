/**
 * 对话观察器
 * 
 * 监听用户和 AI 的对话，自动提取有价值的观察
 * 将观察发送到 AutoDream 进行整合
 */

import { logger } from '../../utils/Logger';
import { AutoDream, Observation } from './AutoDream';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  sessionId?: string;
  toolCalls?: Array<{
    name: string;
    arguments: any;
  }>;
}

export interface ObservationRule {
  name: string;
  pattern: RegExp;
  confidence: number;
  topics: string[];
  extractor: (match: RegExpMatchArray, content: string) => string | null;
}

/**
 * 对话观察器
 */
export class ConversationObserver {
  private autoDream: AutoDream;
  private sessionId: string;
  private rules: ObservationRule[];
  private recentMessages: ConversationMessage[] = [];
  private readonly MAX_RECENT = 10;
  
  // 配置
  private config: {
    minContentLength: number;
    maxObservationsPerMessage: number;
    enableUserPreferenceExtraction: boolean;
    enableErrorLearning: boolean;
  };

  constructor(
    autoDream: AutoDream,
    sessionId: string,
    customRules?: ObservationRule[]
  ) {
    this.autoDream = autoDream;
    this.sessionId = sessionId;
    
    this.config = {
      minContentLength: 20,
      maxObservationsPerMessage: 3,
      enableUserPreferenceExtraction: true,
      enableErrorLearning: true
    };
    
    // 默认规则 + 自定义规则
    this.rules = [
      ...this.getDefaultRules(),
      ...(customRules || [])
    ];
  }

  /**
   * 获取默认观察规则
   */
  private getDefaultRules(): ObservationRule[] {
    return [
      // 用户偏好规则
      {
        name: 'user_preference',
        pattern: /(?:我喜欢|我偏好|我习惯|我希望|请(?:记住|记得)|不要|禁止|必须)(.+?)(?:[。.]|$)/i,
        confidence: 0.85,
        topics: ['user', 'preference'],
        extractor: (match) => {
          const content = match[1]?.trim();
          if (!content || content.length < 3) return null;
          return `用户偏好: ${content}`;
        }
      },
      
      // 错误学习规则
      {
        name: 'error_correction',
        pattern: /(?:错了|不对|应该是|纠正一下|实际上)(.+?)(?:[。.]|$)/i,
        confidence: 0.9,
        topics: ['learning', 'correction'],
        extractor: (match, fullContent) => {
          const correction = match[1]?.trim();
          if (!correction) return null;
          return `修正: ${correction} (原内容: ${fullContent.substring(0, 100)}...)`;
        }
      },
      
      // 重要信息规则
      {
        name: 'important_info',
        pattern: /(?:重要|关键|注意|请记住|务必)(.+?)(?:[。.]|$)/i,
        confidence: 0.8,
        topics: ['important', 'key'],
        extractor: (match) => {
          const info = match[1]?.trim();
          if (!info || info.length < 5) return null;
          return `重要信息: ${info}`;
        }
      },
      
      // 项目信息规则
      {
        name: 'project_info',
        pattern: /(?:项目名称|技术栈|使用|框架|数据库)(.+?)(?:[。.]|$)/i,
        confidence: 0.75,
        topics: ['project', 'tech'],
        extractor: (match) => {
          const info = match[1]?.trim();
          if (!info || info.length < 3) return null;
          return `项目信息: ${info}`;
        }
      },
      
      // 约束规则
      {
        name: 'constraint',
        pattern: /(?:限制|约束|不能超过|必须在|范围)(.+?)(?:[。.]|$)/i,
        confidence: 0.8,
        topics: ['constraint', 'rule'],
        extractor: (match) => {
          const constraint = match[1]?.trim();
          if (!constraint) return null;
          return `约束: ${constraint}`;
        }
      }
    ];
  }

  /**
   * 处理新消息
   */
  onMessage(message: ConversationMessage): void {
    // 保存到最近消息
    this.recentMessages.push(message);
    if (this.recentMessages.length > this.MAX_RECENT) {
      this.recentMessages.shift();
    }
    
    // 只处理用户和 AI 的消息
    if (message.role !== 'user' && message.role !== 'assistant') {
      return;
    }
    
    // 内容太短不处理
    if (!message.content || message.content.length < this.config.minContentLength) {
      return;
    }
    
    // 提取观察
    const observations = this.extractObservations(message);
    
    // 添加到 AutoDream
    for (const obs of observations) {
      this.autoDream.addObservation(obs);
    }
    
    if (observations.length > 0) {
      logger.debug('ConversationObserver', 
        `Extracted ${observations.length} observations from ${message.role} message`
      );
    }
  }

  /**
   * 批量处理消息
   */
  onMessages(messages: ConversationMessage[]): void {
    for (const msg of messages) {
      this.onMessage(msg);
    }
  }

  /**
   * 提取观察
   */
  private extractObservations(message: ConversationMessage): Omit<Observation, 'id'>[] {
    const observations: Omit<Observation, 'id'>[] = [];
    const content = message.content;
    
    // 应用所有规则
    for (const rule of this.rules) {
      // 重置正则
      rule.pattern.lastIndex = 0;
      
      let match;
      while ((match = rule.pattern.exec(content)) !== null) {
        const extracted = rule.extractor(match, content);
        if (extracted) {
          observations.push({
            timestamp: message.timestamp,
            content: extracted,
            source: `${message.role}:${rule.name}`,
            confidence: rule.confidence,
            topics: [...rule.topics],
            sessionId: this.sessionId
          });
          
          // 限制每个消息的最大观察数
          if (observations.length >= this.config.maxObservationsPerMessage) {
            return observations;
          }
        }
      }
    }
    
    // 上下文分析：如果是重要对话，提取摘要
    if (this.shouldExtractSummary(message)) {
      const summary = this.extractSummary(message);
      if (summary) {
        observations.push({
          timestamp: message.timestamp,
          content: `对话摘要: ${summary}`,
          source: `${message.role}:summary`,
          confidence: 0.6,
          topics: ['summary', 'context'],
          sessionId: this.sessionId
        });
      }
    }
    
    return observations;
  }

  /**
   * 是否应该提取摘要
   */
  private shouldExtractSummary(message: ConversationMessage): boolean {
    // 长消息可能包含重要信息
    if (message.content.length > 500) {
      return true;
    }
    
    // 包含特定关键词
    const keywords = ['总结', '结论', '决定', '方案', '计划'];
    return keywords.some(kw => message.content.includes(kw));
  }

  /**
   * 提取摘要
   */
  private extractSummary(message: ConversationMessage): string | null {
    // 简化实现：取前100字符
    const summary = message.content.substring(0, 100).replace(/\n/g, ' ');
    return summary.length > 50 ? summary + '...' : null;
  }

  /**
   * 手动添加观察（供外部调用）
   */
  addManualObservation(
    content: string,
    confidence: number = 0.9,
    topics: string[] = ['manual']
  ): void {
    this.autoDream.addObservation({
      timestamp: Date.now(),
      content,
      source: 'manual',
      confidence,
      topics,
      sessionId: this.sessionId
    });
    
    logger.debug('ConversationObserver', `Added manual observation: ${content.substring(0, 50)}...`);
  }

  /**
   * 记录工具调用（用于学习）
   */
  onToolCall(toolName: string, args: any, result: any): void {
    // 只记录失败的工具调用（用于错误学习）
    if (result && (result.error || result.success === false)) {
      this.autoDream.addObservation({
        timestamp: Date.now(),
        content: `工具调用失败: ${toolName}(${JSON.stringify(args)}) - 错误: ${result.error || 'unknown'}`,
        source: 'tool:error',
        confidence: 0.8,
        topics: ['tool', 'error', 'learning'],
        sessionId: this.sessionId
      });
    }
  }

  /**
   * 记录用户反馈
   */
  onFeedback(feedback: 'positive' | 'negative' | 'neutral', message: string): void {
    const confidence = feedback === 'positive' ? 0.9 : feedback === 'negative' ? 0.95 : 0.7;
    
    this.autoDream.addObservation({
      timestamp: Date.now(),
      content: `用户${feedback === 'positive' ? '满意' : feedback === 'negative' ? '不满' : '中性反馈'}: ${message}`,
      source: 'feedback',
      confidence,
      topics: ['feedback', feedback],
      sessionId: this.sessionId
    });
  }

  /**
   * 获取最近消息
   */
  getRecentMessages(): ConversationMessage[] {
    return [...this.recentMessages];
  }

  /**
   * 清空最近消息
   */
  clearRecentMessages(): void {
    this.recentMessages = [];
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: ObservationRule): void {
    this.rules.push(rule);
  }

  /**
   * 移除规则
   */
  removeRule(ruleName: string): boolean {
    const index = this.rules.findIndex(r => r.name === ruleName);
    if (index >= 0) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 获取统计
   */
  getStats(): {
    rulesCount: number;
    recentMessagesCount: number;
  } {
    return {
      rulesCount: this.rules.length,
      recentMessagesCount: this.recentMessages.length
    };
  }
}

export default ConversationObserver;
