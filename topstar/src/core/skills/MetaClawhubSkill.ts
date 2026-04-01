/**
 * Meta-Clawhub Skill
 * 通过自然语言意图调用 ClawHub CLI 功能
 * v1.3.2: 集成 clawhub npm 包
 */

import {
  MetaSkill,
  ActionResult,
  SessionContext,
  SkillCandidate,
} from '../../types';
import { clawhubConnector, ClawhubSkill } from './ClawhubConnector';
import { installManager } from './InstallManager';
import { skillRuntime } from './SkillRuntime';
import { metaRegistrySkill } from './MetaRegistrySkill';
import { intentRouter } from '../intent/IntentRouter';
import * as path from 'path';

/**
 * Meta-Clawhub Skill
 * 处理与 ClawHub 平台相关的意图
 */
export class MetaClawhubSkill implements MetaSkill {
  id = 'core.clawhub';
  name = 'ClawHub 连接器';
  description = '通过 ClawHub CLI 搜索、安装和管理 Skills';
  type = 'meta' as const;

  permissions = [
    { id: 'network.hub', scope: { allow: ['https://clawhub.ai/*', 'https://clawhub.network/*'], deny: [] } },
    { id: 'fs.write', scope: ['~/.starup/skills/*', './skills/*'] },
    { id: 'skill.runtime.manage', scope: ['load', 'unload'] },
    { id: 'prompt.layer.modify', scope: ['L5'] },
  ];

  private pendingConfirmations: Map<string, { type: string; data: any }> = new Map();

  async initialize(): Promise<void> {
    console.log('[MetaClawhubSkill] Initialized');

    // 检查 clawhub CLI 是否可用
    const available = await clawhubConnector.isAvailable();
    if (available) {
      const version = await clawhubConnector.getVersion();
      console.log(`[MetaClawhubSkill] ClawHub CLI ${version} available`);
    } else {
      console.warn('[MetaClawhubSkill] ClawHub CLI not available, some features may be limited');
    }
  }

  /**
   * 处理请求
   */
  async handle(request: any, context: SessionContext): Promise<ActionResult> {
    const action = request.action;

    switch (action) {
      case 'search':
        return this.handleSearch(request.query, request.options);
      case 'install':
        return this.handleInstall(request.skill_hint, request.version, context);
      case 'uninstall':
        return this.handleUninstall(request.skill_id);
      case 'update':
        return this.handleUpdate(request.skill_id);
      case 'list':
        return this.handleList();
      case 'info':
        return this.handleInfo(request.skill_id);
      case 'explore':
        return this.handleExplore();
      case 'confirm':
        return this.handleConfirmation(request.confirmation_id, request.choice, context);
      default:
        return {
          success: false,
          message: `Unknown action: ${action}`,
        };
    }
  }

  // ==================== 处理方法 ====================

  private async handleSearch(query: string, options?: any): Promise<ActionResult> {
    try {
      const result = await clawhubConnector.search(query, { limit: options?.limit || 10 });

      if (result.skills.length === 0) {
        return {
          success: true,
          message: `未找到与 "${query}" 相关的 Skill`,
          data: { query, results: [] },
        };
      }

      const formattedResults = result.skills.map((s, i) =>
        `${i + 1}. ${s.name}${s.description ? ' - ' + s.description : ''}\n   slug: ${s.slug}`
      ).join('\n\n');

      return {
        success: true,
        message: `找到 ${result.skills.length} 个与 "${query}" 相关的 Skill:\n\n${formattedResults}`,
        data: {
          query,
          total: result.total,
          results: result.skills,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async handleInstall(
    skillHint: string,
    version?: string,
    context?: SessionContext
  ): Promise<ActionResult> {
    try {
      // 1. 搜索匹配
      const searchResult = await clawhubConnector.search(skillHint, { limit: 5 });

      if (searchResult.skills.length === 0) {
        return {
          success: false,
          message: `未找到与 "${skillHint}" 相关的 Skill`,
        };
      }

      // 2. 精确匹配或模糊匹配
      const exactMatch = searchResult.skills.find(
        s => s.slug === skillHint || s.name.toLowerCase() === skillHint.toLowerCase()
      );

      const target = exactMatch || searchResult.skills[0];

      // 3. 如果有多个匹配，询问用户
      if (!exactMatch && searchResult.skills.length > 1) {
        const confirmationId = this.createConfirmationId();
        this.pendingConfirmations.set(confirmationId, {
          type: 'install_disambiguation',
          data: { skillHint, version, candidates: searchResult.skills },
        });

        const candidates = searchResult.skills.map((s, i) =>
          `${i + 1}. ${s.name} (${s.slug}) - ${s.description}`
        ).join('\n');

        return {
          success: true,
          message: `找到多个匹配的 Skill，请确认安装哪一个（回复数字 1-${searchResult.skills.length}）:\n\n${candidates}`,
          requires_confirmation: true,
          confirmation_type: 'disambiguation',
          data: { confirmation_id: confirmationId },
        };
      }

      // 4. 执行安装
      return this.performInstall(target.slug, version);
    } catch (error) {
      return {
        success: false,
        message: `安装失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async performInstall(slug: string, version?: string): Promise<ActionResult> {
    // 检查是否已安装
    const existing = installManager.get(slug);
    if (existing) {
      return {
        success: false,
        message: `Skill ${slug} 已安装 (版本: ${existing.manifest.version})`,
      };
    }

    // 显示安装进度
    const messages: string[] = [];

    const result = await clawhubConnector.installStreaming(
      slug,
      (data) => {
        messages.push(data);
        console.log(`[ClawHub] ${data.trim()}`);
      },
      { version }
    );

    if (!result.success) {
      return {
        success: false,
        message: `安装失败: ${result.message}`,
        error: result.error,
      };
    }

    // 尝试加载到运行时
    try {
      // 从 clawhub 安装目录加载
      const skillPath = result.path;
      if (skillPath) {
        // 创建软链接或复制到 InstallManager 目录
        // TODO: 更优雅的集成方式
        console.log(`[MetaClawhubSkill] Skill installed at ${skillPath}`);
      }

      return {
        success: true,
        message: `成功安装 ${slug}${version ? '@' + version : ''}\n\n现在你可以使用这个 Skill 的功能了。`,
        data: {
          skill_id: slug,
          version: version || 'latest',
          install_path: skillPath,
        },
      };
    } catch (error) {
      return {
        success: true,
        message: `安装成功，但加载到运行时失败: ${error instanceof Error ? error.message : String(error)}`,
        data: {
          skill_id: slug,
          version: version || 'latest',
        },
      };
    }
  }

  private async handleUninstall(skillId: string): Promise<ActionResult> {
    try {
      // 先从 InstallManager 卸载
      await installManager.uninstall(skillId, { purgeData: false });

      // 再从 ClawHub 卸载
      const result = await clawhubConnector.uninstall(skillId);

      if (!result) {
        return {
          success: false,
          message: `卸载 ${skillId} 失败`,
        };
      }

      return {
        success: true,
        message: `已成功卸载 ${skillId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `卸载失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async handleUpdate(skillId?: string): Promise<ActionResult> {
    try {
      const result = await clawhubConnector.update(skillId);

      return {
        success: result.success,
        message: result.message,
        data: result.skillId ? { skill_id: result.skillId } : undefined,
      };
    } catch (error) {
      return {
        success: false,
        message: `更新失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async handleList(): Promise<ActionResult> {
    try {
      // 获取 clawhub 安装的 skills
      const clawhubSkills = await clawhubConnector.list();

      // 获取 InstallManager 的 skills
      const installed = installManager.list();

      const allSkills = [
        ...clawhubSkills.map(s => `📦 ${s} (via ClawHub)`),
        ...installed.map(p => `🔧 ${p.manifest.id}@${p.manifest.version} (via StarUp)`),
      ];

      if (allSkills.length === 0) {
        return {
          success: true,
          message: '没有已安装的 Skill',
        };
      }

      return {
        success: true,
        message: `已安装 ${allSkills.length} 个 Skill:\n\n${allSkills.join('\n')}`,
        data: {
          clawhub: clawhubSkills,
          starup: installed.map(p => ({
            id: p.manifest.id,
            version: p.manifest.version,
            status: p.status,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `获取列表失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async handleInfo(skillId: string): Promise<ActionResult> {
    try {
      const info = await clawhubConnector.inspect(skillId);

      if (!info) {
        return {
          success: false,
          message: `未找到 Skill: ${skillId}`,
        };
      }

      const formatted = `
📦 ${info.name || skillId}
━━━━━━━━━━━━━━━━━━━━━━━━
Slug: ${info.slug || skillId}
版本: ${info.version || 'unknown'}
作者: ${info.author || 'unknown'}
描述: ${info.description || '无描述'}
标签: ${(info.tags || []).join(', ') || '无'}
下载: ${info.downloads || 0}
更新: ${info.updatedAt ? new Date(info.updatedAt).toLocaleDateString() : 'unknown'}
      `.trim();

      return {
        success: true,
        message: formatted,
        data: info,
      };
    } catch (error) {
      return {
        success: false,
        message: `获取信息失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async handleExplore(): Promise<ActionResult> {
    try {
      const skills = await clawhubConnector.explore({ limit: 10 });

      if (skills.length === 0) {
        return {
          success: true,
          message: '暂无推荐的 Skill',
        };
      }

      const formatted = skills.map((s, i) =>
        `${i + 1}. ${s.name} (${s.slug}) - v${s.version}\n   ${s.description}`
      ).join('\n\n');

      return {
        success: true,
        message: `🔥 精选 Skill:\n\n${formatted}`,
        data: { skills },
      };
    } catch (error) {
      return {
        success: false,
        message: `获取推荐失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async handleConfirmation(
    confirmationId: string,
    choice: any,
    context?: SessionContext
  ): Promise<ActionResult> {
    const pending = this.pendingConfirmations.get(confirmationId);
    if (!pending) {
      return {
        success: false,
        message: '确认请求已过期或不存在',
      };
    }

    this.pendingConfirmations.delete(confirmationId);

    if (choice === false || choice === 'cancel' || choice === 'no') {
      return {
        success: false,
        message: '操作已取消',
      };
    }

    switch (pending.type) {
      case 'install_disambiguation': {
        const { skillHint, version, candidates } = pending.data;
        let selected: ClawhubSkill;

        if (typeof choice === 'number') {
          selected = candidates[choice - 1];
        } else if (typeof choice === 'string') {
          selected = candidates.find((c: ClawhubSkill) => c.slug === choice || c.name === choice) || candidates[0];
        } else {
          selected = candidates[0];
        }

        if (!selected) {
          return {
            success: false,
            message: '无效的选择',
          };
        }

        return this.performInstall(selected.slug, version);
      }

      default:
        return {
          success: false,
          message: '未知的确认类型',
        };
    }
  }

  private createConfirmationId(): string {
    return `clawhub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

// 单例导出
export const metaClawhubSkill = new MetaClawhubSkill();
