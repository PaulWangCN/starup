import * as fs from 'fs/promises';
import * as path from 'path';
import {
  MetaSkill,
  ActionResult,
  SessionContext,
  SkillSearchRequest,
  SkillSearchResult,
  SkillCandidate,
  SkillPackage,
} from '../../types';
import { clawhubConnector } from './ClawhubConnector';
import { installManager } from './InstallManager';
import { searchBuiltinSkills, getBuiltinSkill } from './BuiltinSkills';

/**
 * Meta-Registry Skill（简化版）
 * 管理本地 Skill 索引与 Hub 查询
 */
export class MetaRegistrySkill implements MetaSkill {
  id = 'core.registry';
  name = 'Skill 注册表';
  description = '管理本地 Skill 索引与 Hub 查询';
  type = 'meta' as const;

  permissions = [
    { id: 'network.hub', scope: { allow: ['*'], deny: [] } },
    { id: 'db.read', scope: ['~/.starup/skilldb/*'] },
    { id: 'db.write', scope: ['~/.starup/skilldb/*'] },
  ];

  private localIndex: Map<string, SkillPackage> = new Map();
  private indexPath: string;

  constructor() {
    const starupHome = path.join(process.env.HOME || '.', '.starup');
    this.indexPath = path.join(starupHome, 'skilldb', 'index.json');
  }

  async initialize(): Promise<void> {
    await this.loadLocalIndex();
    console.log('[MetaRegistrySkill] Initialized');
  }

  async handle(request: any, context: SessionContext): Promise<ActionResult> {
    switch (request.action) {
      case 'search':
        return this.handleSearch(request.query, request.filters);
      case 'resolve':
        return this.handleResolve(request.skill_hint);
      case 'list':
        return this.handleList(request.filter);
      case 'info':
        return this.handleInfo(request.skill_id);
      default:
        return { success: false, message: `Unknown action: ${request.action}` };
    }
  }

  async search(request: SkillSearchRequest): Promise<SkillSearchResult[]> {
    const results: SkillSearchResult[] = [];
    const seenIds = new Set<string>();

    // 1. 搜索 ClawHub
    try {
      const clawhubResults = await clawhubConnector.search(request.query, { limit: 20 });
      for (const s of clawhubResults.skills) {
        if (!seenIds.has(s.slug)) {
          seenIds.add(s.slug);
          results.push({
            id: s.slug,
            name: s.name,
            version: s.version || 'latest',
            description: s.description,
            manifest_digest: '',
            capabilities_preview: s.tags || [],
            source_hub: 'clawhub',
            trusted: true,
          });
        }
      }
    } catch {
      // ignore
    }

    // 2. 搜索内置列表作为 fallback
    if (results.length === 0) {
      const builtinResults = searchBuiltinSkills(request.query);
      for (const skill of builtinResults) {
        if (!seenIds.has(skill.id)) {
          seenIds.add(skill.id);
          results.push({
            id: skill.id,
            name: skill.name,
            version: skill.version,
            description: skill.description,
            manifest_digest: '',
            capabilities_preview: skill.tags,
            source_hub: 'builtin',
            trusted: true,
          });
        }
      }
    }

    // 补充本地安装信息
    for (const result of results) {
      const local = this.localIndex.get(result.id);
      if (local) {
        result.installed_version = local.manifest.version;
        result.update_available = local.manifest.version !== result.version;
      }
    }

    return results;
  }

  async resolve(skillHint: string): Promise<SkillCandidate[]> {
    const localExact = this.localIndex.get(skillHint);
    if (localExact) {
      return [{ id: localExact.manifest.id, name: localExact.manifest.name, version: localExact.manifest.version, description: localExact.manifest.description, source_hub: 'local' }];
    }

    const results = await this.search({ query: skillHint });
    if (results.length === 0) {
      const builtin = getBuiltinSkill(skillHint);
      if (builtin) {
        return [{ id: builtin.id, name: builtin.name, version: builtin.version, description: builtin.description, source_hub: 'builtin' }];
      }
      return [];
    }

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      description: r.description,
      source_hub: r.source_hub,
    }));
  }

  async updateIndex(skillId: string, pkg: SkillPackage): Promise<void> {
    this.localIndex.set(skillId, pkg);
    await this.saveLocalIndex();
  }

  async removeFromIndex(skillId: string): Promise<void> {
    this.localIndex.delete(skillId);
    await this.saveLocalIndex();
  }

  getLocalSkill(skillId: string): SkillPackage | undefined {
    return this.localIndex.get(skillId);
  }

  // ==================== 私有方法 ====================

  private async handleSearch(query: string, filters?: any): Promise<ActionResult> {
    const results = await this.search({ query, filters });
    return { success: true, message: `Found ${results.length} skill(s) matching "${query}"`, data: results };
  }

  private async handleResolve(skillHint: string): Promise<ActionResult> {
    const candidates = await this.resolve(skillHint);
    if (candidates.length === 0) {
      return { success: false, message: `No skills found matching "${skillHint}"` };
    }
    if (candidates.length === 1) {
      return { success: true, message: `Resolved to ${candidates[0].id}@${candidates[0].version}`, data: candidates[0] };
    }
    return {
      success: true,
      message: `Found ${candidates.length} candidates for "${skillHint}"`,
      requires_confirmation: true,
      confirmation_type: 'disambiguation',
      candidates,
    };
  }

  private async handleList(filter?: string): Promise<ActionResult> {
    const installed = installManager.list();
    let results = installed;
    if (filter) {
      const filterLower = filter.toLowerCase();
      results = installed.filter((pkg) => pkg.manifest.id.toLowerCase().includes(filterLower) || pkg.manifest.name.toLowerCase().includes(filterLower));
    }
    return {
      success: true,
      message: `Found ${results.length} installed skill(s)`,
      data: results.map((pkg) => ({ id: pkg.manifest.id, name: pkg.manifest.name, version: pkg.manifest.version, status: pkg.status })),
    };
  }

  private async handleInfo(skillId: string): Promise<ActionResult> {
    const pkg = installManager.get(skillId);
    if (!pkg) {
      return { success: false, message: `Skill ${skillId} not found` };
    }
    return {
      success: true,
      message: `Skill info for ${skillId}`,
      data: {
        id: pkg.manifest.id,
        name: pkg.manifest.name,
        version: pkg.manifest.version,
        description: pkg.manifest.description,
        author: pkg.manifest.author,
        license: pkg.manifest.license,
        status: pkg.status,
        path: pkg.path,
        permissions: pkg.manifest.permissions,
      },
    };
  }

  private async loadLocalIndex(): Promise<void> {
    try {
      const content = await fs.readFile(this.indexPath, 'utf-8');
      const data = JSON.parse(content);
      for (const [id, pkg] of Object.entries(data.skills || {})) {
        this.localIndex.set(id, pkg as SkillPackage);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[MetaRegistrySkill] Failed to load local index:', error);
      }
    }
  }

  private async saveLocalIndex(): Promise<void> {
    const data = { version: '1.3-simple', updatedAt: Date.now(), skills: Object.fromEntries(this.localIndex) };
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.writeFile(this.indexPath, JSON.stringify(data, null, 2));
  }
}

export const metaRegistrySkill = new MetaRegistrySkill();
