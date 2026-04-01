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
   * 发送对话请求（非流式）
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
   * 发送对话请求（SSE 流式）
   */
  async chatStream(
    messages: ConversationMessage[],
    tools?: any[],
    callbacks?: {
      onChunk?: (chunk: string) => void;
    }
  ): Promise<{ content: string; tool_calls?: any[] }> {
    switch (this.config.provider) {
      case 'deepseek':
        return this.callDeepSeekStream(messages, tools, callbacks);
      case 'openai':
        return this.callOpenAIStream(messages, tools, callbacks);
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }

  /**
   * 调用 DeepSeek API（非流式）
   */
  private async callDeepSeek(
    messages: ConversationMessage[],
    tools?: any[]
  ): Promise<{ content: string; tool_calls?: any[] }> {
    const url = this.config.baseUrl || 'https://api.deepseek.com/v1/chat/completions';

    const payload = this.buildPayload(messages, tools);

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
   * 调用 OpenAI API（非流式）
   */
  private async callOpenAI(
    messages: ConversationMessage[],
    tools?: any[]
  ): Promise<{ content: string; tool_calls?: any[] }> {
    const url = this.config.baseUrl || 'https://api.openai.com/v1/chat/completions';

    const payload = this.buildPayload(messages, tools, 'gpt-4');

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

  /**
   * 调用 DeepSeek API（流式）
   */
  private async callDeepSeekStream(
    messages: ConversationMessage[],
    tools?: any[],
    callbacks?: { onChunk?: (chunk: string) => void }
  ): Promise<{ content: string; tool_calls?: any[] }> {
    const url = this.config.baseUrl || 'https://api.deepseek.com/v1/chat/completions';
    const payload = this.buildPayload(messages, tools);
    payload.stream = true;

    return this.parseSSEStream(url, payload, callbacks);
  }

  /**
   * 调用 OpenAI API（流式）
   */
  private async callOpenAIStream(
    messages: ConversationMessage[],
    tools?: any[],
    callbacks?: { onChunk?: (chunk: string) => void }
  ): Promise<{ content: string; tool_calls?: any[] }> {
    const url = this.config.baseUrl || 'https://api.openai.com/v1/chat/completions';
    const payload = this.buildPayload(messages, tools, 'gpt-4');
    payload.stream = true;

    return this.parseSSEStream(url, payload, callbacks);
  }

  /**
   * 构建请求体
   */
  private buildPayload(
    messages: ConversationMessage[],
    tools?: any[],
    defaultModel?: string
  ): any {
    const payload: any = {
      model: this.config.model || defaultModel || 'deepseek-chat',
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
      })),
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    return payload;
  }

  /**
   * 通用 SSE 流解析
   */
  private async parseSSEStream(
    url: string,
    payload: any,
    callbacks?: { onChunk?: (chunk: string) => void }
  ): Promise<{ content: string; tool_calls?: any[] }> {
    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        responseType: 'stream',
      });

      const stream = response.data as NodeJS.ReadableStream;
      let buffer = '';
      let content = '';
      const toolCallsBuffer: any[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;

              if (delta.content) {
                content += delta.content;
                callbacks?.onChunk?.(delta.content);
              }

              if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCallsBuffer[idx]) {
                    toolCallsBuffer[idx] = {
                      id: tc.id || '',
                      type: tc.type || 'function',
                      function: { name: '', arguments: '' },
                    };
                  }
                  if (tc.function?.name) {
                    toolCallsBuffer[idx].function.name += tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    toolCallsBuffer[idx].function.arguments += tc.function.arguments;
                  }
                  if (tc.id && !toolCallsBuffer[idx].id) {
                    toolCallsBuffer[idx].id = tc.id;
                  }
                  if (tc.type && !toolCallsBuffer[idx].type) {
                    toolCallsBuffer[idx].type = tc.type;
                  }
                }
              }
            } catch {
              // 忽略无法解析的 SSE 行
            }
          }
        });

        stream.on('end', () => {
          const tool_calls = toolCallsBuffer.length > 0 ? toolCallsBuffer : undefined;
          resolve({ content, tool_calls });
        });

        stream.on('error', (err: Error) => {
          reject(new Error(`Stream error: ${err.message}`));
        });
      });
    } catch (error: any) {
      console.error('[LLMService] Stream API error:', error.response?.data || error.message);
      throw new Error(`Stream API error: ${error.message}`);
    }
  }
}
