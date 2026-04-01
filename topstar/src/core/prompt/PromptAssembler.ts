/**
 * StarUp AI 六层Prompt组装引擎
 * L1-L6 分层架构实现
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { ToolDefinition, Skill, ToolParameter } from '../../types';

// ==================== 类型定义 ====================

export interface RuntimeContext {
  timestamp: number;
  timezone: string;
  activeSessions: number;
  systemStatus: 'healthy' | 'degraded' | 'maintenance';
  memoryUsage: {
    used: number;
    total: number;
  };
  requestId: string;
}

export interface PromptLayerConfig {
  version: string;
  layers: {
    soul: { path: string; hash: string; readonly: boolean; };
    identity: { path: string; cache_ttl: number; };
    user_profile: { path: string; auto_update: boolean; };
  };
  compression: { threshold: number; strategy: 'summarize' | 'truncate' | 'hybrid'; };
}

export interface AssembledPrompt {
  version: string;
  content: string;
  tokenCount: number;
  layers: { [key: string]: boolean };
}

export interface ToolRegistryInterface {
  getAll(): ToolDefinition[];
  getToolDescriptions(): any[];
}

export interface SkillRegistryInterface {
  getAll(): Skill[];
  getSkillDescriptions(): { name: string; description: string }[];
}

// ==================== PromptAssembler 类 ====================

export class PromptAssembler {
  private config: PromptLayerConfig;
  private toolRegistry: ToolRegistryInterface;
  private skillRegistry: SkillRegistryInterface;
  private cache: Map<string, { content: string; timestamp: number }> = new Map();

  constructor(
    config: PromptLayerConfig,
    toolRegistry: ToolRegistryInterface,
    skillRegistry: SkillRegistryInterface
  ) {
    this.config = config;
    this.toolRegistry = toolRegistry;
    this.skillRegistry = skillRegistry;
  }

  /**
   * 组装完整的六层Prompt
   */
  async assemble(agentId: string, runtimeContext: RuntimeContext): Promise<AssembledPrompt> {
    const agentPath = this.getAgentPath(agentId);
    
    // 加载 L1-L3（文件层）
    const [layer1, layer2, layer3] = await Promise.all([
      this.loadLayer1(agentPath),
      this.loadLayer2(agentPath),
      this.loadLayer3(agentPath),
    ]);

    // 生成 L4-L6（动态层）
    const layer4 = this.generateLayer4(this.toolRegistry.getAll());
    const layer5 = this.generateLayer5(this.skillRegistry.getAll());
    const layer6 = this.generateLayer6(runtimeContext);

    // 组装完整Prompt
    const content = this.combineLayers([
      { name: 'L1_SOUL', content: layer1, required: true },
      { name: 'L2_IDENTITY', content: layer2, required: true },
      { name: 'L3_USER_PROFILE', content: layer3, required: false },
      { name: 'L4_TOOLS', content: layer4, required: true },
      { name: 'L5_SKILLS', content: layer5, required: true },
      { name: 'L6_RUNTIME', content: layer6, required: true },
    ]);

    let assembled: AssembledPrompt = {
      version: this.config.version,
      content,
      tokenCount: this.estimateTokens(content),
      layers: {
        L1_SOUL: !!layer1,
        L2_IDENTITY: !!layer2,
        L3_USER_PROFILE: !!layer3,
        L4_TOOLS: !!layer4,
        L5_SKILLS: !!layer5,
        L6_RUNTIME: !!layer6,
      },
    };

    // 如果需要，执行压缩
    if (assembled.tokenCount > this.config.compression.threshold) {
      assembled = this.compressIfNeeded(assembled);
    }

    return assembled;
  }

  /**
   * 获取Agent配置目录路径
   */
  private getAgentPath(agentId: string): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(homeDir, '.starup', 'agents', agentId);
  }

  /**
   * 加载 L1: 基础身份 (SOUL.md)
   * 核心人格、价值观、行为准则 - 需重启生效
   */
  private async loadLayer1(agentPath: string): Promise<string> {
    const soulPath = path.join(agentPath, 'SOUL.md');
    
    try {
      // 检查缓存
      const cached = this.cache.get('soul');
      if (cached && this.config.layers.soul.readonly) {
        return cached.content;
      }

      const content = await fs.readFile(soulPath, 'utf-8');
      
      // 计算hash验证完整性
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (this.config.layers.soul.hash && this.config.layers.soul.hash !== hash) {
        console.warn('[PromptAssembler] SOUL.md hash mismatch, using cached version');
        return cached?.content || content;
      }

      // 由于是readonly，缓存内容
      this.cache.set('soul', { content, timestamp: Date.now() });
      
      return this.wrapLayer('SOUL', content);
    } catch (error) {
      console.warn(`[PromptAssembler] Failed to load SOUL.md: ${error}`);
      // 返回默认SOUL
      return this.wrapLayer('SOUL', this.getDefaultSoul());
    }
  }

  /**
   * 加载 L2: 身份标识 (IDENTITY.md)
   * 名称、表情符号、版本号 - 实时更新
   */
  private async loadLayer2(agentPath: string): Promise<string> {
    const identityPath = path.join(agentPath, 'IDENTITY.md');
    const cacheTtl = this.config.layers.identity.cache_ttl * 1000; // 转换为毫秒
    
    try {
      // 检查缓存是否有效
      const cached = this.cache.get('identity');
      if (cached && Date.now() - cached.timestamp < cacheTtl) {
        return cached.content;
      }

      const content = await fs.readFile(identityPath, 'utf-8');
      this.cache.set('identity', { content, timestamp: Date.now() });
      
      return this.wrapLayer('IDENTITY', content);
    } catch (error) {
      console.warn(`[PromptAssembler] Failed to load IDENTITY.md: ${error}`);
      return this.wrapLayer('IDENTITY', this.getDefaultIdentity());
    }
  }

  /**
   * 加载 L3: 用户画像 (USER.md)
   * 用户偏好、历史记忆摘要 - 实时更新
   */
  private async loadLayer3(agentPath: string): Promise<string> {
    const userPath = path.join(agentPath, 'USER.md');
    
    try {
      // USER层通常每次请求都刷新
      const content = await fs.readFile(userPath, 'utf-8');
      
      if (this.config.layers.user_profile.auto_update) {
        this.cache.set('user_profile', { content, timestamp: Date.now() });
      }
      
      return this.wrapLayer('USER_PROFILE', content);
    } catch (error) {
      // L3是可选层，可以不存在
      return '';
    }
  }

  /**
   * 生成 L4: 工具定义
   * 可用工具JSON Schema定义
   */
  private generateLayer4(tools: ToolDefinition[]): string {
    if (!tools || tools.length === 0) {
      return this.wrapLayer('TOOLS', '当前没有可用工具。');
    }

    const toolSchemas = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: this.convertParametersToSchema(tool.parameters || []),
    }));

    const content = [
      '# 可用工具列表',
      '',
      '你可以使用以下工具来帮助用户完成任务：',
      '',
      ...toolSchemas.map((tool, index) => [
        `## ${index + 1}. ${tool.name}`,
        `描述: ${tool.description}`,
        '参数:',
        '```json',
        JSON.stringify(tool.parameters, null, 2),
        '```',
        '',
      ].join('\n')),
    ].join('\n');

    return this.wrapLayer('TOOLS', content);
  }

  /**
   * 生成 L5: 技能清单
   * 当前加载的Skill目录与触发条件
   */
  private generateLayer5(skills: Skill[]): string {
    if (!skills || skills.length === 0) {
      return this.wrapLayer('SKILLS', '当前没有加载技能。');
    }

    const skillList = skills.map((skill, index) => {
      const meta = skill.metadata;
      return [
        `## ${index + 1}. ${meta.name}`,
        `描述: ${meta.description}`,
        `版本: ${meta.version || '1.0.0'}`,
        meta.tools && meta.tools.length > 0 ? `所需工具: ${meta.tools.join(', ')}` : '',
        '',
      ].filter(Boolean).join('\n');
    });

    const content = [
      '# 已加载技能',
      '',
      `当前系统已加载 ${skills.length} 个技能：`,
      '',
      ...skillList,
      '',
      '当用户请求与某个技能描述匹配时，你可以调用该技能来提供专业服务。',
    ].join('\n');

    return this.wrapLayer('SKILLS', content);
  }

  /**
   * 生成 L6: 运行时上下文
   * 当前时间、活跃会话数、系统状态
   */
  private generateLayer6(context: RuntimeContext): string {
    const date = new Date(context.timestamp);
    const content = [
      '# 运行时上下文',
      '',
      '## 时间信息',
      `- 当前时间: ${date.toISOString()}`,
      `- 时区: ${context.timezone || 'UTC'}`,
      `- 本地时间: ${date.toLocaleString()}`,
      '',
      '## 系统状态',
      `- 状态: ${context.systemStatus}`,
      `- 活跃会话数: ${context.activeSessions}`,
      `- 内存使用: ${Math.round(context.memoryUsage.used / 1024 / 1024)}MB / ${Math.round(context.memoryUsage.total / 1024 / 1024)}MB`,
      `- 请求ID: ${context.requestId}`,
      '',
      '## 注意事项',
      '- 请根据当前时间合理安排任务',
      '- 注意系统资源使用情况',
    ].join('\n');

    return this.wrapLayer('RUNTIME_CONTEXT', content);
  }

  /**
   * 组合所有层
   */
  private combineLayers(layers: { name: string; content: string; required: boolean }[]): string {
    const validLayers = layers.filter(l => l.content && l.content.trim().length > 0);
    
    const header = [
      '# StarUp AI 系统提示词',
      '',
      `版本: ${this.config.version}`,
      `生成时间: ${new Date().toISOString()}`,
      `包含层: ${validLayers.map(l => l.name).join(', ')}`,
      '',
      '---',
      '',
    ].join('\n');

    const body = validLayers.map(l => l.content).join('\n\n');

    const footer = [
      '',
      '---',
      '',
      '## 指令',
      '你是一个AI助手，请根据以上所有层的信息来理解和回应用户的请求。',
      '请保持与你身份一致的人格和风格，并善用可用的工具和技能。',
      '',
    ].join('\n');

    return header + body + footer;
  }

  /**
   * 包装层内容
   */
  private wrapLayer(layerName: string, content: string): string {
    if (!content || content.trim().length === 0) {
      return '';
    }
    return `<!-- LAYER: ${layerName} -->\n\n${content}\n\n<!-- END ${layerName} -->`;
  }

  /**
   * 将参数定义转换为JSON Schema
   */
  private convertParametersToSchema(parameters: ToolParameter[]): Record<string, any> {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const param of parameters) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
      };
      if (param.default !== undefined) {
        properties[param.name].default = param.default;
      }
      if (param.required) {
        required.push(param.name);
      }
    }

    return {
      type: 'object',
      properties,
      required,
    };
  }

  /**
   * 估算token数量
   * 简单估算: 每个token约4个字符
   */
  private estimateTokens(text: string): number {
    // 中文字符通常一个字符就是一个token或更多
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    
    // 中文字符按1:1.5估算，其他按4:1估算
    return Math.ceil(chineseChars * 1.5 + otherChars / 4);
  }

  /**
   * 当token超过阈值时压缩Prompt
   */
  private compressIfNeeded(prompt: AssembledPrompt): AssembledPrompt {
    const { threshold, strategy } = this.config.compression;
    const excess = prompt.tokenCount - threshold;
    
    console.log(`[PromptAssembler] Prompt exceeds threshold (${prompt.tokenCount} > ${threshold}), applying ${strategy} compression`);

    let compressedContent = prompt.content;

    switch (strategy) {
      case 'truncate':
        compressedContent = this.truncatePrompt(prompt.content, threshold);
        break;
      case 'summarize':
        compressedContent = this.summarizePrompt(prompt.content);
        break;
      case 'hybrid':
      default:
        compressedContent = this.hybridCompress(prompt.content, threshold);
        break;
    }

    return {
      ...prompt,
      content: compressedContent,
      tokenCount: this.estimateTokens(compressedContent),
    };
  }

  /**
   * 截断策略：保留必要层，截断可选层
   */
  private truncatePrompt(content: string, threshold: number): string {
    // 解析各层
    const layerPattern = /<!-- LAYER: (\w+) -->\n\n([\s\S]*?)\n\n<!-- END \w+ -->/g;
    const layers: { name: string; content: string; priority: number }[] = [];
    
    let match;
    while ((match = layerPattern.exec(content)) !== null) {
      const name = match[1];
      const layerContent = match[0];
      // 优先级: L1和L2最高，L6次之，其他较低
      let priority = 1;
      if (name === 'L1_SOUL' || name === 'L2_IDENTITY') priority = 3;
      else if (name === 'L6_RUNTIME') priority = 2;
      
      layers.push({ name, content: layerContent, priority });
    }

    // 按优先级排序
    layers.sort((a, b) => b.priority - a.priority);

    // 逐步移除低优先级层
    let result = content;
    let currentTokens = this.estimateTokens(result);
    
    for (const layer of layers) {
      if (currentTokens <= threshold) break;
      if (layer.priority >= 3) continue; // 不删除高优先级层
      
      result = result.replace(layer.content, `<!-- ${layer.name} truncated -->`);
      currentTokens = this.estimateTokens(result);
    }

    return result;
  }

  /**
   * 摘要策略：压缩长文本
   */
  private summarizePrompt(content: string): string {
    // 简化实现：移除所有markdown格式，保留纯文本
    return content
      .replace(/<!--[\s\S]*?-->/g, '') // 移除HTML注释
      .replace(/```[\s\S]*?```/g, '[代码块]') // 简化代码块
      .replace(/#+ /g, '') // 移除标题标记
      .replace(/\n{3,}/g, '\n\n') // 压缩多余空行
      .trim();
  }

  /**
   * 混合策略：结合截断和摘要
   */
  private hybridCompress(content: string, threshold: number): string {
    // 先尝试摘要
    let result = this.summarizePrompt(content);
    
    // 如果仍然超限，再截断
    if (this.estimateTokens(result) > threshold) {
      result = this.truncatePrompt(result, threshold);
    }
    
    return result;
  }

  /**
   * 获取默认SOUL内容
   */
  private getDefaultSoul(): string {
    return [
      '# 核心人格',
      '',
      '你是一个有用的AI助手，致力于帮助用户完成各种任务。',
      '',
      '## 价值观',
      '- 诚实：提供准确和真实的信息',
      '-  helpful：尽力帮助用户解决问题',
      '- 安全：避免产生有害或危险的内容',
      '',
      '## 行为准则',
      '- 尊重用户，保持友善和专业的态度',
      '- 在不确定时承认限制，不编造信息',
      '- 保护用户隐私，不泄露敏感信息',
    ].join('\n');
  }

  /**
   * 获取默认IDENTITY内容
   */
  private getDefaultIdentity(): string {
    return [
      '# 身份标识',
      '',
      '- 名称: StarUp',
      '- 表情符号: ⭐',
      '- 版本: 1.0.0',
      '',
      '## 性格特点',
      '- 友好且专业',
      '- 乐于学习和探索',
      '- 注重效率和结果',
    ].join('\n');
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[PromptAssembler] Cache cleared');
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PromptLayerConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[PromptAssembler] Configuration updated');
  }
}

// ==================== 默认配置工厂 ====================

export function createDefaultConfig(): PromptLayerConfig {
  return {
    version: '1.0.0',
    layers: {
      soul: {
        path: 'SOUL.md',
        hash: '',
        readonly: true,
      },
      identity: {
        path: 'IDENTITY.md',
        cache_ttl: 60, // 60秒缓存
      },
      user_profile: {
        path: 'USER.md',
        auto_update: true,
      },
    },
    compression: {
      threshold: 8192, // 8k tokens
      strategy: 'hybrid',
    },
  };
}
