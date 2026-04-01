import {
  MetaSkill,
  ActionResult,
  SessionContext,
  SkillPackage,
  UpgradeResult,
} from '../../types';
import { installManager } from './InstallManager';
import { skillHubClient } from './SkillHubClient';
import { metaRegistrySkill } from './MetaRegistrySkill';

/**
 * Meta-Updater Skill
 * 检查版本更新，处理升级策略
 */
export class MetaUpdaterSkill implements MetaSkill {
  id = 'core.updater';
  name = 'Skill 更新器';
  description = '检查版本更新，处理升级策略';
  type = 'meta' as const;

  permissions = [
    { id: 'fs.modify', scope: ['~/.starup/skills/*', '~/.starup/skilldb/*'] },
    { id: 'version.check', scope: ['*'] },
    { id: 'network.hub', scope: { allow: ['*'], deny: [] } },
  ];

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    console.log('[MetaUpdaterSkill] Initialized');
  }

  /**
   * 处理请求
   */
  async handle(request: any, context: SessionContext): Promise<ActionResult> {
    const action = request.action;

    switch (action) {
      case 'check':
        return this.handleCheck(request.skill_id);
      case 'update':
        return this.handleUpdate(request.skill_id, request.force);
      case 'update_all':
        return this.handleUpdateAll();
      default:
        return {
          success: false,
          message: `Unknown action: ${action}`,
        };
    }
  }

  /**
   * 检查单个 Skill 更新
   */
  async checkUpdate(skillId: string): Promise<{ hasUpdate: boolean; currentVersion: string; latestVersion: string }> {
    const skill = installManager.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    const currentVersion = skill.manifest.version;

    // 搜索 Hub 获取最新版本
    const results = await skillHubClient.search({ query: skillId });
    const match = results.find(r => r.id === skillId);

    if (!match) {
      return { hasUpdate: false, currentVersion, latestVersion: currentVersion };
    }

    const latestVersion = match.version;
    const hasUpdate = this.compareVersion(latestVersion, currentVersion) > 0;

    return { hasUpdate, currentVersion, latestVersion };
  }

  /**
   * 升级 Skill
   */
  async update(skillId: string, force: boolean = false): Promise<UpgradeResult> {
    const check = await this.checkUpdate(skillId);

    if (!check.hasUpdate && !force) {
      return {
        success: true,
        oldVersion: check.currentVersion,
        newVersion: check.currentVersion,
        downtime_ms: 0,
        rollbackAvailable: false,
      };
    }

    return installManager.upgrade(skillId, check.latestVersion);
  }

  /**
   * 检查所有可更新 Skill
   */
  async checkAllUpdates(): Promise<{ skillId: string; currentVersion: string; latestVersion: string }[]> {
    const installed = installManager.list();
    const updates: { skillId: string; currentVersion: string; latestVersion: string }[] = [];

    for (const skill of installed) {
      try {
        const check = await this.checkUpdate(skill.manifest.id);
        if (check.hasUpdate) {
          updates.push({
            skillId: skill.manifest.id,
            currentVersion: check.currentVersion,
            latestVersion: check.latestVersion,
          });
        }
      } catch (error) {
        console.warn(`[MetaUpdaterSkill] Failed to check update for ${skill.manifest.id}:`, error);
      }
    }

    return updates;
  }

  // ==================== 私有方法 ====================

  private async handleCheck(skillId: string): Promise<ActionResult> {
    try {
      const check = await this.checkUpdate(skillId);
      return {
        success: true,
        message: check.hasUpdate
          ? `Update available: ${skillId} ${check.currentVersion} → ${check.latestVersion}`
          : `${skillId} is up to date (${check.currentVersion})`,
        data: check,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleUpdate(skillId: string, force?: boolean): Promise<ActionResult> {
    try {
      // 禁止卸载 core.* 系列
      if (skillId.startsWith('core.')) {
        return {
          success: false,
          message: `System meta-skills cannot be updated through this interface`,
        };
      }

      const result = await this.update(skillId, force);
      return {
        success: result.success,
        message: result.success
          ? `Updated ${skillId} ${result.oldVersion} → ${result.newVersion}`
          : `Update failed`,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleUpdateAll(): Promise<ActionResult> {
    const updates = await this.checkAllUpdates();
    const results: { skillId: string; success: boolean; message: string }[] = [];

    for (const update of updates) {
      try {
        // 跳过 core.*
        if (update.skillId.startsWith('core.')) {
          results.push({
            skillId: update.skillId,
            success: false,
            message: 'System meta-skills cannot be auto-updated',
          });
          continue;
        }

        const result = await installManager.upgrade(update.skillId, update.latestVersion);
        results.push({
          skillId: update.skillId,
          success: result.success,
          message: result.success
            ? `${update.currentVersion} → ${update.latestVersion}`
            : 'Failed',
        });
      } catch (error) {
        results.push({
          skillId: update.skillId,
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return {
      success: successCount === updates.length,
      message: `Updated ${successCount}/${updates.length} skill(s)`,
      data: results,
    };
  }

  private compareVersion(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const a = parts1[i] || 0;
      const b = parts2[i] || 0;
      if (a < b) return -1;
      if (a > b) return 1;
    }

    return 0;
  }
}

// 单例导出
export const metaUpdaterSkill = new MetaUpdaterSkill();
