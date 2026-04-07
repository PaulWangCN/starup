/**
 * 多 LLM 提供商支持
 * 支持 DeepSeek, OpenAI, Anthropic, Google, Alibaba, Moonshot, Baichuan, Ollama
 */

import axios from 'axios';
import { LLMConfig, ConversationMessage, LLMProvider } from '../../types';
import { logger, safeStringify } from '../../utils/Logger';

export interface LLMResponse {
  content: string;
  tool_calls?: any[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMStreamCallbacks {
  onChunk?: (chunk: string) => void;
}

/**
 * 基础 LLM 提供商接口
 */
export abstract class BaseLLMProvider {
  protected config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  abstract chat(messages: ConversationMessage[], tools?: any[], options?: { maxTokens?: number }): Promise<LLMResponse>;
  abstract chatStream(messages: ConversationMessage[], tools?: any[], callbacks?: LLMStreamCallbacks): Promise<LLMResponse>;

  /**
   * 提取精简的错误信息
   */
  protected extractErrorDetail(error: any): string {
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      
      let dataError = '';
      if (error.response.data) {
        if (typeof error.response.data === 'string') {
          dataError = error.response.data;
        } else if (error.response.data.error) {
          dataError = typeof error.response.data.error === 'string' 
            ? error.response.data.error 
            : error.response.data.error.message || safeStringify(error.response.data.error);
        } else if (error.response.data.message) {
          dataError = error.response.data.message;
        }
      }
      
      return dataError 
        ? `HTTP ${status} ${statusText}: ${dataError}`
        : `HTTP ${status} ${statusText}`;
    }
    
    return error.message || String(error);
  }

  /**
   * 构建请求体
   */
  protected buildPayload(messages: ConversationMessage[], tools?: any[], options?: { maxTokens?: number }): any {
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
}

/**
 * OpenAI 兼容格式的提供商
 * 支持 OpenAI, DeepSeek, Moonshot, Baichuan 等
 */
export class OpenAICompatibleProvider extends BaseLLMProvider {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: LLMConfig) {
    super(config);
    this.baseUrl = this.getBaseUrl();
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };
  }

  private getBaseUrl(): string {
    if (this.config.baseUrl) return this.config.baseUrl;

    switch (this.config.provider) {
      case 'openai':
        return 'https://api.openai.com/v1/chat/completions';
      case 'deepseek':
        return 'https://api.deepseek.com/v1/chat/completions';
      case 'moonshot':
        return 'https://api.moonshot.cn/v1/chat/completions';
      case 'baichuan':
        return 'https://api.baichuan-ai.com/v1/chat/completions';
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }

  async chat(messages: ConversationMessage[], tools?: any[], options?: { maxTokens?: number }): Promise<LLMResponse> {
    const payload = this.buildPayload(messages, tools, options);

    try {
      const response = await axios.post(this.baseUrl, payload, { headers: this.headers });
      const choice = response.data.choices[0];

      return {
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls,
        usage: response.data.usage,
      };
    } catch (error: any) {
      const errorDetail = this.extractErrorDetail(error);
      logger.error('LLM', `${this.config.provider} API error: ${errorDetail}`);
      throw new Error(`${this.config.provider} API error: ${errorDetail}`);
    }
  }

  async chatStream(messages: ConversationMessage[], tools?: any[], callbacks?: LLMStreamCallbacks): Promise<LLMResponse> {
    const payload = { ...this.buildPayload(messages, tools), stream: true };

    try {
      const response = await axios.post(this.baseUrl, payload, {
        headers: this.headers,
        responseType: 'stream',
        timeout: 120000,
      });

      return this.parseSSEStream(response.data as any, callbacks);
    } catch (error: any) {
      const errorDetail = this.extractErrorDetail(error);
      logger.error('LLM', `${this.config.provider} Stream API error: ${errorDetail}`);
      throw new Error(`${this.config.provider} Stream API error: ${errorDetail}`);
    }
  }

  private parseSSEStream(stream: any, callbacks?: LLMStreamCallbacks): Promise<LLMResponse> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      let content = '';
      const toolCallsBuffer: any[] = [];

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              content += delta.content;
              callbacks?.onChunk?.(delta.content);
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallsBuffer[idx]) {
                  toolCallsBuffer[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
                }
                if (tc.function?.name) toolCallsBuffer[idx].function.name += tc.function.name;
                if (tc.function?.arguments) toolCallsBuffer[idx].function.arguments += tc.function.arguments;
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      });

      stream.on('end', () => resolve({ content, tool_calls: toolCallsBuffer.length > 0 ? toolCallsBuffer : undefined }));
      stream.on('error', (err: Error) => reject(new Error(`Stream error: ${err.message}`)));
    });
  }
}

/**
 * Anthropic Claude 提供商
 */
export class AnthropicProvider extends BaseLLMProvider {
  private baseUrl = 'https://api.anthropic.com/v1/messages';

  async chat(messages: ConversationMessage[], tools?: any[], options?: { maxTokens?: number }): Promise<LLMResponse> {
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const payload: any = {
      model: this.config.model,
      messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0.7,
    };

    if (systemMessage) {
      payload.system = systemMessage.content;
    }

    try {
      const response = await axios.post(this.baseUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
      });

      return {
        content: response.data.content[0]?.text || '',
        usage: response.data.usage,
      };
    } catch (error: any) {
      const errorDetail = this.extractErrorDetail(error);
      logger.error('LLM', `Anthropic API error: ${errorDetail}`);
      throw new Error(`Anthropic API error: ${errorDetail}`);
    }
  }

  async chatStream(messages: ConversationMessage[], tools?: any[], callbacks?: LLMStreamCallbacks): Promise<LLMResponse> {
    // Claude 流式实现（简化版）
    return this.chat(messages, tools);
  }
}

/**
 * Google Gemini 提供商
 */
export class GoogleProvider extends BaseLLMProvider {
  async chat(messages: ConversationMessage[], tools?: any[], options?: { maxTokens?: number }): Promise<LLMResponse> {
    const apiKey = this.config.apiKey;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${apiKey}`;

    // 转换消息格式为 Gemini 格式
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const systemMessage = messages.find(m => m.role === 'system');

    const payload: any = {
      contents,
      generationConfig: {
        temperature: this.config.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      },
    };

    if (systemMessage) {
      payload.systemInstruction = { parts: [{ text: systemMessage.content }] };
    }

    try {
      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
      });

      return {
        content: response.data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      };
    } catch (error: any) {
      const errorDetail = this.extractErrorDetail(error);
      logger.error('LLM', `Google API error: ${errorDetail}`);
      throw new Error(`Google API error: ${errorDetail}`);
    }
  }

  async chatStream(messages: ConversationMessage[], tools?: any[], callbacks?: LLMStreamCallbacks): Promise<LLMResponse> {
    return this.chat(messages, tools);
  }
}

/**
 * Alibaba Qwen 提供商
 */
export class AlibabaProvider extends BaseLLMProvider {
  private baseUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

  async chat(messages: ConversationMessage[], tools?: any[], options?: { maxTokens?: number }): Promise<LLMResponse> {
    const payload = {
      model: this.config.model,
      input: {
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      },
      parameters: {
        temperature: this.config.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
        result_format: 'message',
      },
    };

    try {
      const response = await axios.post(this.baseUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      return {
        content: response.data.output?.choices?.[0]?.message?.content || '',
      };
    } catch (error: any) {
      const errorDetail = this.extractErrorDetail(error);
      logger.error('LLM', `Alibaba API error: ${errorDetail}`);
      throw new Error(`Alibaba API error: ${errorDetail}`);
    }
  }

  async chatStream(messages: ConversationMessage[], tools?: any[], callbacks?: LLMStreamCallbacks): Promise<LLMResponse> {
    return this.chat(messages, tools);
  }
}

/**
 * Ollama 本地模型提供商
 */
export class OllamaProvider extends BaseLLMProvider {
  private baseUrl: string;

  constructor(config: LLMConfig) {
    super(config);
    const url = this.config.baseUrl || 'http://localhost:11434';
    this.baseUrl = url.endsWith('/api/chat') ? url : url.replace(/\/$/, '') + '/api/chat';
  }

  async chat(messages: ConversationMessage[], tools?: any[], options?: { maxTokens?: number }): Promise<LLMResponse> {
    const payload = {
      model: this.config.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        temperature: this.config.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      },
    };

    try {
      const response = await axios.post(this.baseUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 600000,
      });

      return {
        content: response.data.message?.content || '',
      };
    } catch (error: any) {
      const errorDetail = error.response?.data || error.message;
      logger.error('LLM', `Ollama API error: ${errorDetail}`);
      throw new Error(`Ollama API error: ${errorDetail}`);
    }
  }

  async chatStream(messages: ConversationMessage[], tools?: any[], callbacks?: LLMStreamCallbacks): Promise<LLMResponse> {
    const payload = {
      model: this.config.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      options: {
        temperature: this.config.temperature ?? 0.7,
        num_predict: this.config.maxTokens ?? 4096,
      },
    };

    try {
      const response = await axios.post(this.baseUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        responseType: 'stream',
        timeout: 600000,
      });

      return this.parseOllamaStream(response.data as any, callbacks);
    } catch (error: any) {
      const errorDetail = error.response?.data || error.message;
      logger.error('LLM', `Ollama Stream API error: ${errorDetail}`);
      throw new Error(`Ollama Stream API error: ${errorDetail}`);
    }
  }

  private parseOllamaStream(stream: any, callbacks?: LLMStreamCallbacks): Promise<LLMResponse> {
    return new Promise((resolve, reject) => {
      let content = '';

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
              resolve({ content });
            }
          } catch {
            // 忽略解析错误
          }
        }
      });

      stream.on('end', () => resolve({ content }));
      stream.on('error', (err: Error) => reject(new Error(`Stream error: ${err.message}`)));
    });
  }
}

/**
 * LLM 提供商工厂
 */
export function createLLMProvider(config: LLMConfig): BaseLLMProvider {
  switch (config.provider) {
    case 'openai':
    case 'deepseek':
    case 'moonshot':
    case 'baichuan':
      return new OpenAICompatibleProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'google':
      return new GoogleProvider(config);
    case 'alibaba':
      return new AlibabaProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}

/**
 * 支持的模型列表
 */
export const SUPPORTED_MODELS: Record<LLMProvider, string[]> = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  google: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'],
  alibaba: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-coder-plus'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  baichuan: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k', 'Baichuan2-Turbo'],
  ollama: ['llama3.2', 'llama3.1', 'qwen2.5', 'deepseek-coder-v2', 'codellama'],
};

/**
 * 模型能力评估
 */
export function getModelCapabilities(provider: LLMProvider, model: string): {
  coding: number; // 0-10
  reasoning: number;
  contextWindow: number;
  cost: 'low' | 'medium' | 'high';
} {
  const capabilities: Record<string, { coding: number; reasoning: number; contextWindow: number; cost: 'low' | 'medium' | 'high' }> = {
    'gpt-4o': { coding: 9, reasoning: 9, contextWindow: 128000, cost: 'high' },
    'gpt-4o-mini': { coding: 7, reasoning: 7, contextWindow: 128000, cost: 'low' },
    'claude-3-5-sonnet-20241022': { coding: 10, reasoning: 9, contextWindow: 200000, cost: 'medium' },
    'deepseek-chat': { coding: 7, reasoning: 7, contextWindow: 64000, cost: 'low' },
    'deepseek-reasoner': { coding: 8, reasoning: 9, contextWindow: 64000, cost: 'low' },
    'gemini-1.5-pro': { coding: 8, reasoning: 8, contextWindow: 2000000, cost: 'medium' },
    'qwen-coder-plus': { coding: 9, reasoning: 7, contextWindow: 128000, cost: 'low' },
  };

  return capabilities[model] || { coding: 7, reasoning: 7, contextWindow: 64000, cost: 'low' };
}
