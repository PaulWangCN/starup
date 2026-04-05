import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryEntry, MemoryType, MemoryFrontmatter, ParsedMemory, RelevantMemory } from '../../types';
import { LLMService } from '../llm/LLMService';
import { logger } from '../../utils/Logger';
import { AutoDream, Fact } from './AutoDream';

/**
 * 记忆管理器 v4 - 与 AutoDream 深度融合
 * 
 * 架构：
 * L1 Session Memory: .starup/session/memory.md - 10章节固定格式
 * L2 Persistent Memory: .starup/memory/{type}/*.md - 4种类型，AI召回
 * L3 AutoDream Facts: .starup/memory/autodream/memory.json - 自动整合的事实
 * 
 * 核心特性：
 * 1. AI 驱动的记忆召回（文件记忆 + AutoDream facts）
 * 2. 记忆新鲜度标注
 * 3. YAML frontmatter 格式支持
 * 4. MEMORY.md 索引管理
 * 5. AutoDream 事实自动导出到 Markdown
 */
export class MemoryManager {
  private memoryDir: string;
  private sessionDir: string;
  private logsDir: string;
  private longTermIndex: string = 'MEMORY.md';
  private llmService?: LLMService;
  private autoDream?: AutoDream;

  // 索引限制
  private readonly MAX_ENTRYPOINT_LINES = 200;
  private readonly MAX_ENTRYPOINT_BYTES = 25000;
  
  // 召回限制
  private readonly MAX_RELEVANT_MEMORIES = 5;
  private readonly MAX_RELEVANT_FACTS = 3;
  private readonly MAX_SCAN_FILES = 200;
  private readonly FRESHNESS_WARNING_DAYS = 1;
  private readonly MAX_MEMORY_AGE_DAYS = 90;

  // Session Memory 限制
  private readonly MAX_SECTION_LENGTH = 2000;
  private readonly MAX_TOTAL_SESSION_MEMORY_TOKENS = 12000;

  constructor(llmService?: LLMService, autoDream?: AutoDream) {
    const baseDir = path.join(process.cwd(), '.starup');
    this.memoryDir = path.join(baseDir, 'memory');
    this.sessionDir = path.join(baseDir, 'session');
    this.logsDir = path.join(baseDir, 'logs');
    this.llmService = llmService;
    this.autoDream = autoDream;
    this.ensureDirectories();
  }

  /**
   * 设置 LLM 服务
   */
  setLLMService(service: LLMService): void {
    this.llmService = service;
  }

  /**
   * 设置 AutoDream
   */
  setAutoDream(autoDream: AutoDream): void {
    this.autoDream = autoDream;
  }

  /**
   * 确保目录结构存在
   */
  async ensureDirectories(): Promise<void> {
    const dirs = [
      this.memoryDir,
      this.sessionDir,
      this.logsDir,
      path.join(this.memoryDir, 'user'),
      path.join(this.memoryDir, 'feedback'),
      path.join(this.memoryDir, 'project'),
      path.join(this.memoryDir, 'reference'),
      path.join(this.memoryDir, 'team'),
      path.join(this.memoryDir, 'autodream'), // AutoDream 数据目录
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        logger.error('MemoryManager', `Failed to create directory ${dir}: ${error}`);
      }
    }
  }

  // ==================== AutoDream 集成 ====================

  /**
   * 查询 AutoDream Facts
   */
  queryAutoDreamFacts(query: string, limit: number = 3): Array<{content: string; confidence: number}> {
    if (!this.autoDream) {
      return [];
    }
    
    const facts = this.autoDream.queryFacts(query, limit);
    return facts.map(f => ({
      content: f.content,
      confidence: f.confidence
    }));
  }

  /**
   * 将高置信度 facts 导出到 Markdown 文件
   * 供人工查看和其他工具使用
   */
  async exportFactsToMarkdown(minConfidence: number = 0.85): Promise<string | null> {
    if (!this.autoDream) {
      return null;
    }
    
    const allFacts = this.autoDream.getFacts();
    const highConfidenceFacts = allFacts.filter(f => f.confidence >= minConfidence);
    
    if (highConfidenceFacts.length === 0) {
      return null;
    }

    const lines = [
      '# AutoDream 高置信度事实',
      '',
      `生成时间: ${new Date().toISOString()}`,
      `事实总数: ${allFacts.length}`,
      `高置信度事实数 (≥${(minConfidence * 100).toFixed(0)}%): ${highConfidenceFacts.length}`,
      '',
      '> 本文件由 AutoDream 自动生成，包含系统自动整合的事实。\n> 这些事实基于多次观察，具有较高可信度。',
      ''
    ];

    // 按主题分组
    const byTopic = new Map<string, Fact[]>();
    for (const fact of highConfidenceFacts) {
      // 从内容中提取关键词作为主题
      const topics = this.extractTopics(fact.content);
      const mainTopic = topics[0] || 'general';
      
      if (!byTopic.has(mainTopic)) {
        byTopic.set(mainTopic, []);
      }
      byTopic.get(mainTopic)!.push(fact);
    }

    // 输出分组
    for (const [topic, facts] of byTopic) {
      lines.push(`## ${topic}`);
      lines.push('');
      
      for (const fact of facts.slice(0, 10)) { // 每主题最多10个
        lines.push(`### ${fact.id}`);
        lines.push(`- **置信度:** ${(fact.confidence * 100).toFixed(1)}%`);
        lines.push(`- **首次发现:** ${new Date(fact.createdAt).toLocaleDateString()}`);
        lines.push(`- **最后更新:** ${new Date(fact.updatedAt).toLocaleDateString()}`);
        lines.push(`- **访问次数:** ${fact.accessCount}`);
        lines.push('');
        lines.push(fact.content);
        lines.push('');
      }
    }

    // 写入文件
    const outputPath = path.join(this.memoryDir, 'autodream', 'facts_export.md');
    await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
    
    logger.info('MemoryManager', `Exported ${highConfidenceFacts.length} facts to ${outputPath}`);
    return outputPath;
  }

  /**
   * 从观察自动创建记忆文件
   * 当 AutoDream 整合出高置信度事实时，可自动写入记忆文件
   */
  async autoCreateMemoryFromFact(fact: Fact, type: MemoryType = 'project'): Promise<void> {
    const filename = `autodream_${fact.id}.md`;
    const name = fact.content.substring(0, 30) + (fact.content.length > 30 ? '...' : '');
    
    const frontmatter: MemoryFrontmatter = {
      name,
      description: `AutoDream 自动生成 (置信度: ${(fact.confidence * 100).toFixed(0)}%)`,
      type,
      tags: ['autodream', 'auto-generated']
    };

    const content = `
${fact.content}

---

**来源**: AutoDream 记忆整合
**置信度**: ${(fact.confidence * 100).toFixed(1)}%
**观察来源**: ${fact.sources.join(', ')}
**生成时间**: ${new Date(fact.createdAt).toISOString()}

> 此记忆由系统自动生成，基于多次观察整合。
> 如需修改，请直接编辑此文件。
`;

    await this.writeMemoryFile(filename, frontmatter, content, type);
    logger.info('MemoryManager', `Auto-created memory file from fact: ${filename}`);
  }

  /**
   * 定期维护：导出 facts、清理旧记忆
   */
  async performMaintenance(): Promise<{
    factsExported: number;
    oldMemoriesCleaned: number;
  }> {
    const result = {
      factsExported: 0,
      oldMemoriesCleaned: 0
    };

    // 1. 导出高置信度 facts
    if (this.autoDream) {
      const exportPath = await this.exportFactsToMarkdown();
      if (exportPath) {
        const facts = this.autoDream.getFacts().filter(f => f.confidence >= 0.85);
        result.factsExported = facts.length;
      }
    }

    // 2. 清理过旧的记忆文件（90天未修改）
    const oldFiles = await this.findOldMemoryFiles(90);
    for (const file of oldFiles) {
      // 移动到归档目录，而不是删除
      await this.archiveMemoryFile(file);
      result.oldMemoriesCleaned++;
    }

    logger.info('MemoryManager', 
      `Maintenance complete: ${result.factsExported} facts exported, ${result.oldMemoriesCleaned} files archived`
    );
    
    return result;
  }

  // ==================== Session Memory (L1) ====================

  /**
   * 获取 Session Memory 路径
   */
  getSessionMemoryPath(): string {
    return path.join(this.sessionDir, 'memory.md');
  }

  /**
   * 读取 Session Memory
   */
  async readSessionMemory(): Promise<string> {
    try {
      return await fs.readFile(this.getSessionMemoryPath(), 'utf-8');
    } catch (error) {
      // 返回模板
      return this.getSessionMemoryTemplate();
    }
  }

  /**
   * 写入 Session Memory
   */
  async writeSessionMemory(content: string): Promise<void> {
    await fs.writeFile(this.getSessionMemoryPath(), content, 'utf-8');
  }

  /**
   * Session Memory 模板（10个固定章节）
   */
  getSessionMemoryTemplate(): string {
    return `# Session Memory

## 会话标题
_本会话主题的简要描述_

## 当前状态
_工作当前进展状态_

## 任务规格
_当前任务需求的详细描述_

## 文件与函数
_正在处理的关键文件和函数_

## 工作流程
_正在遵循的步骤或流程_

## 错误与修正
_遇到的错误及解决方式_

## 代码库与系统文档
_重要的代码模式、约定和系统行为_

## 学习收获
_本会话中获得的见解_

## 关键成果
_重要输出、指标或成就_

## 工作日志
_按时间顺序记录的操作_
`;
  }

  // ==================== 日志文件 ====================

  /**
   * 获取日志文件路径（按日期组织：logs/YYYY/MM/YYYY-MM-DD.md）
   */
  getLogPath(date?: Date): string {
    const d = date || new Date();
    const year = d.getFullYear().toString();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    
    return path.join(this.logsDir, year, month, `${year}-${month}-${day}.md`);
  }

  /**
   * 追加日志条目
   */
  async appendLog(entry: string, date?: Date): Promise<void> {
    const logPath = this.getLogPath(date);
    const logDir = path.dirname(logPath);
    
    try {
      await fs.mkdir(logDir, { recursive: true });
      const timestamp = new Date().toISOString();
      const content = `\n## ${timestamp}\n${entry}\n`;
      await fs.appendFile(logPath, content, 'utf-8');
    } catch (error) {
      logger.error('MemoryManager', `Failed to append log: ${error}`);
    }
  }

  // ==================== Frontmatter 解析 ====================

  parseFrontmatter(content: string): { frontmatter: MemoryFrontmatter | null; body: string } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { frontmatter: null, body: content };
    }

    const frontmatterText = match[1];
    const body = match[2].trim();

    const frontmatter: Partial<MemoryFrontmatter> = {};
    const lines = frontmatterText.split('\n');
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        
        if (key === 'tags') {
          const cleanValue = value.replace(/^\[|\]$/g, '');
          frontmatter.tags = cleanValue.split(',').map(t => t.trim()).filter(t => t);
        } else {
          (frontmatter as any)[key] = value;
        }
      }
    }

    if (!frontmatter.name || !frontmatter.description || !frontmatter.type) {
      return { frontmatter: null, body: content };
    }

    return {
      frontmatter: frontmatter as MemoryFrontmatter,
      body,
    };
  }

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

  // ==================== 持久记忆读写（L2） ====================

  async readMemoryFile(filePath: string): Promise<ParsedMemory | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const stats = await fs.stat(filePath);
      const { frontmatter, body } = this.parseFrontmatter(content);

      if (!frontmatter) {
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

  async writeMemoryFile(
    filename: string,
    frontmatter: MemoryFrontmatter,
    content: string,
    type?: MemoryType
  ): Promise<void> {
    const dir = type ? path.join(this.memoryDir, type) : this.memoryDir;
    await fs.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, filename);
    const fullContent = this.generateFrontmatter(frontmatter) + content;
    
    await fs.writeFile(filePath, fullContent, 'utf-8');
    await this.updateMemoryIndex(frontmatter, filename, type);
  }

  async deleteMemoryFile(filename: string, type?: MemoryType): Promise<void> {
    const dir = type ? path.join(this.memoryDir, type) : this.memoryDir;
    const filePath = path.join(dir, filename);
    
    try {
      await fs.unlink(filePath);
      await this.removeFromIndex(filename, type);
    } catch (error) {
      logger.error('MemoryManager', `Failed to delete memory file: ${error}`);
    }
  }

  // ==================== 索引管理 ====================

  getIndexPath(): string {
    return path.join(this.memoryDir, this.longTermIndex);
  }

  private async updateMemoryIndex(
    frontmatter: MemoryFrontmatter,
    filename: string,
    type?: MemoryType
  ): Promise<void> {
    const indexPath = this.getIndexPath();
    let indexContent = '';
    
    try {
      indexContent = await fs.readFile(indexPath, 'utf-8');
    } catch {
      indexContent = '# 记忆索引\n\n本文件索引所有持久化记忆。\n';
      for (const t of ['user', 'feedback', 'project', 'reference']) {
        indexContent += `\n## ${t}\n`;
      }
    }

    const relativePath = type ? `${type}/${filename}` : filename;
    const entryPattern = new RegExp(`- \\[[^\\]]+\\]\\(${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`);
    
    const truncatedDesc = frontmatter.description.length > 150 
      ? frontmatter.description.substring(0, 147) + '...'
      : frontmatter.description;
    
    const newEntry = `- [${frontmatter.name}](${relativePath}) — ${truncatedDesc}`;

    if (entryPattern.test(indexContent)) {
      const lines = indexContent.split('\n');
      const newLines = lines.map(line => {
        if (entryPattern.test(line)) {
          return newEntry;
        }
        return line;
      });
      indexContent = newLines.join('\n');
    } else {
      const typeSection = type || 'reference';
      const sectionPattern = new RegExp(`(## ${typeSection}\\n)`);
      
      if (sectionPattern.test(indexContent)) {
        indexContent = indexContent.replace(sectionPattern, `$1${newEntry}\n`);
      } else {
        indexContent += `\n## ${typeSection}\n${newEntry}\n`;
      }
    }

    indexContent = this.enforceIndexLimits(indexContent);
    await fs.writeFile(indexPath, indexContent, 'utf-8');
  }

  private async removeFromIndex(filename: string, type?: MemoryType): Promise<void> {
    const indexPath = this.getIndexPath();
    
    try {
      let indexContent = await fs.readFile(indexPath, 'utf-8');
      const relativePath = type ? `${type}/${filename}` : filename;
      const entryPattern = new RegExp(`- \\[[^\\]]+\\]\\(${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\).*\\n`);
      
      indexContent = indexContent.replace(entryPattern, '');
      await fs.writeFile(indexPath, indexContent, 'utf-8');
    } catch (error) {
      logger.error('MemoryManager', `Failed to remove from index: ${error}`);
    }
  }

  private enforceIndexLimits(content: string): string {
    const buffer = Buffer.from(content, 'utf-8');
    
    if (buffer.length > this.MAX_ENTRYPOINT_BYTES) {
      const lines = content.split('\n');
      let currentBytes = 0;
      const truncatedLines: string[] = [];
      
      for (const line of lines) {
        const lineBytes = Buffer.byteLength(line + '\n', 'utf-8');
        if (currentBytes + lineBytes > this.MAX_ENTRYPOINT_BYTES - 200) {
          break;
        }
        truncatedLines.push(line);
        currentBytes += lineBytes;
      }
      
      content = truncatedLines.join('\n');
      content += '\n\n> ⚠️ **索引已截断**：已达最大大小限制，部分旧条目未显示。\n';
    }
    
    const lines = content.split('\n');
    if (lines.length > this.MAX_ENTRYPOINT_LINES) {
      const truncated = lines.slice(0, this.MAX_ENTRYPOINT_LINES - 3);
      content = truncated.join('\n');
      content += '\n\n> ⚠️ **索引已截断**：已达最大行数限制，部分旧条目未显示。\n';
    }
    
    return content;
  }

  async readIndex(): Promise<string> {
    try {
      return await fs.readFile(this.getIndexPath(), 'utf-8');
    } catch (error) {
      return '# 记忆索引\n\n暂无记忆条目。\n';
    }
  }

  // ==================== 扫描与召回（增强版） ====================

  async scanMemoryFiles(): Promise<ParsedMemory[]> {
    const memories: ParsedMemory[] = [];

    const scanDir = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (memories.length >= this.MAX_SCAN_FILES) break;
          
          const fullPath = path.join(dir, entry.name);
          
          // 跳过 autodream 目录（那是 AutoDream 自己的数据）
          if (entry.isDirectory() && entry.name !== 'team' && entry.name !== 'autodream') {
            await scanDir(fullPath);
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
    memories.sort((a, b) => b.mtime - a.mtime);
    
    return memories.slice(0, this.MAX_SCAN_FILES);
  }

  /**
   * 增强的记忆召回：文件记忆 + AutoDream Facts
   */
  async findRelevantMemories(query: string, recentTools?: string[]): Promise<RelevantMemory[]> {
    // 1. 召回文件记忆
    const fileMemories = await this.findRelevantFileMemories(query, recentTools);
    
    // 2. 召回 AutoDream Facts
    const facts = this.autoDream ? this.autoDream.queryFacts(query, this.MAX_RELEVANT_FACTS) : [];
    
    // 3. 合并结果（Facts 转换为 RelevantMemory 格式）
    const factMemories: RelevantMemory[] = facts.map(f => ({
      memory: {
        path: `autodream://${f.id}`,
        frontmatter: {
          name: f.content.substring(0, 50),
          description: `AutoDream Fact (置信度: ${(f.confidence * 100).toFixed(0)}%)`,
          type: 'autodream',
        },
        content: f.content,
        mtime: f.updatedAt,
      },
      reason: 'AutoDream 事实',
      freshness: `${this.memoryAgeDays(f.updatedAt)} 天前`,
    }));
    
    // 4. 合并并去重
    const combined = [...fileMemories, ...factMemories];
    
    // 按相关性和新鲜度排序
    // 这里简化处理：文件记忆优先，然后是 facts
    return combined.slice(0, this.MAX_RELEVANT_MEMORIES + this.MAX_RELEVANT_FACTS);
  }

  /**
   * 召回文件记忆（原来的 findRelevantMemories 逻辑）
   */
  private async findRelevantFileMemories(query: string, recentTools?: string[]): Promise<RelevantMemory[]> {
    const allMemories = await this.scanMemoryFiles();
    
    if (allMemories.length === 0) {
      return [];
    }

    const now = Date.now();
    const validMemories = allMemories.filter(m => {
      const age = (now - m.mtime) / (1000 * 60 * 60 * 24);
      return age <= this.MAX_MEMORY_AGE_DAYS;
    });

    if (!this.llmService) {
      return this.fallbackKeywordSearch(query, validMemories);
    }

    try {
      const selectionPrompt = this.buildMemorySelectionPrompt(query, validMemories, recentTools);
      
      const response = await this.llmService.chat(
        [
          { role: 'system', content: selectionPrompt.system, timestamp: Date.now() },
          { role: 'user', content: selectionPrompt.user, timestamp: Date.now() },
        ],
        undefined,
        { maxTokens: 512 }
      );

      const selectedPaths = this.parseSelectionResponse(response.content);
      
      const results: RelevantMemory[] = [];
      for (const { path: memoryPath, reason } of selectedPaths) {
        const memory = validMemories.find(m => 
          m.path === memoryPath || 
          m.path.endsWith(memoryPath) ||
          path.relative(this.memoryDir, m.path) === memoryPath
        );
        if (memory) {
          results.push({
            memory,
            reason,
            freshness: this.getFreshnessText(memory.mtime),
          });
        }
      }

      return results.slice(0, this.MAX_RELEVANT_MEMORIES);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      logger.error('MemoryManager', `AI selection failed, falling back: ${errorMsg}`);
      return this.fallbackKeywordSearch(query, validMemories);
    }
  }

  private buildMemorySelectionPrompt(
    query: string,
    memories: ParsedMemory[],
    recentTools?: string[]
  ): { system: string; user: string } {
    const system = `你是记忆选择助手。任务：为用户查询选择最相关的记忆。

规则：
1. 最多返回 ${this.MAX_RELEVANT_MEMORIES} 个文件名
2. 严格筛选——不确定的不要包含
3. 相关性相近时优先选较新的记忆
4. 若提供了最近使用的工具，不要选择关于如何使用这些工具的记忆（用户已知道）
   - 但要选择关于这些工具的警告/坑点/已知问题的记忆

严格按以下格式回复：
selected_files:
- path/to/file1.md | 相关原因
- path/to/file2.md | 相关原因

如果没有相关的：
selected_files: none`;

    const memoryList = memories.map(m => {
      const relativePath = path.relative(this.memoryDir, m.path);
      const age = this.memoryAgeDays(m.mtime);
      const ageText = age === 0 ? '今天' : age === 1 ? '昨天' : `${age} 天前`;
      return `- [${m.frontmatter.type}] ${relativePath} (${ageText}): ${m.frontmatter.description}`;
    }).join('\n');

    const userParts = [`查询：${query}`, '', '可用记忆：', memoryList];
    
    if (recentTools && recentTools.length > 0) {
      userParts.push('', `最近使用的工具：${recentTools.join(', ')}`);
    }

    return { system, user: userParts.join('\n') };
  }

  private parseSelectionResponse(content: string): Array<{ path: string; reason: string }> {
    const results: Array<{ path: string; reason: string }> = [];
    
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

  private fallbackKeywordSearch(query: string, memories: ParsedMemory[]): RelevantMemory[] {
    const keywords = this.extractKeywords(query);
    const scored: Array<{ memory: ParsedMemory; score: number }> = [];

    for (const memory of memories) {
      let score = 0;
      const text = `${memory.frontmatter.name} ${memory.frontmatter.description} ${memory.content}`.toLowerCase();
      
      for (const keyword of keywords) {
        if (text.includes(keyword)) score += 1;
      }

      const age = this.memoryAgeDays(memory.mtime);
      score *= Math.max(0.3, 1 - age / 30);

      if (score > 0) {
        scored.push({ memory, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    
    return scored.slice(0, this.MAX_RELEVANT_MEMORIES).map(({ memory }) => ({
      memory,
      reason: '关键词匹配',
      freshness: this.getFreshnessText(memory.mtime),
    }));
  }

  // ==================== 新鲜度管理 ====================

  memoryAgeDays(mtimeMs: number): number {
    const now = Date.now();
    const diff = now - mtimeMs;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  getFreshnessText(mtimeMs: number): string {
    const days = this.memoryAgeDays(mtimeMs);
    
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    return `${days} 天前`;
  }

  getFreshnessWarning(mtimeMs: number): string {
    const days = this.memoryAgeDays(mtimeMs);
    
    if (days <= this.FRESHNESS_WARNING_DAYS) {
      return '';
    }

    return `

⚠️ **记忆新鲜度警告**
此记忆来自 ${days} 天前。
记忆是 point-in-time 观察，非实时状态——关于代码行为或文件行号的声明可能已过时。断言为事实前请先与当前代码核对。`;
  }

  formatMemoryContent(memory: ParsedMemory): string {
    const freshness = this.getFreshnessWarning(memory.mtime);
    return `## ${memory.frontmatter.name}
**类型：**${memory.frontmatter.type} | **更新于：**${this.getFreshnessText(memory.mtime)}

${memory.content}${freshness}`;
  }

  async injectRelevantMemories(context: string, _session?: any): Promise<string[]> {
    const relevant = await this.findRelevantMemories(context);
    return relevant.map(r => this.formatMemoryContent(r.memory));
  }

  // ==================== 维护功能 ====================

  /**
   * 查找旧记忆文件
   */
  private async findOldMemoryFiles(maxAgeDays: number): Promise<string[]> {
    const oldFiles: string[] = [];
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

    const scanDir = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'autodream') {
            await scanDir(fullPath);
          } else if (entry.name.endsWith('.md')) {
            const stats = await fs.stat(fullPath);
            if (stats.mtimeMs < cutoff) {
              oldFiles.push(fullPath);
            }
          }
        }
      } catch (error) {
        // 忽略错误
      }
    };

    await scanDir(this.memoryDir);
    return oldFiles;
  }

  /**
   * 归档记忆文件
   */
  private async archiveMemoryFile(filePath: string): Promise<void> {
    const archiveDir = path.join(this.memoryDir, 'archive');
    await fs.mkdir(archiveDir, { recursive: true });
    
    const fileName = path.basename(filePath);
    const archivePath = path.join(archiveDir, `${Date.now()}_${fileName}`);
    
    try {
      await fs.rename(filePath, archivePath);
      // 从索引中移除
      const relativePath = path.relative(this.memoryDir, filePath);
      const parts = relativePath.split(path.sep);
      if (parts.length === 2) {
        await this.removeFromIndex(parts[1], parts[0] as MemoryType);
      }
    } catch (error) {
      logger.warn('MemoryManager', `Failed to archive ${filePath}: ${error}`);
    }
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

  private extractTopics(content: string): string[] {
    const keywords = this.extractKeywords(content);
    return keywords.slice(0, 3);
  }
}

// 单例导出
export const memoryManager = new MemoryManager();
