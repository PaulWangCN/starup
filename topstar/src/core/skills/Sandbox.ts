import * as path from 'path';
import {
  Permission,
  NetworkPermissionScope,
  VMInstance,
  CapabilityError,
} from '../../types';

/**
 * 沙箱隔离
 * 负责权限检查、API 拦截和资源限制
 */
export class Sandbox {
  /**
   * 检查网络权限
   */
  checkNetworkPermission(
    permissions: Permission[],
    url: string
  ): boolean {
    const networkPerm = permissions.find(p => p.id === 'network.fetch');
    if (!networkPerm) return false;

    const scope = networkPerm.scope as NetworkPermissionScope;
    
    // 检查 deny 列表
    for (const pattern of scope.deny) {
      if (this.matchPattern(url, pattern)) {
        return false;
      }
    }

    // 检查 allow 列表
    for (const pattern of scope.allow) {
      if (this.matchPattern(url, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查文件系统权限
   */
  checkFSPermission(
    permissions: Permission[],
    filePath: string,
    operation: 'read' | 'write' | 'append'
  ): boolean {
    const permId = `fs.${operation}`;
    const fsPerm = permissions.find(p => p.id === permId);
    
    if (!fsPerm) {
      // 检查通配权限
      const wildcardPerm = permissions.find(p => p.id === 'fs.*');
      if (!wildcardPerm) return false;
    }

    const scope = (fsPerm || permissions.find(p => p.id === 'fs.*'))?.scope as string[];
    if (!scope) return false;

    for (const pattern of scope) {
      if (this.matchPath(filePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查记忆权限
   */
  checkMemoryPermission(
    permissions: Permission[],
    key: string,
    operation: 'read' | 'write'
  ): boolean {
    const permId = `memory.${operation}`;
    const memPerm = permissions.find(p => p.id === permId);
    
    if (!memPerm) return false;

    const scope = memPerm.scope as string[];
    
    for (const pattern of scope) {
      if (this.matchPattern(key, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查工具权限
   */
  checkToolPermission(
    permissions: Permission[],
    toolName: string
  ): boolean {
    const toolPerm = permissions.find(p => p.id === 'tools.use');
    if (!toolPerm) return false;

    const scope = toolPerm.scope as string[];
    return scope.includes(toolName) || scope.includes('*');
  }

  /**
   * 检查跨 Skill 调用权限
   */
  checkInteropPermission(
    permissions: Permission[],
    targetSkill: string,
    method: string
  ): boolean {
    const interopPerm = permissions.find(p => p.id === 'skill.interop');
    if (!interopPerm) return false;

    const scope = interopPerm.scope as string[];
    return scope.includes(`${targetSkill}:${method}`) ||
           scope.includes(`${targetSkill}:*`);
  }

  /**
   * 创建 Capability 错误
   */
  createError(permission: string, detail?: string): CapabilityError {
    return new CapabilityError(
      `Capability denied: ${permission}${detail ? ` - ${detail}` : ''}`,
      permission
    );
  }

  /**
   * 验证资源使用
   */
  checkResourceUsage(vm: VMInstance, currentMemory: number): boolean {
    return currentMemory <= vm.memory;
  }

  // ==================== 私有方法 ====================

  /**
   * 匹配 URL/域名模式
   */
  private matchPattern(value: string, pattern: string): boolean {
    // 精确匹配
    if (value === pattern) return true;

    // 通配符匹配
    const regexPattern = pattern
      .replace(/\*\*/g, '<<DOUBLESTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<DOUBLESTAR>>/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(value);
  }

  /**
   * 匹配路径模式
   */
  private matchPath(filePath: string, pattern: string): boolean {
    // 替换模板变量
    const expandedPattern = pattern
      .replace('${SKILL_PATH}', '*')
      .replace('${SKILL_HOME}', '*')
      .replace('${SHARED_TEMP}', '*');

    return this.matchPattern(filePath, expandedPattern);
  }

  /**
   * 解析模板变量
   */
  expandPath(pattern: string, vars: Record<string, string>): string {
    return pattern.replace(/\$\{(\w+)\}/g, (match, key) => vars[key] || match);
  }
}
