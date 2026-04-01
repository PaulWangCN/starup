import { MetaSkill, ActionResult, SessionContext, UpgradeResult } from '../../types';
import { installManager } from './InstallManager';
import { clawhubConnector } from './ClawhubConnector';
import { skillRegistry } from './SkillRegistry';

/**
 * Meta-Updater Skill（简化版）
 */
export class MetaUpdaterSkill implements MetaSkill {
  id = 'core.updater';
  name = 'Skill 更新器';
  description = '检查版本更新，处理升级';
  type = 'meta' as const;

  permissions = [
    { id: 'fs.modify', scope: ['~/.starup/skills/*', '~/.starup/skilldb/*'] },
    { id: 'network.hub', scope: { allow: ['*'], deny: [] } },
  ];

  async initialize(): Promise<void> {
    console.log('[MetaUpdaterSkill] Initialized');
  }

  async handle(request: any, context: SessionContext): Promise<ActionResult> {
    switch (request.action) {
      case 'check':
        return this.handleCheck(request.skill_id);
      case 'update':
        return this.handleUpdate(request.skill_id, request.force);
      case 'update_all':
        return this.handleUpdateAll();
      default:
        return { success: false, message: `Unknown action: ${request.action}` };
    }
  }

  async checkUpdate(skillId: string): Promise<{ hasUpdate: boolean; currentVersion: string; latestVersion: string }> {
    const skill = installManager.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} not found`);
    const currentVersion = skill.manifest.version;

    try {
      const clawhubResults = await clawhubConnector.search(skillId, { limit: 10 });
      const match = clawhubResults.skills.find((s) => s.slug === skillId);
      if (!match || !match.version) {
        return { hasUpdate: false, currentVersion, latestVersion: currentVersion };
      }
      const hasUpdate = this.compareVersion(match.version, currentVersion) > 0;
      return { hasUpdate, currentVersion, latestVersion: match.version };
    } catch {
      return { hasUpdate: false, currentVersion, latestVersion: currentVersion };
    }
  }

  async update(skillId: string, force: boolean = false): Promise<UpgradeResult> {
    if (skillId.startsWith('core.')) {
      return { success: false, oldVersion: 'unknown', newVersion: 'unknown', downtime_ms: 0, rollbackAvailable: false };
    }
    const check = await this.checkUpdate(skillId);
    if (!check.hasUpdate && !force) {
      return { success: true, oldVersion: check.currentVersion, newVersion: check.currentVersion, downtime_ms: 0, rollbackAvailable: false };
    }
    return installManager.upgrade(skillId, check.latestVersion);
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
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async handleUpdate(skillId: string, force?: boolean): Promise<ActionResult> {
    try {
      const result = await this.update(skillId, force);
      if (result.success) {
        await skillRegistry.rescan();
      }
      return {
        success: result.success,
        message: result.success ? `Updated ${skillId}` : `Update failed`,
        data: result,
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async handleUpdateAll(): Promise<ActionResult> {
    const installed = installManager.list();
    const results: { skillId: string; success: boolean; message: string }[] = [];

    for (const skill of installed) {
      const id = skill.manifest.id;
      if (id.startsWith('core.')) continue;
      try {
        const result = await this.update(id);
        results.push({ skillId: id, success: result.success, message: result.success ? 'Updated' : 'Failed' });
      } catch (error: any) {
        results.push({ skillId: id, success: false, message: error.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    await skillRegistry.rescan();
    return {
      success: successCount === results.length,
      message: `Updated ${successCount}/${results.length} skill(s)`,
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

export const metaUpdaterSkill = new MetaUpdaterSkill();
