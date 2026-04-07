/**
 * StarUp AI 六层Prompt组装引擎（简化版）
 * L5 层直接读取 skills_index.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { ToolDefinition, Skill, ToolParameter } from '../../types';
import { logger } from '../../utils/Logger';

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
    agents: { path: string; readonly: boolean; };
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
  getBuiltinSkillsDescription(): string;
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
   * 组装完整的七层Prompt
   * L0: AGENTS.md - 工作区指南（含记忆系统说明）
   * L1: SOUL.md - 灵魂/人格
   * L2: IDENTITY.md - 身份标识
   * L3: USER.md - 用户画像
   * L4: TOOLS - 可用工具
   * L5: SKILLS - 技能能力
   * L6: RUNTIME_CONTEXT - 运行时上下文
   */
  async assemble(agentId: string, runtimeContext: RuntimeContext): Promise<AssembledPrompt> {
    const agentPath = this.getAgentPath(agentId);

    const [layer0, layer1, layer2, layer3] = await Promise.all([
      this.loadLayer0(agentPath),
      this.loadLayer1(agentPath),
      this.loadLayer2(agentPath),
      this.loadLayer3(agentPath),
    ]);

    const layer4 = this.generateLayer4(this.toolRegistry.getAll());
    const layer5 = await this.loadLayer5();
    const layer6 = this.generateLayer6(runtimeContext);

    const content = this.combineLayers([
      { name: 'L0_AGENTS', content: layer0, required: true },
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
        L0_AGENTS: !!layer0,
        L1_SOUL: !!layer1,
        L2_IDENTITY: !!layer2,
        L3_USER_PROFILE: !!layer3,
        L4_TOOLS: !!layer4,
        L5_SKILLS: !!layer5,
        L6_RUNTIME: !!layer6,
      },
    };

    if (assembled.tokenCount > this.config.compression.threshold) {
      assembled = this.compressIfNeeded(assembled);
    }

    return assembled;
  }

  private getAgentPath(agentId: string): string {
    const agentPath = path.join(process.cwd(), '.starup');
    logger.debug('PromptAssembler', `Agent path: ${agentPath} (cwd=${process.cwd()})`);
    return agentPath;
  }

  /**
   * L0: AGENTS.md - 工作区指南
   * 包含系统性行为准则、红线、工作模式等
   */
  private async loadLayer0(agentPath: string): Promise<string> {
    const agentsPath = path.join(agentPath, 'AGENTS.md');
    logger.debug('PromptAssembler', `Loading AGENTS.md from: ${agentsPath}`);
    try {
      const cached = this.cache.get('agents');
      if (cached && this.config.layers.agents.readonly) return cached.content;
      const content = await fs.readFile(agentsPath, 'utf-8');
      logger.debug('PromptAssembler', `Successfully loaded AGENTS.md (${content.length} chars)`);
      this.cache.set('agents', { content, timestamp: Date.now() });
      return this.wrapLayer('AGENTS', content);
    } catch (error) {
      logger.error('PromptAssembler', `Failed to load AGENTS.md from ${agentsPath}: ${error}`);
      throw new Error(`Failed to load AGENTS.md: ${error}`);
    }
  }

  private async loadLayer1(agentPath: string): Promise<string> {
    const soulPath = path.join(agentPath, 'SOUL.md');
    logger.debug('PromptAssembler', `Loading SOUL.md from: ${soulPath}`);
    try {
      const cached = this.cache.get('soul');
      if (cached && this.config.layers.soul.readonly) return cached.content;
      const content = await fs.readFile(soulPath, 'utf-8');
      logger.debug('PromptAssembler', `Successfully loaded SOUL.md (${content.length} chars)`);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (this.config.layers.soul.hash && this.config.layers.soul.hash !== hash) {
        return cached?.content || content;
      }
      this.cache.set('soul', { content, timestamp: Date.now() });
      return this.wrapLayer('SOUL', content);
    } catch (error) {
      logger.error('PromptAssembler', `Failed to load SOUL.md from ${soulPath}: ${error}`);
      throw new Error(`Failed to load SOUL.md: ${error}`);
    }
  }

  private async loadLayer2(agentPath: string): Promise<string> {
    const identityPath = path.join(agentPath, 'IDENTITY.md');
    logger.debug('PromptAssembler', `Loading IDENTITY.md from: ${identityPath}`);
    const cacheTtl = this.config.layers.identity.cache_ttl * 1000;
    try {
      const cached = this.cache.get('identity');
      if (cached && Date.now() - cached.timestamp < cacheTtl) return cached.content;
      const content = await fs.readFile(identityPath, 'utf-8');
      logger.debug('PromptAssembler', `Successfully loaded IDENTITY.md (${content.length} chars)`);
      this.cache.set('identity', { content, timestamp: Date.now() });
      return this.wrapLayer('IDENTITY', content);
    } catch (error) {
      logger.error('PromptAssembler', `Failed to load IDENTITY.md from ${identityPath}: ${error}`);
      throw new Error(`Failed to load IDENTITY.md: ${error}`);
    }
  }

  private async loadLayer3(agentPath: string): Promise<string> {
    const userPath = path.join(agentPath, 'USER.md');
    logger.debug('PromptAssembler', `Loading USER.md from: ${userPath}`);
    try {
      const content = await fs.readFile(userPath, 'utf-8');
      logger.debug('PromptAssembler', `Successfully loaded USER.md (${content.length} chars)`);
      if (this.config.layers.user_profile.auto_update) {
        this.cache.set('user_profile', { content, timestamp: Date.now() });
      }
      return this.wrapLayer('USER_PROFILE', content);
    } catch (error) {
      logger.error('PromptAssembler', `Failed to load USER.md from ${userPath}: ${error}`);
      throw new Error(`Failed to load USER.md: ${error}`);
    }
  }

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
      '可使用以下工具帮助用户完成任务：',
      '',
      ...toolSchemas.map((tool, index) => [
        `## ${index + 1}. ${tool.name}`,
        `描述：${tool.description}`,
        '参数：',
        '```json',
        JSON.stringify(tool.parameters, null, 2),
        '```',
        '',
      ].join('\n')),
    ].join('\n');

    return this.wrapLayer('TOOLS', content);
  }

  /**
   * L5: Skills 层
   * 从 skills_index.md 读取已安装 skills 的精简索引
   */
  private async loadLayer5(): Promise<string> {
    const indexPath = path.join(process.cwd(), '.starup', 'skills_index.md');
    let content: string;
    
    try {
      content = await fs.readFile(indexPath, 'utf-8');
      // 防止过长导致上下文膨胀
      const maxChars = 4000;
      if (content.length > maxChars) {
        content = content.substring(0, maxChars) + '\n\n_...（更多 skill 请使用 /skills 查看）_';
      }
    } catch {
      content = '_当前没有安装的 skills。需要时可用 clawhub skill 搜索安装。_';
    }

    return this.wrapLayer('SKILLS', '# Skills 能力层\n\n' + content);
  }

  private generateLayer6(context: RuntimeContext): string {
    const date = new Date(context.timestamp);
    const content = [
      '# 运行时上下文',
      '',
      '## 时间信息',
      `- 当前时间：${date.toISOString()}`,
      `- 时区：${context.timezone || 'UTC'}`,
      `- 本地时间：${date.toLocaleString()}`,
      '',
      '## 系统状态',
      `- 状态：${context.systemStatus}`,
      `- 活跃会话数：${context.activeSessions}`,
      `- 内存使用：${Math.round(context.memoryUsage.used / 1024 / 1024)}MB / ${Math.round(context.memoryUsage.total / 1024 / 1024)}MB`,
      `- 请求ID：${context.requestId}`,
    ].join('\n');

    return this.wrapLayer('RUNTIME_CONTEXT', content);
  }

  private combineLayers(layers: { name: string; content: string; required: boolean }[]): string {
    const validLayers = layers.filter((l) => l.content && l.content.trim().length > 0);
    const header = [
      '# StarUp AI 系统提示词',
      '',
      `版本：${this.config.version}`,
      `包含层：${validLayers.map((l) => l.name).join(', ')}`,
      '',
      '---',
      '',
    ].join('\n');
    const body = validLayers.map((l) => l.content).join('\n\n');
    return header + body;
  }

  private wrapLayer(layerName: string, content: string): string {
    if (!content || content.trim().length === 0) return '';
    return `<!-- LAYER: ${layerName} -->\n\n${content}\n\n<!-- END ${layerName} -->`;
  }

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
    return { type: 'object', properties, required };
  }

  private estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 1.5 + otherChars / 4);
  }

  private compressIfNeeded(prompt: AssembledPrompt): AssembledPrompt {
    const { threshold, strategy } = this.config.compression;
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

  private truncatePrompt(content: string, threshold: number): string {
    const layerPattern = /<!-- LAYER: (\w+) -->\n\n([\s\S]*?)\n\n<!-- END \w+ -->/g;
    const layers: { name: string; content: string; priority: number }[] = [];
    let match;
    while ((match = layerPattern.exec(content)) !== null) {
      const name = match[1];
      const layerContent = match[0];
      let priority = 1;
      if (name === 'L1_SOUL' || name === 'L2_IDENTITY') priority = 3;
      else if (name === 'L6_RUNTIME') priority = 2;
      layers.push({ name, content: layerContent, priority });
    }
    layers.sort((a, b) => b.priority - a.priority);
    let result = content;
    let currentTokens = this.estimateTokens(result);
    for (const layer of layers) {
      if (currentTokens <= threshold) break;
      if (layer.priority >= 3) continue;
      result = result.replace(layer.content, `<!-- ${layer.name} 已截断 -->`);
      currentTokens = this.estimateTokens(result);
    }
    return result;
  }

  private summarizePrompt(content: string): string {
    return content
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/```[\s\S]*?```/g, '[代码块]')
      .replace(/#+ /g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private hybridCompress(content: string, threshold: number): string {
    let result = this.summarizePrompt(content);
    if (this.estimateTokens(result) > threshold) {
      result = this.truncatePrompt(result, threshold);
    }
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }

  updateConfig(config: Partial<PromptLayerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export function createDefaultConfig(): PromptLayerConfig {
  return {
    version: '1.4-simple',
    layers: {
      agents: { path: 'AGENTS.md', readonly: true },
      soul: { path: 'SOUL.md', hash: '', readonly: true },
      identity: { path: 'IDENTITY.md', cache_ttl: 60 },
      user_profile: { path: 'USER.md', auto_update: true },
    },
    compression: { threshold: 8192, strategy: 'hybrid' },
  };
}
