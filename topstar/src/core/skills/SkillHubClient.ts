import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import YAML from 'yaml';
import {
  HubSourceConfig,
  SkillSearchRequest,
  SkillSearchResult,
  SkillManifest,
  SkillCandidate,
} from '../../types';
import { searchBuiltinSkills, getBuiltinSkill } from './BuiltinSkills';

/**
 * SkillHub 客户端
 * 统一封装不同 Hub 的搜索、查询、下载接口
 */
export class SkillHubClient {
  private hubs: HubSourceConfig[] = [];
  private configPath: string;
  private manifestCache: Map<string, SkillManifest> = new Map();

  constructor() {
    const starupHome = path.join(process.env.HOME || '.', '.starup');
    this.configPath = path.join(starupHome, 'config', 'hub.yaml');
  }

  /**
   * 初始化 Hub 配置
   */
  async initialize(): Promise<void> {
    console.log('[SkillHubClient] Initializing...');
    await this.loadHubConfig();

    if (this.hubs.length === 0) {
      // 设置默认 Hub 源：腾讯 SkillHub (主要) + ClawHub (兜底) + 本地
      this.hubs = [
        {
          name: 'tencent-skillhub',
          endpoint: 'https://skillhub.tencent.com/api/v1',
          priority: 1,
          trusted: true,
        },
        {
          name: 'clawhub',
          endpoint: 'https://clawhub.ai/api/v1',
          priority: 2,
          trusted: true,
        },
        {
          name: 'local',
          endpoint: `file://${path.join(process.env.HOME || '.', '.starup', 'hub')}`,
          priority: 99,
          type: 'filesystem',
          trusted: true,
        },
      ];
    }

    console.log(`[SkillHubClient] Loaded ${this.hubs.length} hub sources`);
  }

  /**
   * 搜索 Skill
   */
  async search(request: SkillSearchRequest): Promise<SkillSearchResult[]> {
    const results: SkillSearchResult[] = [];
    const seenIds = new Set<string>();

    const hubsToQuery = this.getHubsInPriority(request.hub_preference);
    let hubSearchFailed = false;

    for (const hub of hubsToQuery) {
      try {
        if (request.filters?.trusted_only && !hub.trusted) {
          continue;
        }

        const hubResults = await this.searchHub(hub, request);

        for (const result of hubResults) {
          const uniqueKey = `${result.id}@${result.version}`;
          if (!seenIds.has(uniqueKey)) {
            seenIds.add(uniqueKey);
            results.push(result);
          }
        }
      } catch (error) {
        console.warn(`[SkillHubClient] Search failed for hub ${hub.name}:`, error);
        hubSearchFailed = true;
      }
    }

    // 如果 Hub 搜索失败或没有结果，使用内置列表作为 fallback
    if (results.length === 0) {
      console.log(`[SkillHubClient] Using builtin skills as fallback for query: ${request.query}`);
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
            capabilities_preview: [],
            source_hub: 'builtin',
            trusted: true,
          });
        }
      }
    }

    return results;
  }

  /**
   * 模糊匹配 Skill 名称
   */
  async resolveFuzzyName(name: string): Promise<SkillCandidate[]> {
    const results = await this.search({ query: name });

    // 如果没有找到结果，尝试精确匹配内置列表
    if (results.length === 0) {
      const builtin = getBuiltinSkill(name);
      if (builtin) {
        return [{
          id: builtin.id,
          name: builtin.name,
          version: builtin.version,
          description: builtin.description,
          source_hub: 'builtin',
        }];
      }
    }

    return results.map(r => ({
      id: r.id,
      name: r.name,
      version: r.version,
      description: r.description,
      source_hub: r.source_hub,
    }));
  }

  /**
   * 获取指定 Skill 的 manifest
   */
  async fetchManifest(skillId: string, version: string, hubName?: string): Promise<SkillManifest | null> {
    const cacheKey = `${skillId}@${version}`;
    if (this.manifestCache.has(cacheKey)) {
      return this.manifestCache.get(cacheKey)!;
    }

    const hubsToQuery = hubName
      ? this.hubs.filter(h => h.name === hubName)
      : this.getHubsInPriority();

    for (const hub of hubsToQuery) {
      try {
        const manifest = await this.fetchManifestFromHub(hub, skillId, version);
        if (manifest) {
          this.manifestCache.set(cacheKey, manifest);
          return manifest;
        }
      } catch (error) {
        console.warn(`[SkillHubClient] Failed to fetch manifest from ${hub.name}:`, error);
      }
    }

    return null;
  }

  /**
   * 获取下载链接
   */
  async getDownloadUrl(skillId: string, version: string, hubName?: string): Promise<string | null> {
    const hubsToQuery = hubName
      ? this.hubs.filter(h => h.name === hubName)
      : this.getHubsInPriority();

    for (const hub of hubsToQuery) {
      if (hub.type === 'filesystem') {
        const hubPath = hub.endpoint.replace('file://', '');
        const packagePath = path.join(hubPath, skillId, `${version}.claw`);
        try {
          await fs.access(packagePath);
          return `file://${packagePath}`;
        } catch {
          continue;
        }
      } else {
        const url = `${hub.endpoint}/skills/${skillId}/download?version=${version}`;
        try {
          const response = await axios.head(url, {
            timeout: 5000,
            headers: this.getAuthHeaders(hub),
          });
          if (response.status === 200) {
            return url;
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  /**
   * 获取签名
   */
  async getSignature(skillId: string, version: string, hubName?: string): Promise<string | null> {
    const hubsToQuery = hubName
      ? this.hubs.filter(h => h.name === hubName)
      : this.getHubsInPriority();

    for (const hub of hubsToQuery) {
      if (hub.type === 'filesystem') {
        const hubPath = hub.endpoint.replace('file://', '');
        const sigPath = path.join(hubPath, skillId, `${version}.sig`);
        try {
          const content = await fs.readFile(sigPath, 'utf-8');
          return content;
        } catch {
          continue;
        }
      } else {
        try {
          const url = `${hub.endpoint}/skills/${skillId}/signature?version=${version}`;
          const response = await axios.get(url, {
            timeout: 5000,
            headers: this.getAuthHeaders(hub),
          });
          return response.data.signature || null;
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  /**
   * 获取所有配置的 Hub
   */
  getHubs(): HubSourceConfig[] {
    return [...this.hubs];
  }

  // ==================== 私有方法 ====================

  private async loadHubConfig(): Promise<void> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const config = YAML.parse(content);
      this.hubs = (config.hubs || []).sort((a: HubSourceConfig, b: HubSourceConfig) => a.priority - b.priority);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[SkillHubClient] Failed to load hub config:', error);
      }
    }
  }

  private getHubsInPriority(preference?: string[]): HubSourceConfig[] {
    let sorted = [...this.hubs].sort((a, b) => a.priority - b.priority);

    if (preference && preference.length > 0) {
      sorted = sorted.filter(h => preference.includes(h.name));
      // 按 preference 顺序排列
      sorted.sort((a, b) => {
        const aIndex = preference.indexOf(a.name);
        const bIndex = preference.indexOf(b.name);
        return aIndex - bIndex;
      });
    }

    return sorted;
  }

  private async searchHub(hub: HubSourceConfig, request: SkillSearchRequest): Promise<SkillSearchResult[]> {
    if (hub.type === 'filesystem') {
      return this.searchFilesystemHub(hub, request);
    }

    const url = `${hub.endpoint}/search`;
    const response = await axios.get(url, {
      params: {
        q: request.query,
        runtime: request.filters?.runtime,
      },
      timeout: 8000,
      headers: this.getAuthHeaders(hub),
    });

    let results = response.data.results || response.data || [];
    
    // 确保 results 是数组
    if (!Array.isArray(results)) {
      console.warn(`[SkillHubClient] Hub ${hub.name} returned non-array response:`, typeof results);
      // 尝试从常见结构中提取数组
      if (results.data && Array.isArray(results.data)) {
        results = results.data;
      } else if (results.skills && Array.isArray(results.skills)) {
        results = results.skills;
      } else if (results.items && Array.isArray(results.items)) {
        results = results.items;
      } else {
        // 如果是单个对象，包装成数组
        results = typeof results === 'object' && results !== null ? [results] : [];
      }
    }
    
    return results.map((r: any) => ({
      ...r,
      source_hub: hub.name,
      trusted: hub.trusted || false,
    }));
  }

  private async searchFilesystemHub(hub: HubSourceConfig, request: SkillSearchRequest): Promise<SkillSearchResult[]> {
    const hubPath = hub.endpoint.replace('file://', '');
    const results: SkillSearchResult[] = [];

    try {
      const entries = await fs.readdir(hubPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillPath = path.join(hubPath, entry.name);
        const manifestPath = path.join(skillPath, 'manifest.yaml');

        try {
          const content = await fs.readFile(manifestPath, 'utf-8');
          const manifest = YAML.parse(content);

          const matchScore = this.calculateMatchScore(request.query, manifest);
          if (matchScore > 0) {
            results.push({
              id: manifest.id,
              name: manifest.name,
              version: manifest.version,
              description: manifest.description,
              manifest_digest: '',
              capabilities_preview: (manifest.permissions || []).map((p: any) => p.id),
              source_hub: hub.name,
              trusted: hub.trusted || false,
            });
          }
        } catch {
          // 忽略无法读取的目录
        }
      }
    } catch {
      // 目录可能不存在
    }

    return results;
  }

  private async fetchManifestFromHub(hub: HubSourceConfig, skillId: string, version: string): Promise<SkillManifest | null> {
    if (hub.type === 'filesystem') {
      const hubPath = hub.endpoint.replace('file://', '');
      const manifestPath = path.join(hubPath, skillId, 'manifest.yaml');
      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        return YAML.parse(content) as SkillManifest;
      } catch {
        return null;
      }
    }

    const url = `${hub.endpoint}/skills/${skillId}/manifest?version=${version}`;
    const response = await axios.get(url, {
      timeout: 5000,
      headers: this.getAuthHeaders(hub),
    });

    return response.data as SkillManifest;
  }

  private getAuthHeaders(hub: HubSourceConfig): Record<string, string> {
    if (!hub.auth) return {};

    if (hub.auth.type === 'token') {
      const token = hub.auth.env ? process.env[hub.auth.env] : hub.auth.token;
      if (token) {
        return { Authorization: `Bearer ${token}` };
      }
    }

    return {};
  }

  private calculateMatchScore(query: string, manifest: any): number {
    const queryLower = query.toLowerCase();
    const nameLower = (manifest.name || '').toLowerCase();
    const descLower = (manifest.description || '').toLowerCase();
    const idLower = (manifest.id || '').toLowerCase();

    if (nameLower.includes(queryLower) || idLower.includes(queryLower)) return 1.0;
    if (descLower.includes(queryLower)) return 0.5;

    const queryWords = queryLower.split(/\s+/);
    const matchWords = queryWords.filter(w => nameLower.includes(w) || descLower.includes(w) || idLower.includes(w));
    return matchWords.length / queryWords.length * 0.3;
  }
}

// 单例导出
export const skillHubClient = new SkillHubClient();
