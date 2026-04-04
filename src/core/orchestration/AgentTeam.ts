/**
 * Agent Team 多实例协作系统
 * 支持多 Agent 发现、通信和任务协调
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { starupDB } from '../persistence/Database';
import { logger } from '../../utils/Logger';

export type AgentRole = 'architect' | 'coder' | 'reviewer' | 'tester' | 'doc' | 'general';

export interface TeamAgent {
  id: string;
  name: string;
  role: AgentRole;
  endpoint?: string; // 远程 Agent 的地址
  capabilities: string[];
  status: 'idle' | 'busy' | 'offline';
  currentTask?: string;
  lastSeen: number;
  metadata: Record<string, any>;
}

export interface TeamTask {
  id: string;
  type: 'analysis' | 'coding' | 'review' | 'test' | 'doc' | 'custom';
  description: string;
  context: string;
  requirements: string[];
  assignedTo?: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: number;
  updatedAt: number;
  result?: any;
  parentTask?: string; // 父任务 ID（用于任务分解）
  subTasks?: string[]; // 子任务 ID 列表
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: 'task_assignment' | 'task_result' | 'coordination' | 'heartbeat';
  payload: any;
  timestamp: number;
  requiresAck: boolean;
}

export interface AgentTeamConfig {
  teamId: string;
  teamName: string;
  discoveryEnabled: boolean;
  messageBusType: 'local' | 'websocket' | 'ipc';
  coordinationStrategy: 'hierarchical' | 'peer_to_peer' | 'consensus';
}

/**
 * Agent Team 管理器
 * 管理多 Agent 协作
 */
export class AgentTeam extends EventEmitter {
  private config: AgentTeamConfig;
  private agents: Map<string, TeamAgent> = new Map();
  private tasks: Map<string, TeamTask> = new Map();
  private messages: AgentMessage[] = [];
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 秒

  constructor(config?: Partial<AgentTeamConfig>) {
    super();
    
    this.config = {
      teamId: uuidv4(),
      teamName: 'Default Team',
      discoveryEnabled: true,
      messageBusType: 'local',
      coordinationStrategy: 'hierarchical',
      ...config,
    };
  }

  /**
   * 初始化 Agent Team
   */
  async initialize(): Promise<void> {
    // 加载保存的 Agent 列表
    await this.loadAgents();
    
    // 启动心跳
    this.startHeartbeat();
    
    logger.info('AgentTeam', `Team ${this.config.teamName} initialized`);
  }

  /**
   * 关闭 Agent Team
   */
  async shutdown(): Promise<void> {
    this.stopHeartbeat();
    
    // 保存状态
    this.saveAgents();
    
    this.removeAllListeners();
    logger.info('AgentTeam', 'Team shutdown complete');
  }

  // ==================== Agent 管理 ====================

  /**
   * 注册 Agent
   */
  registerAgent(agent: Omit<TeamAgent, 'id' | 'lastSeen'>): TeamAgent {
    const fullAgent: TeamAgent = {
      ...agent,
      id: uuidv4(),
      lastSeen: Date.now(),
    };

    this.agents.set(fullAgent.id, fullAgent);
    
    logger.info('AgentTeam', `Agent registered: ${fullAgent.name} (${fullAgent.role})`);
    this.emit('agent_registered', fullAgent);
    
    return fullAgent;
  }

  /**
   * 注销 Agent
   */
  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      logger.info('AgentTeam', `Agent unregistered: ${agent.name}`);
      this.emit('agent_unregistered', agent);
    }
  }

  /**
   * 获取 Agent
   */
  getAgent(agentId: string): TeamAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 获取所有 Agent
   */
  getAllAgents(): TeamAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 按角色获取 Agent
   */
  getAgentsByRole(role: AgentRole): TeamAgent[] {
    return this.getAllAgents().filter(a => a.role === role);
  }

  /**
   * 获取可用的 Agent
   */
  getAvailableAgents(): TeamAgent[] {
    return this.getAllAgents().filter(a => a.status === 'idle');
  }

  /**
   * 更新 Agent 状态
   */
  updateAgentStatus(agentId: string, status: TeamAgent['status'], currentTask?: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.currentTask = currentTask;
      agent.lastSeen = Date.now();
      
      this.emit('agent_status_changed', agent);
    }
  }

  // ==================== 任务管理 ====================

  /**
   * 创建任务
   */
  createTask(task: Omit<TeamTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>): TeamTask {
    const fullTask: TeamTask = {
      ...task,
      id: uuidv4(),
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(fullTask.id, fullTask);
    
    logger.info('AgentTeam', `Task created: ${fullTask.description.substring(0, 50)}...`);
    this.emit('task_created', fullTask);
    
    // 尝试自动分配
    this.tryAssignTask(fullTask);
    
    return fullTask;
  }

  /**
   * 分配任务给 Agent
   */
  assignTask(taskId: string, agentId: string): boolean {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);

    if (!task || !agent) {
      return false;
    }

    if (agent.status !== 'idle') {
      logger.warn('AgentTeam', `Agent ${agent.name} is not available`);
      return false;
    }

    task.assignedTo = agentId;
    task.status = 'assigned';
    task.updatedAt = Date.now();

    agent.status = 'busy';
    agent.currentTask = taskId;

    // 发送任务分配消息
    this.sendMessage({
      from: 'coordinator',
      to: agentId,
      type: 'task_assignment',
      payload: task,
      requiresAck: true,
    });

    logger.info('AgentTeam', `Task ${taskId} assigned to ${agent.name}`);
    this.emit('task_assigned', { task, agent });

    return true;
  }

  /**
   * 尝试自动分配任务
   */
  private tryAssignTask(task: TeamTask): void {
    if (task.assignedTo) return;

    // 根据任务类型选择最佳 Agent
    let candidates: TeamAgent[] = [];

    switch (task.type) {
      case 'analysis':
        candidates = this.getAvailableAgents().filter(a => 
          a.role === 'architect' || a.capabilities.includes('analysis')
        );
        break;
      case 'coding':
        candidates = this.getAvailableAgents().filter(a => 
          a.role === 'coder' || a.capabilities.includes('coding')
        );
        break;
      case 'review':
        candidates = this.getAvailableAgents().filter(a => 
          a.role === 'reviewer' || a.capabilities.includes('review')
        );
        break;
      case 'test':
        candidates = this.getAvailableAgents().filter(a => 
          a.role === 'tester' || a.capabilities.includes('testing')
        );
        break;
      case 'doc':
        candidates = this.getAvailableAgents().filter(a => 
          a.role === 'doc' || a.capabilities.includes('documentation')
        );
        break;
      default:
        candidates = this.getAvailableAgents();
    }

    if (candidates.length > 0) {
      // 选择最合适的（基于负载、能力匹配度等）
      const selected = candidates[0];
      this.assignTask(task.id, selected.id);
    }
  }

  /**
   * 报告任务完成
   */
  completeTask(taskId: string, result: any): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'completed';
    task.result = result;
    task.updatedAt = Date.now();

    // 释放 Agent
    if (task.assignedTo) {
      this.updateAgentStatus(task.assignedTo, 'idle');
    }

    logger.info('AgentTeam', `Task ${taskId} completed`);
    this.emit('task_completed', task);

    // 检查父任务
    if (task.parentTask) {
      this.checkParentTask(task.parentTask);
    }
  }

  /**
   * 报告任务失败
   */
  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'failed';
    task.result = { error };
    task.updatedAt = Date.now();

    // 释放 Agent
    if (task.assignedTo) {
      this.updateAgentStatus(task.assignedTo, 'idle');
    }

    logger.warn('AgentTeam', `Task ${taskId} failed: ${error}`);
    this.emit('task_failed', task);
  }

  /**
   * 分解任务为子任务
   */
  decomposeTask(taskId: string, subTasks: Omit<TeamTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>[]): TeamTask[] {
    const parentTask = this.tasks.get(taskId);
    if (!parentTask) return [];

    const createdSubTasks: TeamTask[] = [];

    for (const subTask of subTasks) {
      const fullSubTask = this.createTask({
        ...subTask,
        parentTask: taskId,
      });
      createdSubTasks.push(fullSubTask);
    }

    parentTask.subTasks = createdSubTasks.map(t => t.id);
    parentTask.status = 'in_progress';

    logger.info('AgentTeam', `Task ${taskId} decomposed into ${createdSubTasks.length} subtasks`);
    
    return createdSubTasks;
  }

  /**
   * 检查父任务是否完成
   */
  private checkParentTask(parentTaskId: string): void {
    const parentTask = this.tasks.get(parentTaskId);
    if (!parentTask || !parentTask.subTasks) return;

    const subTasks = parentTask.subTasks.map(id => this.tasks.get(id)).filter(Boolean) as TeamTask[];
    
    const allCompleted = subTasks.every(t => t.status === 'completed');
    const anyFailed = subTasks.some(t => t.status === 'failed');

    if (allCompleted) {
      // 合并子任务结果
      const combinedResult = subTasks.map(t => t.result);
      this.completeTask(parentTaskId, combinedResult);
    } else if (anyFailed) {
      this.failTask(parentTaskId, 'Some subtasks failed');
    }
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): TeamTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): TeamTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取待处理任务
   */
  getPendingTasks(): TeamTask[] {
    return this.getAllTasks().filter(t => t.status === 'pending');
  }

  // ==================== 消息系统 ====================

  /**
   * 发送消息
   */
  sendMessage(message: Omit<AgentMessage, 'id' | 'timestamp'>): AgentMessage {
    const fullMessage: AgentMessage = {
      ...message,
      id: uuidv4(),
      timestamp: Date.now(),
    };

    this.messages.push(fullMessage);
    
    // 清理旧消息（保留最近 1000 条）
    if (this.messages.length > 1000) {
      this.messages = this.messages.slice(-1000);
    }

    this.emit('message', fullMessage);
    
    // 如果是发给特定 Agent 的，触发定向事件
    if (message.to !== 'broadcast') {
      this.emit(`message:${message.to}`, fullMessage);
    }

    return fullMessage;
  }

  /**
   * 广播消息
   */
  broadcast(from: string, type: AgentMessage['type'], payload: any): void {
    this.sendMessage({
      from,
      to: 'broadcast',
      type,
      payload,
      requiresAck: false,
    });
  }

  /**
   * 获取 Agent 的消息
   */
  getMessagesForAgent(agentId: string, since?: number): AgentMessage[] {
    return this.messages.filter(m => 
      (m.to === agentId || m.to === 'broadcast') &&
      (!since || m.timestamp > since)
    );
  }

  // ==================== 协调策略 ====================

  /**
   * 执行协调
   */
  async coordinate(): Promise<void> {
    switch (this.config.coordinationStrategy) {
      case 'hierarchical':
        await this.hierarchicalCoordination();
        break;
      case 'peer_to_peer':
        await this.peerToPeerCoordination();
        break;
      case 'consensus':
        await this.consensusCoordination();
        break;
    }
  }

  /**
   * 层级协调
   */
  private async hierarchicalCoordination(): Promise<void> {
    // 简单的层级协调：主协调器分配所有任务
    const pendingTasks = this.getPendingTasks();
    
    for (const task of pendingTasks) {
      this.tryAssignTask(task);
    }
  }

  /**
   * 点对点协调
   */
  private async peerToPeerCoordination(): Promise<void> {
    // Agent 之间自行协商任务分配
    // 简化版本：广播待处理任务
    const pendingTasks = this.getPendingTasks();
    
    if (pendingTasks.length > 0) {
      this.broadcast('coordinator', 'coordination', {
        type: 'tasks_available',
        tasks: pendingTasks,
      });
    }
  }

  /**
   * 共识协调
   */
  private async consensusCoordination(): Promise<void> {
    // 需要多个 Agent 同意才能执行任务
    // 简化版本：至少需要 2 个 Agent 确认
    // TODO: 实现完整的共识机制
  }

  // ==================== 持久化 ====================

  /**
   * 加载 Agent 列表
   */
  private async loadAgents(): Promise<void> {
    const state = starupDB.getSystemState(`agent_team_${this.config.teamId}_agents`);
    if (state) {
      try {
        const agents = JSON.parse(state);
        for (const agent of agents) {
          this.agents.set(agent.id, agent);
        }
      } catch {
        // 解析失败，忽略
      }
    }
  }

  /**
   * 保存 Agent 列表
   */
  private saveAgents(): void {
    const agents = this.getAllAgents();
    starupDB.setSystemState(
      `agent_team_${this.config.teamId}_agents`,
      JSON.stringify(agents)
    );
  }

  // ==================== 心跳 ====================

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      this.broadcast('coordinator', 'heartbeat', {
        teamId: this.config.teamId,
        timestamp: Date.now(),
      });

      // 检查 Agent 存活状态
      const now = Date.now();
      for (const [id, agent] of this.agents) {
        if (now - agent.lastSeen > this.HEARTBEAT_INTERVAL * 3) {
          logger.warn('AgentTeam', `Agent ${agent.name} appears offline`);
          agent.status = 'offline';
          this.emit('agent_offline', agent);
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ==================== 统计信息 ====================

  /**
   * 获取统计信息
   */
  getStats(): {
    totalAgents: number;
    availableAgents: number;
    totalTasks: number;
    pendingTasks: number;
    completedTasks: number;
    failedTasks: number;
  } {
    const allTasks = this.getAllTasks();
    
    return {
      totalAgents: this.agents.size,
      availableAgents: this.getAvailableAgents().length,
      totalTasks: allTasks.length,
      pendingTasks: allTasks.filter(t => t.status === 'pending').length,
      completedTasks: allTasks.filter(t => t.status === 'completed').length,
      failedTasks: allTasks.filter(t => t.status === 'failed').length,
    };
  }

  /**
   * 获取配置
   */
  getConfig(): AgentTeamConfig {
    return { ...this.config };
  }
}

// 单例导出
export const agentTeam = new AgentTeam();
