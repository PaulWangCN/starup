import * as fs from 'fs/promises';
import * as path from 'path';
import YAML from 'yaml';
import {
  InstallSpec,
  InstallOptions,
  InstallResult,
  SkillPackage,
  SkillManifest,
  UpgradeResult,
} from '../../types';
import { PackageDownloader } from '../install/PackageDownloader';

/**
 * 安装管理器（简化版）
 * 仅负责 skill 目录的获取、复制、记录和删除。
 */
export class InstallManager {
  private skillDbPath: string;
  private cachePath: string;
  private userSkillsDir: string;
  private packageDownloader: PackageDownloader;
  private installedSkills: Map<string, SkillPackage> = new Map();

  constructor() {
    const starupHome = path.join(process.env.HOME || '.', '.starup');
    this.skillDbPath = path.join(starupHome, 'skilldb');
    this.cachePath = path.join(this.skillDbPath, 'cache');
    this.userSkillsDir = path.join(starupHome, 'skills');
    this.packageDownloader = new PackageDownloader(this.cachePath);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.skillDbPath, { recursive: true });
    await fs.mkdir(this.cachePath, { recursive: true });
    await fs.mkdir(this.userSkillsDir, { recursive: true });
    await this.loadInstalledSkills();
  }

  /**
   * 安装 skill
   */
  async install(spec: InstallSpec, options: InstallOptions = {}): Promise<InstallResult> {
    try {
      const parsedSpec = await this.parseInstallSpec(spec);
      if (!parsedSpec.id && !parsedSpec.url && !parsedSpec.path) {
        return { success: false, message: '安装参数无效：缺少 skill ID 或安装源' };
      }

      const packagePath = await this.acquirePackage(parsedSpec, options);
      const manifest = await this.parseManifest(packagePath);
      const skillPath = path.join(this.userSkillsDir, manifest.id);

      if (options.force) {
        await fs.rm(skillPath, { recursive: true, force: true });
      }

      await fs.mkdir(skillPath, { recursive: true });
      await this.copyDirectory(packagePath, skillPath);

      const pkg: SkillPackage = {
        manifest,
        path: skillPath,
        status: 'active',
        installedAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.installedSkills.set(manifest.id, pkg);
      await this.saveSkillDb();

      return {
        success: true,
        skillId: manifest.id,
        version: manifest.version,
        message: `Successfully installed ${manifest.name}@${manifest.version}`,
      };
    } catch (error) {
      console.error('[InstallManager] Installation failed:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 卸载 skill
   */
  async uninstall(skillId: string, options: { purgeData?: boolean } = {}): Promise<boolean> {
    try {
      const skillPath = path.join(this.userSkillsDir, skillId);
      await fs.rm(skillPath, { recursive: true, force: true });
      this.installedSkills.delete(skillId);
      await this.saveSkillDb();
      return true;
    } catch (error) {
      console.error(`[InstallManager] Failed to uninstall ${skillId}:`, error);
      return false;
    }
  }

  /**
   * 升级 skill（简化：先卸载再安装）
   */
  async upgrade(skillId: string, toVersion: string): Promise<UpgradeResult> {
    const skill = this.installedSkills.get(skillId);
    if (!skill) {
      return { success: false, oldVersion: 'unknown', newVersion: toVersion, downtime_ms: 0, rollbackAvailable: false };
    }
    const oldVersion = skill.manifest.version;

    await this.uninstall(skillId);
    const result = await this.install({ source: 'marketplace', id: skillId, version: toVersion }, { force: true });

    return {
      success: result.success,
      oldVersion,
      newVersion: toVersion,
      downtime_ms: 0,
      rollbackAvailable: false,
    };
  }

  list(): SkillPackage[] {
    return Array.from(this.installedSkills.values());
  }

  get(skillId: string): SkillPackage | undefined {
    return this.installedSkills.get(skillId);
  }

  // ==================== 私有方法 ====================

  private async parseInstallSpec(spec: InstallSpec): Promise<InstallSpec> {
    if (typeof spec === 'string') {
      const str = spec as string;
      if (str.startsWith('git:') || str.startsWith('github:')) return { source: 'git', url: str };
      if (str.startsWith('http://') || str.startsWith('https://')) return { source: 'url', url: str };
      if (str.startsWith('./') || str.startsWith('../') || str.startsWith('/')) return { source: 'local', path: str };
      const match = str.match(/^([^@]+)(?:@(.+))?$/);
      if (match) return { source: 'marketplace', id: match[1], version: match[2] || 'latest' };
    }
    return spec;
  }

  private async acquirePackage(spec: InstallSpec, options: InstallOptions): Promise<string> {
    switch (spec.source) {
      case 'marketplace':
        return this.packageDownloader.downloadFromMarketplace(spec.id!, spec.version, spec.registry, options.offline);
      case 'git':
        return this.packageDownloader.downloadFromGit(spec.url!, options.offline);
      case 'url':
        return this.packageDownloader.downloadFromUrl(spec.url!, options.offline);
      case 'local':
        return spec.path!;
      default:
        throw new Error(`Unknown source: ${(spec as any).source}`);
    }
  }

  private async parseManifest(packagePath: string): Promise<SkillManifest> {
    const manifestPath = path.join(packagePath, 'manifest.yaml');
    const content = await fs.readFile(manifestPath, 'utf-8');
    return YAML.parse(content) as SkillManifest;
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

  private async loadInstalledSkills(): Promise<void> {
    try {
      const dbPath = path.join(this.skillDbPath, 'skills.json');
      const content = await fs.readFile(dbPath, 'utf-8');
      const data = JSON.parse(content);
      for (const [id, skill] of Object.entries(data.skills || {})) {
        this.installedSkills.set(id, skill as SkillPackage);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[InstallManager] Failed to load skill DB:', error);
      }
    }
  }

  private async saveSkillDb(): Promise<void> {
    const dbPath = path.join(this.skillDbPath, 'skills.json');
    const data = {
      version: '1.3-simple',
      updatedAt: Date.now(),
      skills: Object.fromEntries(this.installedSkills),
    };
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2));
  }
}

export const installManager = new InstallManager();
