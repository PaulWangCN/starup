import { MetaSkill, ActionResult, SessionContext } from '../../types';
import { clawhubConnector } from './ClawhubConnector';
import { installManager } from './InstallManager';
import { skillRegistry } from './SkillRegistry';
import { metaInstallerSkill } from './MetaInstallerSkill';

/**
 * Meta-Clawhub Skill（简化版）
 */
export class MetaClawhubSkill implements MetaSkill {
  id = 'core.clawhub';
  name = 'ClawHub 连接器';
  description = '通过 ClawHub 搜索、安装和管理 Skills';
  type = 'meta' as const;

  permissions = [
    { id: 'network.hub', scope: { allow: ['https://clawhub.ai/*'], deny: [] } },
    { id: 'fs.write', scope: ['~/.starup/skills/*'] },
  ];

  async initialize(): Promise<void> {
    console.log('[MetaClawhubSkill] Initialized');
  }

  async handle(request: any, context: SessionContext): Promise<ActionResult> {
    switch (request.action) {
      case 'search':
        return this.handleSearch(request.query, request.options);
      case 'install':
        return metaInstallerSkill.handle({ action: 'install', intent: { skill_hint: request.skill_hint, version: request.version } }, context);
      case 'uninstall':
        return this.handleUninstall(request.skill_id);
      case 'list':
        return this.handleList();
      case 'info':
        return this.handleInfo(request.skill_id);
      default:
        return { success: false, message: `Unknown action: ${request.action}` };
    }
  }

  private async handleSearch(query: string, options?: any): Promise<ActionResult> {
    try {
      const result = await clawhubConnector.search(query, { limit: options?.limit || 10 });
      if (result.skills.length === 0) {
        return { success: true, message: `未找到与 "${query}" 相关的 Skill`, data: { query, results: [] } };
      }
      const formatted = result.skills.map((s, i) => `${i + 1}. ${s.name}${s.description ? ' - ' + s.description : ''}\n   slug: ${s.slug}`).join('\n\n');
      return { success: true, message: `找到 ${result.skills.length} 个与 "${query}" 相关的 Skill:\n\n${formatted}`, data: { query, results: result.skills } };
    } catch (error) {
      return { success: false, message: `搜索失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleUninstall(skillId: string): Promise<ActionResult> {
    if (skillId.startsWith('core.')) {
      return { success: false, message: '系统核心 Meta-Skill 不允许卸载' };
    }
    try {
      const result = await skillRegistry.uninstall(skillId);
      return { success: result, message: result ? `已成功卸载 ${skillId}` : `卸载 ${skillId} 失败` };
    } catch (error) {
      return { success: false, message: `卸载失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleList(): Promise<ActionResult> {
    const installed = installManager.list();
    if (installed.length === 0) {
      return { success: true, message: '没有已安装的 Skill' };
    }
    const list = installed.map((p) => `- ${p.manifest.id}@${p.manifest.version}`).join('\n');
    return { success: true, message: `已安装 ${installed.length} 个 Skill:\n${list}`, data: installed.map((p) => ({ id: p.manifest.id, version: p.manifest.version })) };
  }

  private async handleInfo(skillId: string): Promise<ActionResult> {
    try {
      const info = await clawhubConnector.inspect(skillId);
      if (!info) {
        return { success: false, message: `未找到 Skill: ${skillId}` };
      }
      return {
        success: true,
        message: `📦 ${info.name || skillId}\nSlug: ${info.slug || skillId}\n版本: ${info.version || 'unknown'}\n作者: ${info.author || 'unknown'}\n描述: ${info.description || '无描述'}`,
        data: info,
      };
    } catch (error) {
      return { success: false, message: `获取信息失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

export const metaClawhubSkill = new MetaClawhubSkill();
