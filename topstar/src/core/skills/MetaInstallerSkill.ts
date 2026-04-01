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
import { skillHubClient } from './SkillHubClient';
import { skillhubCLI } from './SkillhubCLI';

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
    | { type: 'install'; data: any }
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
    // 3.1 获取 manifest 预览权限
    const manifest = await skillHubClient.fetchManifest(skillId, version, intent.source_hub);
    if (!manifest) {
      return {
        success: false,
        message: `无法获取 ${skillId}@${version} 的 manifest`,
      };
    }

    // 3.2 权限预览（高危权限需要确认）
    const highRiskPerms = this.extractHighRiskPermissions(manifest);
    if (highRiskPerms.length > 0) {
      const confirmationId = this.createConfirmationId();
      this.pendingConfirmations.set(confirmationId, {
        type: 'capability',
        data: { skillId, version, intent, manifest },
      });

      return {
        success: true,
        message: `Skill "${manifest.name}" 申请以下权限，是否继续安装？\n` +
          highRiskPerms.map(p => `- ${p.name}: ${p.description} [风险等级: ${p.risk_level}]`).join('\n'),
        requires_confirmation: true,
        confirmation_type: 'capability',
        capabilities: highRiskPerms,
        data: { confirmation_id: confirmationId },
      };
    }

    // 3.3 执行实际安装
    return this.performInstallation(skillId, version, intent, manifest);
  }

  private async performInstallation(
    skillId: string,
    version: string,
    intent: InstallIntent,
    manifest: SkillManifest
  ): Promise<ActionResult> {
    try {
      // v1.3.1: 优先尝试使用腾讯 SkillHub CLI 安装
      const skillhubInstalled = await skillhubCLI.isInstalled();
      
      if (skillhubInstalled) {
        console.log(`[MetaInstallerSkill] Using SkillHub CLI to install ${skillId}`);
        const result = await skillhubCLI.install(skillId, version);
        
        if (result.success) {
          // 尝试从 SkillHub 安装目录加载
          await this.loadSkillFromSkillHub(skillId);
          
          return {
            success: true,
            message: `已通过 SkillHub 成功安装 ${skillId}${version ? '@' + version : ''}，现在你可以使用相关功能了。`,
            data: {
              skill_id: skillId,
              version: version || 'latest',
              name: manifest.name,
              installed_via: 'skillhub',
            },
          };
        } else {
          // SkillHub 安装失败，回退到内部 InstallManager
          console.log(`[MetaInstallerSkill] SkillHub install failed, falling back to internal installer`);
        }
      } else {
        console.log(`[MetaInstallerSkill] SkillHub CLI not found, using internal installer`);
      }

      // 使用内部 InstallManager 安装
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
        // 安装失败，返回明确的错误信息
        return {
          success: false,
          message: `❌ 安装失败: ${result.message}\n\n` +
            `系统已尝试以下安装方式但都未成功：\n` +
            `1. SkillHub CLI (skillhub install)\n` +
            `2. Tencent SkillHub (https://skillhub.tencent.com/)\n` +
            `3. ClawHub (https://clawhub.ai/)\n\n` +
            `💡 建议解决方案：\n` +
            `- 安装 SkillHub CLI: curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only\n` +
            `- 或访问 https://skillhub.tencent.com/ 手动下载安装`,
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
        message: `已成功安装 ${skillId}@${version}，现在你可以使用相关功能了。`,
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
   * 尝试从 SkillHub 安装目录加载 Skill
   */
  private async loadSkillFromSkillHub(skillId: string): Promise<void> {
    try {
      // SkillHub 默认安装到当前 workspace 的 .skillhub 目录
      const skillhubPath = path.join(process.cwd(), '.skillhub', skillId);
      const fs = await import('fs/promises');
      
      try {
        await fs.access(skillhubPath);
        // TODO: 加载 SkillHub 安装的 skill 到运行时
        console.log(`[MetaInstallerSkill] Found SkillHub installation at ${skillhubPath}`);
      } catch {
        // SkillHub 可能安装到了其他位置
      }
    } catch {
      // 忽略加载错误
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

      case 'capability': {
        const { skillId, version, intent, manifest } = pending.data;
        return this.performInstallation(skillId, version, intent, manifest);
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
