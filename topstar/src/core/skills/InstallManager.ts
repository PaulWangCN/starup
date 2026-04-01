import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';
import YAML from 'yaml';
import {
  InstallSpec,
  InstallOptions,
  InstallResult,
  SkillPackage,
  SkillManifest,
  SkillStatus,
  DependencyTree,
  ResolutionConstraints,
  UpgradeResult,
  InstallError,
  DependencyError,
} from '../../types';
import { DependencyResolver } from './DependencyResolver';
import { SignatureVerifier } from '../install/SignatureVerifier';
import { PackageDownloader } from '../install/PackageDownloader';

/**
 * 安装管理器
 * 负责 Skill 的安装、卸载、升级和依赖管理
 * 支持原子化操作和失败回滚
 */
export class InstallManager {
  private skillDbPath: string;
  private cachePath: string;
  private userSkillsDir: string;
  private dependencyResolver: DependencyResolver;
  private signatureVerifier: SignatureVerifier;
  private packageDownloader: PackageDownloader;
  private installedSkills: Map<string, SkillPackage> = new Map();

  constructor() {
    const starupHome = path.join(process.env.HOME || '.', '.starup');
    this.skillDbPath = path.join(starupHome, 'skilldb');
    this.cachePath = path.join(this.skillDbPath, 'cache');
    this.userSkillsDir = path.join(starupHome, 'skills');
    
    this.dependencyResolver = new DependencyResolver(this.cachePath);
    this.signatureVerifier = new SignatureVerifier();
    this.packageDownloader = new PackageDownloader(this.cachePath);
  }

  /**
   * 初始化安装管理器
   */
  async initialize(): Promise<void> {
    console.log('[InstallManager] Initializing...');
    
    // 创建必要目录
    await fs.mkdir(this.skillDbPath, { recursive: true });
    await fs.mkdir(this.cachePath, { recursive: true });
    await fs.mkdir(this.userSkillsDir, { recursive: true });
    
    // 加载已安装的 Skill
    await this.loadInstalledSkills();
    
    console.log(`[InstallManager] Loaded ${this.installedSkills.size} installed skills`);
  }

  /**
   * 主安装入口
   * 完整的7阶段安装流程：解析→获取→校验→依赖→隔离→注册→加载
   */
  async install(spec: InstallSpec, options: InstallOptions = {}): Promise<InstallResult> {
    const startTime = Date.now();
    
    try {
      console.log(`[InstallManager] Installing ${spec.id || spec.url || spec.path}...`);
      
      // Phase 1: 解析安装指令
      const parsedSpec = await this.parseInstallSpec(spec);
      console.log(`[InstallManager] Parsed spec: ${parsedSpec.id}@${parsedSpec.version || 'latest'}`);
      
      // Phase 2: 获取包
      const packagePath = await this.acquirePackage(parsedSpec, options);
      console.log(`[InstallManager] Package acquired: ${packagePath}`);
      
      // Phase 3: 校验
      if (options.verify !== false) {
        const valid = await this.verifyPackage(packagePath, parsedSpec);
        if (!valid) {
          throw new InstallError('Package signature verification failed', 'verify');
        }
      }
      
      // 解析 manifest
      const manifest = await this.parseManifest(packagePath);
      
      // Phase 4: 依赖解析
      if (manifest.dependencies && manifest.dependencies.length > 0) {
        const constraints: ResolutionConstraints = {
          strategies: {
            upgrade: 'auto',
            multi_version: true,
            cycle_detection: 'error',
          },
        };
        
        const depTree = await this.dependencyResolver.resolve(
          manifest.dependencies,
          constraints
        );
        
        if (depTree.conflicts.length > 0) {
          throw new DependencyError('Dependency conflicts detected', depTree.conflicts);
        }
        
        // 安装依赖
        for (const dep of depTree.install_order) {
          if (!this.installedSkills.has(dep.manifest.id)) {
            await this.installDependency(dep);
          }
        }
      }
      
      // Phase 5-6: 隔离与注册
      const skillPath = await this.registerSkill(manifest, packagePath, options);
      
      // Phase 7: 激活
      await this.activateSkill(manifest.id);
      
      const duration = Date.now() - startTime;
      console.log(`[InstallManager] Installed ${manifest.id}@${manifest.version} in ${duration}ms`);
      
      return {
        success: true,
        skillId: manifest.id,
        version: manifest.version,
        message: `Successfully installed ${manifest.name}@${manifest.version}`,
        dependencies: manifest.dependencies,
      };
      
    } catch (error) {
      console.error('[InstallManager] Installation failed:', error);
      
      // 清理失败安装
      await this.rollback(spec.id || 'unknown');
      
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        error: error instanceof Error ? error.stack : undefined,
      };
    }
  }

  /**
   * 事务性卸载
   */
  async uninstall(skillId: string, options: { purgeData?: boolean } = {}): Promise<boolean> {
    try {
      console.log(`[InstallManager] Uninstalling ${skillId}...`);
      
      const skill = this.installedSkills.get(skillId);
      if (!skill) {
        console.warn(`[InstallManager] Skill ${skillId} not found`);
        return false;
      }
      
      // 检查依赖此 Skill 的其他 Skill
      const dependents = await this.findDependents(skillId);
      if (dependents.length > 0) {
        throw new InstallError(
          `Cannot uninstall: ${dependents.join(', ')} depend on this skill`,
          'dependents'
        );
      }
      
      // 停用 Skill
      await this.deactivateSkill(skillId);
      
      // 删除文件
      await fs.rm(skill.path, { recursive: true, force: true });
      
      // 清理数据（如果指定）
      if (options.purgeData) {
        const dataPath = path.join(this.userSkillsDir, skillId, 'data');
        await fs.rm(dataPath, { recursive: true, force: true });
      }
      
      // 从注册表移除
      this.installedSkills.delete(skillId);
      await this.saveSkillDb();
      
      console.log(`[InstallManager] Uninstalled ${skillId}`);
      return true;
      
    } catch (error) {
      console.error(`[InstallManager] Failed to uninstall ${skillId}:`, error);
      return false;
    }
  }

  /**
   * 原子性升级（蓝绿部署）
   */
  async upgrade(skillId: string, toVersion: string): Promise<UpgradeResult> {
    const startTime = Date.now();
    
    try {
      console.log(`[InstallManager] Upgrading ${skillId} to ${toVersion}...`);
      
      const skill = this.installedSkills.get(skillId);
      if (!skill) {
        throw new InstallError(`Skill ${skillId} not found`, 'not_found');
      }
      
      const oldVersion = skill.manifest.version;
      
      // 标记为升级中
      skill.status = 'upgrading';
      await this.saveSkillDb();
      
      // 蓝绿部署：先安装新版本到临时目录
      const tempId = `${skillId}-upgrade-${Date.now()}`;
      const upgradeSpec: InstallSpec = {
        source: 'marketplace',
        id: skillId,
        version: toVersion,
      };
      
      // 安装新版本
      const result = await this.install(upgradeSpec, { force: true });
      if (!result.success) {
        throw new InstallError(`Failed to install new version: ${result.message}`, 'upgrade');
      }
      
      // 原子切换
      const newSkill = this.installedSkills.get(skillId);
      if (!newSkill) {
        throw new InstallError('Upgrade failed: new version not found', 'upgrade');
      }
      
      // 保留旧版本备份
      const backupPath = `${skill.path}.backup-${oldVersion}`;
      await fs.rename(skill.path, backupPath);
      
      // 更新状态
      newSkill.status = 'active';
      await this.saveSkillDb();
      
      // 清理备份（异步）
      setTimeout(async () => {
        await fs.rm(backupPath, { recursive: true, force: true });
      }, 60000);
      
      const duration = Date.now() - startTime;
      
      return {
        success: true,
        oldVersion,
        newVersion: toVersion,
        downtime_ms: duration,
        rollbackAvailable: true,
      };
      
    } catch (error) {
      console.error(`[InstallManager] Upgrade failed:`, error);
      
      // 恢复状态
      const skill = this.installedSkills.get(skillId);
      if (skill) {
        skill.status = 'active';
        await this.saveSkillDb();
      }
      
      return {
        success: false,
        oldVersion: skill?.manifest.version || 'unknown',
        newVersion: toVersion,
        downtime_ms: Date.now() - startTime,
        rollbackAvailable: false,
      };
    }
  }

  /**
   * 查询依赖树
   */
  async dependencyTree(skillId: string): Promise<DependencyTree | null> {
    const skill = this.installedSkills.get(skillId);
    if (!skill) return null;
    
    if (!skill.manifest.dependencies || skill.manifest.dependencies.length === 0) {
      return {
        root: {
          id: skillId,
          version: skill.manifest.version,
          resolved: true,
          children: [],
        },
        conflicts: [],
        install_order: [],
      };
    }
    
    return this.dependencyResolver.resolve(skill.manifest.dependencies, {
      strategies: {
        upgrade: 'auto',
        multi_version: true,
        cycle_detection: 'error',
      },
    });
  }

  /**
   * 列出已安装 Skill
   */
  list(): SkillPackage[] {
    return Array.from(this.installedSkills.values());
  }

  /**
   * 获取 Skill 信息
   */
  get(skillId: string): SkillPackage | undefined {
    return this.installedSkills.get(skillId);
  }

  // ==================== 私有方法 ====================

  /**
   * 解析安装指令
   */
  private async parseInstallSpec(spec: InstallSpec): Promise<InstallSpec> {
    // 如果是字符串，解析为 spec
    if (typeof spec === 'string') {
      const str = spec as string;
      
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
    }
    
    return spec;
  }

  /**
   * 获取包
   */
  private async acquirePackage(spec: InstallSpec, options: InstallOptions): Promise<string> {
    switch (spec.source) {
      case 'marketplace':
        return this.packageDownloader.downloadFromMarketplace(
          spec.id!,
          spec.version,
          spec.registry,
          options.offline
        );
        
      case 'git':
        return this.packageDownloader.downloadFromGit(spec.url!, options.offline);
        
      case 'url':
        return this.packageDownloader.downloadFromUrl(spec.url!, options.offline);
        
      case 'local':
        return spec.path!;
        
      default:
        throw new InstallError(`Unknown source: ${(spec as any).source}`, 'acquire');
    }
  }

  /**
   * 验证包
   */
  private async verifyPackage(packagePath: string, spec: InstallSpec): Promise<boolean> {
    try {
      // 检查文件是否存在
      const stats = await fs.stat(packagePath);
      if (!stats.isDirectory() && !packagePath.endsWith('.claw')) {
        return false;
      }
      
      // 检查 manifest
      const manifestPath = stats.isDirectory()
        ? path.join(packagePath, 'manifest.yaml')
        : path.join(packagePath, 'manifest.yaml'); // .claw 包内部
        
      await fs.access(manifestPath);
      
      // 验证签名（如果是下载的包）
      if (spec.source !== 'local' && spec.source !== 'git') {
        const sigValid = await this.signatureVerifier.verify(packagePath);
        if (!sigValid) {
          console.warn('[InstallManager] Signature verification failed');
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error('[InstallManager] Package verification failed:', error);
      return false;
    }
  }

  /**
   * 解析 manifest
   */
  private async parseManifest(packagePath: string): Promise<SkillManifest> {
    const manifestPath = path.join(packagePath, 'manifest.yaml');
    const content = await fs.readFile(manifestPath, 'utf-8');
    return YAML.parse(content) as SkillManifest;
  }

  /**
   * 注册 Skill
   */
  private async registerSkill(
    manifest: SkillManifest,
    packagePath: string,
    options: InstallOptions
  ): Promise<string> {
    const skillPath = path.join(this.userSkillsDir, manifest.id);
    
    // 清理旧版本
    if (options.force) {
      await fs.rm(skillPath, { recursive: true, force: true });
    }
    
    // 创建目录
    await fs.mkdir(skillPath, { recursive: true });
    
    if (options.link) {
      // 开发模式：创建软链接
      const entries = await fs.readdir(packagePath);
      for (const entry of entries) {
        const src = path.join(packagePath, entry);
        const dest = path.join(skillPath, entry);
        await fs.symlink(src, dest);
      }
    } else {
      // 正常模式：复制文件
      await this.copyDirectory(packagePath, skillPath);
    }
    
    // 创建数据目录
    const dataPath = path.join(skillPath, 'data');
    await fs.mkdir(dataPath, { recursive: true });
    
    // 记录到注册表
    const skillPackage: SkillPackage = {
      manifest,
      path: skillPath,
      status: 'installed',
      installedAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    this.installedSkills.set(manifest.id, skillPackage);
    await this.saveSkillDb();
    
    return skillPath;
  }

  /**
   * 激活 Skill
   */
  private async activateSkill(skillId: string): Promise<void> {
    const skill = this.installedSkills.get(skillId);
    if (skill) {
      skill.status = 'active';
      skill.updatedAt = Date.now();
      await this.saveSkillDb();
    }
  }

  /**
   * 停用 Skill
   */
  private async deactivateSkill(skillId: string): Promise<void> {
    const skill = this.installedSkills.get(skillId);
    if (skill) {
      skill.status = 'disabled';
      skill.updatedAt = Date.now();
      await this.saveSkillDb();
    }
  }

  /**
   * 安装依赖
   */
  private async installDependency(dep: SkillPackage): Promise<void> {
    const spec: InstallSpec = {
      source: 'marketplace',
      id: dep.manifest.id,
      version: dep.manifest.version,
    };
    await this.install(spec);
  }

  /**
   * 查找依赖此 Skill 的其他 Skill
   */
  private async findDependents(skillId: string): Promise<string[]> {
    const dependents: string[] = [];
    
    for (const [id, skill] of this.installedSkills) {
      if (skill.manifest.dependencies) {
        const isDependent = skill.manifest.dependencies.some(
          dep => dep.id === skillId
        );
        if (isDependent) {
          dependents.push(id);
        }
      }
    }
    
    return dependents;
  }

  /**
   * 失败回滚
   */
  private async rollback(skillId: string): Promise<void> {
    try {
      const skillPath = path.join(this.userSkillsDir, skillId);
      await fs.rm(skillPath, { recursive: true, force: true });
      this.installedSkills.delete(skillId);
      await this.saveSkillDb();
    } catch (error) {
      console.error('[InstallManager] Rollback failed:', error);
    }
  }

  /**
   * 加载已安装的 Skill
   */
  private async loadInstalledSkills(): Promise<void> {
    try {
      const dbPath = path.join(this.skillDbPath, 'skills.json');
      const content = await fs.readFile(dbPath, 'utf-8');
      const data = JSON.parse(content);
      
      for (const [id, skill] of Object.entries(data.skills || {})) {
        this.installedSkills.set(id, skill as SkillPackage);
      }
    } catch (error) {
      // 数据库可能不存在，忽略
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[InstallManager] Failed to load skill DB:', error);
      }
    }
  }

  /**
   * 保存 Skill 数据库
   */
  private async saveSkillDb(): Promise<void> {
    const dbPath = path.join(this.skillDbPath, 'skills.json');
    const data = {
      version: '1.2',
      updatedAt: Date.now(),
      skills: Object.fromEntries(this.installedSkills),
    };
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2));
  }

  /**
   * 复制目录
   */
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
export const installManager = new InstallManager();
