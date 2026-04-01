import { SkillPackage, SkillInstance, SkillStatus, ToolDefinition, PromptFragment } from '../../types';

/**
 * Skill 运行时（简化版占位符）
 * 工具注册和索引生成已迁移到 SkillRegistry。
 */
export class SkillRuntime {
  private instances: Map<string, SkillInstance> = new Map();
  private promptFragments: Map<string, PromptFragment> = new Map();

  async initialize(): Promise<void> {
    console.log('[SkillRuntime] Initialized (noop)');
  }

  async loadAndActivate(pkg: SkillPackage): Promise<SkillInstance> {
    const instance: SkillInstance = {
      id: pkg.manifest.id,
      package: pkg,
      tools: [],
      status: 'active',
    };
    this.instances.set(pkg.manifest.id, instance);
    return instance;
  }

  async load(pkg: SkillPackage): Promise<SkillInstance> {
    return this.loadAndActivate(pkg);
  }

  async activate(instance: SkillInstance): Promise<void> {
    instance.status = 'active';
  }

  async deactivate(skillId: string): Promise<void> {
    const instance = this.instances.get(skillId);
    if (instance) instance.status = 'disabled';
  }

  async unload(skillId: string): Promise<void> {
    this.instances.delete(skillId);
    this.promptFragments.delete(skillId);
  }

  getActiveSkills(): SkillInstance[] {
    return Array.from(this.instances.values()).filter((i) => i.status === 'active');
  }

  getStatus(skillId: string): SkillStatus | null {
    return this.instances.get(skillId)?.status || null;
  }

  getPromptFragments(): PromptFragment[] {
    return Array.from(this.promptFragments.values());
  }
}

export const skillRuntime = new SkillRuntime();
