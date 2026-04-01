import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);

/**
 * 包下载器
 * 支持从 Marketplace、Git、URL 等多种来源下载 Skill 包
 * v1.3.2: 优先使用 clawhub CLI 安装
 */
export class PackageDownloader {
  private cachePath: string;
  private clawhubPath: string;

  constructor(cachePath: string) {
    this.cachePath = cachePath;
    this.clawhubPath = path.join(process.cwd(), 'node_modules', '.bin', 'clawhub');
  }

  /**
   * 检查 clawhub CLI 是否可用
   * Windows 上使用 npx
   */
  async isClawhubAvailable(): Promise<boolean> {
    try {
      const cmd = process.platform === 'win32' ? 'npx clawhub --help' : `${this.clawhubPath} --help`;
      await execAsync(cmd, { cwd: process.cwd() });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 从 Marketplace 下载
   * v1.3.2: 优先使用 clawhub CLI，回退到 HTTP registry
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

    // v1.3.2: 优先尝试使用 clawhub CLI
    if (await this.isClawhubAvailable()) {
      try {
        console.log(`[PackageDownloader] Trying clawhub CLI...`);
        const skillPath = await this.downloadViaClawhub(id, version);
        if (skillPath) {
          return skillPath;
        }
      } catch (error) {
        console.warn(`[PackageDownloader] clawhub CLI failed: ${error}`);
        // 继续尝试 HTTP registry
      }
    }

    // v1.3.1: 定义 registry 优先级列表
    const registries = registry 
      ? [registry]
      : [
          'https://skillhub.tencent.com',      // 腾讯 SkillHub (主要)
          'https://clawhub.ai',                 // ClawHub (兜底)
          'https://marketplace.starup.ai',      // 兼容旧配置
        ];

    let lastError: Error | undefined;

    // 依次尝试每个 registry
    for (const registryUrl of registries) {
      const downloadUrl = `${registryUrl}/api/v1/skills/${id}/download?version=${version}`;
      
      console.log(`[PackageDownloader] Trying ${registryUrl}...`);

      try {
        const response = await axios.get(downloadUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'Accept': 'application/octet-stream, application/zip, application/gzip',
          },
          // 允许 404 继续到下一个 registry
          validateStatus: (status) => status === 200,
        });

        // 保存到缓存
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeFile(cachedPath, response.data);

        // 验证下载内容不是 HTML 错误页面
        const fd = await fs.open(cachedPath, 'r');
        const headerBuffer = Buffer.alloc(64);
        await fd.read(headerBuffer, 0, 64, 0);
        await fd.close();
        const isHtml = headerBuffer.toString('utf-8').trimStart().startsWith('<');
        if (isHtml) {
          await fs.unlink(cachedPath);
          throw new Error(`Registry ${registryUrl} returned an HTML page instead of a package file for ${id}@${version}`);
        }

        console.log(`[PackageDownloader] Downloaded from ${registryUrl} to ${cachedPath}`);
        return cachedPath;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[PackageDownloader] ${registryUrl} failed: ${message}`);
        // 优先保留 HTML 错误页面这类更有意义的错误
        if (!lastError || message.includes('HTML page')) {
          lastError = error instanceof Error ? error : new Error(message);
        }
        // 继续尝试下一个 registry
      }
    }

    // 所有 registry 都失败
    throw lastError || new Error('All registries failed to download the package');
  }

  /**
   * 使用 clawhub CLI 下载/安装 skill
   * v1.3.2: Windows 使用 npx，Unix 使用直接路径
   */
  private async downloadViaClawhub(id: string, version?: string): Promise<string | null> {
    const skillsDir = path.join(process.cwd(), 'skills');
    const targetPath = path.join(skillsDir, id);

    try {
      // 检查是否已安装
      try {
        await fs.access(targetPath);
        console.log(`[PackageDownloader] Skill ${id} already installed via clawhub at ${targetPath}`);
        return this.createClawhubMarker(id, version || 'latest', targetPath);
      } catch {
        // 未安装，继续
      }

      // 使用 npx clawhub install (跨平台)
      const cmd = process.platform === 'win32' 
        ? `npx clawhub install ${version && version !== 'latest' ? '--version ' + version : ''} ${id}`
        : `${this.clawhubPath} install ${version && version !== 'latest' ? '--version ' + version : ''} ${id}`;
      
      console.log(`[PackageDownloader] Running: ${cmd}`);

      const { stdout, stderr } = await execAsync(cmd, {
        cwd: process.cwd(),
        timeout: 120000,
      });

      console.log(`[PackageDownloader] clawhub output:`, stdout);
      if (stderr) {
        console.warn(`[PackageDownloader] clawhub stderr:`, stderr);
      }

      // 验证安装成功
      await fs.access(targetPath);
      console.log(`[PackageDownloader] Successfully installed ${id} via clawhub to ${targetPath}`);

      return this.createClawhubMarker(id, version || 'latest', targetPath);
    } catch (error) {
      console.error(`[PackageDownloader] clawhub install failed: ${error}`);
      return null;
    }
  }

  /**
   * 创建 clawhub 标记文件
   */
  private async createClawhubMarker(id: string, version: string, targetPath: string): Promise<string> {
    const clawPath = path.join(this.cachePath, id, `${version}.claw`);
    await fs.mkdir(path.dirname(clawPath), { recursive: true });
    
    // 创建一个指向安装目录的标记文件
    await fs.writeFile(clawPath, JSON.stringify({ 
      source: 'clawhub', 
      path: targetPath,
      id,
      version,
    }));

    return clawPath;
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
