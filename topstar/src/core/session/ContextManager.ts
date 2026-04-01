/**
 * 上下文管理器
 * 实现跨会话意图继承(context_carry)功能
 */

import { Session } from '../../types';

/**
 * 跨会话继承状态
 */
export interface ContextCarryState {
  intent: string;
  slots: Record<string, any>;
  context_carry: boolean;
  ttl: number;           // 过期时间(秒)
  createdAt: number;
}

/**
 * 上下文管理器
 * 管理跨会话的状态继承，支持意图、槽位等状态的传递
 */
export class ContextManager {
  private carryStates: Map<string, ContextCarryState> = new Map();

  /**
   * 设置跨会话继承状态
   * @param sessionId 会话ID
   * @param state 继承状态
   */
  setCarryState(sessionId: string, state: ContextCarryState): void {
    // 更新创建时间
    state.createdAt = Date.now();
    this.carryStates.set(sessionId, state);
    console.log(`[ContextManager] Carry state set for session ${sessionId}, intent: ${state.intent}`);
  }

  /**
   * 获取继承状态
   * @param sessionId 会话ID
   * @returns 继承状态或 null（如果已过期）
   */
  getCarryState(sessionId: string): ContextCarryState | null {
    const state = this.carryStates.get(sessionId);
    
    if (!state) {
      return null;
    }

    // 检查是否过期
    if (this.isExpired(state)) {
      this.carryStates.delete(sessionId);
      console.log(`[ContextManager] Carry state expired for session ${sessionId}`);
      return null;
    }

    return state;
  }

  /**
   * 检查状态是否过期
   * @param state 继承状态
   * @returns 是否过期
   */
  isExpired(state: ContextCarryState): boolean {
    const now = Date.now();
    const age = (now - state.createdAt) / 1000; // 转换为秒
    return age > state.ttl;
  }

  /**
   * 清理所有过期状态
   * @returns 清理的状态数量
   */
  cleanExpiredStates(): number {
    let cleanedCount = 0;
    
    for (const [sessionId, state] of this.carryStates.entries()) {
      if (this.isExpired(state)) {
        this.carryStates.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[ContextManager] Cleaned ${cleanedCount} expired carry states`);
    }
    
    return cleanedCount;
  }

  /**
   * 合并继承状态到新会话
   * @param sessionId 源会话ID（继承自）
   * @param targetSession 目标会话
   * @returns 是否成功合并
   */
  mergeCarryState(sessionId: string, targetSession: Session): boolean {
    const state = this.getCarryState(sessionId);
    
    if (!state) {
      console.log(`[ContextManager] No carry state found for session ${sessionId}`);
      return false;
    }

    if (!state.context_carry) {
      console.log(`[ContextManager] Context carry is disabled for session ${sessionId}`);
      return false;
    }

    // 将继承的状态合并到目标会话
    // 通过添加系统消息的方式传递上下文
    const carryMessage = this.buildCarryMessage(state);
    
    targetSession.context.messages.unshift({
      role: 'system',
      content: carryMessage,
      timestamp: Date.now(),
    });

    // 更新会话元数据（如果有的话）
    // 这里可以扩展 Session 类型以支持元数据存储

    console.log(`[ContextManager] Merged carry state from ${sessionId} to session ${targetSession.id}`);
    console.log(`  - Intent: ${state.intent}`);
    console.log(`  - Slots: ${Object.keys(state.slots).join(', ')}`);
    
    return true;
  }

  /**
   * 创建从快照恢复的状态
   * @param sessionId 会话ID
   * @param intent 意图
   * @param slots 槽位
   * @param ttl 过期时间（秒）
   * @returns 创建的继承状态
   */
  createCarryStateFromSnapshot(
    sessionId: string,
    intent: string,
    slots: Record<string, any>,
    ttl: number = 86400
  ): ContextCarryState {
    const state: ContextCarryState = {
      intent,
      slots,
      context_carry: true,
      ttl,
      createdAt: Date.now(),
    };

    this.setCarryState(sessionId, state);
    return state;
  }

  /**
   * 禁用指定会话的上下文继承
   * @param sessionId 会话ID
   */
  disableCarry(sessionId: string): void {
    const state = this.carryStates.get(sessionId);
    if (state) {
      state.context_carry = false;
      console.log(`[ContextManager] Context carry disabled for session ${sessionId}`);
    }
  }

  /**
   * 启用指定会话的上下文继承
   * @param sessionId 会话ID
   */
  enableCarry(sessionId: string): void {
    const state = this.carryStates.get(sessionId);
    if (state) {
      state.context_carry = true;
      console.log(`[ContextManager] Context carry enabled for session ${sessionId}`);
    }
  }

  /**
   * 获取所有活跃的继承状态
   * @returns 活跃状态的列表
   */
  getAllActiveStates(): Array<{ sessionId: string; state: ContextCarryState }> {
    this.cleanExpiredStates(); // 先清理过期状态
    
    const activeStates: Array<{ sessionId: string; state: ContextCarryState }> = [];
    
    for (const [sessionId, state] of this.carryStates.entries()) {
      activeStates.push({ sessionId, state });
    }

    return activeStates;
  }

  /**
   * 删除指定会话的继承状态
   * @param sessionId 会话ID
   * @returns 是否成功删除
   */
  deleteCarryState(sessionId: string): boolean {
    const existed = this.carryStates.has(sessionId);
    if (existed) {
      this.carryStates.delete(sessionId);
      console.log(`[ContextManager] Carry state deleted for session ${sessionId}`);
    }
    return existed;
  }

  /**
   * 获取继承状态的数量
   * @returns 当前存储的状态数量
   */
  getStateCount(): number {
    return this.carryStates.size;
  }

  /**
   * 清空所有继承状态
   */
  clearAllStates(): void {
    const count = this.carryStates.size;
    this.carryStates.clear();
    console.log(`[ContextManager] Cleared all ${count} carry states`);
  }

  /**
   * 延长状态的过期时间
   * @param sessionId 会话ID
   * @param additionalTtl 额外的时间（秒）
   * @returns 是否成功
   */
  extendTtl(sessionId: string, additionalTtl: number): boolean {
    const state = this.carryStates.get(sessionId);
    if (!state) {
      return false;
    }

    state.ttl += additionalTtl;
    console.log(`[ContextManager] Extended TTL for session ${sessionId} to ${state.ttl}s`);
    return true;
  }

  // ==================== 私有方法 ====================

  /**
   * 构建携带消息
   * 将继承状态格式化为系统消息
   */
  private buildCarryMessage(state: ContextCarryState): string {
    const parts: string[] = [
      '[上下文继承] 从前一个会话继承了以下状态：',
      `当前意图: ${state.intent}`,
    ];

    if (Object.keys(state.slots).length > 0) {
      parts.push('槽位信息:');
      for (const [key, value] of Object.entries(state.slots)) {
        parts.push(`  - ${key}: ${value}`);
      }
    }

    parts.push(`状态创建时间: ${new Date(state.createdAt).toISOString()}`);
    parts.push(`过期时间: ${state.ttl}秒`);

    return parts.join('\n');
  }
}

// 单例导出
export const contextManager = new ContextManager();
