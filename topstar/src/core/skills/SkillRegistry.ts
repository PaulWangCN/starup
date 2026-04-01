import * as fs from 'fs/promises';
import * as path from 'path';
import YAML from 'yaml';
import { Skill, SkillPackage, SkillManifest, InstallResult } from '../../types';
import { installManager } from './InstallManager';

/**
 * Skill 注册表（简化版）
 *
 * 设计理念：
 * 1. 内置 skills：放在项目 skills/ 目录，系统启动时直接读取 SKILL.md 嵌入提示词
 * 2. 用户 skills：放在 ~/.starup/skills/，扫描后写入 skills_index.md 作为扩展能力
 * 3. 大模型根据 SKILL.md 的 description 自行判断何时使用
 */
export class SkillRegistry {
  // 内置 skills（项目自带）
  private builtinSkills: Map<string, Skill> = new Map();
  // 用户安装的 skills
  private userSkills: Map<string, Skill> = new Map();
  // v1.2 manifest 格式的 packages
  private packages: Map<string, SkillPackage> = new Map();

  private builtinSkillsDir: string;
  private userSkillsDir: string;
  private skillsIndexPath: string;
  private scanInterval: NodeJS.Timeout | null = null;

  constructor() {
    const isCompiled = __dirname.includes('dist');
    if (isCompiled) {
      this.builtinSkillsDir = path.join(process.cwd(), 'skills');
    } else {
      this.builtinSkillsDir = path.join(__dirname, '../../../skills');
    }
    this.userSkillsDir = path.join(process.env.HOME || '.', '.starup', 'skills');
    this.skillsIndexPath = path.join(process.env.HOME || '.', '.starup', 'skills_index.md');
  }

  /**
   * 初始化：加载内置 skills 和用户 skills
   */
  async initialize(): Promise<void> {
    await installManager.initialize();
    // 加载内置 skills（直接嵌入提示词）
    await this.loadBuiltinSkills();
    // 加载用户 skills（写入索引文件）
    await this.rescan();
    this.startAutoScan();
  }

  /**
   * 获取内置 skills 的完整描述（用于系统提示词）
   */
  getBuiltinSkillsDescription(): string {
    if (this.builtinSkills.size === 0) {
      return '';
    }

    const lines: string[] = ['## 内置 Skills（可直接使用）', ''];
    for (const [id, skill] of this.builtinSkills) {
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
   * 重新扫描用户 skills 目录
   */
  async rescan(): Promise<void> {
    this.userSkills.clear();
    this.packages.clear();

    // 扫描用户目录
    await this.scanDirectory(this.userSkillsDir, this.userSkills);
    // 同步 InstallManager 的已安装列表
    for (const pkg of installManager.list()) {
      if (!this.packages.has(pkg.manifest.id)) {
        this.packages.set(pkg.manifest.id, pkg);
      }
    }

    await this.writeSkillsIndex();
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
        console.warn(`[SkillRegistry] Scan directory failed: ${dir}`, error);
      }
    }
  }

  /**
   * 加载内置 skills
   */
  private async loadBuiltinSkills(): Promise<void> {
    this.builtinSkills.clear();
    await this.scanDirectory(this.builtinSkillsDir, this.builtinSkills);
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
   */
  private parseSkillMd(content: string, skillPath: string): Skill {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

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
      skillContent = content.trim();
    }

    return {
      id: metadata.name,
      metadata,
      content: skillContent,
      path: skillPath,
    };
  }

  /**
   * 生成用户 skills 索引文件
   */
  private async writeSkillsIndex(): Promise<void> {
    const lines: string[] = [
      '# 用户安装的 Skills 索引',
      '',
      '以下 skills 已安装，可以在需要时使用：',
      '',
    ];

    const all = [...Array.from(this.userSkills.values()), ...Array.from(this.packages.values())];

    if (all.length === 0) {
      lines.push('_当前没有用户安装的 skills。_');
    } else {
      for (const item of all) {
        if ('manifest' in item) {
          const pkg = item as SkillPackage;
          lines.push(`## ${pkg.manifest.name}`);
          lines.push(`- **ID**: ${pkg.manifest.id}`);
          lines.push(`- **版本**: ${pkg.manifest.version}`);
          lines.push(`- **描述**: ${pkg.manifest.description}`);
          if (pkg.content) {
            lines.push('');
            lines.push(pkg.content);
          }
        } else {
          const skill = item as Skill;
          lines.push(`## ${skill.metadata.name}`);
          lines.push(`- **ID**: ${skill.id}`);
          lines.push(`- **描述**: ${skill.metadata.description}`);
          if (skill.content) {
            lines.push('');
            lines.push(skill.content);
          }
        }
        lines.push('');
      }
    }

    // 添加使用提示
    lines.push('---');
    lines.push('');
    lines.push('## 提示');
    lines.push('如果以上 skills 无法满足需求，可以使用内置的 `clawhub` skill 搜索更多 skills。');
    lines.push('例如："帮我搜索一个能处理 PDF 的 skill"');
    lines.push('');

    await fs.mkdir(path.dirname(this.skillsIndexPath), { recursive: true });
    await fs.writeFile(this.skillsIndexPath, lines.join('\n'), 'utf-8');
  }

  /**
   * 安装 skill
   */
  async install(spec: any, options?: any): Promise<InstallResult> {
    const result = await installManager.install(spec, options);
    if (result.success) {
      await this.rescan();
    }
    return result;
  }

  /**
   * 卸载 skill
   */
  async uninstall(skillId: string, options?: { purgeData?: boolean }): Promise<boolean> {
    const result = await installManager.uninstall(skillId, options);
    if (result) {
      this.userSkills.delete(skillId);
      this.packages.delete(skillId);
      await this.rescan();
    }
    return result;
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
    return this.packages.get(id) || installManager.get(id);
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
   * 升级 skill（兼容旧接口）
   */
  async upgrade(skillId: string, toVersion: string): Promise<any> {
    return installManager.upgrade(skillId, toVersion);
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
      this.rescan().catch((err) => console.error('[SkillRegistry] Auto scan failed:', err));
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
