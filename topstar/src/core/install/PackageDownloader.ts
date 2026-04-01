import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * 包下载器
 * 支持从 Marketplace、Git、URL 等多种来源下载 Skill 包
 */
export class PackageDownloader {
  private cachePath: string;

  constructor(cachePath: string) {
    this.cachePath = cachePath;
  }

  /**
   * 从 Marketplace 下载
   */
  async downloadFromMarketplace(
    id: string,
    version: string = 'latest',
    registry?: string,
    offline?: boolean
  ): Promise<string> {
    const cacheKey = `${id}-${version}`;
    const cacheDir = path.join(this.cachePath, id);
    const cachedPath = path.join(cacheDir, `${version}.claw`);

    // 检查缓存
    if (!offline) {
      try {
        await fs.access(cachedPath);
        console.log(`[PackageDownloader] Cache hit: ${cacheKey}`);
        return cachedPath;
      } catch {
        // 缓存不存在，继续下载
      }
    } else {
      // 离线模式，必须使用缓存
      try {
        await fs.access(cachedPath);
        return cachedPath;
      } catch {
        throw new Error(`Offline mode: package ${cacheKey} not in cache`);
      }
    }

    // 下载
    const registryUrl = registry || 'https://marketplace.starup.ai';
    const downloadUrl = `${registryUrl}/api/skills/${id}/${version}/download`;

    console.log(`[PackageDownloader] Downloading from ${downloadUrl}...`);

    try {
      const response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: {
          'Accept': 'application/octet-stream',
        },
      });

      // 保存到缓存
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(cachedPath, response.data);

      console.log(`[PackageDownloader] Downloaded to ${cachedPath}`);
      return cachedPath;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to download from marketplace: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 从 Git 仓库下载
   */
  async downloadFromGit(url: string, offline?: boolean): Promise<string> {
    if (offline) {
      throw new Error('Offline mode: cannot clone git repository');
    }

    // 解析 Git URL
    const parsed = this.parseGitUrl(url);
    const cacheDir = path.join(this.cachePath, 'git', parsed.repo);

    console.log(`[PackageDownloader] Cloning ${parsed.url}...`);

    try {
      // 清理旧缓存
      await fs.rm(cacheDir, { recursive: true, force: true });
      await fs.mkdir(cacheDir, { recursive: true });

      // Clone
      const branch = parsed.branch ? `-b ${parsed.branch}` : '';
      await execAsync(`git clone --depth 1 ${branch} ${parsed.url} ${cacheDir}`);

      console.log(`[PackageDownloader] Cloned to ${cacheDir}`);
      return cacheDir;
    } catch (error) {
      throw new Error(`Failed to clone git repository: ${error}`);
    }
  }

  /**
   * 从 URL 直接下载
   */
  async downloadFromUrl(url: string, offline?: boolean): Promise<string> {
    // 检查缓存
    const urlHash = this.hashUrl(url);
    const cachedPath = path.join(this.cachePath, 'url', `${urlHash}.claw`);

    if (!offline) {
      try {
        await fs.access(cachedPath);
        console.log(`[PackageDownloader] Cache hit: ${url}`);
        return cachedPath;
      } catch {
        // 缓存不存在
      }
    } else {
      try {
        await fs.access(cachedPath);
        return cachedPath;
      } catch {
        throw new Error(`Offline mode: URL ${url} not in cache`);
      }
    }

    console.log(`[PackageDownloader] Downloading from ${url}...`);

    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
      });

      // 保存到缓存
      const cacheDir = path.join(this.cachePath, 'url');
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(cachedPath, response.data);

      console.log(`[PackageDownloader] Downloaded to ${cachedPath}`);
      return cachedPath;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to download from URL: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 清理过期缓存
   */
  async cleanCache(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    console.log('[PackageDownloader] Cleaning cache...');

    const now = Date.now();
    const cleanDir = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const stats = await fs.stat(fullPath);
          
          if (now - stats.mtime.getTime() > maxAgeMs) {
            await fs.rm(fullPath, { recursive: true, force: true });
            console.log(`[PackageDownloader] Removed old cache: ${fullPath}`);
          }
        }
      } catch (error) {
        // 目录可能不存在，忽略
      }
    };

    await cleanDir(this.cachePath);
    await cleanDir(path.join(this.cachePath, 'url'));
    await cleanDir(path.join(this.cachePath, 'git'));
  }

  // ==================== 私有方法 ====================

  /**
   * 解析 Git URL
   */
  private parseGitUrl(url: string): { url: string; repo: string; branch?: string } {
    // github:user/repo#branch
    if (url.startsWith('github:')) {
      const parts = url.slice(7).split('#');
      const [user, repo] = parts[0].split('/');
      return {
        url: `https://github.com/${user}/${repo}.git`,
        repo: `${user}-${repo}`,
        branch: parts[1],
      };
    }

    // git+https://...
    if (url.startsWith('git+')) {
      url = url.slice(4);
    }

    // 提取分支
    const hashIndex = url.indexOf('#');
    let branch: string | undefined;
    if (hashIndex > 0) {
      branch = url.slice(hashIndex + 1);
      url = url.slice(0, hashIndex);
    }

    // 提取仓库名
    const match = url.match(/\/([^\/]+?)(?:\.git)?$/);
    const repo = match ? match[1] : 'unknown';

    return { url, repo, branch };
  }

  /**
   * URL 哈希
   */
  private hashUrl(url: string): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
  }
}
