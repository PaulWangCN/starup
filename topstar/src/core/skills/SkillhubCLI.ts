import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import {
  SkillSearchResult,
  InstallResult,
  SkillManifest,
} from '../../types';

const execAsync = promisify(exec);

/**
 * Tencent SkillHub CLI 集成
 * 封装外部 skillhub 命令行工具的调用
 * 
 * SkillHub 安装命令：
 * curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only
 */
export class SkillhubCLI {
  private cliPath: string = 'skillhub';

  /**
   * 检查 skillhub CLI 是否已安装
   */
  async isInstalled(): Promise<boolean> {
    try {
      const cmd = process.platform === 'win32' ? 'where skillhub' : 'which skillhub';
      await execAsync(cmd);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取 skillhub CLI 版本
   */
  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`${this.cliPath} --version`);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * 搜索 Skill
   * 命令: skillhub search <query>
   */
  async search(query: string): Promise<SkillSearchResult[]> {
    try {
      const { stdout } = await execAsync(`${this.cliPath} search ${query} --json`);
      const results = JSON.parse(stdout);
      return results.map((r: any) => ({
        id: r.id || r.name,
        name: r.name,
        version: r.version || 'latest',
        description: r.description || '',
        manifest_digest: r.digest || '',
        capabilities_preview: r.permissions || [],
        source_hub: 'tencent-skillhub',
        trusted: true,
        ...r,
      }));
    } catch (error) {
      console.warn('[SkillhubCLI] Search failed:', error);
      return [];
    }
  }

  /**
   * 安装 Skill
   * 命令: skillhub install <skill-id>
   */
  async install(skillId: string, version?: string): Promise<InstallResult> {
    const spec = version ? `${skillId}@${version}` : skillId;
    
    try {
      const { stdout, stderr } = await execAsync(`${this.cliPath} install ${spec}`);
      
      if (stderr && !stdout) {
        return {
          success: false,
          message: `安装失败: ${stderr}`,
        };
      }

      return {
        success: true,
        skillId,
        version: version || 'latest',
        message: stdout.trim() || `已成功安装 ${skillId}`,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `安装失败: ${error.message}`,
        error: error.stderr || error.message,
      };
    }
  }

  /**
   * 获取 Skill 信息
   * 命令: skillhub info <skill-id>
   */
  async info(skillId: string): Promise<SkillManifest | null> {
    try {
      const { stdout } = await execAsync(`${this.cliPath} info ${skillId} --json`);
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }

  /**
   * 列出已安装的 Skills
   * 命令: skillhub list
   */
  async list(): Promise<string[]> {
    try {
      const { stdout } = await execAsync(`${this.cliPath} list`);
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * 更新 Skill
   * 命令: skillhub update <skill-id>
   */
  async update(skillId: string): Promise<InstallResult> {
    try {
      const { stdout } = await execAsync(`${this.cliPath} update ${skillId}`);
      return {
        success: true,
        skillId,
        message: stdout.trim(),
      };
    } catch (error: any) {
      return {
        success: false,
        skillId,
        message: `更新失败: ${error.message}`,
      };
    }
  }

  /**
   * 卸载 Skill
   * 命令: skillhub uninstall <skill-id>
   */
  async uninstall(skillId: string): Promise<boolean> {
    try {
      await execAsync(`${this.cliPath} uninstall ${skillId}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 流式执行命令（用于长时间运行的命令）
   */
  async spawnInstall(skillId: string, onOutput?: (data: string) => void): Promise<InstallResult> {
    return new Promise((resolve) => {
      const child = spawn(this.cliPath, ['install', skillId]);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        onOutput?.(chunk);
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        onOutput?.(chunk);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            skillId,
            message: stdout.trim() || `已成功安装 ${skillId}`,
          });
        } else {
          resolve({
            success: false,
            skillId,
            message: `安装失败 (退出码: ${code})`,
            error: stderr || stdout,
          });
        }
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          skillId,
          message: `启动失败: ${error.message}`,
          error: error.message,
        });
      });
    });
  }

  /**
   * 自动安装 SkillHub CLI
   */
  async autoInstall(): Promise<{ success: boolean; message: string }> {
    if (process.platform === 'win32') {
      return {
        success: false,
        message: 'Windows 平台暂不支持自动安装 SkillHub CLI，请手动安装或访问 https://skillhub.tencent.com/',
      };
    }

    try {
      console.log('[SkillhubCLI] Auto-installing SkillHub CLI...');
      
      const installScript = 'curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only';
      
      const { stdout, stderr } = await execAsync(installScript, { 
        timeout: 120000,
        env: { ...process.env, PATH: process.env.PATH || '' }
      });
      
      // 检查是否安装成功
      const installed = await this.isInstalled();
      if (installed) {
        return {
          success: true,
          message: 'SkillHub CLI 安装成功',
        };
      } else {
        return {
          success: false,
          message: `安装失败: ${stderr || stdout || '未知错误'}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `自动安装失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 获取安装指南
   */
  getInstallGuide(): string {
    return `
SkillHub CLI 未安装。

安装命令：
  curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only

或者访问：https://skillhub.tencent.com/
`;
  }
}

// 单例导出
export const skillhubCLI = new SkillhubCLI();
