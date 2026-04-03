import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryEntry, MemoryType, MemoryFrontmatter, ParsedMemory, RelevantMemory } from '../../types';
import { LLMService } from '../llm/LLMService';
import { logger } from '../../utils/Logger';

/**
 * 记忆管理器 v2
 * 
 * 核心改进：
 * 1. AI 驱动的记忆召回（替代关键词匹配）
 * 2. 记忆新鲜度标注（防止过期幻觉）
 * 3. 支持 frontmatter 格式（Claude Code 风格）
 * 4. 使用前验证提示
 */
export class MemoryManager {
  private memoryDir: string;
  private longTermIndex: string = 'MEMORY.md';
  private llmService?: LLMService;

  // 配置
  private readonly MAX_RELEVANT_MEMORIES = 5;      // 最多召回 5 条
  private readonly MAX_MEMORY_AGE_DAYS = 90;       // 90 天前的记忆视为过期
  private readonly FRESHNESS_WARNING_DAYS = 1;     // 超过 1 天添加警告

  constructor(llmService?: LLMService) {
    this.memoryDir = path.join(process.cwd(), '.starup', 'memory');
    this.llmService = llmService;
    this.ensureDirectories();
  }

  /**
   * 设置 LLM 服务（用于 AI 召回）
   */
  setLLMService(service: LLMService): void {
    this.llmService = service;
  }

  /**
   * 确保目录结构存在
   */
  async ensureDirectories(): Promise<void> {
    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
    } catch (error) {
      logger.error('MemoryManager', `Failed to create memory directory: ${error}`);
    }
  }

  // ==================== 文件路径方法 ====================

  /**
   * 获取日记忆文件路径
   */
  getDailyLogPath(date?: string): string {
    const dateStr = date || new Date().toISOString().split('T')[0];
    return path.join(this.memoryDir, `${dateStr}.md`);
  }

  /**
   * 获取长期记忆索引路径
   */
  getLongTermIndexPath(): string {
    return path.join(this.memoryDir, this.longTermIndex);
  }

  /**
   * 获取特定类型的记忆目录
   */
  getTypedMemoryDir(type: MemoryType): string {
    return path.join(this.memoryDir, type);
  }

  // ==================== Frontmatter 解析 ====================

  /**
   * 解析 frontmatter
   * 支持 YAML 格式：
   * ---
   * name: xxx
   * description: xxx
   * type: user
   * ---
   */
  parseFrontmatter(content: string): { frontmatter: MemoryFrontmatter | null; body: string } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { frontmatter: null, body: content };
    }

    const frontmatterText = match[1];
    const body = match[2].trim();

    // 简单 YAML 解析
    const frontmatter: Partial<MemoryFrontmatter> = {};
    const lines = frontmatterText.split('\n');
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        
        if (key === 'tags') {
          // 解析数组格式: [tag1, tag2] 或单行格式
          const cleanValue = value.replace(/^\[|\]$/g, '');  // 去掉首尾方括号
          frontmatter.tags = cleanValue.split(',').map(t => t.trim()).filter(t => t);
        } else {
          (frontmatter as any)[key] = value;
        }
      }
    }

    // 验证必要字段
    if (!frontmatter.name || !frontmatter.description || !frontmatter.type) {
      return { frontmatter: null, body: content };
    }

    return {
      frontmatter: frontmatter as MemoryFrontmatter,
      body,
    };
  }

  /**
   * 生成 frontmatter
   */
  generateFrontmatter(frontmatter: MemoryFrontmatter): string {
    const lines = ['---'];
    lines.push(`name: ${frontmatter.name}`);
    lines.push(`description: ${frontmatter.description}`);
    lines.push(`type: ${frontmatter.type}`);
    
    const now = new Date().toISOString();
    lines.push(`created: ${frontmatter.created || now}`);
    lines.push(`updated: ${now}`);
    
    if (frontmatter.tags && frontmatter.tags.length > 0) {
      lines.push(`tags: [${frontmatter.tags.join(', ')}]`);
    }
    
    lines.push('---\n');
    return lines.join('\n');
  }

  // ==================== 记忆读写 ====================

  /**
   * 读取记忆文件（带 frontmatter 解析）
   */
  async readMemoryFile(filePath: string): Promise<ParsedMemory | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const stats = await fs.stat(filePath);
      const { frontmatter, body } = this.parseFrontmatter(content);

      // 如果没有 frontmatter，尝试兼容旧格式
      if (!frontmatter) {
        // 从文件名和第一行推断
        const filename = path.basename(filePath, '.md');
        const firstLine = content.split('\n')[0]?.replace(/^#\s*/, '') || filename;
        
        return {
          path: filePath,
          frontmatter: {
            name: firstLine,
            description: 'Legacy memory entry',
            type: 'reference',
          },
          content: body,
          mtime: stats.mtimeMs,
        };
      }

      return {
        path: filePath,
        frontmatter,
        content: body,
        mtime: stats.mtimeMs,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 写入记忆文件（带 frontmatter）
   */
  async writeMemoryFile(
    filename: string,
    frontmatter: MemoryFrontmatter,
    content: string,
    type?: MemoryType
  ): Promise<void> {
    const dir = type ? this.getTypedMemoryDir(type) : this.memoryDir;
    await fs.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, filename);
    const fullContent = this.generateFrontmatter(frontmatter) + content;
    
    await fs.writeFile(filePath, fullContent, 'utf-8');
    
    // 更新索引
    await this.updateMemoryIndex(frontmatter, filename, type);
  }

  /**
   * 更新 MEMORY.md 索引
   */
  private async updateMemoryIndex(
    frontmatter: MemoryFrontmatter,
    filename: string,
    type?: MemoryType
  ): Promise<void> {
    const indexPath = this.getLongTermIndexPath();
    let indexContent = '';
    
    try {
      indexContent = await fs.readFile(indexPath, 'utf-8');
    } catch {
      // 文件不存在，创建新索引
      indexContent = '# Memory Index\n\nThis file indexes all persistent memories.\n\n';
    }

    // 检查是否已存在
    const relativePath = type ? `${type}/${filename}` : filename;
    const entryPattern = new RegExp(`- \\[[^\\]]+\\]\\(${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`);
    
    if (entryPattern.test(indexContent)) {
      // 更新现有条目
      const lines = indexContent.split('\n');
      const newLines = lines.map(line => {
        if (entryPattern.test(line)) {
          return `- [${frontmatter.name}](${relativePath}) — ${frontmatter.description}`;
        }
        return line;
      });
      indexContent = newLines.join('\n');
    } else {
      // 添加新条目
      const newEntry = `- [${frontmatter.name}](${relativePath}) — ${frontmatter.description}`;
      indexContent += `${newEntry}\n`;
    }

    await fs.writeFile(indexPath, indexContent, 'utf-8');
  }

  // ==================== 扫描与召回 ====================

  /**
   * 扫描所有记忆文件
   */
  async scanMemoryFiles(): Promise<ParsedMemory[]> {
    const memories: ParsedMemory[] = [];
    const maxFiles = 200;  // 最多扫描 200 个文件

    // 递归扫描目录
    const scanDir = async (dir: string, baseDir: string = dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (memories.length >= maxFiles) break;
          
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            await scanDir(fullPath, baseDir);
          } else if (entry.name.endsWith('.md') && entry.name !== this.longTermIndex) {
            const memory = await this.readMemoryFile(fullPath);
            if (memory) {
              memories.push(memory);
            }
          }
        }
      } catch (error) {
        logger.error('MemoryManager', `Failed to scan ${dir}: ${error}`);
      }
    };

    await scanDir(this.memoryDir);

    // 按修改时间降序排序
    memories.sort((a, b) => b.mtime - a.mtime);
    
    return memories.slice(0, maxFiles);
  }

  /**
   * AI 驱动的记忆召回
   * 
   * 使用 LLM 选择最相关的记忆，替代简单的关键词匹配
   */
  async findRelevantMemories(query: string, recentTools?: string[]): Promise<RelevantMemory[]> {
    // 1. 扫描所有记忆
    const allMemories = await this.scanMemoryFiles();
    
    if (allMemories.length === 0) {
      return [];
    }

    // 如果没有 LLM 服务，回退到简单匹配
    if (!this.llmService) {
      return this.fallbackKeywordSearch(query, allMemories);
    }

    try {
      // 2. 构建选择提示
      const selectionPrompt = this.buildMemorySelectionPrompt(query, allMemories, recentTools);
      
      // 3. 调用 LLM 选择
      const response = await this.llmService.chat(
        [
          { role: 'system', content: selectionPrompt.system, timestamp: Date.now() },
          { role: 'user', content: selectionPrompt.user, timestamp: Date.now() },
        ],
        undefined,
        { maxTokens: 512 }
      );

      // 4. 解析选择结果
      const selectedPaths = this.parseSelectionResponse(response.content);
      
      // 5. 构建结果
      const results: RelevantMemory[] = [];
      for (const { path: memoryPath, reason } of selectedPaths) {
        const memory = allMemories.find(m => m.path === memoryPath || m.path.endsWith(memoryPath));
        if (memory) {
          results.push({
            memory,
            reason,
            freshness: this.getFreshnessText(memory.mtime),
          });
        }
      }

      return results.slice(0, this.MAX_RELEVANT_MEMORIES);
    } catch (error) {
      logger.error('MemoryManager', `AI selection failed, falling back: ${error}`);
      return this.fallbackKeywordSearch(query, allMemories);
    }
  }

  /**
   * 构建记忆选择提示词
   */
  private buildMemorySelectionPrompt(
    query: string,
    memories: ParsedMemory[],
    recentTools?: string[]
  ): { system: string; user: string } {
    const system = `You are a memory selection assistant. Your task is to select the most relevant memories for the user's query.

Rules:
1. Return at most ${this.MAX_RELEVANT_MEMORIES} filenames
2. Be selective and discerning - if unsure, do not include
3. Prioritize recent memories when relevance is similar
4. If recent tools are provided, do NOT select memories about how to use those tools (user already knows)
   - But DO select memories about warnings/pitfalls/known issues of those tools

Respond in this exact format:
selected_files:
- path/to/file1.md | reason why relevant
- path/to/file2.md | reason why relevant

Or if none are relevant:
selected_files: none`;

    // 构建记忆列表
    const memoryList = memories.map(m => {
      const relativePath = path.relative(this.memoryDir, m.path);
      const age = this.memoryAgeDays(m.mtime);
      const ageText = age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`;
      return `- [${m.frontmatter.type}] ${relativePath} (${ageText}): ${m.frontmatter.description}`;
    }).join('\n');

    const userParts = [`Query: ${query}`, '', 'Available memories:', memoryList];
    
    if (recentTools && recentTools.length > 0) {
      userParts.push('', `Recently used tools: ${recentTools.join(', ')}`);
    }

    return { system, user: userParts.join('\n') };
  }

  /**
   * 解析选择响应
   */
  private parseSelectionResponse(content: string): Array<{ path: string; reason: string }> {
    const results: Array<{ path: string; reason: string }> = [];
    
    // 查找 selected_files: 部分
    const match = content.match(/selected_files:\s*\n?([\s\S]*?)(?:\n\n|$)/i);
    if (!match) return results;

    const lines = match[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const content = trimmed.substring(2);
        const parts = content.split(/\s*\|\s*/);
        if (parts.length >= 1) {
          const filePath = parts[0].trim();
          const reason = parts[1]?.trim() || 'Relevant to query';
          if (filePath && filePath.endsWith('.md')) {
            results.push({ path: filePath, reason });
          }
        }
      }
    }

    return results;
  }

  /**
   * 回退：关键词搜索（无 LLM 时使用）
   */
  private fallbackKeywordSearch(query: string, memories: ParsedMemory[]): RelevantMemory[] {
    const keywords = this.extractKeywords(query);
    const scored: Array<{ memory: ParsedMemory; score: number }> = [];

    for (const memory of memories) {
      let score = 0;
      const text = `${memory.frontmatter.name} ${memory.frontmatter.description} ${memory.content}`.toLowerCase();
      
      for (const keyword of keywords) {
        if (text.includes(keyword)) score += 1;
      }

      // 时间衰减：越新的记忆分数越高
      const age = this.memoryAgeDays(memory.mtime);
      score *= Math.max(0.3, 1 - age / 30);  // 30 天后降至 30%

      if (score > 0) {
        scored.push({ memory, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    
    return scored.slice(0, this.MAX_RELEVANT_MEMORIES).map(({ memory }) => ({
      memory,
      reason: 'Keyword match',
      freshness: this.getFreshnessText(memory.mtime),
    }));
  }

  // ==================== 新鲜度管理 ====================

  /**
   * 计算记忆年龄（天数）
   */
  memoryAgeDays(mtimeMs: number): number {
    const now = Date.now();
    const diff = now - mtimeMs;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * 获取新鲜度文本
   */
  getFreshnessText(mtimeMs: number): string {
    const days = this.memoryAgeDays(mtimeMs);
    
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }

  /**
   * 获取新鲜度警告
   * 
   * 超过 1 天的记忆会附加警告，防止模型将过期记忆当作事实
   */
  getFreshnessWarning(mtimeMs: number): string {
    const days = this.memoryAgeDays(mtimeMs);
    
    if (days <= this.FRESHNESS_WARNING_DAYS) {
      return '';  // 新鲜记忆不加警告
    }

    return `\n\n⚠️ **Memory Freshness Warning**\nThis memory is from ${days} days ago. Memories are point-in-time observations, not live state — claims about code behavior or file citations may be outdated. Verify against current code before asserting as fact.`;
  }

  /**
   * 格式化记忆内容（带新鲜度标注）
   */
  formatMemoryContent(memory: ParsedMemory): string {
    const freshness = this.getFreshnessWarning(memory.mtime);
    return `## ${memory.frontmatter.name}\n**Type:** ${memory.frontmatter.type} | **Updated:** ${this.getFreshnessText(memory.mtime)}\n\n${memory.content}${freshness}`;
  }

  // ==================== 记忆注入（兼容旧接口） ====================

  /**
   * 获取相关记忆并注入上下文（兼容旧接口）
   */
  async injectRelevantMemories(context: string, _session?: any): Promise<string[]> {
    const relevant = await this.findRelevantMemories(context);
    return relevant.map(r => this.formatMemoryContent(r.memory));
  }

  // ==================== 传统方法（向后兼容） ====================

  /**
   * 读取日记忆（兼容旧格式）
   */
  async readDailyLog(date?: string): Promise<string> {
    const filePath = date 
      ? path.join(this.memoryDir, `${date}.md`)
      : this.getDailyLogPath();
    
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      return '';
    }
  }

  /**
   * 写入日记忆（兼容旧格式）
   */
  async writeDailyLog(entry: MemoryEntry): Promise<void> {
    const filePath = this.getDailyLogPath();
    const content = await this.readDailyLog();
    
    const entryText = `
## ${entry.topic}
${entry.summary}

_Importance: ${entry.importance}/10 | Time: ${new Date(entry.timestamp).toLocaleString()}_

---
`;

    const newContent = content + entryText;
    await fs.writeFile(filePath, newContent, 'utf-8');
  }

  /**
   * 读取长期记忆索引
   */
  async readLongTermMemory(): Promise<string> {
    try {
      return await fs.readFile(this.getLongTermIndexPath(), 'utf-8');
    } catch (error) {
      return '';
    }
  }

  /**
   * 获取最近 N 天的日记忆
   */
  async getRecentDailyLogs(days: number): Promise<string[]> {
    const logs: string[] = [];
    const now = new Date();
    
    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      try {
        const log = await fs.readFile(
          path.join(this.memoryDir, `${dateStr}.md`), 
          'utf-8'
        );
        logs.push(log);
      } catch (error) {
        // 忽略不存在的文件
      }
    }
    
    return logs;
  }

  // ==================== 私有方法 ====================

  private extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
    
    return [...new Set(words)].slice(0, 10);
  }
}

// 单例导出（向后兼容）
export const memoryManager = new MemoryManager();
