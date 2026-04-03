import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryEntry, MemoryType, MemoryFrontmatter, ParsedMemory, RelevantMemory } from '../../types';
import { LLMService } from '../llm/LLMService';
import { logger } from '../../utils/Logger';

/**
 * 记忆管理器 v3 - Claude Code 三层记忆架构实现
 * 
 * 架构：
 * L1 Session Memory: .starup/session/memory.md - 10章节固定格式，服务于上下文压缩
 * L2 Persistent Memory: .starup/memory/{type}/*.md - 4种类型，AI召回
 * L3 Team Memory: .starup/memory/team/*.md - 团队协作（暂忽略）
 * 
 * 核心特性：
 * 1. AI 驱动的记忆召回（替代关键词匹配）
 * 2. 记忆新鲜度标注（防止过期幻觉）
 * 3. YAML frontmatter 格式支持
 * 4. MEMORY.md 索引管理（200行/25KB限制）
 * 5. 两步保存流程（先写文件，再更新索引）
 */
export class MemoryManager {
  private memoryDir: string;
  private sessionDir: string;
  private logsDir: string;
  private longTermIndex: string = 'MEMORY.md';
  private llmService?: LLMService;

  // 索引限制
  private readonly MAX_ENTRYPOINT_LINES = 200;
  private readonly MAX_ENTRYPOINT_BYTES = 25000;
  
  // 召回限制
  private readonly MAX_RELEVANT_MEMORIES = 5;
  private readonly MAX_SCAN_FILES = 200;
  private readonly FRESHNESS_WARNING_DAYS = 1;
  private readonly MAX_MEMORY_AGE_DAYS = 90;

  // Session Memory 限制
  private readonly MAX_SECTION_LENGTH = 2000;
  private readonly MAX_TOTAL_SESSION_MEMORY_TOKENS = 12000;

  constructor(llmService?: LLMService) {
    const baseDir = path.join(process.cwd(), '.starup');
    this.memoryDir = path.join(baseDir, 'memory');
    this.sessionDir = path.join(baseDir, 'session');
    this.logsDir = path.join(baseDir, 'logs');
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
    const dirs = [
      this.memoryDir,
      this.sessionDir,
      this.logsDir,
      path.join(this.memoryDir, 'user'),
      path.join(this.memoryDir, 'feedback'),
      path.join(this.memoryDir, 'project'),
      path.join(this.memoryDir, 'reference'),
      path.join(this.memoryDir, 'team'),
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        logger.error('MemoryManager', `Failed to create directory ${dir}: ${error}`);
      }
    }
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

  // ==================== 日志文件（KAIROS 模式） ====================

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
   * 追加日志条目（KAIROS 模式 - 只追加不编辑）
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
          const cleanValue = value.replace(/^\[|\]$/g, '');
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

  // ==================== 持久记忆读写（L2） ====================

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
   * 
   * 两步保存流程：
   * 1. 写入记忆文件
   * 2. 更新 MEMORY.md 索引
   */
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
    
    // 更新索引
    await this.updateMemoryIndex(frontmatter, filename, type);
  }

  /**
   * 删除记忆文件
   */
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

  // ==================== MEMORY.md 索引管理 ====================

  /**
   * 获取索引文件路径
   */
  getIndexPath(): string {
    return path.join(this.memoryDir, this.longTermIndex);
  }

  /**
   * 更新 MEMORY.md 索引
   * 
   * 格式：- [记忆名称](path/to/file.md) — 简短描述（约150字符以内）
   * 限制：
   * - 最大 200 行（MAX_ENTRYPOINT_LINES）
   * - 最大 25,000 字节（MAX_ENTRYPOINT_BYTES）
   * - 超出时在末尾追加截断警告
   */
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
      // 文件不存在，创建新索引
      indexContent = '# 记忆索引\n\n本文件索引所有持久化记忆。\n';
      for (const t of ['user', 'feedback', 'project', 'reference']) {
        indexContent += `\n## ${t}\n`;
      }
    }

    // 构建相对路径
    const relativePath = type ? `${type}/${filename}` : filename;
    const entryPattern = new RegExp(`- \\[[^\\]]+\\]\\(${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`);
    
    // 截断描述到约150字符
    const truncatedDesc = frontmatter.description.length > 150 
      ? frontmatter.description.substring(0, 147) + '...'
      : frontmatter.description;
    
    const newEntry = `- [${frontmatter.name}](${relativePath}) — ${truncatedDesc}`;

    if (entryPattern.test(indexContent)) {
      // 更新现有条目
      const lines = indexContent.split('\n');
      const newLines = lines.map(line => {
        if (entryPattern.test(line)) {
          return newEntry;
        }
        return line;
      });
      indexContent = newLines.join('\n');
    } else {
      // 在对应类型章节下添加新条目
      const typeSection = type || 'reference';
      const sectionPattern = new RegExp(`(## ${typeSection}\\n)`);
      
      if (sectionPattern.test(indexContent)) {
        indexContent = indexContent.replace(sectionPattern, `$1${newEntry}\n`);
      } else {
        indexContent += `\n## ${typeSection}\n${newEntry}\n`;
      }
    }

    // 应用索引限制
    indexContent = this.enforceIndexLimits(indexContent);

    await fs.writeFile(indexPath, indexContent, 'utf-8');
  }

  /**
   * 从索引中移除条目
   */
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

  /**
   * 强制执行索引限制
   */
  private enforceIndexLimits(content: string): string {
    const buffer = Buffer.from(content, 'utf-8');
    
    // 检查字节限制
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
    
    // 检查行数限制
    const lines = content.split('\n');
    if (lines.length > this.MAX_ENTRYPOINT_LINES) {
      const truncated = lines.slice(0, this.MAX_ENTRYPOINT_LINES - 3);
      content = truncated.join('\n');
      content += '\n\n> ⚠️ **索引已截断**：已达最大行数限制，部分旧条目未显示。\n';
    }
    
    return content;
  }

  /**
   * 读取索引
   */
  async readIndex(): Promise<string> {
    try {
      return await fs.readFile(this.getIndexPath(), 'utf-8');
    } catch (error) {
      return '# 记忆索引\n\n暂无记忆条目。\n';
    }
  }

  // ==================== 扫描与召回 ====================

  /**
   * 扫描所有记忆文件
   */
  async scanMemoryFiles(): Promise<ParsedMemory[]> {
    const memories: ParsedMemory[] = [];

    // 递归扫描目录
    const scanDir = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (memories.length >= this.MAX_SCAN_FILES) break;
          
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory() && entry.name !== 'team') {
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

    // 按修改时间降序排序
    memories.sort((a, b) => b.mtime - a.mtime);
    
    return memories.slice(0, this.MAX_SCAN_FILES);
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

    // 过滤掉过旧的记忆（90天）
    const now = Date.now();
    const validMemories = allMemories.filter(m => {
      const age = (now - m.mtime) / (1000 * 60 * 60 * 24);
      return age <= this.MAX_MEMORY_AGE_DAYS;
    });

    // 如果没有 LLM 服务，回退到简单匹配
    if (!this.llmService) {
      return this.fallbackKeywordSearch(query, validMemories);
    }

    try {
      // 2. 构建选择提示
      const selectionPrompt = this.buildMemorySelectionPrompt(query, validMemories, recentTools);
      
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
    } catch (error) {
      logger.error('MemoryManager', `AI selection failed, falling back: ${error}`);
      return this.fallbackKeywordSearch(query, validMemories);
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

    // 构建记忆列表
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
      reason: '关键词匹配',
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
   * 
   * 使用相对时间（X 天前）比 ISO 时间戳更能触发模型的过期推理
   */
  getFreshnessText(mtimeMs: number): string {
    const days = this.memoryAgeDays(mtimeMs);
    
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    return `${days} 天前`;
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

    return `\n\n⚠️ **记忆新鲜度警告**\n此记忆来自 ${days} 天前。\n记忆是 point-in-time 观察，非实时状态——关于代码行为或文件行号的声明可能已过时。断言为事实前请先与当前代码核对。`;
  }

  /**
   * 格式化记忆内容（带新鲜度标注）
   */
  formatMemoryContent(memory: ParsedMemory): string {
    const freshness = this.getFreshnessWarning(memory.mtime);
    return `## ${memory.frontmatter.name}\n**类型：**${memory.frontmatter.type} | **更新于：**${this.getFreshnessText(memory.mtime)}\n\n${memory.content}${freshness}`;
  }

  // ==================== 记忆注入 ====================

  /**
   * 获取相关记忆并注入上下文
   */
  async injectRelevantMemories(context: string, _session?: any): Promise<string[]> {
    const relevant = await this.findRelevantMemories(context);
    return relevant.map(r => this.formatMemoryContent(r.memory));
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

// 单例导出
export const memoryManager = new MemoryManager();
