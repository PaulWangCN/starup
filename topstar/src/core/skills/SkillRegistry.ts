import * as fs from 'fs/promises';
import * as path from 'path';
import YAML from 'yaml';
import {
  Skill,
  SkillMetadata,
  SkillPackage,
  SkillManifest,
  InstallSpec,
  InstallOptions,
  InstallResult,
  ToolDefinition,
  DependencyTree,
} from '../../types';
import { installManager } from './InstallManager';
import { toolRegistry } from '../tools/ToolRegistry';

/**
 * Skill 注册表（简化版）
 * 职责：
 * 1. 启动时扫描 skills 目录
 * 2. 加载 skill 的工具定义到 ToolRegistry
 * 3. 生成 skills_index.md 供 LLM 读取
 * 4. 定时重新扫描（每 30 秒）
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
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
   * 初始化：扫描一次并启动定时器
   */
  async initialize(): Promise<void> {
    console.log('[SkillRegistry] Initializing...');
    await installManager.initialize();
    await this.rescan();
    this.startAutoScan();
    console.log('[SkillRegistry] Initialized');
  }

  /**
   * 重新扫描所有 skills
   */
  async rescan(): Promise<void> {
    this.skills.clear();
    this.packages.clear();

    // 扫描内置目录
    await this.scanDirectory(this.builtinSkillsDir);
    // 扫描用户目录
    await this.scanDirectory(this.userSkillsDir);
    // 同步 InstallManager 的已安装列表
    for (const pkg of installManager.list()) {
      if (!this.packages.has(pkg.manifest.id)) {
        this.packages.set(pkg.manifest.id, pkg);
        await this.loadSkillTools(pkg.manifest.id, pkg.path);
      }
    }

    await this.writeSkillsIndex();
  }

  /**
   * 扫描目录下的所有 skill
   */
  private async scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = path.join(dir, entry.name);
        await this.loadSkillFromPath(skillPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[SkillRegistry] Scan directory failed: ${dir}`, error);
      }
    }
  }

  /**
   * 从路径加载单个 skill
   */
  private async loadSkillFromPath(skillPath: string): Promise<void> {
    // 优先尝试 manifest.yaml (v1.2)
    const manifestPath = path.join(skillPath, 'manifest.yaml');
    try {
      await fs.access(manifestPath);
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
      await this.loadSkillTools(manifest.id, skillPath);
      return;
    } catch {
      // 没有 manifest.yaml，尝试 SKILL.md (v1.1)
    }

    const skillFile = path.join(skillPath, 'SKILL.md');
    try {
      const content = await fs.readFile(skillFile, 'utf-8');
      const skill = this.parseSkillMd(content, skillPath);
      this.skills.set(skill.id, skill);
      await this.loadSkillTools(skill.id, skillPath);
    } catch {
      // ignore invalid skill directories
    }
  }

  /**
   * 加载 skill 的工具定义
   * 如果目录下有 index.js，尝试 require 并注册工具
   */
  private async loadSkillTools(skillId: string, skillPath: string): Promise<void> {
    const indexPath = path.join(skillPath, 'index.js');
    try {
      await fs.access(indexPath);
      // 清除 require 缓存以便热重载
      delete require.cache[require.resolve(indexPath)];
      const module = require(indexPath);
      if (module.tools && Array.isArray(module.tools)) {
        for (const tool of module.tools) {
          const toolDef: ToolDefinition = {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.parameters || [],
            handler: tool.handler,
          };
          toolRegistry.register(toolDef);
          toolRegistry.setToolSource(toolDef.name, skillId);
        }
      }
    } catch {
      // ignore
    }

    // 也尝试 tools.json
    const toolsJsonPath = path.join(skillPath, 'tools.json');
    try {
      const toolsContent = await fs.readFile(toolsJsonPath, 'utf-8');
      const tools = JSON.parse(toolsContent);
      if (Array.isArray(tools)) {
        for (const tool of tools) {
          // tools.json 只包含元信息，handler 需要在 index.js 中定义
          // 如果已经通过 index.js 注册了，跳过
          if (toolRegistry.get(tool.name)) continue;
          console.warn(`[SkillRegistry] Tool "${tool.name}" has no handler in ${skillId}`);
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * 生成 skills_index.md
   */
  private async writeSkillsIndex(): Promise<void> {
    const lines: string[] = [
      '# 可用 Skills 索引',
      '',
      '当用户提出以下类型的请求时，你可以调用对应的 skill 或使用相关工具：',
      '',
    ];

    const all = [...Array.from(this.skills.values()), ...Array.from(this.packages.values())];
    if (all.length === 0) {
      lines.push('_当前没有加载任何 skill。_');
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
          lines.push(`- **版本**: ${skill.metadata.version || '1.0.0'}`);
          lines.push(`- **描述**: ${skill.metadata.description}`);
          if (skill.content) {
            lines.push('');
            lines.push(skill.content);
          }
        }
        lines.push('');
      }
    }

    await fs.mkdir(path.dirname(this.skillsIndexPath), { recursive: true });
    await fs.writeFile(this.skillsIndexPath, lines.join('\n'), 'utf-8');
    // console.log deliberately omitted to avoid spamming the user console
  }

  /**
   * 解析 SKILL.md
   */
  private parseSkillMd(content: string, skillPath: string): Skill {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    let metadata: SkillMetadata;
    let skillContent: string;

    if (frontmatterMatch) {
      metadata = YAML.parse(frontmatterMatch[1]) as SkillMetadata;
      skillContent = frontmatterMatch[2].trim();
    } else {
      metadata = { name: path.basename(skillPath), description: '' };
      skillContent = content.trim();
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
   * 安装 skill
   */
  async install(spec: InstallSpec | string, options: InstallOptions = {}): Promise<InstallResult> {
    const installSpec = typeof spec === 'string' ? this.parseInstallString(spec) : spec;
    const result = await installManager.install(installSpec, options);
    if (result.success) {
      await this.rescan();
    }
    return result;
  }

  /**
   * 卸载 skill
   */
  async uninstall(skillId: string, options: { purgeData?: boolean } = {}): Promise<boolean> {
    const result = await installManager.uninstall(skillId, options);
    if (result) {
      this.packages.delete(skillId);
      this.skills.delete(skillId);
      await this.rescan();
    }
    return result;
  }

  /**
   * 列出所有 skill
   */
  list(): { legacy: Skill[]; packages: SkillPackage[] } {
    return {
      legacy: Array.from(this.skills.values()),
      packages: Array.from(this.packages.values()),
    };
  }

  /**
   * 获取所有 skill（v1.1 兼容接口）
   */
  getAll(): Skill[] {
    const legacy = Array.from(this.skills.values());
    const packagesAsSkills: Skill[] = Array.from(this.packages.values()).map((pkg) => ({
      id: pkg.manifest.id,
      metadata: {
        name: pkg.manifest.name,
        description: pkg.manifest.description,
        version: pkg.manifest.version,
        tools: [],
      },
      content: pkg.content || '',
      path: pkg.path,
    }));
    return [...legacy, ...packagesAsSkills];
  }

  /**
   * 获取 skill 描述
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
   * 获取索引文件路径
   */
  getSkillsIndexPath(): string {
    return this.skillsIndexPath;
  }

  /**
   * 启动定时扫描
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

  async upgrade(skillId: string, toVersion: string) {
    const result = await installManager.upgrade(skillId, toVersion);
    if (result.success) {
      await this.rescan();
    }
    return result;
  }

  async dependencyTree(skillId: string): Promise<DependencyTree | null> {
    const pkg = this.getPackage(skillId);
    if (!pkg || !pkg.manifest.dependencies || pkg.manifest.dependencies.length === 0) {
      return null;
    }
    // 简化返回，不再做 SAT 求解
    return {
      root: { id: skillId, version: pkg.manifest.version, resolved: true, children: [] },
      conflicts: [],
      install_order: [],
    };
  }

  private parseInstallString(str: string) {
    if (str.startsWith('git:') || str.startsWith('github:')) return { source: 'git' as const, url: str };
    if (str.startsWith('http://') || str.startsWith('https://')) return { source: 'url' as const, url: str };
    if (str.startsWith('./') || str.startsWith('../') || str.startsWith('/')) return { source: 'local' as const, path: str };
    const match = str.match(/^([^@]+)(?:@(.+))?$/);
    if (match) return { source: 'marketplace' as const, id: match[1], version: match[2] || 'latest' };
    return { source: 'marketplace' as const, id: str };
  }

  getPackage(id: string): SkillPackage | undefined {
    return this.packages.get(id) || installManager.get(id);
  }

  getLegacy(id: string): Skill | undefined {
    return this.skills.get(id);
  }
}

export const skillRegistry = new SkillRegistry();
