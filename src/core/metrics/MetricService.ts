/**
 * MetricService - 工具和 Skill 监控服务
 * 
 * 功能：
 * 1. 记录工具调用指标（成功/失败、耗时、错误类型）
 * 2. 记录 Skill 执行指标（步数、工具调用数、LLM调用数）
 * 3. 提供统计查询和报告生成功能
 */

import { starupDB } from '../persistence/Database';
import { logger } from '../../utils/Logger';

// 工具调用上下文（用于跟踪一次完整的工具调用）
interface ToolCallContext {
  id: string;
  toolName: string;
  sessionId: string;
  subagentId?: string;
  startTime: number;
  argsSummary: string;
}

// Skill 执行上下文
interface SkillExecutionContext {
  id: string;
  skillId: string;
  sessionId: string;
  missionId?: string;
  subagentRole?: string;
  startTime: number;
  stepsCount: number;
  toolCallsCount: number;
  llmCallsCount: number;
}

// 错误类型分类
export type ErrorType = 
  | 'TIMEOUT'           // 超时
  | 'PERMISSION_DENIED' // 权限不足
  | 'NOT_FOUND'         // 资源不存在
  | 'VALIDATION_ERROR'  // 参数验证失败
  | 'EXECUTION_ERROR'   // 执行错误
  | 'NETWORK_ERROR'     // 网络错误
  | 'RATE_LIMIT'        // 限流
  | 'UNKNOWN';          // 未知错误

export class MetricService {
  private activeToolCalls: Map<string, ToolCallContext> = new Map();
  private activeSkillExecutions: Map<string, SkillExecutionContext> = new Map();

  /**
   * 获取数据库实例
   * 使用方法而不是属性，确保始终获取到当前的 starupDB 实例
   */
  private get db() {
    return starupDB;
  }

  // ==================== 工具调用监控 ====================

  /**
   * 开始记录工具调用
   */
  startToolCall(
    toolName: string,
    sessionId: string,
    args: any,
    subagentId?: string
  ): string {
    const id = `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const context: ToolCallContext = {
      id,
      toolName,
      sessionId,
      subagentId,
      startTime: Date.now(),
      argsSummary: this.summarizeArgs(args),
    };

    this.activeToolCalls.set(id, context);
    return id;
  }

  /**
   * 结束工具调用（成功）
   */
  endToolCallSuccess(toolCallId: string): void {
    const context = this.activeToolCalls.get(toolCallId);
    if (!context) {
      logger.warn('MetricService', `Tool call context not found: ${toolCallId}`);
      return;
    }

    const duration = Date.now() - context.startTime;

    try {
      this.db.recordToolCallMetrics({
        tool_name: context.toolName,
        session_id: context.sessionId,
        subagent_id: context.subagentId,
        args_summary: context.argsSummary,
        success: true,
        duration_ms: duration,
        timestamp: context.startTime,
      });

      logger.debug('MetricService', 
        `Tool ${context.toolName} succeeded in ${duration}ms`);
    } catch (error) {
      logger.error('MetricService', `Failed to record tool metrics: ${error}`);
    }

    this.activeToolCalls.delete(toolCallId);
  }

  /**
   * 结束工具调用（失败）
   */
  endToolCallFailure(toolCallId: string, error: Error | string): void {
    const context = this.activeToolCalls.get(toolCallId);
    if (!context) {
      logger.warn('MetricService', `Tool call context not found: ${toolCallId}`);
      return;
    }

    const duration = Date.now() - context.startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = this.classifyError(errorMessage);

    try {
      this.db.recordToolCallMetrics({
        tool_name: context.toolName,
        session_id: context.sessionId,
        subagent_id: context.subagentId,
        args_summary: context.argsSummary,
        success: false,
        error_type: errorType,
        error_message: errorMessage.substring(0, 500), // 限制长度
        duration_ms: duration,
        timestamp: context.startTime,
      });

      logger.debug('MetricService', 
        `Tool ${context.toolName} failed after ${duration}ms: ${errorType}`);
    } catch (err) {
      logger.error('MetricService', `Failed to record tool metrics: ${err}`);
    }

    this.activeToolCalls.delete(toolCallId);
  }

  // ==================== Skill 执行监控 ====================

  /**
   * 开始记录 Skill 执行
   */
  startSkillExecution(
    skillId: string,
    sessionId: string,
    options: {
      missionId?: string;
      subagentRole?: string;
    } = {}
  ): string {
    const id = `skill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const context: SkillExecutionContext = {
      id,
      skillId,
      sessionId,
      missionId: options.missionId,
      subagentRole: options.subagentRole,
      startTime: Date.now(),
      stepsCount: 0,
      toolCallsCount: 0,
      llmCallsCount: 0,
    };

    this.activeSkillExecutions.set(id, context);
    return id;
  }

  /**
   * 记录 Skill 执行中的一步
   */
  recordSkillStep(skillExecutionId: string, toolCalls: number = 0, llmCalls: number = 1): void {
    const context = this.activeSkillExecutions.get(skillExecutionId);
    if (!context) return;

    context.stepsCount++;
    context.toolCallsCount += toolCalls;
    context.llmCallsCount += llmCalls;
  }

  /**
   * 记录工具调用（在 Skill 执行过程中）
   */
  recordToolCallInSkill(skillExecutionId: string, count: number = 1): void {
    const context = this.activeSkillExecutions.get(skillExecutionId);
    if (!context) return;

    context.toolCallsCount += count;
  }

  /**
   * 结束 Skill 执行
   */
  endSkillExecution(
    skillExecutionId: string, 
    success: boolean, 
    completed: boolean = true
  ): void {
    const context = this.activeSkillExecutions.get(skillExecutionId);
    if (!context) {
      logger.warn('MetricService', `Skill execution context not found: ${skillExecutionId}`);
      return;
    }

    const duration = Date.now() - context.startTime;

    try {
      this.db.recordSkillExecutionMetrics({
        skill_id: context.skillId,
        session_id: context.sessionId,
        mission_id: context.missionId,
        subagent_role: context.subagentRole,
        steps_count: context.stepsCount,
        tool_calls_count: context.toolCallsCount,
        llm_calls_count: context.llmCallsCount,
        duration_ms: duration,
        success,
        completed,
        timestamp: context.startTime,
      });

      logger.debug('MetricService', 
        `Skill ${context.skillId} ${success ? 'succeeded' : 'failed'} ` +
        `(${context.stepsCount} steps, ${context.toolCallsCount} tools, ${duration}ms)`);
    } catch (error) {
      logger.error('MetricService', `Failed to record skill metrics: ${error}`);
    }

    this.activeSkillExecutions.delete(skillExecutionId);
  }

  // ==================== 统计查询 ====================

  /**
   * 获取工具调用统计概览
   */
  getToolStats(days: number = 7): {
    total: number;
    success: number;
    failed: number;
    byTool: Array<{
      tool_name: string;
      total_calls: number;
      success_count: number;
      fail_count: number;
      avg_duration_ms: number;
      max_duration_ms: number;
      min_duration_ms: number;
    }>;
    errors: Array<{
      error_type: string;
      error_count: number;
      affected_tools: string;
      sample_error: string;
    }>;
  } {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const stats = this.db.getToolCallStats({ since });
    const errors = this.db.getToolErrorAnalysis({ since, limit: 10 });

    const total = stats.reduce((sum, s) => sum + s.total_calls, 0);
    const success = stats.reduce((sum, s) => sum + s.success_count, 0);
    const failed = stats.reduce((sum, s) => sum + s.fail_count, 0);

    return {
      total,
      success,
      failed,
      byTool: stats,
      errors,
    };
  }

  /**
   * 获取 Skill 执行统计概览
   */
  getSkillStats(days: number = 7): {
    total: number;
    success: number;
    failed: number;
    bySkill: Array<{
      skill_id: string;
      total_executions: number;
      success_count: number;
      fail_count: number;
      avg_steps: number;
      avg_tool_calls: number;
      avg_duration_ms: number;
      completion_rate: number;
    }>;
    byRole: Array<{
      subagent_role: string;
      total_executions: number;
      avg_steps: number;
      avg_tool_calls: number;
      avg_duration_ms: number;
      success_rate: number;
    }>;
  } {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const bySkill = this.db.getSkillExecutionStats({ since });
    const byRole = this.db.getSubagentRoleStats({ since });

    const total = bySkill.reduce((sum, s) => sum + s.total_executions, 0);
    const success = bySkill.reduce((sum, s) => sum + s.success_count, 0);
    const failed = bySkill.reduce((sum, s) => sum + s.fail_count, 0);

    return {
      total,
      success,
      failed,
      bySkill,
      byRole,
    };
  }

  /**
   * 生成监控报告
   */
  generateReport(days: number = 7): string {
    const toolStats = this.getToolStats(days);
    const skillStats = this.getSkillStats(days);

    const lines: string[] = [];
    lines.push(`📊 StarUp 监控报告 (最近 ${days} 天)`);
    lines.push('=' .repeat(50));
    lines.push('');

    // 工具统计
    lines.push(`🔧 工具调用统计`);
    lines.push(`   总计: ${toolStats.total} 次`);
    lines.push(`   成功: ${toolStats.success} (${((toolStats.success/toolStats.total)*100).toFixed(1)}%)`);
    lines.push(`   失败: ${toolStats.failed} (${((toolStats.failed/toolStats.total)*100).toFixed(1)}%)`);
    lines.push('');

    if (toolStats.byTool.length > 0) {
      lines.push('   工具使用排行:');
      toolStats.byTool.slice(0, 5).forEach((tool, i) => {
        const failRate = tool.fail_count > 0 
          ? ` (失败 ${((tool.fail_count/tool.total_calls)*100).toFixed(1)}%)` 
          : '';
        lines.push(`   ${i+1}. ${tool.tool_name}: ${tool.total_calls} 次${failRate}`);
      });
      lines.push('');
    }

    if (toolStats.errors.length > 0) {
      lines.push('   主要错误类型:');
      toolStats.errors.slice(0, 3).forEach((err, i) => {
        lines.push(`   ${i+1}. ${err.error_type}: ${err.error_count} 次`);
      });
      lines.push('');
    }

    // Skill 统计
    lines.push(`🎯 Skill 执行统计`);
    lines.push(`   总计: ${skillStats.total} 次`);
    lines.push(`   成功: ${skillStats.success} (${((skillStats.success/skillStats.total)*100).toFixed(1)}%)`);
    lines.push(`   失败: ${skillStats.failed} (${((skillStats.failed/skillStats.total)*100).toFixed(1)}%)`);
    lines.push('');

    if (skillStats.byRole.length > 0) {
      lines.push('   Subagent 角色效率:');
      skillStats.byRole.forEach((role, i) => {
        lines.push(`   ${role.subagent_role}: ` +
          `平均 ${role.avg_steps} 步, ` +
          `成功率 ${role.success_rate}%`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  // ==================== 私有工具方法 ====================

  /**
   * 对参数进行摘要（避免存储过长）
   */
  private summarizeArgs(args: any): string {
    if (!args) return '';
    
    try {
      const keys = Object.keys(args).slice(0, 5); // 最多5个参数
      const summary = keys.map(k => {
        const val = args[k];
        if (typeof val === 'string') {
          return `${k}=${val.substring(0, 30)}${val.length > 30 ? '...' : ''}`;
        }
        return `${k}=${String(val).substring(0, 30)}`;
      }).join(', ');
      
      return summary;
    } catch {
      return '';
    }
  }

  /**
   * 对错误消息进行分类
   */
  private classifyError(errorMessage: string): ErrorType {
    const lowerMsg = errorMessage.toLowerCase();
    
    if (lowerMsg.includes('timeout') || lowerMsg.includes('etimedout')) {
      return 'TIMEOUT';
    }
    if (lowerMsg.includes('permission') || lowerMsg.includes('eacces') || lowerMsg.includes('access denied')) {
      return 'PERMISSION_DENIED';
    }
    if (lowerMsg.includes('not found') || lowerMsg.includes('enoent') || lowerMsg.includes('does not exist')) {
      return 'NOT_FOUND';
    }
    if (lowerMsg.includes('validation') || lowerMsg.includes('invalid') || lowerMsg.includes('required')) {
      return 'VALIDATION_ERROR';
    }
    if (lowerMsg.includes('network') || lowerMsg.includes('enotfound') || lowerMsg.includes('econnrefused')) {
      return 'NETWORK_ERROR';
    }
    if (lowerMsg.includes('rate limit') || lowerMsg.includes('too many requests')) {
      return 'RATE_LIMIT';
    }
    
    return 'UNKNOWN';
  }

  /**
   * 清理活跃但超时的上下文（防止内存泄漏）
   */
  cleanupStaleContexts(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    
    for (const [id, context] of this.activeToolCalls) {
      if (now - context.startTime > maxAgeMs) {
        this.activeToolCalls.delete(id);
        logger.debug('MetricService', `Cleaned up stale tool call context: ${id}`);
      }
    }

    for (const [id, context] of this.activeSkillExecutions) {
      if (now - context.startTime > maxAgeMs) {
        this.activeSkillExecutions.delete(id);
        logger.debug('MetricService', `Cleaned up stale skill context: ${id}`);
      }
    }
  }
}

// 单例导出
export const metricService = new MetricService();
