import * as path from 'path';
import * as fs from 'fs/promises';
import axios from 'axios';
import {
  MetaSkill,
  ActionResult,
  SessionContext,
  InstallIntent,
  SkillCandidate,
  CapabilityPreview,
  InstallSpec,
  InstallOptions,
  SkillManifest,
} from '../../types';
import { installManager } from './InstallManager';
import { skillRuntime } from './SkillRuntime';
import { metaRegistrySkill } from './MetaRegistrySkill';
import { clawhubConnector, ClawhubSkill } from './ClawhubConnector';

import { intentRouter } from '../intent/IntentRouter';

/**
 * Meta-Installer Skill
 * 处理 install/uninstall 意图，实现"用 Skill 管理 Skill"的自举架构
 */
export class MetaInstallerSkill implements MetaSkill {
  id = 'core.installer';
  name = 'Skill 安装器';
  description = '处理 Skill 的安装、卸载和依赖管理';
  type = 'meta' as const;

  permissions = [
    { id: 'fs.write', scope: ['~/.starup/skills/*', '~/.starup/skilldb/*', '~/.starup/db/*'] },
    { id: 'network.fetch', scope: { allow: ['https://skillhub.tencent.com/*', 'https://clawhub.ai/*', 'https://*.github.com/*'], deny: [] } },
    { id: 'skill.runtime.manage', scope: ['load', 'unload', 'reload'] },
    { id: 'prompt.layer.modify', scope: ['L5'] },
    { id: 'intent.router.register', scope: ['dynamic'] },
  ];

  private pendingConfirmations: Map<string,
    | { type: 'disambiguation'; data: { intent: InstallIntent; candidates: SkillCandidate[] } }
    | { type: 'capability'; data: { skillId: string; version: string; intent: InstallIntent; manifest: SkillManifest } }
    | { type: 'install_confirm'; data: { skill: ClawhubSkill; version: string; intent: InstallIntent; manifest: SkillManifest } }
    | { type: 'install_select'; data: { skills: ClawhubSkill[]; version: string; intent: InstallIntent } }
    | { type: 'general'; data: any }
  > = new Map();

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    console.log('[MetaInstallerSkill] Initialized');
  }

  /**
   * 处理请求
   */
  async handle(request: any, context: SessionContext): Promise<ActionResult> {
    const action = request.action;

    switch (action) {
      case 'install':
        return this.handleInstall(request.intent, context);
      case 'uninstall':
        return this.handleUninstall(request.skill_id, request.purge_data);
      case 'confirm':
        return this.handleConfirmation(request.confirmation_id, request.choice, context);
      default:
        return {
          success: false,
          message: `Unknown action: ${action}`,
        };
    }
  }

  /**
   * 安装 Skill（支持模糊匹配和权限确认）
   */
  async install(intent: InstallIntent, context: SessionContext): Promise<ActionResult> {
    return this.handleInstall(intent, context);
  }

  /**
   * 卸载 Skill
   */
  async uninstall(skillId: string, purgeData: boolean = false): Promise<ActionResult> {
    return this.handleUninstall(skillId, purgeData);
  }

  // ==================== 私有方法 ====================

  private async handleInstall(intent: InstallIntent, context: SessionContext): Promise<ActionResult> {
    try {
      // 1. 解析目标（模糊匹配）
      const candidates = await metaRegistrySkill.resolve(intent.skill_hint);

      if (!candidates || candidates.length === 0) {
        // 如果没有找到候选，尝试直接使用用户输入的名称安装
        console.log(`[MetaInstallerSkill] No candidates found for "${intent.skill_hint}", trying direct install`);
        return this.executeInstall(intent.skill_hint, intent.version || 'latest', intent, context);
      }
      
      // 验证候选数据完整性
      const validCandidates = candidates.filter(c => c && c.id);
      if (validCandidates.length === 0) {
        console.warn(`[MetaInstallerSkill] No valid candidates found, trying direct install with hint: ${intent.skill_hint}`);
        return this.executeInstall(intent.skill_hint, intent.version || 'latest', intent, context);
      }

      // 2. 如果有多个候选，请求用户确认
      if (validCandidates.length > 1) {
        const confirmationId = this.createConfirmationId();
        this.pendingConfirmations.set(confirmationId, {
          type: 'disambiguation',
          data: { intent, candidates: validCandidates },
        });

        return {
          success: true,
          message: `找到以下与 "${intent.skill_hint}" 相关的 Skill，请确认安装哪一个：\n` +
            validCandidates.map((c, i) => `${i + 1}. ${c.name} (${c.id}@${c.version}) - ${c.description}`).join('\n'),
          requires_confirmation: true,
          confirmation_type: 'disambiguation',
          candidates: validCandidates,
          data: { confirmation_id: confirmationId },
        };
      }

      // 3. 单个候选，继续安装流程
      const target = validCandidates[0];
      return this.executeInstall(target.id, target.version, intent, context);

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '安装失败',
      };
    }
  }

  private async executeInstall(
    skillId: string,
    version: string,
    intent: InstallIntent,
    context: SessionContext
  ): Promise<ActionResult> {
    // v1.3.2: 安装前先在 ClawHub 搜索确认存在性
    console.log(`[MetaInstallerSkill] Searching for ${skillId} on ClawHub before install...`);
    
    const searchResult = await clawhubConnector.search(skillId, { limit: 10 });
    
    // 1. 没有找到任何结果
    if (searchResult.skills.length === 0) {
      return {
        success: false,
        message: `❌ 未找到名为 "${skillId}" 的 Skill。\n\n` +
          `请确认名称是否正确，或使用以下命令搜索相关 Skill：\n` +
          `  startup skillhub search ${skillId}`,
      };
    }

    // 2. 精确匹配（slug 完全匹配）
    const exactMatch = searchResult.skills.find(s => s.slug === skillId);
    
    // 3. 如果有精确匹配，检查是否有多个同名不同源的
    const nameMatches = searchResult.skills.filter(s => 
      s.slug === skillId || s.name.toLowerCase() === skillId.toLowerCase()
    );

    // 4. 只有一个精确匹配：显示详情让用户确认
    if (exactMatch && nameMatches.length === 1) {
      return this.confirmInstallSingle(exactMatch, version, intent);
    }

    // 5. 多个匹配：让用户选择
    if (nameMatches.length > 1 || (!exactMatch && searchResult.skills.length > 0)) {
      return this.askUserToSelectSkill(searchResult.skills, skillId, version, intent);
    }

    // 6. 其他情况（理论上不会到这里）
    return {
      success: false,
      message: `❌ 无法确定要安装的 Skill。\n\n` +
        `找到 ${searchResult.skills.length} 个相关结果，但没有精确匹配。\n` +
        `请使用以下命令查看详情：\n` +
        `  startup skillhub search ${skillId}`,
    };
  }

  /**
   * 确认安装单个 skill
   */
  private async confirmInstallSingle(
    skill: ClawhubSkill,
    version: string,
    intent: InstallIntent
  ): Promise<ActionResult> {
    const confirmationId = this.createConfirmationId();
    
    // 创建临时的 manifest 用于权限检查
    const tempManifest: SkillManifest = {
      id: skill.slug,
      name: skill.name,
      version: skill.version || 'latest',
      api_version: '1.2',
      author: skill.author,
      license: 'unknown',
      description: skill.description,
      runtime: { type: 'javascript', entry: 'index.js' },
      permissions: [],
    };

    this.pendingConfirmations.set(confirmationId, {
      type: 'install_confirm',
      data: { skill, version, intent, manifest: tempManifest },
    });

    return {
      success: true,
      message: `📦 找到 Skill：${skill.name}\n\n` +
        `slug: ${skill.slug}\n` +
        `描述: ${skill.description}\n` +
        `版本: ${skill.version || 'latest'}\n\n` +
        `确认安装吗？（回复 "确认" 或 "是" 继续）`,
      requires_confirmation: true,
      confirmation_type: 'general',
      data: { confirmation_id: confirmationId },
    };
  }

  /**
   * 让用户从多个 skill 中选择
   */
  private async askUserToSelectSkill(
    skills: ClawhubSkill[],
    originalHint: string,
    version: string,
    intent: InstallIntent
  ): Promise<ActionResult> {
    const confirmationId = this.createConfirmationId();
    
    this.pendingConfirmations.set(confirmationId, {
      type: 'install_select',
      data: { skills, version, intent },
    });

    const list = skills.slice(0, 5).map((s, i) => 
      `${i + 1}. ${s.name}\n   slug: ${s.slug}\n   ${s.description}`
    ).join('\n\n');

    return {
      success: true,
      message: `🔍 找到多个相关 Skill（搜索: "${originalHint}"）：\n\n${list}\n\n` +
        `请回复数字 1-${Math.min(skills.length, 5)} 选择要安装的 Skill，或回复 "取消" 放弃安装。`,
      requires_confirmation: true,
      confirmation_type: 'disambiguation',
      candidates: skills.slice(0, 5).map(s => ({
        id: s.slug,
        name: s.name,
        version: s.version || 'latest',
        description: s.description,
        source_hub: 'clawhub',
      })),
      data: { confirmation_id: confirmationId },
    };
  }

  private async performInstallation(
    skillId: string,
    version: string,
    intent: InstallIntent,
    manifest: SkillManifest
  ): Promise<ActionResult> {
    try {
      // v1.3.2: 使用 InstallManager 安装（PackageDownloader 内部已集成 clawhub）
      const spec: InstallSpec = {
        source: 'marketplace',
        id: skillId,
        version: version,
        registry: intent.source_hub,
      };

      const options: InstallOptions = {
        force: intent.force || false,
        offline: intent.offline || false,
        verify: true,
      };

      const result = await installManager.install(spec, options);

      if (!result.success) {
        // 安装失败，尝试搜索相似 skill 建议
        const suggestions = await this.searchSimilarSkills(skillId);
        
        let suggestionText = '';
        if (suggestions.length > 0) {
          suggestionText = '\n\n💡 你是否想找:\n' + suggestions.map(s => `  - ${s}`).join('\n');
        }

        return {
          success: false,
          message: `❌ 安装失败: ${result.message}${suggestionText}\n\n` +
            `请确认 skill 名称正确，或尝试搜索相关 skill。`,
          error: result.error,
        };
      }

      // 3.4 热加载：加载到 SkillRuntime（零重启热扩展）
      const pkg = installManager.get(skillId);
      if (pkg) {
        await metaRegistrySkill.updateIndex(skillId, pkg);
        await skillRuntime.loadAndActivate(pkg);

        // 3.5 注册意图到 IntentRouter
        const intentPath = path.join(pkg.path, 'INTENTS.md');
        await intentRouter.loadSkillIntentFromFile(skillId, intentPath);

        // 3.6 更新 L5 Prompt Layer（通过 SkillRuntime 的 prompt fragment）
        // SkillRuntime.loadAndActivate 已经处理了 Prompt 片段注入和事件通知
      }

      return {
        success: true,
        message: `✅ 成功安装 ${skillId}@${version}，现在你可以使用相关功能了。`,
        data: {
          skill_id: skillId,
          version: version,
          name: manifest.name,
        },
      };

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '安装过程中发生未知错误',
      };
    }
  }

  /**
   * 搜索相似的 skills 作为建议
   */
  private async searchSimilarSkills(hint: string): Promise<string[]> {
    try {
      const result = await clawhubConnector.search(hint, { limit: 5 });
      return result.skills.map(s => s.slug);
    } catch {
      return [];
    }
  }

  private async handleUninstall(skillId: string, purgeData?: boolean): Promise<ActionResult> {
    // 禁止卸载 core.* 系列 Meta-Skill
    if (skillId.startsWith('core.')) {
      return {
        success: false,
        message: '系统核心 Meta-Skill 不允许卸载',
      };
    }

    try {
      // 1. 先从 SkillRuntime 卸载
      await skillRuntime.unload(skillId);

      // 2. 从 InstallManager 卸载
      const result = await installManager.uninstall(skillId, { purgeData: purgeData || false });

      if (!result) {
        return {
          success: false,
          message: `卸载 ${skillId} 失败`,
        };
      }

      // 3. 更新本地索引
      await metaRegistrySkill.removeFromIndex(skillId);

      // 4. 从 IntentRouter 注销意图
      // TODO: IntentRouter 需要添加 unregisterSkillIntent 方法

      return {
        success: true,
        message: `已成功卸载 ${skillId}${purgeData ? '（数据已清除）' : ''}`,
      };

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '卸载失败',
      };
    }
  }

  private async handleConfirmation(
    confirmationId: string,
    choice: any,
    context: SessionContext
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
      case 'disambiguation': {
        const { intent, candidates } = pending.data;
        let selected: SkillCandidate;

        if (typeof choice === 'number') {
          selected = candidates[choice - 1];
        } else if (typeof choice === 'string') {
          // 尝试按 ID 或名称匹配
          selected = candidates.find(c => c.id === choice || c.name === choice) || candidates[0];
        } else {
          selected = candidates[0];
        }

        if (!selected) {
          return {
            success: false,
            message: '无效的选择',
          };
        }

        return this.executeInstall(selected.id, selected.version, intent, context);
      }

      case 'install_select': {
        const { skills, version, intent } = pending.data;
        
        let selected: ClawhubSkill;

        if (typeof choice === 'number') {
          selected = skills[choice - 1];
        } else if (typeof choice === 'string') {
          // 尝试解析数字
          const numChoice = parseInt(choice, 10);
          if (!isNaN(numChoice) && numChoice > 0 && numChoice <= skills.length) {
            selected = skills[numChoice - 1];
          } else {
            // 尝试按 slug 或名称匹配
            selected = skills.find(s => s.slug === choice || s.name === choice) || skills[0];
          }
        } else {
          selected = skills[0];
        }

        if (!selected) {
          return {
            success: false,
            message: '无效的选择',
          };
        }

        // 选择后需要确认
        return this.confirmInstallSingle(selected, version || 'latest', intent);
      }

      case 'capability': {
        const { skillId, version, intent, manifest } = pending.data;
        return this.performInstallation(skillId, version, intent, manifest);
      }

      case 'install_confirm': {
        const { skill, version, intent } = pending.data;
        
        // 用户确认安装单个 skill
        if (choice === true || choice === 'yes' || choice === '确认' || choice === '是') {
          const tempManifest: SkillManifest = {
            id: skill.slug,
            name: skill.name,
            version: skill.version || version || 'latest',
            api_version: '1.2',
            author: skill.author,
            license: 'unknown',
            description: skill.description,
            runtime: { type: 'javascript', entry: 'index.js' },
            permissions: [],
          };
          return this.performInstallation(skill.slug, version || skill.version || 'latest', intent, tempManifest);
        }
        
        return {
          success: false,
          message: '安装已取消',
        };
      }

      default:
        return {
          success: false,
          message: '未知的确认类型',
        };
    }
  }

  private extractHighRiskPermissions(manifest: SkillManifest): CapabilityPreview[] {
    const riskMap: Record<string, { name: string; description: string; risk_level: CapabilityPreview['risk_level'] }> = {
      'fs.write': { name: '文件系统写入', description: '允许 Skill 写入本地文件', risk_level: 'medium' },
      'fs.delete': { name: '文件删除', description: '允许 Skill 删除本地文件', risk_level: 'high' },
      'fs.system': { name: '系统目录访问', description: '允许访问系统关键目录', risk_level: 'critical' },
      'network.fetch': { name: '网络请求', description: '允许发起 HTTP 请求', risk_level: 'low' },
      'skill.runtime.manage': { name: '运行时管理', description: '允许加载/卸载其他 Skill', risk_level: 'critical' },
      'prompt.layer.modify': { name: 'Prompt 层修改', description: '允许修改系统 Prompt', risk_level: 'high' },
      'intent.router.register': { name: '意图路由注册', description: '允许动态注册意图', risk_level: 'high' },
      'memory.write': { name: '记忆写入', description: '允许写入长期记忆', risk_level: 'medium' },
      'tools.use': { name: '工具调用', description: '允许调用系统工具', risk_level: 'low' },
    };

    const highRisk: CapabilityPreview[] = [];

    for (const perm of manifest.permissions || []) {
      const info = riskMap[perm.id];
      if (info && (info.risk_level === 'high' || info.risk_level === 'critical')) {
        highRisk.push({
          id: perm.id,
          name: info.name,
          description: info.description,
          risk_level: info.risk_level,
          scope: Array.isArray(perm.scope) ? perm.scope : undefined,
        });
      }
    }

    return highRisk;
  }

  private createConfirmationId(): string {
    return `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

// 单例导出
export const metaInstallerSkill = new MetaInstallerSkill();
