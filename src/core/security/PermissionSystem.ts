/**
 * 权限系统
 * 
 * 核心功能：
 * 1. 三级权限模式：default（询问用户）、bypass（自动允许）、strict（自动拒绝）
 * 2. 细粒度的工具级权限控制
 * 3. 路径级权限控制
 * 
 * 参考：Claude Code泄漏代码中的权限系统
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/Logger';

/** 权限模式 */
export type PermissionMode = 'default' | 'bypass' | 'strict';

/** 权限级别 */
export type PermissionLevel = 'deny' | 'ask' | 'allow';

/** 操作类型 */
export type ActionType = 
  | 'tool_use' 
  | 'file_read' 
  | 'file_write' 
  | 'file_delete'
  | 'exec_command'
  | 'network_request'
  | 'subagent_spawn';

/** 权限规则 */
export interface PermissionRule {
  id: string;
  pattern: string;
  action: ActionType;
  level: PermissionLevel;
  description?: string;
  createdAt: number;
  expiresAt?: number;
}

/** 权限请求 */
export interface PermissionRequest {
  action: ActionType;
  resource: string;
  params?: Record<string, any>;
}

/** 权限决策 */
export interface PermissionDecision {
  allowed: boolean;
  level: PermissionLevel;
  reason: string;
  ruleId?: string;
  requestUser?: boolean;
}

/** 危险命令模式 */
const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+-rf\s+\//, action: 'exec_command', level: 'deny' as PermissionLevel, reason: 'Dangerous: recursive delete root' },
  { pattern: /rm\s+-rf\s+~/, action: 'exec_command', level: 'deny' as PermissionLevel, reason: 'Dangerous: recursive delete home' },
  { pattern: /dd\s+if=.*of=\/dev\//, action: 'exec_command', level: 'deny' as PermissionLevel, reason: 'Dangerous: direct device write' },
  { pattern: /mkfs\./, action: 'exec_command', level: 'deny' as PermissionLevel, reason: 'Dangerous: filesystem format' },
  { pattern: /:\(\)\{\s*:\|:\s*&\s*};\s*:/, action: 'exec_command', level: 'deny' as PermissionLevel, reason: 'Dangerous: fork bomb' },
  { pattern: /\.ssh\/id_rsa/, action: 'file_read', level: 'ask' as PermissionLevel, reason: 'Sensitive: SSH private key' },
  { pattern: /\.aws\/credentials/, action: 'file_read', level: 'ask' as PermissionLevel, reason: 'Sensitive: AWS credentials' },
];

/**
 * 权限系统
 */
export class PermissionSystem extends EventEmitter {
  private mode: PermissionMode = 'default';
  private rules: Map<string, PermissionRule> = new Map();
  private userDecisions: Map<string, PermissionLevel> = new Map();

  constructor(mode: PermissionMode = 'default') {
    super();
    this.mode = mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
    logger.info('PermissionSystem', `Mode changed to ${mode}`);
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  checkPermission(request: PermissionRequest): PermissionDecision {
    if (this.mode === 'bypass') {
      return { allowed: true, level: 'allow', reason: 'Bypass mode' };
    }

    if (this.mode === 'strict') {
      return { allowed: false, level: 'deny', reason: 'Strict mode' };
    }

    // 检查危险模式
    const dangerCheck = this.checkDangerousPatterns(request);
    if (dangerCheck.level === 'deny') {
      return { allowed: false, level: 'deny', reason: dangerCheck.reason };
    }

    // 检查规则
    const rule = this.findMatchingRule(request);
    if (rule) {
      return {
        allowed: rule.level === 'allow',
        level: rule.level,
        reason: `Rule: ${rule.description}`,
        ruleId: rule.id
      };
    }

    return { allowed: false, level: 'ask', reason: 'Confirmation required', requestUser: true };
  }

  addRule(rule: Omit<PermissionRule, 'id' | 'createdAt'>): PermissionRule {
    const fullRule: PermissionRule = {
      ...rule,
      id: `rule-${Date.now()}`,
      createdAt: Date.now()
    };
    this.rules.set(fullRule.id, fullRule);
    return fullRule;
  }

  canUseTool(toolName: string): PermissionDecision {
    return this.checkPermission({ action: 'tool_use', resource: toolName });
  }

  private checkDangerousPatterns(request: PermissionRequest): { level: PermissionLevel; reason: string } {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.action === request.action && pattern.pattern.test(request.resource)) {
        return { level: pattern.level, reason: pattern.reason };
      }
    }
    return { level: 'ask', reason: 'No pattern matched' };
  }

  private findMatchingRule(request: PermissionRequest): PermissionRule | null {
    for (const rule of this.rules.values()) {
      if (rule.action === request.action && new RegExp(rule.pattern).test(request.resource)) {
        return rule;
      }
    }
    return null;
  }
}

export const permissionSystem = new PermissionSystem();
export default PermissionSystem;
