import * as fs from 'fs/promises';
import * as path from 'path';
import { LLMService } from '../llm/LLMService';
import { SessionContext } from '../../types';
import { skillRegistry } from '../skills/SkillRegistry';

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
    priority: number;
  };
}

/**
 * 意图路由引擎（简化版）
 * 完全由 LLM 通过 Prompt 进行意图分类，不使用正则表达式。
 */
export class IntentRouter {
  private llmService: LLMService | null = null;

  setLLMService(llmService: LLMService): void {
    this.llmService = llmService;
  }

  /**
   * 识别用户消息的意图
   * 通过 LLM 分析，不使用正则。
   */
  async recognize(
    message: string,
    sessionContext: SessionContext
  ): Promise<IntentRecognition> {
    const startTime = Date.now();

    // 快速短路：系统命令（不使用正则）
    const lower = message.trim().toLowerCase();
    if (lower.startsWith('/') || ['重置', '清空记忆', '帮助', '状态'].some((k) => lower.includes(k))) {
      return {
        intent_id: 'system_cmd',
        confidence: 0.95,
        slots: {},
        routing: { target: 'main_session', priority: 10 },
      };
    }

    const prompt = `对用户消息分类，只输出JSON：
{"intent_id":"general_chat|use_skill|code_help|memory_query","confidence":0.0-1.0,"skill_hint":""}
规则：
- use_skill：搜索、查天气、翻译、画图、计算等需用skill完成的任务
- code_help：写代码、review、debug、解释代码
- memory_query：问之前聊过的内容
- general_chat：其他闲聊

用户消息："""${message}"""`;

    let result: IntentRecognition;

    if (this.llmService) {
      try {
        const response = await this.llmService.chat(
          [
            { role: 'system', content: '意图分类器', timestamp: Date.now() },
            { role: 'user', content: prompt, timestamp: Date.now() },
          ],
          []
        );
        const parsed = this.parseJSON(response.content);
        result = this.buildRecognition(parsed, message);
      } catch (error) {
        console.error('[IntentRouter] LLM classification failed:', error);
        result = this.fallbackRecognition(message);
      }
    } else {
      result = this.fallbackRecognition(message);
    }

    const latency = Date.now() - startTime;
    console.log(
      `[IntentRouter] Recognized: ${result.intent_id} ` +
      `(confidence: ${result.confidence.toFixed(2)}, ` +
      `latency: ${latency}ms)`
    );

    return result;
  }

  private parseJSON(content: string): any {
    try {
      const codeBlock = content.match(/```json\s*([\s\S]*?)```/);
      if (codeBlock) return JSON.parse(codeBlock[1].trim());
      return JSON.parse(content.trim());
    } catch {
      return {};
    }
  }

  private buildRecognition(parsed: any, message: string): IntentRecognition {
    const intentId = parsed.intent_id || 'general_chat';
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.8;
    const skillHint = parsed.skill_hint || '';

    const targetMap: Record<string, IntentRecognition['routing']['target']> = {
      general_chat: 'main_session',
      use_skill: 'skill',
      system_cmd: 'main_session',
      code_help: 'acp',
      memory_query: 'main_session',
    };

    return {
      intent_id: intentId,
      confidence,
      matched_skill: skillHint || undefined,
      slots: parsed.slots || {},
      routing: {
        target: targetMap[intentId] || 'main_session',
        priority: intentId === 'system_cmd' ? 10 : 5,
      },
    };
  }

  private fallbackRecognition(message: string): IntentRecognition {
    const lower = message.toLowerCase();
    let intentId = 'general_chat';
    let skillHint = '';

    if (
      lower.includes('搜索') ||
      lower.includes('查一下') ||
      lower.includes('查天气') ||
      lower.includes('翻译') ||
      lower.includes('画图')
    ) {
      intentId = 'use_skill';
      skillHint = 'fetch';
    } else if (
      lower.includes('写代码') ||
      lower.includes('review') ||
      lower.includes('debug')
    ) {
      intentId = 'code_help';
    } else if (
      lower.includes('还记得') ||
      lower.includes('之前说')
    ) {
      intentId = 'memory_query';
    }

    return {
      intent_id: intentId,
      confidence: 0.5,
      matched_skill: skillHint || undefined,
      slots: {},
      routing: {
        target: intentId === 'use_skill' ? 'skill' : intentId === 'code_help' ? 'acp' : 'main_session',
        priority: 3,
      },
    };
  }
}

export const intentRouter = new IntentRouter();
