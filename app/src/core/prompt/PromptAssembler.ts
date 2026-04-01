/**
 * StarUp AI 六层Prompt组装引擎（简化版）
 * L5 层直接读取 skills_index.md
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
   * 组装完整的六层Prompt
   */
  async assemble(agentId: string, runtimeContext: RuntimeContext): Promise<AssembledPrompt> {
    const agentPath = this.getAgentPath(agentId);

    const [layer1, layer2, layer3] = await Promise.all([
      this.loadLayer1(agentPath),
      this.loadLayer2(agentPath),
      this.loadLayer3(agentPath),
    ]);

    const layer4 = this.generateLayer4(this.toolRegistry.getAll());
    const layer5 = await this.loadLayer5();
    const layer6 = this.generateLayer6(runtimeContext);

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

    if (assembled.tokenCount > this.config.compression.threshold) {
      assembled = this.compressIfNeeded(assembled);
    }

    return assembled;
  }

  private getAgentPath(agentId: string): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(homeDir, '.starup', 'agents', agentId);
  }

  private async loadLayer1(agentPath: string): Promise<string> {
    const soulPath = path.join(agentPath, 'SOUL.md');
    try {
      const cached = this.cache.get('soul');
      if (cached && this.config.layers.soul.readonly) return cached.content;
      const content = await fs.readFile(soulPath, 'utf-8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (this.config.layers.soul.hash && this.config.layers.soul.hash !== hash) {
        return cached?.content || content;
      }
      this.cache.set('soul', { content, timestamp: Date.now() });
      return this.wrapLayer('SOUL', content);
    } catch {
      return this.wrapLayer('SOUL', this.getDefaultSoul());
    }
  }

  private async loadLayer2(agentPath: string): Promise<string> {
    const identityPath = path.join(agentPath, 'IDENTITY.md');
    const cacheTtl = this.config.layers.identity.cache_ttl * 1000;
    try {
      const cached = this.cache.get('identity');
      if (cached && Date.now() - cached.timestamp < cacheTtl) return cached.content;
      const content = await fs.readFile(identityPath, 'utf-8');
      this.cache.set('identity', { content, timestamp: Date.now() });
      return this.wrapLayer('IDENTITY', content);
    } catch {
      return this.wrapLayer('IDENTITY', this.getDefaultIdentity());
    }
  }

  private async loadLayer3(agentPath: string): Promise<string> {
    const userPath = path.join(agentPath, 'USER.md');
    try {
      const content = await fs.readFile(userPath, 'utf-8');
      if (this.config.layers.user_profile.auto_update) {
        this.cache.set('user_profile', { content, timestamp: Date.now() });
      }
      return this.wrapLayer('USER_PROFILE', content);
    } catch {
      return '';
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
   * L5: Skills 层
   * 包含两部分：
   * 1. 内置 skills（直接嵌入，系统核心能力）
   * 2. 用户安装的 skills（从索引文件读取）
   */
  private async loadLayer5(): Promise<string> {
    const lines: string[] = ['# Skills 能力层', ''];

    // 1. 内置 skills（从 SkillRegistry 获取）
    const builtinDescription = this.skillRegistry.getBuiltinSkillsDescription();
    if (builtinDescription) {
      lines.push('## 系统内置 Skills（立即可用）');
      lines.push('');
      lines.push(builtinDescription);
      lines.push('');
    }

    // 2. 用户安装的 skills（从索引文件读取）
    const indexPath = path.join(process.env.HOME || '.', '.starup', 'skills_index.md');
    try {
      let userContent = await fs.readFile(indexPath, 'utf-8');
      // 防止过长导致上下文膨胀
      const maxChars = 4000;
      if (userContent.length > maxChars) {
        userContent = userContent.substring(0, maxChars) + '\n\n_...（更多 skill 请使用 /skills 查看）_';
      }
      lines.push('---');
      lines.push('');
      lines.push(userContent);
    } catch {
      lines.push('---');
      lines.push('');
      lines.push('_当前没有用户安装的 skills。需要时可以使用 clawhub skill 搜索安装。_');
    }

    return this.wrapLayer('SKILLS', lines.join('\n'));
  }

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
    ].join('\n');

    return this.wrapLayer('RUNTIME_CONTEXT', content);
  }

  private combineLayers(layers: { name: string; content: string; required: boolean }[]): string {
    const validLayers = layers.filter((l) => l.content && l.content.trim().length > 0);
    const header = [
      '# StarUp AI 系统提示词',
      '',
      `版本: ${this.config.version}`,
      `生成时间: ${new Date().toISOString()}`,
      `包含层: ${validLayers.map((l) => l.name).join(', ')}`,
      '',
      '---',
      '',
    ].join('\n');
    const body = validLayers.map((l) => l.content).join('\n\n');
    const footer = [
      '',
      '---',
      '',
      '## 指令',
      '你是一个AI助手，请根据以上所有层的信息来理解和回应用户的请求。',
      '请保持与你身份一致的人格和风格，并善用可用的工具和技能。',
      '',
      '## 回复格式要求',
      '1. **思考过程**：在每次回复开头，用 1-2 句话简要说明你的思考过程（例如："我需要查询杭州的天气信息"）。',
      '2. **工具使用**：如果要调用工具，先说明你要调用什么工具，然后给出工具调用。',
      '3. **最终回复**：在获得工具结果后，给出完整、清晰的最终回复。',
      '',
      '## 工具使用优先级',
      '1. 如果某个 skill 已经安装并提供了专门工具（如 web_search、weather），必须优先使用该专门工具，**禁止**用 exec 工具自行模拟实现相同功能。',
      '2. 调用工具时，请在回复开头明确说明你要调用哪个工具/来源（例如："我调用 web_search 工具来搜索..."）。',
      '3. exec 仅用于本地系统命令（如 ls、cat、dir），不应用于替代已安装的 skill。',
      '',
    ].join('\n');
    return header + body + footer;
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
      result = result.replace(layer.content, `<!-- ${layer.name} truncated -->`);
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

  private getDefaultSoul(): string {
    return '[SOUL] 等待初始化 - 请检查 ~/.starup/agents/default/SOUL.md';
  }

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

  clearCache(): void {
    this.cache.clear();
  }

  updateConfig(config: Partial<PromptLayerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export function createDefaultConfig(): PromptLayerConfig {
  return {
    version: '1.3-simple',
    layers: {
      soul: { path: 'SOUL.md', hash: '', readonly: true },
      identity: { path: 'IDENTITY.md', cache_ttl: 60 },
      user_profile: { path: 'USER.md', auto_update: true },
    },
    compression: { threshold: 8192, strategy: 'hybrid' },
  };
}
