import * as path from 'path';
import * as fs from 'fs/promises';
import {
  MetaSkill,
  ActionResult,
  SessionContext,
  InstallIntent,
  SkillCandidate,
  SkillManifest,
} from '../../types';
import { installManager } from './InstallManager';
import { skillRegistry } from './SkillRegistry';
import { metaRegistrySkill } from './MetaRegistrySkill';
import { clawhubConnector } from './ClawhubConnector';

/**
 * Meta-Installer Skill（简化版）
 * 处理 install/uninstall 意图
 */
export class MetaInstallerSkill implements MetaSkill {
  id = 'core.installer';
  name = 'Skill 安装器';
  description = '处理 Skill 的安装、卸载';
  type = 'meta' as const;

  permissions = [
    { id: 'fs.write', scope: ['~/.starup/skills/*', '~/.starup/skilldb/*'] },
    { id: 'network.fetch', scope: { allow: ['https://skillhub.tencent.com/*', 'https://clawhub.ai/*', 'https://*.github.com/*'], deny: [] } },
  ];

  private pendingConfirmations: Map<string, { type: string; data: any }> = new Map();

  async initialize(): Promise<void> {
    console.log('[MetaInstallerSkill] Initialized');
  }

  async handle(request: any, context: SessionContext): Promise<ActionResult> {
    switch (request.action) {
      case 'install':
        return this.handleInstall(request.intent, context);
      case 'uninstall':
        return this.handleUninstall(request.skill_id);
      case 'confirm':
        return this.handleConfirmation(request.confirmation_id, request.choice, context);
      default:
        return { success: false, message: `Unknown action: ${request.action}` };
    }
  }

  async install(intent: InstallIntent, context: SessionContext): Promise<ActionResult> {
    return this.handleInstall(intent, context);
  }

  async uninstall(skillId: string, purgeData: boolean = false): Promise<ActionResult> {
    return this.handleUninstall(skillId);
  }

  // ==================== 私有方法 ====================

  private async handleInstall(intent: InstallIntent, context: SessionContext): Promise<ActionResult> {
    try {
      const candidates = await metaRegistrySkill.resolve(intent.skill_hint);
      const validCandidates = candidates.filter((c) => c && c.id);

      if (validCandidates.length === 0) {
        return {
          success: false,
          message: `未找到与 "${intent.skill_hint}" 相关的 Skill，请确认名称是否正确。`,
        };
      }

      if (validCandidates.length > 1) {
        const confirmationId = this.createConfirmationId();
        this.pendingConfirmations.set(confirmationId, {
          type: 'disambiguation',
          data: { intent, candidates: validCandidates },
        });
        return {
          success: true,
          message: `找到以下与 "${intent.skill_hint}" 相关的 Skill，请确认安装哪一个（回复数字）：\n` +
            validCandidates.map((c, i) => `${i + 1}. ${c.name} (${c.id}@${c.version}) - ${c.description}`).join('\n'),
          requires_confirmation: true,
          confirmation_type: 'disambiguation',
          candidates: validCandidates,
          data: { confirmation_id: confirmationId },
        };
      }

      return this.performInstallation(validCandidates[0].id, validCandidates[0].version, intent);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '安装失败' };
    }
  }

  private async performInstallation(skillId: string, version: string, intent: InstallIntent): Promise<ActionResult> {
    try {
      const result = await installManager.install(
        { source: 'marketplace', id: skillId, version: version || 'latest', registry: intent.source_hub },
        { force: intent.force || false, offline: intent.offline || false, verify: false }
      );

      if (!result.success) {
        return {
          success: false,
          message: `❌ 安装失败: ${result.message}`,
          error: result.error,
        };
      }

      // 触发重新扫描，让 SkillRegistry 加载工具和更新索引
      await skillRegistry.rescan();

      return {
        success: true,
        message: `✅ 成功安装 ${skillId}@${version || 'latest'}，现在你可以使用相关功能了。`,
        data: { skill_id: skillId, version: version || 'latest' },
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '安装过程中发生未知错误' };
    }
  }

  private async handleUninstall(skillId: string): Promise<ActionResult> {
    if (skillId.startsWith('core.')) {
      return { success: false, message: '系统核心 Meta-Skill 不允许卸载' };
    }
    try {
      const result = await skillRegistry.uninstall(skillId);
      if (!result) {
        return { success: false, message: `卸载 ${skillId} 失败` };
      }
      return { success: true, message: `已成功卸载 ${skillId}` };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '卸载失败' };
    }
  }

  private async handleConfirmation(
    confirmationId: string,
    choice: any,
    context: SessionContext
  ): Promise<ActionResult> {
    const pending = this.pendingConfirmations.get(confirmationId);
    if (!pending) {
      return { success: false, message: '确认请求已过期或不存在' };
    }

    this.pendingConfirmations.delete(confirmationId);

    if (choice === false || choice === 'cancel' || choice === 'no' || choice === '取消') {
      return { success: false, message: '操作已取消' };
    }

    if (pending.type === 'disambiguation') {
      const { intent, candidates } = pending.data;
      let selected: SkillCandidate;
      if (typeof choice === 'number') {
        selected = candidates[choice - 1];
      } else if (typeof choice === 'string') {
        const num = parseInt(choice, 10);
        if (!isNaN(num) && num > 0 && num <= candidates.length) {
          selected = candidates[num - 1];
        } else {
          selected = candidates.find((c: SkillCandidate) => c.id === choice || c.name === choice) || candidates[0];
        }
      } else {
        selected = candidates[0];
      }
      if (!selected) return { success: false, message: '无效的选择' };
      return this.performInstallation(selected.id, selected.version, intent);
    }

    return { success: false, message: '未知的确认类型' };
  }

  private createConfirmationId(): string {
    return `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

export const metaInstallerSkill = new MetaInstallerSkill();
