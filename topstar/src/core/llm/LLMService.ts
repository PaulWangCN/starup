import axios from 'axios';
import { LLMConfig, ConversationMessage } from '../../types';

/**
 * LLM 服务
 * 封装与各大模型厂商的API交互
 */
export class LLMService {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 发送对话请求
   */
  async chat(
    messages: ConversationMessage[],
    tools?: any[]
  ): Promise<{
    content: string;
    tool_calls?: any[];
  }> {
    switch (this.config.provider) {
      case 'deepseek':
        return this.callDeepSeek(messages, tools);
      case 'openai':
        return this.callOpenAI(messages, tools);
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }

  /**
   * 调用 DeepSeek API
   */
  private async callDeepSeek(
    messages: ConversationMessage[],
    tools?: any[]
  ): Promise<{ content: string; tool_calls?: any[] }> {
    const url = this.config.baseUrl || 'https://api.deepseek.com/v1/chat/completions';
    
    const payload: any = {
      model: this.config.model || 'deepseek-chat',
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
      })),
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
    };

    // tools 已经是从 getToolDescriptions() 返回的 API 格式
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const choice = response.data.choices[0];
      return {
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls,
      };
    } catch (error: any) {
      console.error('[LLMService] DeepSeek API error:', error.response?.data || error.message);
      throw new Error(`DeepSeek API error: ${error.message}`);
    }
  }

  /**
   * 调用 OpenAI API
   */
  private async callOpenAI(
    messages: ConversationMessage[],
    tools?: any[]
  ): Promise<{ content: string; tool_calls?: any[] }> {
    const url = this.config.baseUrl || 'https://api.openai.com/v1/chat/completions';
    
    const payload: any = {
      model: this.config.model || 'gpt-4',
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
      })),
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
    };

    // tools 已经是从 getToolDescriptions() 返回的 API 格式
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const choice = response.data.choices[0];
      return {
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls,
      };
    } catch (error: any) {
      console.error('[LLMService] OpenAI API error:', error.response?.data || error.message);
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }

}
