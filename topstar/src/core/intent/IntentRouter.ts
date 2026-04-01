import * as fs from 'fs/promises';
import * as path from 'path';
import { Session } from '../../types';
import { calculateSimilarity, extractKeywords, extractSlots } from './IntentUtils';

/**
 * 会话上下文
 * 用于意图识别的上下文信息
 */
export interface SessionContext {
  session: Session;
  recentMessages: string[];
  userPreferences: Record<string, any>;
}

/**
 * 意图识别结果
 */
export interface IntentRecognition {
  intent_id: string;
  confidence: number;
  matched_skill?: string;
  slots: Record<string, any>;
  routing: {
    target: 'main_session' | 'skill' | 'sub_agent' | 'acp';
    model?: string;
    priority: number;
  };
  fallback_action?: 'ask_clarify' | 'general_chat';
}

/**
 * 意图模式定义
 */
export interface IntentPattern {
  id: string;
  patterns: (string | RegExp)[];  // 正则或关键词
  examples: string[];
  confidence_boost: number;
  target: 'main_session' | 'skill' | 'sub_agent' | 'acp';
  priority: number;
  model?: string;
}

/**
 * Skill 意图定义
 */
export interface SkillIntentDef {
  intents: {
    id: string;
    description: string;
    examples: string[];
    slots?: { 
      name: string; 
      type: string; 
      required: boolean; 
      extractor: 'llm' | 'regex';
      pattern?: string;
    }[];
  }[];
  fallback_patterns?: { 
    pattern: string; 
    intent: string; 
    confidence_boost: number;
  }[];
}

/**
 * Skill 意图注册信息
 */
interface SkillIntentInfo {
  skillId: string;
  intentDef: SkillIntentDef;
}

/**
 * 意图路由引擎
 * 双层意图识别架构的网关层实现
 */
export class IntentRouter {
  private intentPatterns: Map<string, IntentPattern> = new Map();
  private skillIntents: Map<string, SkillIntentInfo> = new Map();
  private skillKeywords: Map<string, { skillId: string; weight: number }[]> = new Map();

  // 置信度阈值配置
  private readonly CONFIDENCE_THRESHOLD_HIGH = 0.8;
  private readonly CONFIDENCE_THRESHOLD_LOW = 0.5;

  constructor() {
    this.registerBuiltInIntents();
  }

  /**
   * 识别用户消息的意图
   * @param message 用户消息
   * @param sessionContext 会话上下文
   * @param options 识别选项
   * @returns 意图识别结果
   */
  async recognize(
    message: string,
    sessionContext: SessionContext,
    options?: { fast_mode?: boolean; allowed_intents?: string[] }
  ): Promise<IntentRecognition> {
    const startTime = Date.now();
    const fastMode = options?.fast_mode ?? true;
    const allowedIntents = options?.allowed_intents;

    // 1. 首先尝试规则匹配（快速路径）
    const ruleResult = this.matchRuleBased(message, allowedIntents);
    if (ruleResult && ruleResult.confidence >= this.CONFIDENCE_THRESHOLD_HIGH) {
      this.logRecognition(message, ruleResult, startTime);
      return ruleResult;
    }

    // 2. 检查是否匹配到Skill（非快速模式下进行更深层的匹配）
    if (!fastMode) {
      const skillResult = await this.matchSkillIntent(message, sessionContext);
      if (skillResult && skillResult.confidence > (ruleResult?.confidence || 0)) {
        this.logRecognition(message, skillResult, startTime);
        return skillResult;
      }
    } else {
      // 快速模式：简单的关键词匹配Skill
      const fastSkillResult = this.fastMatchSkill(message);
      if (fastSkillResult && fastSkillResult.confidence > (ruleResult?.confidence || 0)) {
        this.logRecognition(message, fastSkillResult, startTime);
        return fastSkillResult;
      }
    }

    // 3. 使用规则匹配的中等置信度结果
    if (ruleResult && ruleResult.confidence >= this.CONFIDENCE_THRESHOLD_LOW) {
      this.logRecognition(message, ruleResult, startTime);
      return ruleResult;
    }

    // 4. 低置信度，返回回退处理
    const fallbackResult: IntentRecognition = {
      intent_id: ruleResult?.intent_id || 'chit_chat',
      confidence: ruleResult?.confidence || 0.3,
      slots: {},
      routing: {
        target: 'main_session',
        priority: 1,
      },
      fallback_action: ruleResult ? 'ask_clarify' : 'general_chat',
    };

    this.logRecognition(message, fallbackResult, startTime);
    return fallbackResult;
  }

  /**
   * 注册 Skill 的意图定义
   * @param skillId Skill ID
   * @param intentDef 意图定义
   */
  registerSkillIntent(skillId: string, intentDef: SkillIntentDef): void {
    this.skillIntents.set(skillId, { skillId, intentDef });

    // 建立关键词索引
    for (const intent of intentDef.intents) {
      for (const example of intent.examples) {
        const keywords = extractKeywords(example, 3);
        for (const keyword of keywords) {
          if (!this.skillKeywords.has(keyword)) {
            this.skillKeywords.set(keyword, []);
          }
          const entries = this.skillKeywords.get(keyword)!;
          if (!entries.find(e => e.skillId === skillId)) {
            entries.push({ skillId, weight: 1.0 });
          }
        }
      }
    }

    console.log(`[IntentRouter] Registered skill intent: ${skillId}`);
  }

  /**
   * 从 INTENT.md 文件加载 Skill 意图定义
   * @param skillId Skill ID
   * @param intentFilePath INTENT.md 文件路径
   */
  async loadSkillIntentFromFile(skillId: string, intentFilePath: string): Promise<void> {
    try {
      const content = await fs.readFile(intentFilePath, 'utf-8');
      const intentDef = this.parseIntentMarkdown(content);
      this.registerSkillIntent(skillId, intentDef);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[IntentRouter] Error loading intent file for ${skillId}:`, error);
      }
    }
  }

  /**
   * 解析 INTENT.md 内容
   * @param content Markdown 内容
   * @returns Skill 意图定义
   */
  private parseIntentMarkdown(content: string): SkillIntentDef {
    const intentDef: SkillIntentDef = {
      intents: [],
      fallback_patterns: [],
    };

    // 解析意图定义部分
    const intentSection = content.match(/##\s*意图定义\s*([\s\S]*?)(?=##|$)/);
    if (intentSection) {
      const intentBlocks = intentSection[1].matchAll(/###\s*(\w+)\s*\n([\s\S]*?)(?=###|##|$)/g);
      for (const block of intentBlocks) {
        const intentId = block[1].trim();
        const intentContent = block[2];

        const description = intentContent.match(/\*\*描述\*\*:\s*(.+)/)?.[1] || '';
        const examplesMatch = intentContent.match(/\*\*示例\*\*:\s*([\s\S]*?)(?=\*\*|$)/);
        const examples = examplesMatch
          ? examplesMatch[1].split('\n').filter(s => s.trim().startsWith('-')).map(s => s.replace(/^-\s*/, '').trim())
          : [];

        const slots: SkillIntentDef['intents'][0]['slots'] = [];
        const slotsMatch = intentContent.match(/\*\*槽位\*\*:\s*([\s\S]*?)(?=\*\*|$)/);
        if (slotsMatch) {
          const slotLines = slotsMatch[1].split('\n').filter(s => s.trim().startsWith('-'));
          for (const line of slotLines) {
            const slotMatch = line.match(/-\s*(\w+)\s*\((\w+)\)\s*-\s*(\w+)(?:\s*-\s*extractor:\s*(\w+))?/);
            if (slotMatch) {
              slots.push({
                name: slotMatch[1],
                type: slotMatch[2],
                required: slotMatch[3] === 'required',
                extractor: (slotMatch[4] as 'llm' | 'regex') || 'llm',
              });
            }
          }
        }

        intentDef.intents.push({
          id: intentId,
          description,
          examples,
          slots: slots.length > 0 ? slots : undefined,
        });
      }
    }

    // 解析回退模式
    const fallbackSection = content.match(/##\s*回退模式\s*([\s\S]*?)(?=##|$)/);
    if (fallbackSection) {
      const patternLines = fallbackSection[1].split('\n').filter(s => s.trim().startsWith('-'));
      for (const line of patternLines) {
        const match = line.match(/-\s*pattern:\s*`(.+?)`\s*->\s*(\w+)(?:\s*\(\+(\d\.?\d*)\))?/);
        if (match) {
          intentDef.fallback_patterns!.push({
            pattern: match[1],
            intent: match[2],
            confidence_boost: parseFloat(match[3] || '0.1'),
          });
        }
      }
    }

    return intentDef;
  }

  /**
   * 内置意图规则匹配
   * @param message 用户消息
   * @param allowedIntents 允许的意图列表
   * @returns 意图识别结果或 null
   */
  private matchRuleBased(message: string, allowedIntents?: string[]): IntentRecognition | null {
    const messageLower = message.toLowerCase().trim();
    let bestMatch: IntentRecognition | null = null;
    let bestScore = 0;

    for (const [intentId, pattern] of this.intentPatterns) {
      // 如果指定了允许的意图，过滤其他意图
      if (allowedIntents && !allowedIntents.includes(intentId)) {
        continue;
      }

      const score = this.calculateConfidence(messageLower, pattern);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          intent_id: intentId,
          confidence: score,
          slots: this.extractSlotsFromMessage(message, pattern),
          routing: {
            target: pattern.target,
            model: pattern.model,
            priority: pattern.priority,
          },
        };
      }
    }

    return bestMatch;
  }

  /**
   * 计算消息与模式的匹配置信度
   * @param message 用户消息（小写）
   * @param pattern 意图模式
   * @returns 置信度分数 (0-1)
   */
  private calculateConfidence(message: string, pattern: IntentPattern): number {
    let maxScore = 0;

    for (const p of pattern.patterns) {
      let score = 0;

      if (typeof p === 'string') {
        // 关键词匹配
        if (message.includes(p.toLowerCase())) {
          score = 0.6 + (p.length / message.length) * 0.2;
        }
      } else {
        // 正则匹配
        const match = message.match(p);
        if (match) {
          score = 0.7 + (match[0].length / message.length) * 0.2;
          // 如果完全匹配，给予更高分数
          if (match[0].length === message.length) {
            score = 0.95;
          }
        }
      }

      maxScore = Math.max(maxScore, score);
    }

    // 应用置信度提升
    if (maxScore > 0) {
      maxScore = Math.min(1.0, maxScore + pattern.confidence_boost);
    }

    // 检查示例相似度
    for (const example of pattern.examples) {
      const similarity = calculateSimilarity(message, example.toLowerCase());
      if (similarity > 0.8) {
        maxScore = Math.max(maxScore, similarity * 0.9);
      }
    }

    return maxScore;
  }

  /**
   * 从消息中提取槽位
   * @param message 用户消息
   * @param pattern 意图模式
   * @returns 槽位键值对
   */
  private extractSlotsFromMessage(message: string, pattern: IntentPattern): Record<string, any> {
    const slots: Record<string, any> = {};

    for (const p of pattern.patterns) {
      if (p instanceof RegExp) {
        const match = message.match(p);
        if (match && match.groups) {
          Object.assign(slots, match.groups);
        }
      }
    }

    return slots;
  }

  /**
   * 匹配 Skill 意图（完整模式）
   * @param message 用户消息
   * @param sessionContext 会话上下文
   * @returns 意图识别结果或 null
   */
  private async matchSkillIntent(
    message: string,
    sessionContext: SessionContext
  ): Promise<IntentRecognition | null> {
    const messageLower = message.toLowerCase();
    const keywords = extractKeywords(messageLower);

    // 收集候选 Skills
    const candidateSkills = new Map<string, number>();
    for (const keyword of keywords) {
      const entries = this.skillKeywords.get(keyword);
      if (entries) {
        for (const entry of entries) {
          const current = candidateSkills.get(entry.skillId) || 0;
          candidateSkills.set(entry.skillId, current + entry.weight);
        }
      }
    }

    // 按得分排序
    const sortedSkills = Array.from(candidateSkills.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    let bestMatch: IntentRecognition | null = null;
    let bestScore = 0;

    for (const [skillId, score] of sortedSkills) {
      const skillInfo = this.skillIntents.get(skillId);
      if (!skillInfo) continue;

      // 计算与 Skill 意图的相似度
      for (const intent of skillInfo.intentDef.intents) {
        for (const example of intent.examples) {
          const similarity = calculateSimilarity(messageLower, example.toLowerCase());
          const totalScore = (similarity * 0.7 + score * 0.3) * 0.9;

          if (totalScore > bestScore && totalScore >= this.CONFIDENCE_THRESHOLD_LOW) {
            bestScore = totalScore;

            // 提取槽位
            const slots: Record<string, any> = {};
            if (intent.slots) {
              for (const slot of intent.slots) {
                const extracted = extractSlots(message, slot.type, slot.pattern);
                if (extracted) {
                  slots[slot.name] = extracted;
                }
              }
            }

            bestMatch = {
              intent_id: `skill_invoke`,
              confidence: totalScore,
              matched_skill: skillId,
              slots: {
                ...slots,
                skill_intent: intent.id,
              },
              routing: {
                target: 'skill',
                priority: 5,
              },
            };
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * 快速匹配 Skill（基于关键词）
   * @param message 用户消息
   * @returns 意图识别结果或 null
   */
  private fastMatchSkill(message: string): IntentRecognition | null {
    const messageLower = message.toLowerCase();
    const keywords = extractKeywords(messageLower, 5);

    let bestSkillId: string | null = null;
    let bestScore = 0;

    for (const [skillId, skillInfo] of this.skillIntents) {
      let score = 0;
      for (const intent of skillInfo.intentDef.intents) {
        for (const example of intent.examples) {
          const exampleKeywords = extractKeywords(example.toLowerCase(), 5);
          const commonKeywords = keywords.filter(k => exampleKeywords.includes(k));
          score = Math.max(score, commonKeywords.length / Math.max(keywords.length, exampleKeywords.length));
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestSkillId = skillId;
      }
    }

    if (bestSkillId && bestScore >= 0.3) {
      return {
        intent_id: 'skill_invoke',
        confidence: bestScore * 0.8,
        matched_skill: bestSkillId,
        slots: {},
        routing: {
          target: 'skill',
          priority: 5,
        },
      };
    }

    return null;
  }

  /**
   * 注册内置核心意图
   */
  private registerBuiltInIntents(): void {
    // 1. skill_invoke - 调用特定 Skill
    this.intentPatterns.set('skill_invoke', {
      id: 'skill_invoke',
      patterns: [
        /(?:生成|画|绘制|创建)(?:一个|一张)?(.+?)(?:图片|图像|照片)/,
        /(?:查|查询|看)(?:一下)?(.+?)(?:天气|温度)/,
        /(?:翻译|把|将)(.+?)(?:翻译|译成|译成|转成)(.+?)/,
        /(?:搜索|查找|找)(?:一下)?(.+?)/,
        /(?:计算|算|算是)(?:一下)?(.+?)/,
      ],
      examples: [
        '生成一张猫的图片',
        '查一下北京天气',
        '翻译 hello world 成中文',
        '搜索最新的AI新闻',
      ],
      confidence_boost: 0.1,
      target: 'skill',
      priority: 5,
    });

    // 2. memory_query - 查询历史记忆
    this.intentPatterns.set('memory_query', {
      id: 'memory_query',
      patterns: [
        /(?:还记得|记得)(?:我)?(?:之前|上次|刚才)(?:说|讲|问|提到|告诉你的)?/,
        /(?:之前|上次|刚才)(?:说|讲|问|提到)(?:过)?/,
        /(?:翻翻|找找|查)(?:一下)?(?:之前|历史|记录)/,
        /(?:我)(?:好像|记得)(?:之前|以前)(?:说|问)(?:过)?/,
      ],
      examples: [
        '还记得我之前说什么了吗',
        '刚才提到的那个方案',
        '翻翻之前的记录',
      ],
      confidence_boost: 0.15,
      target: 'main_session',
      priority: 4,
    });

    // 3. code_request - 代码生成/审查
    this.intentPatterns.set('code_request', {
      id: 'code_request',
      patterns: [
        /(?:写|创建|实现|编写)(?:一个|一段)?(?:函数|方法|类|代码|程序|脚本)/,
        /(?:review|审查|检查|看看)(?:一下)?(?:这段|这个)?(?:代码|程序|函数)/,
        /(?:优化|重构|改进)(?:一下)?(?:这段|这个)?(?:代码|程序|函数)/,
        /(?:debug|调试|修复)(?:一下)?(?:这段|这个)?(?:代码|bug|错误)/,
        /(?:解释|说明)(?:一下)?(?:这段|这个)?(?:代码|函数|算法)(?:怎么|如何)?(?:工作|运行|实现)/,
        /(?:写|创建)(?:一个|一段)?(?:用|使用)?(\w+)(?:语言|写的)?/,
      ],
      examples: [
        '写一个快速排序函数',
        'review一下这段代码',
        '用Python写一个爬虫',
        '优化这个算法',
        '解释这段代码的工作原理',
      ],
      confidence_boost: 0.1,
      target: 'acp',
      priority: 5,
      model: 'deepseek-coder',
    });

    // 4. chit_chat - 闲聊对话
    this.intentPatterns.set('chit_chat', {
      id: 'chit_chat',
      patterns: [
        /^(你好|您好|嗨|哈喽|hello|hi)$/i,
        /(?:今天|最近)(?:怎么样|如何|还好吗)/,
        /(?:谢谢|感谢|多谢)/,
        /(?:再见|拜拜|bye|goodbye)/i,
        /(?:早上好|下午好|晚上好)/,
        /(?:在吗|在不在|在不)/,
      ],
      examples: [
        '你好',
        '今天怎么样',
        '谢谢你',
        '再见',
        '在吗',
      ],
      confidence_boost: 0.05,
      target: 'main_session',
      priority: 1,
    });

    // 5. system_cmd - 系统命令
    this.intentPatterns.set('system_cmd', {
      id: 'system_cmd',
      patterns: [
        /^\/(reset|compact|clear|help|status|config)(?:\s+(.+))?$/,
        /^(重置|压缩|清空|帮助|状态|配置)(?:会话|记忆|上下文)?/,
      ],
      examples: [
        '/reset',
        '/compact',
        '/help',
        '重置会话',
        '清空记忆',
      ],
      confidence_boost: 0.2,
      target: 'main_session',
      priority: 10,
    });

    // 6. escalate - 转人工/复杂任务
    this.intentPatterns.set('escalate', {
      id: 'escalate',
      patterns: [
        /(?:帮我|帮我做|帮我完成|帮我实现)(?:一个|一套|整个|完整的)?(?:项目|系统|应用|网站|程序)/,
        /(?:需要|想要)(?:开发|搭建|构建|创建|设计)(?:一个|一套|整个|完整的)?(?:项目|系统|应用|网站|程序)/,
        /(?:太复杂了|太难了|我不会|搞不定)/,
        /(?:转人工|找人工|人工服务|人工客服)/,
      ],
      examples: [
        '帮我做一个完整的电商网站',
        '我需要开发一个APP',
        '这太复杂了，能不能找人工',
        '转人工服务',
      ],
      confidence_boost: 0.15,
      target: 'sub_agent',
      priority: 8,
    });

    console.log('[IntentRouter] Built-in intents registered');
  }

  /**
   * 记录识别日志
   */
  private logRecognition(
    message: string,
    result: IntentRecognition,
    startTime: number
  ): void {
    const latency = Date.now() - startTime;
    console.log(
      `[IntentRouter] Recognized: ${result.intent_id} ` +
      `(confidence: ${result.confidence.toFixed(2)}, ` +
      `target: ${result.routing.target}, ` +
      `latency: ${latency}ms)`
    );
  }

  /**
   * 获取所有注册的意图
   */
  getRegisteredIntents(): string[] {
    return Array.from(this.intentPatterns.keys());
  }

  /**
   * 获取 Skill 意图定义
   */
  getSkillIntent(skillId: string): SkillIntentInfo | undefined {
    return this.skillIntents.get(skillId);
  }
}

// 单例导出
export const intentRouter = new IntentRouter();
