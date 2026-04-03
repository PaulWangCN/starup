import axios from 'axios';
import { LLMConfig, ConversationMessage } from '../../types';
import { logger } from '../../utils/Logger';

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
    tools?: any[],
    options?: { maxTokens?: number }
  ): Promise<{
    content: string;
    tool_calls?: any[];
  }> {
    switch (this.config.provider) {
      case 'deepseek':
        return this.callDeepSeek(messages, tools, options);
      case 'openai':
        return this.callOpenAI(messages, tools, options);
      case 'ollama':
        return this.callOllama(messages, tools, options);
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
      case 'ollama':
        return this.callOllamaStream(messages, tools, callbacks);
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }

  /**
   * 调用 DeepSeek API（非流式）
   */
  private async callDeepSeek(
    messages: ConversationMessage[],
    tools?: any[],
    options?: { maxTokens?: number }
  ): Promise<{ content: string; tool_calls?: any[] }> {
    const url = this.config.baseUrl || 'https://api.deepseek.com/v1/chat/completions';

    const payload = this.buildPayload(messages, tools, options);

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
      const errorDetail = error.response?.data 
        ? JSON.stringify(error.response.data, null, 2) 
        : error.message;
      logger.error('LLMService', `DeepSeek API error: ${errorDetail}`);
      throw new Error(`DeepSeek API error: ${errorDetail}`);
    }
  }

  /**
   * 调用 OpenAI API（非流式）
   */
  private async callOpenAI(
    messages: ConversationMessage[],
    tools?: any[],
    options?: { maxTokens?: number }
  ): Promise<{ content: string; tool_calls?: any[] }> {
    const url = this.config.baseUrl || 'https://api.openai.com/v1/chat/completions';

    const payload = this.buildPayload(messages, tools, options);

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
      const errorDetail = error.response?.data 
        ? JSON.stringify(error.response.data, null, 2) 
        : error.message;
      logger.error('LLMService', `OpenAI API error: ${errorDetail}`);
      throw new Error(`OpenAI API error: ${errorDetail}`);
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
    const payload = this.buildPayload(messages, tools);
    payload.stream = true;

    return this.parseSSEStream(url, payload, callbacks);
  }

  /**
   * 构建请求体
   */
  private buildPayload(
    messages: ConversationMessage[],
    tools?: any[],
    options?: { maxTokens?: number }
  ): any {
    const payload: any = {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
      })),
      temperature: this.config.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    return payload;
  }

  /**
   * 调用 Ollama API（非流式）
   */
  private async callOllama(
    messages: ConversationMessage[],
    tools?: any[],
    options?: { maxTokens?: number }
  ): Promise<{ content: string; tool_calls?: any[] }> {
    const url = this.getOllamaUrl();

    const payload = {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      options: {
        temperature: this.config.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      },
    };

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: parseInt(process.env.OLLAMA_TIMEOUT || '600000', 10),
      });

      return {
        content: response.data.message?.content || '',
      };
    } catch (error: any) {
      const errorDetail = error.response?.data
        ? (typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data))
        : error.message;
      logger.error('LLMService', `Ollama API error: ${errorDetail}`);
      throw new Error(`Ollama API error: ${errorDetail}`);
    }
  }

  /**
   * 调用 Ollama API（流式）
   */
  private async callOllamaStream(
    messages: ConversationMessage[],
    tools?: any[],
    callbacks?: { onChunk?: (chunk: string) => void }
  ): Promise<{ content: string; tool_calls?: any[] }> {
    const url = this.getOllamaUrl();
    const payload = {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      options: {
        temperature: this.config.temperature ?? 0.7,
        num_predict: this.config.maxTokens ?? 4096,
      },
    };

    const TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT || '600000', 10);

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
        timeout: TIMEOUT_MS,
      });

      const stream = response.data as NodeJS.ReadableStream;
      let content = '';
      let isCompleted = false;

      return new Promise((resolve, reject) => {
        const timeoutTimer = setTimeout(() => {
          if (!isCompleted) {
            isCompleted = true;
            reject(new Error(`Stream timeout after ${TIMEOUT_MS}ms`));
          }
        }, TIMEOUT_MS);

        stream.on('data', (chunk: Buffer) => {
          const lines = chunk.toString('utf-8').split('\n');
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
              const parsed = JSON.parse(line);
              if (parsed.message?.content) {
                content += parsed.message.content;
                callbacks?.onChunk?.(parsed.message.content);
              }
              if (parsed.done) {
                if (!isCompleted) {
                  isCompleted = true;
                  clearTimeout(timeoutTimer);
                  resolve({ content });
                }
              }
            } catch {
              // 忽略无法解析的行
            }
          }
        });

        stream.on('end', () => {
          if (!isCompleted) {
            isCompleted = true;
            clearTimeout(timeoutTimer);
            resolve({ content });
          }
        });

        stream.on('error', (err: Error) => {
          if (!isCompleted) {
            isCompleted = true;
            clearTimeout(timeoutTimer);
            reject(new Error(`Stream error: ${err.message}`));
          }
        });
      });
    } catch (error: any) {
      const errorDetail = error.response?.data
        ? (typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data))
        : error.message;
      logger.error('LLMService', `Ollama Stream API error: ${errorDetail}`);
      throw new Error(`Ollama Stream API error: ${errorDetail}`);
    }
  }

  /**
   * 获取 Ollama API URL
   * 自动处理 baseUrl 格式
   */
  private getOllamaUrl(): string {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    // 如果已经包含 /api/chat，直接使用
    if (baseUrl.endsWith('/api/chat')) {
      return baseUrl;
    }
    // 去除尾部斜杠，添加 /api/chat
    return baseUrl.replace(/\/$/, '') + '/api/chat';
  }

  /**
   * 通用 SSE 流解析
   */
  private async parseSSEStream(
    url: string,
    payload: any,
    callbacks?: { onChunk?: (chunk: string) => void }
  ): Promise<{ content: string; tool_calls?: any[] }> {
    const TIMEOUT_MS = 120000; // 2分钟超时
    
    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        responseType: 'stream',
        timeout: TIMEOUT_MS,
      });

      const stream = response.data as NodeJS.ReadableStream;
      let buffer = '';
      let content = '';
      const toolCallsBuffer: any[] = [];
      let isCompleted = false;

      return new Promise((resolve, reject) => {
        // 设置超时
        const timeoutTimer = setTimeout(() => {
          if (!isCompleted) {
            isCompleted = true;
            reject(new Error(`Stream timeout after ${TIMEOUT_MS}ms`));
          }
        }, TIMEOUT_MS);

        stream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              // 收到结束信号，立即完成
              if (!isCompleted) {
                isCompleted = true;
                clearTimeout(timeoutTimer);
                const tool_calls = toolCallsBuffer.length > 0 ? toolCallsBuffer : undefined;
                resolve({ content, tool_calls });
              }
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
          if (!isCompleted) {
            isCompleted = true;
            clearTimeout(timeoutTimer);
            const tool_calls = toolCallsBuffer.length > 0 ? toolCallsBuffer : undefined;
            resolve({ content, tool_calls });
          }
        });

        stream.on('error', (err: Error) => {
          if (!isCompleted) {
            isCompleted = true;
            clearTimeout(timeoutTimer);
            reject(new Error(`Stream error: ${err.message}`));
          }
        });
      });
    } catch (error: any) {
      const errorDetail = error.response?.data 
        ? JSON.stringify(error.response.data, null, 2) 
        : error.message;
      logger.error('LLMService', `Stream API error: ${errorDetail}`);
      throw new Error(`Stream API error: ${errorDetail}`);
    }
  }
}
