import * as fs from 'fs/promises';
import * as path from 'path';
import YAML from 'yaml';
import {
  Skill,
  SkillMetadata,
  SkillPackage,
  SkillManifest,
  SkillStatus,
  InstallSpec,
  InstallOptions,
  InstallResult,
  DependencyTree,
  UpgradeResult,
} from '../../types';
import { installManager } from './InstallManager';
import { skillRuntime } from './SkillRuntime';
import { metaInstallerSkill } from './MetaInstallerSkill';
import { metaRegistrySkill } from './MetaRegistrySkill';
import { metaUpdaterSkill } from './MetaUpdaterSkill';

/**
 * Skill 注册表
 * v1.2: 集成 InstallManager 和 SkillRuntime，支持 manifest.yaml
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private packages: Map<string, SkillPackage> = new Map();
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

    // 初始化 InstallManager
    await installManager.initialize();

    // 初始化 SkillRuntime
    await skillRuntime.initialize();

    // v1.3: 初始化 Meta-Skills
    await this.initializeMetaSkills();

    // 加载内置 Skills
    await this.loadSkillsFromDirectory(this.builtinSkillsDir);

    // 加载用户 Skills（v1.2 manifest.yaml）
    await this.loadPackagesFromDirectory(this.userSkillsDir);

    // 同步 InstallManager 的已安装 Skills
    await this.syncInstalledSkills();

    console.log(`[SkillRegistry] Loaded ${this.skills.size} legacy skills, ${this.packages.size} v1.2 packages, 3 meta-skills`);
  }

  /**
   * 从目录加载 Skills（v1.1 兼容）
   */
  async loadSkillsFromDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(dir, entry.name);
          
          // 优先检查 manifest.yaml（v1.2）
          const manifestPath = path.join(skillPath, 'manifest.yaml');
          try {
            await fs.access(manifestPath);
            await this.loadPackage(skillPath);
            continue;
          } catch {
            // 没有 manifest.yaml，尝试 SKILL.md（v1.1）
          }
          
          // 加载 v1.1 Skill
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
   * 从目录加载 Packages（v1.2）
   */
  async loadPackagesFromDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const packagePath = path.join(dir, entry.name);
          await this.loadPackage(packagePath);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[SkillRegistry] Error loading packages from ${dir}:`, error);
      }
    }
  }

  /**
   * 加载单个 v1.1 Skill
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
      console.log(`[SkillRegistry] Loaded legacy skill: ${skill.id}`);
      return skill;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[SkillRegistry] Error loading skill from ${skillPath}:`, error);
      }
      return null;
    }
  }

  /**
   * 加载单个 v1.2 Package
   */
  async loadPackage(packagePath: string): Promise<SkillPackage | null> {
    const manifestPath = path.join(packagePath, 'manifest.yaml');
    
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = YAML.parse(content) as SkillManifest;
      
      // 验证 manifest
      if (!this.validateManifest(manifest)) {
        console.error(`[SkillRegistry] Invalid manifest in ${packagePath}`);
        return null;
      }
      
      // 加载 PROMPT.md（可选）
      let promptContent: string | undefined;
      try {
        promptContent = await fs.readFile(
          path.join(packagePath, 'PROMPT.md'),
          'utf-8'
        );
      } catch {
        // PROMPT.md 可选
      }
      
      const pkg: SkillPackage = {
        manifest,
        path: packagePath,
        content: promptContent,
        status: 'installed',
        installedAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      this.packages.set(manifest.id, pkg);
      console.log(`[SkillRegistry] Loaded package: ${manifest.id}@${manifest.version}`);
      
      // 自动加载到运行时
      try {
        const instance = await skillRuntime.load(pkg);
        await skillRuntime.activate(instance);
      } catch (error) {
        console.error(`[SkillRegistry] Failed to activate ${manifest.id}:`, error);
        pkg.status = 'error';
      }
      
      return pkg;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[SkillRegistry] Error loading package from ${packagePath}:`, error);
      }
      return null;
    }
  }

  /**
   * 安装 Skill（v1.2）
   */
  async install(spec: InstallSpec | string, options: InstallOptions = {}): Promise<InstallResult> {
    // 字符串转换为 InstallSpec
    let installSpec: InstallSpec;
    if (typeof spec === 'string') {
      installSpec = this.parseInstallString(spec);
    } else {
      installSpec = spec;
    }
    
    return installManager.install(installSpec, options);
  }

  /**
   * 卸载 Skill
   */
  async uninstall(skillId: string, options: { purgeData?: boolean } = {}): Promise<boolean> {
    // 先卸载运行时
    await skillRuntime.unload(skillId);
    
    // 再从 InstallManager 卸载
    const result = await installManager.uninstall(skillId, options);
    
    if (result) {
      this.packages.delete(skillId);
      this.skills.delete(skillId);
    }
    
    return result;
  }

  /**
   * 升级 Skill
   */
  async upgrade(skillId: string, toVersion: string): Promise<UpgradeResult> {
    return installManager.upgrade(skillId, toVersion);
  }

  /**
   * 列出已安装 Skill
   */
  list(): { legacy: Skill[]; packages: SkillPackage[] } {
    return {
      legacy: Array.from(this.skills.values()),
      packages: Array.from(this.packages.values()),
    };
  }

  /**
   * 获取 v1.1 Skill
   */
  getLegacy(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * 获取 v1.2 Package
   */
  getPackage(id: string): SkillPackage | undefined {
    return this.packages.get(id) || installManager.get(id);
  }

  /**
   * 获取所有 Skills（兼容 v1.1 接口）
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取所有 Skill 描述（用于 LLM）
   */
  getSkillDescriptions(): { id: string; name: string; description: string; version?: string }[] {
    const legacy = Array.from(this.skills.values()).map(s => ({
      id: s.id,
      name: s.metadata.name,
      description: s.metadata.description,
    }));
    
    const packages = Array.from(this.packages.values()).map(p => ({
      id: p.manifest.id,
      name: p.manifest.name,
      description: p.manifest.description,
      version: p.manifest.version,
    }));
    
    return [...legacy, ...packages];
  }

  /**
   * 根据任务匹配 Skill
   */
  matchSkills(task: string): (Skill | SkillPackage)[] {
    const taskLower = task.toLowerCase();
    const matches: (Skill | SkillPackage)[] = [];
    
    // 匹配 v1.1 Skills
    for (const skill of this.skills.values()) {
      const desc = skill.metadata.description.toLowerCase();
      if (this.calculateSimilarity(taskLower, desc) > 0.3) {
        matches.push(skill);
      }
    }
    
    // 匹配 v1.2 Packages
    for (const pkg of this.packages.values()) {
      const desc = pkg.manifest.description.toLowerCase();
      if (this.calculateSimilarity(taskLower, desc) > 0.3) {
        matches.push(pkg);
      }
    }
    
    return matches.slice(0, 3);
  }

  /**
   * 获取依赖树
   */
  async dependencyTree(skillId: string): Promise<DependencyTree | null> {
    return installManager.dependencyTree(skillId);
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
      await this.loadPackagesFromDirectory(this.userSkillsDir);
    }, 5000);
    
    console.log('[SkillRegistry] Watch mode enabled');
  }

  // ==================== 私有方法 ====================

  /**
   * 解析 SKILL.md 文件（v1.1）
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
   * 验证 manifest
   */
  private validateManifest(manifest: SkillManifest): boolean {
    const required = ['id', 'name', 'version', 'api_version', 'author', 'license', 'description', 'runtime'];
    for (const field of required) {
      if (!(manifest as any)[field]) {
        console.error(`[SkillRegistry] Missing required field: ${field}`);
        return false;
      }
    }
    
    // 验证 api_version 兼容性
    const apiVersion = manifest.api_version;
    if (!this.isCompatibleApiVersion(apiVersion)) {
      console.error(`[SkillRegistry] Incompatible api_version: ${apiVersion}`);
      return false;
    }
    
    return true;
  }

  /**
   * 检查 API 版本兼容性
   */
  private isCompatibleApiVersion(version: string): boolean {
    const coreVersion = '1.2';
    const [major] = version.split('.');
    const [coreMajor] = coreVersion.split('.');
    return parseInt(major) <= parseInt(coreMajor);
  }

  /**
   * 解析安装字符串
   */
  private parseInstallString(str: string): InstallSpec {
    // git: 前缀
    if (str.startsWith('git:') || str.startsWith('github:')) {
      return { source: 'git', url: str };
    }
    
    // http(s):// 前缀
    if (str.startsWith('http://') || str.startsWith('https://')) {
      return { source: 'url', url: str };
    }
    
    // 本地路径
    if (str.startsWith('./') || str.startsWith('../') || str.startsWith('/')) {
      return { source: 'local', path: str };
    }
    
    // marketplace 格式: name@version
    const match = str.match(/^([^@]+)(?:@(.+))?$/);
    if (match) {
      return {
        source: 'marketplace',
        id: match[1],
        version: match[2] || 'latest',
      };
    }
    
    return { source: 'marketplace', id: str };
  }

  /**
   * 同步 InstallManager 的已安装 Skills
   */
  private async syncInstalledSkills(): Promise<void> {
    const installed = installManager.list();
    for (const pkg of installed) {
      if (!this.packages.has(pkg.manifest.id)) {
        this.packages.set(pkg.manifest.id, pkg);
        
        // 激活已安装的 Skill
        if (pkg.status === 'active') {
          try {
            const instance = await skillRuntime.load(pkg);
            await skillRuntime.activate(instance);
          } catch (error) {
            console.error(`[SkillRegistry] Failed to activate ${pkg.manifest.id}:`, error);
          }
        }
      }
    }
  }

  /**
   * 初始化 Meta-Skills
   * v1.3: 加载 core.installer, core.registry, core.updater
   */
  private async initializeMetaSkills(): Promise<void> {
    await metaRegistrySkill.initialize();
    await metaInstallerSkill.initialize();
    await metaUpdaterSkill.initialize();

    // 将 Meta-Skills 注册为特殊的 SkillPackage
    const metaSkills = [
      {
        manifest: {
          id: 'core.installer',
          name: 'Skill 安装器',
          version: '1.3.0',
          api_version: '1.3',
          author: 'StarUp',
          license: 'MIT',
          description: '处理 Skill 的安装、卸载和依赖管理',
          runtime: { type: 'javascript', entry: 'index.js' },
          permissions: metaInstallerSkill.permissions,
        },
        path: '',
        status: 'active' as const,
        installedAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        manifest: {
          id: 'core.registry',
          name: 'Skill 注册表',
          version: '1.3.0',
          api_version: '1.3',
          author: 'StarUp',
          license: 'MIT',
          description: '管理本地 Skill 索引与 Hub 查询',
          runtime: { type: 'javascript', entry: 'index.js' },
          permissions: metaRegistrySkill.permissions,
        },
        path: '',
        status: 'active' as const,
        installedAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        manifest: {
          id: 'core.updater',
          name: 'Skill 更新器',
          version: '1.3.0',
          api_version: '1.3',
          author: 'StarUp',
          license: 'MIT',
          description: '检查版本更新，处理升级策略',
          runtime: { type: 'javascript', entry: 'index.js' },
          permissions: metaUpdaterSkill.permissions,
        },
        path: '',
        status: 'active' as const,
        installedAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    for (const pkg of metaSkills) {
      this.packages.set(pkg.manifest.id, pkg as any);
    }

    console.log('[SkillRegistry] Meta-skills initialized');
  }

  /**
   * 计算相似度
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));
    
    let common = 0;
    for (const word of words1) {
      if (words2.has(word)) common++;
    }
    
    return common / Math.max(words1.size, words2.size);
  }
}

// 单例导出
export const skillRegistry = new SkillRegistry();
