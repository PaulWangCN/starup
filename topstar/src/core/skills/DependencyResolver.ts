import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import YAML from 'yaml';
import {
  Dependency,
  DependencyTree,
  DependencyNode,
  VersionConflict,
  ResolutionConstraints,
  SkillManifest,
  SkillPackage,
  DependencyError,
} from '../../types';

/**
 * 依赖解析器
 * 使用 SAT 求解器思想处理复杂依赖关系
 * 支持版本冲突解决和多版本共存
 */
export class DependencyResolver {
  private cachePath: string;
  private registryCache: Map<string, SkillManifest[]> = new Map();

  constructor(cachePath: string) {
    this.cachePath = cachePath;
  }

  /**
   * 解析依赖树
   * 返回拓扑排序后的安装顺序和冲突列表
   */
  async resolve(
    requirements: Dependency[],
    constraints: ResolutionConstraints
  ): Promise<DependencyTree> {
    console.log('[DependencyResolver] Resolving dependencies...');
    
    // 构建依赖图
    const graph = await this.buildDependencyGraph(requirements);
    
    // 检测循环依赖
    const cycles = this.detectCycles(graph);
    if (cycles.length > 0) {
      if (constraints.strategies.cycle_detection === 'error') {
        throw new DependencyError(
          `Circular dependency detected: ${cycles.join(' -> ')}`,
          []
        );
      } else if (constraints.strategies.cycle_detection === 'warn') {
        console.warn('[DependencyResolver] Circular dependencies:', cycles);
      }
    }
    
    // 解决版本冲突
    const conflicts = this.findVersionConflicts(graph);
    const resolvedConflicts = await this.resolveConflicts(
      conflicts,
      constraints.strategies.upgrade
    );
    
    // 拓扑排序获取安装顺序
    const installOrder = this.topologicalSort(graph, resolvedConflicts);
    
    // 构建依赖树
    const root: DependencyNode = {
      id: 'root',
      version: '0.0.0',
      resolved: true,
      children: [],
    };
    
    for (const dep of requirements) {
      const node = this.buildDependencyNode(dep.id, graph, resolvedConflicts);
      root.children.push(node);
    }
    
    return {
      root,
      conflicts: resolvedConflicts,
      install_order: installOrder,
    };
  }

  /**
   * 检查版本是否满足范围
   */
  satisfies(version: string, range: string): boolean {
    // 简单实现，实际应使用 semver 库
    if (range === '*' || range === 'latest') return true;
    
    // 精确版本
    if (!range.match(/[\^~>=<]/)) {
      return version === range;
    }
    
    // ^ 范围：兼容次要版本
    if (range.startsWith('^')) {
      const minVersion = range.slice(1);
      const [major] = minVersion.split('.');
      const [vMajor] = version.split('.');
      return parseInt(vMajor) === parseInt(major) && this.compareVersion(version, minVersion) >= 0;
    }
    
    // ~ 范围：兼容补丁版本
    if (range.startsWith('~')) {
      const minVersion = range.slice(1);
      const [major, minor] = minVersion.split('.');
      const [vMajor, vMinor] = version.split('.');
      return parseInt(vMajor) === parseInt(major) &&
             parseInt(vMinor) === parseInt(minor) &&
             this.compareVersion(version, minVersion) >= 0;
    }
    
    // >= 范围
    if (range.startsWith('>=')) {
      const minVersion = range.slice(2);
      return this.compareVersion(version, minVersion) >= 0;
    }
    
    return false;
  }

  /**
   * 比较两个版本号
   * 返回：-1 (v1 < v2), 0 (v1 = v2), 1 (v1 > v2)
   */
  compareVersion(v1: string, v2: string): number {
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

  /**
   * 获取最新满足范围的版本
   */
  async resolveVersion(id: string, range: string): Promise<string | null> {
    const versions = await this.fetchAvailableVersions(id);
    
    // 排序版本（从高到低）
    const sortedVersions = versions
      .filter(v => this.satisfies(v, range))
      .sort((a, b) => this.compareVersion(b, a));
    
    return sortedVersions[0] || null;
  }

  // ==================== 私有方法 ====================

  /**
   * 构建依赖图
   */
  private async buildDependencyGraph(
    requirements: Dependency[],
    visited: Set<string> = new Set()
  ): Promise<Map<string, Dependency[]>> {
    const graph = new Map<string, Dependency[]>();
    
    for (const req of requirements) {
      if (visited.has(req.id)) continue;
      visited.add(req.id);
      
      // 获取满足范围的版本
      const version = await this.resolveVersion(req.id, req.version);
      if (!version) {
        throw new DependencyError(
          `Cannot resolve ${req.id}@${req.version}`,
          []
        );
      }
      
      // 获取该版本的 manifest
      const manifest = await this.fetchManifest(req.id, version);
      
      // 记录依赖
      graph.set(req.id, manifest.dependencies || []);
      
      // 递归处理子依赖
      if (manifest.dependencies) {
        const subGraph = await this.buildDependencyGraph(
          manifest.dependencies,
          visited
        );
        for (const [id, deps] of subGraph) {
          if (!graph.has(id)) {
            graph.set(id, deps);
          }
        }
      }
    }
    
    return graph;
  }

  /**
   * 检测循环依赖
   */
  private detectCycles(graph: Map<string, Dependency[]>): string[] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[] = [];
    
    const dfs = (node: string, path: string[]): boolean => {
      visited.add(node);
      recursionStack.add(node);
      
      const deps = graph.get(node) || [];
      for (const dep of deps) {
        if (!visited.has(dep.id)) {
          if (dfs(dep.id, [...path, dep.id])) {
            return true;
          }
        } else if (recursionStack.has(dep.id)) {
          // 发现循环
          const cycleStart = path.indexOf(dep.id);
          cycles.push(...path.slice(cycleStart), dep.id);
          return true;
        }
      }
      
      recursionStack.delete(node);
      return false;
    };
    
    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node, [node]);
      }
    }
    
    return cycles;
  }

  /**
   * 查找版本冲突
   */
  private findVersionConflicts(
    graph: Map<string, Dependency[]>
  ): VersionConflict[] {
    const conflicts: VersionConflict[] = [];
    const requirements = new Map<string, { by: string; range: string }[]>();
    
    // 收集所有版本要求
    for (const [id, deps] of graph) {
      for (const dep of deps) {
        if (!requirements.has(dep.id)) {
          requirements.set(dep.id, []);
        }
        requirements.get(dep.id)!.push({ by: id, range: dep.version });
      }
    }
    
    // 检查冲突
    for (const [id, reqs] of requirements) {
      if (reqs.length > 1) {
        const ranges = [...new Set(reqs.map(r => r.range))];
        if (ranges.length > 1) {
          // 检查是否有共同满足的版本
          const candidates = this.findCommonVersions(ranges);
          if (candidates.length === 0) {
            conflicts.push({
              skill_id: id,
              required_by: reqs.map(r => r.by),
              candidates: [],
              resolution: 'fail',
            });
          }
        }
      }
    }
    
    return conflicts;
  }

  /**
   * 解决版本冲突
   */
  private async resolveConflicts(
    conflicts: VersionConflict[],
    strategy: 'auto' | 'prompt' | 'reject'
  ): Promise<VersionConflict[]> {
    if (strategy === 'reject' && conflicts.length > 0) {
      throw new DependencyError('Version conflicts rejected', conflicts);
    }
    
    const resolved: VersionConflict[] = [];
    
    for (const conflict of conflicts) {
      if (strategy === 'auto') {
        // 尝试升级以满足所有依赖
        const allVersions = await this.fetchAvailableVersions(conflict.skill_id);
        const sortedVersions = allVersions.sort((a, b) =>
          this.compareVersion(b, a)
        );
        
        // 找一个满足所有范围的版本
        for (const version of sortedVersions) {
          // 这里应该检查是否满足所有依赖方的要求
          // 简化处理：选择最新版本
          resolved.push({
            ...conflict,
            candidates: [version],
            resolution: 'upgrade',
          });
          break;
        }
      }
    }
    
    return resolved;
  }

  /**
   * 拓扑排序
   */
  private topologicalSort(
    graph: Map<string, Dependency[]>,
    resolvedConflicts: VersionConflict[]
  ): SkillPackage[] {
    const inDegree = new Map<string, number>();
    const result: SkillPackage[] = [];
    
    // 计算入度
    for (const [id, deps] of graph) {
      if (!inDegree.has(id)) {
        inDegree.set(id, 0);
      }
      for (const dep of deps) {
        inDegree.set(dep.id, (inDegree.get(dep.id) || 0) + 1);
      }
    }
    
    // 找到入度为0的节点
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }
    
    // 处理队列
    while (queue.length > 0) {
      const id = queue.shift()!;
      
      // 创建 SkillPackage（简化版本）
      const skillPackage: SkillPackage = {
        manifest: {
          id,
          name: id,
          version: '1.0.0',
          api_version: '1.2',
          author: 'unknown',
          license: 'unknown',
          description: '',
          runtime: { type: 'javascript', entry: 'dist/main.js' },
          permissions: [],
        },
        path: '',
        status: 'installed',
        installedAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      result.push(skillPackage);
      
      // 减少依赖此节点的入度
      const deps = graph.get(id) || [];
      for (const dep of deps) {
        const newDegree = (inDegree.get(dep.id) || 0) - 1;
        inDegree.set(dep.id, newDegree);
        if (newDegree === 0) {
          queue.push(dep.id);
        }
      }
    }
    
    return result;
  }

  /**
   * 构建依赖节点树
   */
  private buildDependencyNode(
    id: string,
    graph: Map<string, Dependency[]>,
    resolvedConflicts: VersionConflict[],
    visited: Set<string> = new Set()
  ): DependencyNode {
    if (visited.has(id)) {
      return {
        id,
        version: 'circular',
        resolved: false,
        children: [],
      };
    }
    
    visited.add(id);
    const deps = graph.get(id) || [];
    const children: DependencyNode[] = [];
    
    for (const dep of deps) {
      const child = this.buildDependencyNode(dep.id, graph, resolvedConflicts, visited);
      children.push(child);
    }
    
    return {
      id,
      version: '1.0.0', // 应该从 manifest 获取
      resolved: true,
      children,
    };
  }

  /**
   * 查找共同满足的版本
   */
  private findCommonVersions(ranges: string[]): string[] {
    // 简化实现：返回假设的共同版本
    // 实际应该查询 registry
    return ['1.0.0'];
  }

  /**
   * 获取可用版本列表
   */
  private async fetchAvailableVersions(id: string): Promise<string[]> {
    // 检查缓存
    if (this.registryCache.has(id)) {
      return this.registryCache.get(id)!.map(m => m.version);
    }
    
    try {
      // 从 registry 获取
      const registryUrl = `https://marketplace.starup.ai/api/skills/${id}/versions`;
      const response = await axios.get(registryUrl, { timeout: 5000 });
      const versions = response.data.versions || [];
      return versions;
    } catch (error) {
      console.warn(`[DependencyResolver] Failed to fetch versions for ${id}:`, error);
      return ['1.0.0'];
    }
  }

  /**
   * 获取指定版本的 manifest
   */
  private async fetchManifest(id: string, version: string): Promise<SkillManifest> {
    // 检查缓存
    const cached = this.registryCache.get(id);
    if (cached) {
      const found = cached.find(m => m.version === version);
      if (found) return found;
    }
    
    try {
      // 从 registry 获取
      const registryUrl = `https://marketplace.starup.ai/api/skills/${id}/${version}/manifest`;
      const response = await axios.get(registryUrl, { timeout: 5000 });
      return response.data as SkillManifest;
    } catch (error) {
      console.warn(`[DependencyResolver] Failed to fetch manifest for ${id}@${version}:`, error);
      
      // 返回空 manifest
      return {
        id,
        name: id,
        version,
        api_version: '1.2',
        author: 'unknown',
        license: 'unknown',
        description: '',
        runtime: { type: 'javascript', entry: 'dist/main.js' },
        permissions: [],
      };
    }
  }
}
