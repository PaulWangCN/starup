/**
 * Subagent 编排系统
 * 
 * 核心功能：
 * 1. 真正的Subagent并行执行
 * 2. Coordinator模式任务编排
 * 3. 任务分解和结果合并
 * 
 * 参考：Claude Code泄漏代码中的Coordinator Mode
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/Logger';
import { Session, ToolDefinition, ToolResult, LLMConfig, ConversationMessage } from '../../types';
import { LLMService } from '../llm/LLMService';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ParallelToolExecutor, ToolExecutionGraph, ParallelToolCall } from '../tools/ParallelToolExecutor';

/** Subagent角色类型 */
export type SubagentRole = 
  | 'coordinator'  // 协调者 - 负责任务分配和结果合并
  | 'planner'      // 规划师
  | 'researcher'   // 研究员
  | 'architect'    // 架构师
  | 'coder'        // 程序员
  | 'reviewer'     // 审查员
  | 'tester'       // 测试员
  | 'debugger'     // 调试员
  | 'writer'       // 文档员
  | 'validator';   // 验证员

/** Subagent状态 */
export type SubagentStatus = 'idle' | 'running' | 'completed' | 'error' | 'terminated';

/** Subagent配置 */
export interface SubagentConfig {
  id: string;
  role: SubagentRole;
  name: string;
  description?: string;
  tools: string[];
  memory: boolean;
  timeout: number;
  model?: string;
  temperature?: number;
  permissions: PermissionLevel;
  maxIterations: number;
  inheritContext: boolean;
}

/** 权限级别 */
export type PermissionLevel = 'read' | 'write' | 'execute' | 'full';

/** Subagent实例 */
export interface Subagent {
  config: SubagentConfig;
  status: SubagentStatus;
  context: ConversationMessage[];
  currentTask?: Task;
  results: TaskResult[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  parentOrchestratorId: string;
}

/** 任务定义 */
export interface Task {
  id: string;
  description: string;
  type: 'analysis' | 'coding' | 'review' | 'test' | 'research' | 'write' | 'debug';
  priority: number;
  deadline?: number;
  dependencies: string[];
  requiredRole: SubagentRole;
  input?: any;
  expectedOutput?: string;
}

/** 任务分配 */
export interface TaskAssignment {
  task: Task;
  subagentId: string;
  startTime?: number;
  endTime?: number;
}

/** 任务结果 */
export interface TaskResult {
  taskId: string;
  subagentId: string;
  success: boolean;
  output: any;
  error?: string;
  duration: number;
  toolCalls?: ToolCallRecord[];
}

/** 工具调用记录 */
export interface ToolCallRecord {
  tool: string;
  params: any;
  result: ToolResult;
  timestamp: number;
  duration: number;
}

/** 协调任务 */
export interface CoordinationMission {
  id: string;
  description: string;
  originalRequest: string;
  status: 'planning' | 'executing' | 'merging' | 'completed' | 'failed';
  tasks: Task[];
  assignments: TaskAssignment[];
  subagents: Map<string, Subagent>;
  results: Map<string, TaskResult>;
  coordinatorId: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Subagent编排器
 */
export class SubagentOrchestrator extends EventEmitter {
  private llmService: LLMService;
  private toolRegistry: ToolRegistry;
  private parallelExecutor: ParallelToolExecutor;
  private missions: Map<string, CoordinationMission> = new Map();
  private subagents: Map<string, Subagent> = new Map();
  
  private readonly DEFAULT_TIMEOUT = 10 * 60 * 1000; // 10分钟
  private readonly MAX_PARALLEL_SUBAGENTS = 5;

  constructor(llmService: LLMService, toolRegistry: ToolRegistry) {
    super();
    this.llmService = llmService;
    this.toolRegistry = toolRegistry;
    this.parallelExecutor = new ParallelToolExecutor(toolRegistry.getAll());
  }

  // ==================== 核心API ====================

  /**
   * 创建协调任务
   */
  async coordinate(
    description: string,
    options: {
      autoPlan?: boolean;
      maxSubagents?: number;
      timeout?: number;
    } = {}
  ): Promise<CoordinationMission> {
    const missionId = `mission-${uuidv4().slice(0, 8)}`;
    
    logger.info('SubagentOrchestrator', `Creating coordination mission: ${missionId}`);

    // 创建协调者（Coordinator）
    const coordinator = this.spawnSubagent({
      role: 'coordinator',
      name: 'Coordinator',
      description: 'Main coordinator for this mission',
      tools: ['read', 'write', 'edit', 'spawn_agent', 'delegate_task', 'merge_results'],
      memory: true,
      timeout: options.timeout || this.DEFAULT_TIMEOUT,
      permissions: 'full',
      maxIterations: 10,
      inheritContext: true
    }, missionId);

    const mission: CoordinationMission = {
      id: missionId,
      description,
      originalRequest: description,
      status: 'planning',
      tasks: [],
      assignments: [],
      subagents: new Map([[coordinator.config.id, coordinator]]),
      results: new Map(),
      coordinatorId: coordinator.config.id,
      createdAt: Date.now()
    };

    this.missions.set(missionId, mission);
    this.emit('mission_created', mission);

    // 自动规划任务
    if (options.autoPlan !== false) {
      await this.planMission(mission);
    }

    return mission;
  }

  /**
   * 执行协调任务
   */
  async executeMission(missionId: string): Promise<CoordinationMission> {
    const mission = this.missions.get(missionId);
    if (!mission) {
      throw new Error(`Mission ${missionId} not found`);
    }

    logger.info('SubagentOrchestrator', `Executing mission: ${missionId}`);

    mission.status = 'executing';
    mission.startedAt = Date.now();
    this.emit('mission_started', mission);

    try {
      // 1. 为任务创建Subagent
      await this.spawnAgentsForTasks(mission);

      // 2. 执行所有任务
      await this.executeTasks(mission);

      // 3. 合并结果
      await this.mergeMissionResults(mission);

      mission.status = 'completed';
      mission.completedAt = Date.now();
      
      this.emit('mission_completed', mission);
      logger.info('SubagentOrchestrator', `Mission ${missionId} completed`);

    } catch (error) {
      mission.status = 'failed';
      this.emit('mission_failed', { mission, error });
      logger.error('SubagentOrchestrator', `Mission ${missionId} failed: ${error}`);
    }

    return mission;
  }

  /**
   * 创建Subagent
   */
  spawnSubagent(
    config: Omit<SubagentConfig, 'id'>,
    parentOrchestratorId: string
  ): Subagent {
    const id = `subagent-${uuidv4().slice(0, 8)}`;
    
    const fullConfig: SubagentConfig = {
      ...config,
      id,
      timeout: config.timeout || this.DEFAULT_TIMEOUT,
      maxIterations: config.maxIterations || 10,
      inheritContext: config.inheritContext ?? true
    };

    const subagent: Subagent = {
      config: fullConfig,
      status: 'idle',
      context: this.buildAgentContext(config.role),
      results: [],
      createdAt: Date.now(),
      parentOrchestratorId
    };

    this.subagents.set(id, subagent);
    this.emit('subagent_spawned', subagent);
    
    logger.debug('SubagentOrchestrator', `Spawned subagent ${id} (${config.role})`);
    
    return subagent;
  }

  /**
   * 委派任务给Subagent
   */
  async delegateTask(subagentId: string, task: Task): Promise<TaskResult> {
    const subagent = this.subagents.get(subagentId);
    if (!subagent) {
      throw new Error(`Subagent ${subagentId} not found`);
    }

    if (subagent.status === 'terminated') {
      throw new Error(`Subagent ${subagentId} has been terminated`);
    }

    logger.info('SubagentOrchestrator', `Delegating task ${task.id} to subagent ${subagentId}`);

    const startTime = Date.now();
    subagent.status = 'running';
    subagent.currentTask = task;
    subagent.startedAt = startTime;

    this.emit('task_started', { subagent, task });

    try {
      // 构建执行上下文
      const context = this.buildTaskContext(subagent, task);
      
      // 执行ReAct循环
      const result = await this.executeReActLoop(subagent, task, context);
      
      const endTime = Date.now();
      const taskResult: TaskResult = {
        taskId: task.id,
        subagentId,
        success: result.success,
        output: result.output,
        error: result.error,
        duration: endTime - startTime,
        toolCalls: result.toolCalls
      };

      subagent.results.push(taskResult);
      subagent.status = 'completed';
      subagent.completedAt = endTime;
      subagent.currentTask = undefined;

      this.emit('task_completed', { subagent, task, result: taskResult });
      
      return taskResult;

    } catch (error) {
      const endTime = Date.now();
      const taskResult: TaskResult = {
        taskId: task.id,
        subagentId,
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        duration: endTime - startTime
      };

      subagent.status = 'error';
      subagent.currentTask = undefined;

      this.emit('task_failed', { subagent, task, result: taskResult });
      
      return taskResult;
    }
  }

  /**
   * 并行执行多个任务
   */
  async parallelExecute(assignments: TaskAssignment[]): Promise<Map<string, TaskResult>> {
    const results = new Map<string, TaskResult>();
    
    logger.info('SubagentOrchestrator', `Parallel executing ${assignments.length} tasks`);

    // 按批次执行（考虑依赖关系）
    const batches = this.groupByDependencies(assignments);
    
    for (const batch of batches) {
      const batchPromises = batch.map(async (assignment) => {
        const result = await this.delegateTask(assignment.subagentId, assignment.task);
        results.set(assignment.task.id, result);
        return result;
      });

      await Promise.all(batchPromises);
    }

    return results;
  }

  /**
   * 终止Subagent
   */
  terminateSubagent(subagentId: string): void {
    const subagent = this.subagents.get(subagentId);
    if (!subagent) return;

    subagent.status = 'terminated';
    this.emit('subagent_terminated', subagent);
    
    logger.info('SubagentOrchestrator', `Terminated subagent ${subagentId}`);
  }

  /**
   * 获取任务状态
   */
  getMissionStatus(missionId: string): CoordinationMission | undefined {
    return this.missions.get(missionId);
  }

  /**
   * 获取所有活跃的Missions
   */
  getActiveMissions(): CoordinationMission[] {
    return Array.from(this.missions.values()).filter(
      m => m.status === 'planning' || m.status === 'executing' || m.status === 'merging'
    );
  }

  // ==================== 私有方法 ====================

  /**
   * 规划任务
   */
  private async planMission(mission: CoordinationMission): Promise<void> {
    logger.info('SubagentOrchestrator', `Planning mission ${mission.id}`);

    const coordinator = mission.subagents.get(mission.coordinatorId)!;
    
    const prompt = `作为任务协调专家，请将以下复杂任务分解为可执行的子任务：

主任务：${mission.description}

要求：
1. 分析任务复杂度，确定需要哪些角色参与
2. 将任务分解为5-10个可并行/串行执行的子任务
3. 明确每个子任务的依赖关系
4. 为每个子任务分配合适的角色

可用角色：
- planner: 任务规划
- researcher: 信息收集
- architect: 架构设计
- coder: 代码编写
- reviewer: 代码审查
- tester: 测试验证
- debugger: 调试修复
- writer: 文档编写
- validator: 最终验证

请以JSON格式返回：
{
  "tasks": [
    {
      "id": "task-1",
      "description": "具体任务描述",
      "type": "coding",
      "priority": 1,
      "dependencies": [],
      "requiredRole": "coder"
    }
  ]
}`;

    try {
      const response = await this.llmService.chat([
        { role: 'system', content: this.buildCoordinatorSystemPrompt(), timestamp: Date.now() },
        { role: 'user', content: prompt, timestamp: Date.now() }
      ]);

      const plan = this.parsePlanResponse(response.content);
      mission.tasks = plan.tasks;
      
      logger.info('SubagentOrchestrator', `Mission ${mission.id} planned with ${plan.tasks.length} tasks`);
      this.emit('mission_planned', mission);

    } catch (error) {
      logger.error('SubagentOrchestrator', `Planning failed: ${error}`);
      // 降级：创建单任务
      mission.tasks = [{
        id: `task-${uuidv4().slice(0, 8)}`,
        description: mission.description,
        type: 'coding',
        priority: 1,
        dependencies: [],
        requiredRole: 'coder'
      }];
    }
  }

  /**
   * 为任务创建Subagent
   */
  private async spawnAgentsForTasks(mission: CoordinationMission): Promise<void> {
    const neededRoles = new Set(mission.tasks.map(t => t.requiredRole));
    
    for (const role of neededRoles) {
      if (role === 'coordinator') continue; // 已存在

      const subagent = this.spawnSubagent({
        role,
        name: `${this.getRoleDisplayName(role)}-${mission.id.slice(-4)}`,
        tools: this.getToolsForRole(role),
        memory: true,
        timeout: this.DEFAULT_TIMEOUT,
        permissions: this.getPermissionsForRole(role),
        maxIterations: 10,
        inheritContext: false
      }, mission.id);

      mission.subagents.set(subagent.config.id, subagent);
    }

    logger.info('SubagentOrchestrator', `Spawned ${mission.subagents.size} subagents for mission ${mission.id}`);
  }

  /**
   * 执行任务
   */
  private async executeTasks(mission: CoordinationMission): Promise<void> {
    // 按依赖分组
    const batches = this.groupTasksByDependencies(mission.tasks);

    for (const batch of batches) {
      // 为每个任务找到合适的subagent
      const assignments: TaskAssignment[] = [];
      
      for (const task of batch) {
        const subagent = this.findBestSubagentForTask(mission, task);
        if (subagent) {
          assignments.push({ task, subagentId: subagent.config.id });
        }
      }

      // 并行执行
      const results = await this.parallelExecute(assignments);
      
      // 保存结果
      for (const [taskId, result] of results) {
        mission.results.set(taskId, result);
      }
    }
  }

  /**
   * 合并任务结果
   */
  private async mergeMissionResults(mission: CoordinationMission): Promise<void> {
    mission.status = 'merging';
    
    const coordinator = mission.subagents.get(mission.coordinatorId)!;
    const completedResults = Array.from(mission.results.values()).filter(r => r.success);

    if (completedResults.length === 0) {
      throw new Error('No tasks completed successfully');
    }

    const prompt = `请将以下子任务的结果合并为完整的输出：

主任务：${mission.description}

子任务结果：
${completedResults.map((r, i) => `
--- 子任务 ${i + 1} ---
角色：${mission.subagents.get(r.subagentId)?.config.role}
结果：${JSON.stringify(r.output, null, 2)}
`).join('\n')}

请：
1. 整合所有结果
2. 消除重复内容
3. 保持逻辑连贯
4. 输出最终成果`;

    try {
      const response = await this.llmService.chat([
        { role: 'system', content: this.buildCoordinatorSystemPrompt(), timestamp: Date.now() },
        { role: 'user', content: prompt, timestamp: Date.now() }
      ]);

      mission.results.set('final', {
        taskId: 'final',
        subagentId: mission.coordinatorId,
        success: true,
        output: response.content,
        duration: 0
      });

    } catch (error) {
      logger.error('SubagentOrchestrator', `Result merging failed: ${error}`);
    }
  }

  /**
   * ReAct执行循环
   */
  private async executeReActLoop(
    subagent: Subagent,
    task: Task,
    context: string
  ): Promise<{ success: boolean; output: any; error?: string; toolCalls?: ToolCallRecord[] }> {
    const toolCalls: ToolCallRecord[] = [];
    let iterations = 0;

    const messages: ConversationMessage[] = [
      ...subagent.context,
      { role: 'user', content: `## 任务\n${task.description}\n\n## 上下文\n${context}`, timestamp: Date.now() }
    ];

    while (iterations < subagent.config.maxIterations) {
      iterations++;

      // 调用LLM
      const response = await this.llmService.chat(messages, this.getAvailableTools(subagent));

      // 检查是否有工具调用
      if (response.tool_calls && response.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.tool_calls,
          timestamp: Date.now()
        });

        // 执行工具调用
        for (const toolCall of response.tool_calls) {
          const toolStart = Date.now();
          const result = await this.toolRegistry.execute(
            toolCall.function.name,
            JSON.parse(toolCall.function.arguments),
            null as any // Session
          );
          
          toolCalls.push({
            tool: toolCall.function.name,
            params: JSON.parse(toolCall.function.arguments),
            result,
            timestamp: toolStart,
            duration: Date.now() - toolStart
          });

          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
            timestamp: Date.now()
          });
        }
      } else {
        // 任务完成
        return {
          success: true,
          output: response.content,
          toolCalls
        };
      }
    }

    // 达到最大迭代次数
    return {
      success: false,
      output: null,
      error: `Exceeded maximum iterations (${subagent.config.maxIterations})`,
      toolCalls
    };
  }

  // ==================== 工具方法 ====================

  private groupByDependencies(assignments: TaskAssignment[]): TaskAssignment[][] {
    // 简化实现：直接返回单批次
    return [assignments];
  }

  private groupTasksByDependencies(tasks: Task[]): Task[][] {
    const completed = new Set<string>();
    const batches: Task[][] = [];
    const remaining = new Set(tasks);

    while (remaining.size > 0) {
      const batch: Task[] = [];

      for (const task of remaining) {
        const depsSatisfied = task.dependencies.every(depId => completed.has(depId));
        if (depsSatisfied) {
          batch.push(task);
        }
      }

      if (batch.length === 0) {
        batch.push(...remaining);
        remaining.clear();
      } else {
        for (const task of batch) {
          remaining.delete(task);
          completed.add(task.id);
        }
      }

      batches.push(batch);
    }

    return batches;
  }

  private findBestSubagentForTask(mission: CoordinationMission, task: Task): Subagent | undefined {
    const candidates = Array.from(mission.subagents.values()).filter(
      s => s.config.role === task.requiredRole && s.status === 'idle'
    );
    return candidates[0];
  }

  private parsePlanResponse(content: string): { tasks: Task[] } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        if (data.tasks && Array.isArray(data.tasks)) {
          return {
            tasks: data.tasks.map((t: any) => ({
              id: t.id || `task-${uuidv4().slice(0, 8)}`,
              description: t.description,
              type: t.type || 'coding',
              priority: t.priority || 1,
              dependencies: t.dependencies || [],
              requiredRole: t.requiredRole || 'coder'
            }))
          };
        }
      }
    } catch (e) {
      logger.warn('SubagentOrchestrator', `Failed to parse plan: ${e}`);
    }
    return { tasks: [] };
  }

  private getToolsForRole(role: SubagentRole): string[] {
    const toolMap: Record<SubagentRole, string[]> = {
      coordinator: ['read', 'write', 'edit', 'spawn_agent', 'delegate_task', 'merge_results'],
      planner: ['read', 'fetch', 'web_fetch'],
      researcher: ['read', 'fetch', 'web_fetch', 'grep'],
      architect: ['read', 'write', 'edit', 'listSkills'],
      coder: ['read', 'write', 'edit', 'exec', 'grep'],
      reviewer: ['read', 'grep', 'write'],
      tester: ['read', 'write', 'edit', 'exec'],
      debugger: ['read', 'edit', 'exec', 'grep'],
      writer: ['read', 'write', 'edit'],
      validator: ['read', 'exec', 'grep']
    };
    return toolMap[role] || ['read'];
  }

  private getPermissionsForRole(role: SubagentRole): PermissionLevel {
    const permissionMap: Record<SubagentRole, PermissionLevel> = {
      coordinator: 'full',
      planner: 'read',
      researcher: 'read',
      architect: 'write',
      coder: 'execute',
      reviewer: 'read',
      tester: 'execute',
      debugger: 'execute',
      writer: 'write',
      validator: 'read'
    };
    return permissionMap[role] || 'read';
  }

  private getRoleDisplayName(role: SubagentRole): string {
    const names: Record<SubagentRole, string> = {
      coordinator: 'Coordinator',
      planner: 'Planner',
      researcher: 'Researcher',
      architect: 'Architect',
      coder: 'Coder',
      reviewer: 'Reviewer',
      tester: 'Tester',
      debugger: 'Debugger',
      writer: 'Writer',
      validator: 'Validator'
    };
    return names[role];
  }

  private buildAgentContext(role: SubagentRole): ConversationMessage[] {
    const rolePrompts: Record<SubagentRole, string> = {
      coordinator: 'You are a coordination expert. You manage subagents and merge their results.',
      planner: 'You are a planning expert. You break down complex tasks into manageable subtasks.',
      researcher: 'You are a research expert. You gather information and investigate solutions.',
      architect: 'You are an architecture expert. You design systems and make technology choices.',
      coder: 'You are a senior programmer. You write high-quality, maintainable code.',
      reviewer: 'You are a code review expert. You identify issues and suggest improvements.',
      tester: 'You are a testing expert. You write test cases and find edge cases.',
      debugger: 'You are a debugging expert. You locate and fix bugs.',
      writer: 'You are a technical writing expert. You write documentation and comments.',
      validator: 'You are a validation expert. You ensure quality and completeness.'
    };

    return [{
      role: 'system',
      content: rolePrompts[role],
      timestamp: Date.now()
    }];
  }

  private buildCoordinatorSystemPrompt(): string {
    return `You are a coordination expert managing a team of AI subagents.
Your responsibilities:
1. Analyze complex tasks and break them down
2. Delegate tasks to appropriate subagents
3. Monitor progress and handle dependencies
4. Merge results from multiple subagents
5. Ensure quality and completeness`;
  }

  private buildTaskContext(subagent: Subagent, task: Task): string {
    return `Task: ${task.description}
Type: ${task.type}
Priority: ${task.priority}
Expected Output: ${task.expectedOutput || 'Complete the task successfully'}`;
  }

  private getAvailableTools(subagent: Subagent): any[] {
    const allTools = this.toolRegistry.getAll();
    return allTools
      .filter(t => subagent.config.tools.includes(t.name))
      .map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: t.parameters.reduce((acc, p) => {
              acc[p.name] = { type: p.type, description: p.description };
              return acc;
            }, {} as any),
            required: t.parameters.filter(p => p.required).map(p => p.name)
          }
        }
      }));
  }
}

export default SubagentOrchestrator;
