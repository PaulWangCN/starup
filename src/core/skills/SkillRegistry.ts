import * as fs from 'fs/promises';
import * as path from 'path';
import YAML from 'yaml';
import { Skill, SkillPackage, SkillManifest } from '../../types';
import { logger } from '../../utils/Logger';

/**
 * Skill 注册表（简化版）
 *
 * 设计理念：
 * 1. 内置 skills：放在项目 skills/ 目录，系统启动时直接读取 SKILL.md 嵌入提示词
 * 2. 用户 skills：放在 ./.starup/skills/，扫描后写入 skills_index.md 作为扩展能力
 * 3. 大模型根据 SKILL.md 的 description 自行判断何时使用
 */
export class SkillRegistry {
  // 内置 skills（项目自带）
  private builtinSkills: Map<string, Skill> = new Map();
  // 用户安装的 skills
  private userSkills: Map<string, Skill> = new Map();
  // v1.2 manifest 格式的 packages
  private packages: Map<string, SkillPackage> = new Map();

  private skillsDir: string;
  private skillsIndexPath: string;
  private scanInterval: NodeJS.Timeout | null = null;
  private lastIndexContent: string = '';
  private onSkillsUpdated: (() => void) | null = null;

  constructor() {
    // 所有 skills 统一放到 .starup/skills 目录下
    // 这样用户可以自由管理（包括删除）任何 skill
    this.skillsDir = path.join(process.cwd(), '.starup', 'skills');
    this.skillsIndexPath = path.join(process.cwd(), '.starup', 'skills_index.md');
  }

  /**
   * 初始化：加载所有 skills
   */
  async initialize(): Promise<void> {
    // 确保 skills 目录存在
    await fs.mkdir(this.skillsDir, { recursive: true });
    // 加载所有 skills（统一从 .starup/skills 加载）
    await this.rescan();
    this.startAutoScan();
  }

  /**
   * 设置 skills 更新回调
   */
  setOnSkillsUpdated(callback: () => void): void {
    this.onSkillsUpdated = callback;
  }

  /**
   * 获取 skills_index.md 的内容（用于会话初始化时注入）
   */
  async getSkillsIndexContent(): Promise<string> {
    try {
      const content = await fs.readFile(this.skillsIndexPath, 'utf-8');
      this.lastIndexContent = content;
      return content;
    } catch {
      return '_当前没有安装的 skills。需要时可以使用 clawhub skill 搜索安装。_';
    }
  }

  /**
   * 获取内置 skills 的完整描述（用于系统提示词）
   */
  getBuiltinSkillsDescription(): string {
    // 现在所有 skills 都在同一个目录，不再需要区分内置和用户
    if (this.userSkills.size === 0) {
      return '';
    }

    const lines: string[] = ['## 已安装 Skills', ''];
    for (const [id, skill] of this.userSkills) {
      lines.push(`### ${skill.metadata.name}`);
      lines.push(`- **ID**: ${id}`);
      lines.push(`- **描述**: ${skill.metadata.description}`);
      if (skill.content) {
        lines.push('');
        lines.push(skill.content);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  /**
   * 重新扫描 skills 目录
   */
  async rescan(): Promise<void> {
    this.userSkills.clear();
    this.packages.clear();

    // 扫描 skills 目录（现在统一在 .starup/skills）
    await this.scanDirectory(this.skillsDir, this.userSkills);

    await this.writeSkillsIndex();
    
    // 触发更新回调
    if (this.onSkillsUpdated) {
      this.onSkillsUpdated();
    }
  }

  /**
   * 扫描目录加载 skills
   */
  private async scanDirectory(dir: string, targetMap: Map<string, Skill>): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = path.join(dir, entry.name);
        const skill = await this.loadSkillFromPath(skillPath);
        if (skill) {
          targetMap.set(skill.id, skill);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('SkillRegistry', `Scan directory failed: ${dir}, ${error}`);
      }
    }
  }



  /**
   * 从路径加载单个 skill
   * 最简单的形式：只需要 SKILL.md
   */
  private async loadSkillFromPath(skillPath: string): Promise<Skill | null> {
    // 1. 尝试 SKILL.md（标准格式）
    const skillFile = path.join(skillPath, 'SKILL.md');
    try {
      const content = await fs.readFile(skillFile, 'utf-8');
      return this.parseSkillMd(content, skillPath);
    } catch {
      // 没有 SKILL.md，尝试 manifest.yaml
    }

    // 2. 尝试 manifest.yaml（v1.2 格式）
    const manifestPath = path.join(skillPath, 'manifest.yaml');
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = YAML.parse(content) as SkillManifest;

      let promptContent: string | undefined;
      try {
        promptContent = await fs.readFile(path.join(skillPath, 'PROMPT.md'), 'utf-8');
      } catch {
        // ignore
      }

      const pkg: SkillPackage = {
        manifest,
        path: skillPath,
        content: promptContent,
        status: 'active',
        installedAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.packages.set(manifest.id, pkg);

      // 转换为 Skill 格式返回
      return {
        id: manifest.id,
        metadata: {
          name: manifest.name,
          description: manifest.description,
          version: manifest.version,
        },
        content: promptContent || manifest.description,
        path: skillPath,
      };
    } catch {
      // 无效 skill 目录
    }

    return null;
  }

  /**
   * 解析 SKILL.md
   * 格式：YAML Frontmatter + Markdown Body
   * 支持 Windows (\r\n) 和 Unix (\n) 换行符
   */
  private parseSkillMd(content: string, skillPath: string): Skill {
    // 统一处理换行符，支持 Windows \r\n 和 Unix \n
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    let metadata: { name: string; description: string; version?: string };
    let skillContent: string;

    if (frontmatterMatch) {
      const yamlContent = YAML.parse(frontmatterMatch[1]);
      metadata = {
        name: yamlContent.name || path.basename(skillPath),
        description: yamlContent.description || '',
        version: yamlContent.version,
      };
      skillContent = frontmatterMatch[2].trim();
    } else {
      // 没有 frontmatter，使用文件名作为 name
      metadata = {
        name: path.basename(skillPath),
        description: '',
      };
      skillContent = normalizedContent.trim();
    }

    return {
      id: metadata.name,
      metadata,
      content: skillContent,
      path: skillPath,
    };
  }

  /**
   * 生成 skills 索引文件（精简版）
   */
  private async writeSkillsIndex(): Promise<void> {
    const lines: string[] = [
      '# 已安装 Skills',
      '',
    ];

    const all = [...Array.from(this.userSkills.values()), ...Array.from(this.packages.values())];

    if (all.length === 0) {
      lines.push('_当前没有安装的 skills。_');
    } else {
      for (const item of all) {
        if ('manifest' in item) {
          const pkg = item as SkillPackage;
          lines.push(`- **${pkg.manifest.name}**: ${pkg.manifest.description}`);
          lines.push(`  - 路径: ${pkg.path}`);
        } else {
          const skill = item as Skill;
          lines.push(`- **${skill.metadata.name}**: ${skill.metadata.description}`);
          lines.push(`  - 路径: ${skill.path}`);
        }
      }
    }

    await fs.mkdir(path.dirname(this.skillsIndexPath), { recursive: true });
    await fs.writeFile(this.skillsIndexPath, lines.join('\n'), 'utf-8');
    
    logger.debug('SkillRegistry', `Skills index updated: ${all.length} skills`);
  }



  /**
   * 获取 skill
   */
  getSkill(id: string): Skill | undefined {
    return this.builtinSkills.get(id) || this.userSkills.get(id);
  }

  /**
   * 获取 package
   */
  getPackage(id: string): SkillPackage | undefined {
    return this.packages.get(id);
  }

  /**
   * 列出所有 skills（兼容旧接口）
   */
  list(): { builtin: Skill[]; user: Skill[]; packages: SkillPackage[]; legacy: Skill[] } {
    return {
      builtin: Array.from(this.builtinSkills.values()),
      user: Array.from(this.userSkills.values()),
      packages: Array.from(this.packages.values()),
      legacy: [], // 兼容旧代码
    };
  }

  /**
   * 获取所有 skills（兼容旧接口）
   */
  getAll(): Skill[] {
    return [
      ...Array.from(this.builtinSkills.values()),
      ...Array.from(this.userSkills.values()),
    ];
  }

  /**
   * 获取 skill 描述列表（兼容旧接口）
   */
  getSkillDescriptions(): { id: string; name: string; description: string; version?: string }[] {
    return this.getAll().map((s) => ({
      id: s.id,
      name: s.metadata.name,
      description: s.metadata.description,
      version: s.metadata.version,
    }));
  }



  /**
   * 获取依赖树（兼容旧接口）
   */
  async dependencyTree(skillId: string): Promise<any> {
    return null;
  }

  /**
   * 获取 legacy skill（兼容旧接口）
   */
  getLegacy(id: string): Skill | undefined {
    return this.getSkill(id);
  }

  /**
   * 启动定时扫描（4小时）
   */
  private startAutoScan(): void {
    if (this.scanInterval) return;
    this.scanInterval = setInterval(() => {
      this.rescan().catch((err) => logger.error('SkillRegistry', `Auto scan failed: ${err}`));
    }, 4 * 60 * 60 * 1000);
  }

  /**
   * 停止定时扫描
   */
  stopAutoScan(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }
}

export const skillRegistry = new SkillRegistry();
