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

/**
 * Meta-Registry Skill
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

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    await this.loadLocalIndex();
    console.log('[MetaRegistrySkill] Initialized');
  }

  /**
   * 处理请求
   */
  async handle(request: any, context: SessionContext): Promise<ActionResult> {
    const action = request.action;

    switch (action) {
      case 'search':
        return this.handleSearch(request.query, request.filters);
      case 'resolve':
        return this.handleResolve(request.skill_hint);
      case 'list':
        return this.handleList(request.filter);
      case 'info':
        return this.handleInfo(request.skill_id);
      default:
        return {
          success: false,
          message: `Unknown action: ${action}`,
        };
    }
  }

  /**
   * 搜索 Skill
   * v1.3.2: 仅使用 ClawHub Connector 搜索
   */
  async search(request: SkillSearchRequest): Promise<SkillSearchResult[]> {
    // 使用 ClawHub 搜索
    console.log(`[MetaRegistrySkill] Searching ClawHub: ${request.query}`);
    const clawhubResults = await clawhubConnector.search(request.query, { limit: 20 });
    
    const results: SkillSearchResult[] = clawhubResults.skills.map(s => ({
      id: s.slug,
      name: s.name,
      version: s.version || 'latest',
      description: s.description,
      manifest_digest: '',
      capabilities_preview: s.tags || [],
      source_hub: 'clawhub',
      trusted: true,
    }));

    // 补充本地安装信息
    for (const result of results) {
      const local = this.localIndex.get(result.id);
      if (local) {
        result.installed_version = local.manifest.version;
        // 简化版本比较
        result.update_available = local.manifest.version !== result.version;
      }
    }

    return results;
  }

  /**
   * 解析模糊名称到精确 ID
   * v1.3.2: 仅使用 ClawHub 搜索
   */
  async resolve(skillHint: string): Promise<SkillCandidate[]> {
    // 1. 先检查本地精确匹配
    const localExact = this.localIndex.get(skillHint);
    if (localExact) {
      return [{
        id: localExact.manifest.id,
        name: localExact.manifest.name,
        version: localExact.manifest.version,
        description: localExact.manifest.description,
        source_hub: 'local',
      }];
    }

    // 2. 搜索 ClawHub
    const clawhubResults = await clawhubConnector.search(skillHint, { limit: 10 });

    // 3. 按相关度排序
    return clawhubResults.skills.map(s => ({
      id: s.slug,
      name: s.name,
      version: s.version || 'latest',
      description: s.description,
      source_hub: 'clawhub',
    })).sort((a, b) => {
      const aExact = a.name.toLowerCase() === skillHint.toLowerCase() || a.id.toLowerCase() === skillHint.toLowerCase();
      const bExact = b.name.toLowerCase() === skillHint.toLowerCase() || b.id.toLowerCase() === skillHint.toLowerCase();
      if (aExact && !bExact) return -1;
      if (bExact && !aExact) return 1;
      return 0;
    });
  }

  /**
   * 更新本地索引
   */
  async updateIndex(skillId: string, pkg: SkillPackage): Promise<void> {
    this.localIndex.set(skillId, pkg);
    await this.saveLocalIndex();
  }

  /**
   * 从本地索引移除
   */
  async removeFromIndex(skillId: string): Promise<void> {
    this.localIndex.delete(skillId);
    await this.saveLocalIndex();
  }

  /**
   * 获取本地已安装 Skill
   */
  getLocalSkill(skillId: string): SkillPackage | undefined {
    return this.localIndex.get(skillId);
  }

  // ==================== 私有方法 ====================

  private async handleSearch(query: string, filters?: any): Promise<ActionResult> {
    const results = await this.search({ query, filters });
    return {
      success: true,
      message: `Found ${results.length} skill(s) matching "${query}"`,
      data: results,
    };
  }

  private async handleResolve(skillHint: string): Promise<ActionResult> {
    const candidates = await this.resolve(skillHint);

    if (candidates.length === 0) {
      return {
        success: false,
        message: `No skills found matching "${skillHint}"`,
      };
    }

    if (candidates.length === 1) {
      return {
        success: true,
        message: `Resolved to ${candidates[0].id}@${candidates[0].version}`,
        data: candidates[0],
      };
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
      results = installed.filter(pkg =>
        pkg.manifest.id.toLowerCase().includes(filterLower) ||
        pkg.manifest.name.toLowerCase().includes(filterLower)
      );
    }

    return {
      success: true,
      message: `Found ${results.length} installed skill(s)`,
      data: results.map(pkg => ({
        id: pkg.manifest.id,
        name: pkg.manifest.name,
        version: pkg.manifest.version,
        status: pkg.status,
      })),
    };
  }

  private async handleInfo(skillId: string): Promise<ActionResult> {
    const pkg = installManager.get(skillId);
    if (!pkg) {
      return {
        success: false,
        message: `Skill ${skillId} not found`,
      };
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
        dependencies: pkg.manifest.dependencies,
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
    const data = {
      version: '1.3',
      updatedAt: Date.now(),
      skills: Object.fromEntries(this.localIndex),
    };
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.writeFile(this.indexPath, JSON.stringify(data, null, 2));
  }
}

// 单例导出
export const metaRegistrySkill = new MetaRegistrySkill();
