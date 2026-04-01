/**
 * ClawHub CLI 连接�?
 * 封装 clawhub npm 包的 CLI 调用
 * v1.3.2: 提供�?ClawHub 平台的集�?
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Skill 信息
 */
export interface ClawhubSkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  downloads: number;
  updatedAt: string;
}

/**
 * 搜索结果
 */
export interface ClawhubSearchResult {
  skills: ClawhubSkill[];
  total: number;
}

/**
 * 安装结果
 */
export interface ClawhubInstallResult {
  success: boolean;
  skillId?: string;
  version?: string;
  message: string;
  path?: string;
  error?: string;
}

/**
 * ClawHub CLI 连接�?
 */
export class ClawhubConnector {
  private cliPath: string;
  private workdir: string;
  private skillsDir: string;

  constructor(workdir?: string, skillsDir?: string) {
    // clawhub CLI 路径 (Unix/Linux/Mac)
    this.cliPath = path.join(process.cwd(), 'node_modules', '.bin', 'clawhub');
    this.workdir = workdir || process.cwd();
    this.skillsDir = skillsDir || 'skills';
  }

  /**
   * 获取适合当前平台�?clawhub 命令
   */
  private getClawhubCmd(): string {
    return process.platform === 'win32' ? 'npx clawhub' : this.cliPath;
  }

  /**
   * 检�?CLI 是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync(`${this.getClawhubCmd()} --help`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取 CLI 版本
   */
  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`${this.getClawhubCmd()} --cli-version`);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * 搜索 Skills
   * v1.3.2: 支持文本格式输出解析
   */
  async search(query: string, options?: { limit?: number; json?: boolean }): Promise<ClawhubSearchResult> {
    try {
      const limitFlag = options?.limit ? `--limit ${options.limit}` : '';

      const { stdout } = await execAsync(
        `${this.getClawhubCmd()} search ${limitFlag} ${query}`,
        {
          cwd: this.workdir,
          env: {
            ...process.env,
            CLAWHUB_WORKDIR: this.workdir,
          },
        }
      );

      // 解析文本输出格式: "slug  name  (score)"
      const lines = stdout.split('\n').filter(line => line.trim() && !line.startsWith('-'));
      const skills: ClawhubSkill[] = [];

      for (const line of lines) {
        // 格式: "slug  name  (score)" �?"slug  name  description (score)"
        const match = line.match(/^(\S+)\s+(.+?)\s+\(([\d.]+)\)$/);
        if (match) {
          const [, slug, nameWithDesc] = match;
          // 提取名称和描述（如果有）
          const nameParts = nameWithDesc.trim().split('  ');
          const name = nameParts[0];
          const description = nameParts.slice(1).join('  ') || '';
          
          skills.push({
            slug,
            name,
            description,
            version: 'latest',
            author: '',
            tags: [],
            downloads: 0,
            updatedAt: '',
          });
        }
      }

      return {
        skills,
        total: skills.length,
      };
    } catch (error: any) {
      console.warn('[ClawhubConnector] Search failed:', error.message);
      return { skills: [], total: 0 };
    }
  }

  /**
   * 安装 Skill
   */
  async install(slug: string, options?: { version?: string; force?: boolean }): Promise<ClawhubInstallResult> {
    try {
      const versionFlag = options?.version ? `--version ${options.version}` : '';
      const forceFlag = options?.force ? '--force' : '';

      const { stdout, stderr } = await execAsync(
        `${this.getClawhubCmd()} install ${versionFlag} ${forceFlag} ${slug}`,
        {
          cwd: this.workdir,
          env: {
            ...process.env,
            CLAWHUB_WORKDIR: this.workdir,
            CLAWHUB_DIR: this.skillsDir,
          },
        }
      );

      // 解析安装结果
      const output = stdout + stderr;

      if (output.includes('error') || output.includes('Error')) {
        return {
          success: false,
          skillId: slug,
          message: `安装失败: ${output}`,
          error: output,
        };
      }

      return {
        success: true,
        skillId: slug,
        version: options?.version || 'latest',
        message: `成功安装 ${slug}`,
        path: path.join(this.workdir, this.skillsDir, slug),
      };
    } catch (error: any) {
      return {
        success: false,
        skillId: slug,
        message: `安装失败: ${error.message}`,
        error: error.stderr || error.message,
      };
    }
  }

  /**
   * 查看 Skill 详情
   */
  async inspect(slug: string): Promise<any | null> {
    try {
      const { stdout } = await execAsync(
        `${this.getClawhubCmd()} inspect --json ${slug}`,
        {
          cwd: this.workdir,
          env: {
            ...process.env,
            CLAWHUB_WORKDIR: this.workdir,
          },
        }
      );

      return JSON.parse(stdout);
    } catch (error: any) {
      console.warn('[ClawhubConnector] Inspect failed:', error.message);
      return null;
    }
  }

  /**
   * 列出已安装的 Skills
   */
  async list(): Promise<string[]> {
    try {
      const { stdout } = await execAsync(`${this.getClawhubCmd()} list`, {
        cwd: this.workdir,
        env: {
          ...process.env,
          CLAWHUB_WORKDIR: this.workdir,
          CLAWHUB_DIR: this.skillsDir,
        },
      });

      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * 更新 Skill
   */
  async update(slug?: string): Promise<ClawhubInstallResult> {
    try {
      const slugArg = slug || '';
      const { stdout, stderr } = await execAsync(
        `${this.getClawhubCmd()} update ${slugArg}`,
        {
          cwd: this.workdir,
          env: {
            ...process.env,
            CLAWHUB_WORKDIR: this.workdir,
            CLAWHUB_DIR: this.skillsDir,
          },
        }
      );

      const output = stdout + stderr;

      return {
        success: !output.includes('error'),
        skillId: slug,
        message: output.trim() || '更新完成',
      };
    } catch (error: any) {
      return {
        success: false,
        skillId: slug,
        message: `更新失败: ${error.message}`,
        error: error.stderr || error.message,
      };
    }
  }

  /**
   * 卸载 Skill
   */
  async uninstall(slug: string): Promise<boolean> {
    try {
      await execAsync(`${this.getClawhubCmd()} uninstall ${slug}`, {
        cwd: this.workdir,
        env: {
          ...process.env,
          CLAWHUB_WORKDIR: this.workdir,
          CLAWHUB_DIR: this.skillsDir,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 探索最�?Skills
   */
  async explore(options?: { limit?: number }): Promise<ClawhubSkill[]> {
    try {
      const limitFlag = options?.limit ? `--limit ${options.limit}` : '';
      const { stdout } = await execAsync(
        `${this.getClawhubCmd()} explore ${limitFlag} --json`,
        {
          cwd: this.workdir,
          env: {
            ...process.env,
            CLAWHUB_WORKDIR: this.workdir,
          },
        }
      );

      const result = JSON.parse(stdout);
      return result.skills || result.results || [];
    } catch (error: any) {
      console.warn('[ClawhubConnector] Explore failed:', error.message);
      return [];
    }
  }

  /**
   * 流式安装（用于长时间运行的安装）
   */
  async installStreaming(
    slug: string,
    onOutput: (data: string) => void,
    options?: { version?: string }
  ): Promise<ClawhubInstallResult> {
    return new Promise((resolve) => {
      const args = ['install'];
      if (options?.version) {
        args.push('--version', options.version);
      }
      args.push(slug);

      const child = spawn(this.cliPath, args, {
        cwd: this.workdir,
        env: {
          ...process.env,
          CLAWHUB_WORKDIR: this.workdir,
          CLAWHUB_DIR: this.skillsDir,
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        onOutput(chunk);
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        onOutput(chunk);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            skillId: slug,
            message: stdout.trim() || `成功安装 ${slug}`,
          });
        } else {
          resolve({
            success: false,
            skillId: slug,
            message: `安装失败 (退出码: ${code})`,
            error: stderr || stdout,
          });
        }
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          skillId: slug,
          message: `启动失败: ${error.message}`,
          error: error.message,
        });
      });
    });
  }

  /**
   * 登录
   */
  async login(token?: string): Promise<boolean> {
    try {
      if (token) {
        // 使用 token 登录
        await execAsync(`${this.getClawhubCmd()} login --token ${token}`, {
          cwd: this.workdir,
        });
      } else {
        // 交互式登录（会打开浏览器）
        await execAsync(`${this.getClawhubCmd()} login`, {
          cwd: this.workdir,
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 退出登�?
   */
  async logout(): Promise<boolean> {
    try {
      await execAsync(`${this.getClawhubCmd()} logout`, {
        cwd: this.workdir,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前用户信息
   */
  async whoami(): Promise<any | null> {
    try {
      const { stdout } = await execAsync(`${this.getClawhubCmd()} whoami --json`, {
        cwd: this.workdir,
      });
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }
}

// 单例导出
export const clawhubConnector = new ClawhubConnector();
