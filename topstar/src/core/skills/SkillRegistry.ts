import * as fs from 'fs/promises';
import * as path from 'path';
import { Skill, SkillMetadata } from '../../types';
import YAML from 'yaml';

/**
 * Skill 注册表
 * 管理 Skill 的加载、存储和匹配
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private builtinSkillsDir: string;
  private userSkillsDir: string;
  private watchMode: boolean = false;

  constructor() {
    // 计算内置 skills 目录路径（支持 ts-node 和编译后的环境）
    const isCompiled = __dirname.includes('dist');
    if (isCompiled) {
      // 编译后：从 dist/core/skills/ 指向项目根目录的 skills/
      this.builtinSkillsDir = path.join(process.cwd(), 'skills');
    } else {
      // ts-node：从 src/core/skills/ 指向 src/skills/
      this.builtinSkillsDir = path.join(__dirname, '../../../skills');
    }
    this.userSkillsDir = path.join(process.env.HOME || '.', '.starup', 'skills');
  }

  /**
   * 初始化并加载所有 Skills
   */
  async initialize(): Promise<void> {
    console.log('[SkillRegistry] Initializing...');
    
    // 加载内置 Skills
    await this.loadSkillsFromDirectory(this.builtinSkillsDir);
    
    // 加载用户 Skills
    await this.loadSkillsFromDirectory(this.userSkillsDir);
    
    console.log(`[SkillRegistry] Loaded ${this.skills.size} skills`);
  }

  /**
   * 从目录加载 Skills
   */
  async loadSkillsFromDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(dir, entry.name);
          await this.loadSkill(skillPath);
        }
      }
    } catch (error) {
      // 目录可能不存在，忽略错误
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[SkillRegistry] Error loading from ${dir}:`, error);
      }
    }
  }

  /**
   * 加载单个 Skill
   */
  async loadSkill(skillPath: string): Promise<Skill | null> {
    const skillFile = path.join(skillPath, 'SKILL.md');
    
    try {
      const content = await fs.readFile(skillFile, 'utf-8');
      const skill = this.parseSkill(content, skillPath);
      
      // 加载脚本和资源
      await this.loadScripts(skill);
      await this.loadResources(skill);
      
      this.skills.set(skill.id, skill);
      console.log(`[SkillRegistry] Loaded skill: ${skill.id}`);
      return skill;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[SkillRegistry] Error loading skill from ${skillPath}:`, error);
      }
      return null;
    }
  }

  /**
   * 解析 SKILL.md 文件
   */
  private parseSkill(content: string, skillPath: string): Skill {
    // 解析 YAML Frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    
    let metadata: SkillMetadata;
    let skillContent: string;
    
    if (frontmatterMatch) {
      const yamlContent = frontmatterMatch[1];
      metadata = YAML.parse(yamlContent) as SkillMetadata;
      skillContent = frontmatterMatch[2].trim();
    } else {
      throw new Error('Invalid SKILL.md format: missing YAML frontmatter');
    }

    return {
      id: metadata.name,
      metadata,
      content: skillContent,
      path: skillPath,
      scripts: new Map(),
      resources: new Map(),
    };
  }

  /**
   * 加载脚本文件
   */
  private async loadScripts(skill: Skill): Promise<void> {
    const scriptsDir = path.join(skill.path, 'scripts');
    
    try {
      const entries = await fs.readdir(scriptsDir);
      for (const entry of entries) {
        const scriptPath = path.join(scriptsDir, entry);
        const content = await fs.readFile(scriptPath, 'utf-8');
        skill.scripts!.set(entry, content);
      }
    } catch (error) {
      // 没有 scripts 目录是正常的
    }
  }

  /**
   * 加载资源文件
   */
  private async loadResources(skill: Skill): Promise<void> {
    const resourcesDir = path.join(skill.path, 'resources');
    
    try {
      const entries = await fs.readdir(resourcesDir);
      for (const entry of entries) {
        const resourcePath = path.join(resourcesDir, entry);
        const content = await fs.readFile(resourcePath, 'utf-8');
        skill.resources!.set(entry, content);
      }
    } catch (error) {
      // 没有 resources 目录是正常的
    }
  }

  /**
   * 获取 Skill
   */
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * 获取所有 Skills
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取 Skill 列表（用于LLM）
   */
  getSkillDescriptions(): { name: string; description: string }[] {
    return this.getAll().map((skill) => ({
      name: skill.metadata.name,
      description: skill.metadata.description,
    }));
  }

  /**
   * 根据任务匹配 Skill
   * 简单的关键词匹配，实际应使用语义匹配
   */
  matchSkills(task: string): Skill[] {
    const taskLower = task.toLowerCase();
    const matches: Skill[] = [];
    
    for (const skill of this.skills.values()) {
      const desc = skill.metadata.description.toLowerCase();
      // 简单的相似度判断
      if (this.calculateSimilarity(taskLower, desc) > 0.3) {
        matches.push(skill);
      }
    }
    
    return matches.slice(0, 3); // 最多返回3个匹配
  }

  /**
   * 安装 Skill
   */
  async installSkill(sourcePath: string): Promise<boolean> {
    try {
      const skill = await this.loadSkill(sourcePath);
      if (!skill) return false;

      // 复制到用户目录
      const targetPath = path.join(this.userSkillsDir, path.basename(sourcePath));
      await fs.mkdir(this.userSkillsDir, { recursive: true });
      await this.copyDirectory(sourcePath, targetPath);
      
      console.log(`[SkillRegistry] Installed skill: ${skill.id}`);
      return true;
    } catch (error) {
      console.error(`[SkillRegistry] Failed to install skill:`, error);
      return false;
    }
  }

  /**
   * 卸载 Skill
   */
  async uninstallSkill(skillId: string): Promise<boolean> {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    try {
      // 只卸载用户目录中的 skill
      if (skill.path.startsWith(this.userSkillsDir)) {
        await fs.rm(skill.path, { recursive: true });
      }
      
      this.skills.delete(skillId);
      console.log(`[SkillRegistry] Uninstalled skill: ${skillId}`);
      return true;
    } catch (error) {
      console.error(`[SkillRegistry] Failed to uninstall skill:`, error);
      return false;
    }
  }

  /**
   * 启用热加载（开发模式）
   */
  enableWatchMode(): void {
    if (this.watchMode) return;
    this.watchMode = true;
    
    // 简化的热加载：定时重新加载
    setInterval(async () => {
      await this.loadSkillsFromDirectory(this.builtinSkillsDir);
      await this.loadSkillsFromDirectory(this.userSkillsDir);
    }, 5000);
    
    console.log('[SkillRegistry] Watch mode enabled');
  }

  /**
   * 从远程安装 Skill
   */
  async installFromRemote(url: string): Promise<boolean> {
    // TODO: 实现从 skillhub 等平台下载安装
    console.log(`[SkillRegistry] Installing from remote: ${url}`);
    return false;
  }

  // ==================== 私有方法 ====================

  private calculateSimilarity(str1: string, str2: string): number {
    // 简单的相似度计算
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));
    
    let common = 0;
    for (const word of words1) {
      if (words2.has(word)) common++;
    }
    
    return common / Math.max(words1.size, words2.size);
  }

  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}

// 单例导出
export const skillRegistry = new SkillRegistry();
