/**
 * 动态 Agent Team 编排器
 * 
 * 核心功能：
 * 1. 任务复杂度分析 - 判断是否需要组建 Agent Team
 * 2. 动态 Agent 生成 - 根据任务需求即时创建 specialized agents
 * 3. 协作编排 - 多 Agent 并行/串行协作完成任务
 * 4. 自动销毁 - 任务完成后自动清理资源
 * 
 * 与子 Agent 的区别：
 * - 子 Agent：简单的会话分身，单一任务
 * - Agent Team：多角色协作，动态生命周期，任务分解与合并
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { LLMService } from '../llm/LLMService';
import { ToolRegistry } from '../tools/ToolRegistry';
import { SessionManager } from '../session/SessionManager';
import { logger } from '../../utils/Logger';
import { 
  ConversationMessage, 
  LLMConfig,
  ToolDefinition
} from '../../types';

/** Agent 角色定义 */
export type DynamicAgentRole = 
  | 'planner'      // 任务规划师 - 分解任务
  | 'researcher'   // 研究员 - 收集信息
  | 'architect'    // 架构师 - 设计方案
  | 'coder'        // 程序员 - 编写代码
  | 'reviewer'     // 审查员 - 代码审查
  | 'tester'       // 测试员 - 测试验证
  | 'debugger'     // 调试员 - 修复问题
  | 'writer'       // 文档员 - 编写文档
  | 'validator';   // 验证员 - 最终检查

/** Agent 能力集 */
interface AgentCapabilities {
  canPlan: boolean;
  canCode: boolean;
  canReview: boolean;
  canTest: boolean;
  canWrite: boolean;
  tools: string[];
}

/** 动态 Agent 实例 */
interface DynamicAgent {
  id: string;
  role: DynamicAgentRole;
  name: string;
  capabilities: AgentCapabilities;
  llmConfig: LLMConfig;
  context: ConversationMessage[];
  status: 'idle' | 'working' | 'completed' | 'error';
  currentTask?: string;
  createdAt: number;
  lastActiveAt: number;
  result?: any;
  parentOrchestratorId: string;
}

/** 子任务定义 */
interface SubTask {
  id: string;
  description: string;
  role: DynamicAgentRole;
  dependencies: string[]; // 依赖的其他子任务ID
  status: 'pending' | 'ready' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  assignedAgentId?: string;
  result?: any;
  startTime?: number;
  endTime?: number;
}

/** 复杂度评估结果 */
interface ComplexityAnalysis {
  score: number; // 0-100
  level: 'simple' | 'moderate' | 'complex' | 'very_complex';
  reasons: string[];
  suggestedTeamSize: number;
  suggestedRoles: DynamicAgentRole[];
  estimatedDuration: 'minutes' | 'hours' | 'days';
  canParallelize: boolean;
}

/** Agent Team 任务 */
interface AgentTeamMission {
  id: string;
  description: string;
  originalRequest: string;
  complexity: ComplexityAnalysis;
  subtasks: SubTask[];
  agents: Map<string, DynamicAgent>;
  status: 'analyzing' | 'planning' | 'executing' | 'merging' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  finalResult?: any;
}

/**
 * 动态 Agent Team 编排器
 */
export class DynamicAgentOrchestrator extends EventEmitter {
  private llmService: LLMService;
  private toolRegistry: ToolRegistry;
  private sessionManager: SessionManager;
  private missions: Map<string, AgentTeamMission> = new Map();
  private baseLLMConfig: LLMConfig;
  
  // 配置
  private readonly COMPLEXITY_THRESHOLD = 40; // 超过此分数组建 Agent Team
  private readonly MAX_PARALLEL_AGENTS = 5;
  private readonly AGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10分钟

  constructor(
    llmService: LLMService,
    toolRegistry: ToolRegistry,
    sessionManager: SessionManager,
    baseLLMConfig: LLMConfig
  ) {
    super();
    this.llmService = llmService;
    this.toolRegistry = toolRegistry;
    this.sessionManager = sessionManager;
    this.baseLLMConfig = baseLLMConfig;
  }

  // ==================== 公开 API ====================

  /**
   * 分析任务复杂度，决定是否需要组建 Agent Team
   */
  async analyzeComplexity(taskDescription: string): Promise<ComplexityAnalysis> {
    const prompt = `分析以下任务的复杂度，从多个维度评估：

任务：${taskDescription}

请评估以下维度（1-10分）：
1. 技术难度 - 需要多深的技术栈知识
2. 代码量 - 预估需要编写多少代码
3. 模块数 - 涉及多少个功能模块
4. 依赖关系 - 内部模块间的依赖复杂度
5. 外部集成 - 需要对接多少外部系统/API
6. 未知因素 - 有多少不确定性

请以JSON格式返回：
{
  "scores": { "technical": N, "codeVolume": N, "modules": N, "dependencies": N, "external": N, "uncertainty": N },
  "reasons": ["原因1", "原因2"],
  "suggestedRoles": ["coder", "reviewer"],
  "estimatedDuration": "minutes|hours|days",
  "canParallelize": true|false
}`;

    try {
      const response = await this.llmService.chat([
        { role: 'system', content: '你是任务复杂度分析专家', timestamp: Date.now() },
        { role: 'user', content: prompt, timestamp: Date.now() }
      ]);

      const analysis = this.parseComplexityResponse(response.content, taskDescription);
      logger.info('DynamicAgentOrchestrator', 
        `Complexity analysis: ${analysis.level} (${analysis.score}/100), ` +
        `team size: ${analysis.suggestedTeamSize}, roles: ${analysis.suggestedRoles.join(',')}`
      );
      
      return analysis;
    } catch (error) {
      logger.error('DynamicAgentOrchestrator', `Complexity analysis failed: ${error}`);
      // 降级为简单任务
      return {
        score: 30,
        level: 'moderate',
        reasons: ['分析失败，降级处理'],
        suggestedTeamSize: 1,
        suggestedRoles: ['coder'],
        estimatedDuration: 'minutes',
        canParallelize: false
      };
    }
  }

  /**
   * 判断是否需要组建 Agent Team
   */
  shouldUseAgentTeam(complexity: ComplexityAnalysis): boolean {
    return complexity.score >= this.COMPLEXITY_THRESHOLD;
  }

  /**
   * 执行复杂任务 - 组建 Agent Team 协作完成
   */
  async executeWithTeam(
    taskDescription: string,
    context?: ConversationMessage[]
  ): Promise<{ result: any; mission: AgentTeamMission; usedTeam: boolean }> {
    
    // 1. 分析复杂度
    const complexity = await this.analyzeComplexity(taskDescription);
    
    // 2. 判断是否需要 Agent Team
    if (!this.shouldUseAgentTeam(complexity)) {
      logger.info('DynamicAgentOrchestrator', 'Task complexity low, executing directly');
      const result = await this.executeDirectly(taskDescription, context);
      return { result, mission: null as any, usedTeam: false };
    }

    // 3. 创建 Mission
    const mission = await this.createMission(taskDescription, complexity, context);
    
    // 4. 规划任务分解
    await this.planMission(mission);
    
    // 5. 动态生成 Agents
    await this.spawnAgentsForMission(mission);
    
    // 6. 执行协作
    await this.executeMission(mission);
    
    // 7. 合并结果
    const result = await this.mergeResults(mission);
    
    // 8. 清理资源
    await this.cleanupMission(mission);
    
    return { result, mission, usedTeam: true };
  }

  /**
   * 获取进行中的 Mission 列表
   */
  getActiveMissions(): AgentTeamMission[] {
    return Array.from(this.missions.values()).filter(
      m => !['completed', 'failed'].includes(m.status)
    );
  }

  /**
   * 获取 Mission 详情
   */
  getMission(missionId: string): AgentTeamMission | undefined {
    return this.missions.get(missionId);
  }

  /**
   * 强制终止 Mission
   */
  async abortMission(missionId: string): Promise<void> {
    const mission = this.missions.get(missionId);
    if (!mission) return;

    logger.warn('DynamicAgentOrchestrator', `Aborting mission ${missionId}`);
    
    // 标记所有进行中的子任务为失败
    for (const subtask of mission.subtasks) {
      if (subtask.status === 'in_progress' || subtask.status === 'assigned') {
        subtask.status = 'failed';
      }
    }
    
    mission.status = 'failed';
    this.emit('mission_aborted', mission);
    
    // 清理资源
    await this.cleanupMission(mission);
  }

  // ==================== 私有实现 ====================

  /**
   * 直接执行简单任务（不走 Agent Team）
   */
  private async executeDirectly(
    taskDescription: string,
    context?: ConversationMessage[]
  ): Promise<any> {
    const messages: ConversationMessage[] = [
      ...(context || []),
      { role: 'user', content: taskDescription, timestamp: Date.now() }
    ];

    const response = await this.llmService.chat(messages, this.getAvailableTools());
    return response.content;
  }

  /**
   * 创建 Mission
   */
  private async createMission(
    description: string,
    complexity: ComplexityAnalysis,
    context?: ConversationMessage[]
  ): Promise<AgentTeamMission> {
    const mission: AgentTeamMission = {
      id: `mission-${uuidv4().slice(0, 8)}`,
      description,
      originalRequest: description,
      complexity,
      subtasks: [],
      agents: new Map(),
      status: 'analyzing',
      createdAt: Date.now()
    };

    this.missions.set(mission.id, mission);
    this.emit('mission_created', mission);
    
    logger.info('DynamicAgentOrchestrator', `Mission ${mission.id} created`);
    return mission;
  }

  /**
   * 规划任务 - 使用 Planner Agent 分解任务
   */
  private async planMission(mission: AgentTeamMission): Promise<void> {
    mission.status = 'planning';
    
    const prompt = `作为任务规划专家，请将以下复杂任务分解为可并行执行的子任务：

主任务：${mission.description}

复杂度分析：
- 级别：${mission.complexity.level}
- 建议团队规模：${mission.complexity.suggestedTeamSize} 人
- 建议角色：${mission.complexity.suggestedRoles.join(', ')}
- 可并行化：${mission.complexity.canParallelize}

要求：
1. 每个子任务应该有明确的输入和输出
2. 标注任务间的依赖关系（哪些任务必须在其他任务之后执行）
3. 为每个子任务分配最适合的角色
4. 尽量并行化独立任务

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

请以JSON格式返回子任务列表：
[
  {
    "id": "task-1",
    "description": "具体任务描述",
    "role": "coder",
    "dependencies": [] // 依赖的其他任务ID
  }
]`;

    try {
      const response = await this.llmService.chat([
        { role: 'system', content: '你是任务规划专家', timestamp: Date.now() },
        { role: 'user', content: prompt, timestamp: Date.now() }
      ]);

      const subtasks = this.parseSubTasks(response.content);
      mission.subtasks = subtasks;
      
      logger.info('DynamicAgentOrchestrator', 
        `Mission ${mission.id} planned: ${subtasks.length} subtasks`
      );
      
      this.emit('mission_planned', mission);
    } catch (error) {
      logger.error('DynamicAgentOrchestrator', `Planning failed: ${error}`);
      // 降级为单任务
      mission.subtasks = [{
        id: `task-${uuidv4().slice(0, 8)}`,
        description: mission.description,
        role: mission.complexity.suggestedRoles[0] || 'coder',
        dependencies: [],
        status: 'pending'
      }];
    }
  }

  /**
   * 为 Mission 动态生成 Agents
   */
  private async spawnAgentsForMission(mission: AgentTeamMission): Promise<void> {
    const neededRoles = new Set(mission.subtasks.map(t => t.role));
    
    for (const role of neededRoles) {
      const agent = await this.spawnAgent(role, mission.id);
      mission.agents.set(agent.id, agent);
      
      logger.debug('DynamicAgentOrchestrator', 
        `Spawned agent ${agent.name} (${role}) for mission ${mission.id}`
      );
    }
    
    this.emit('agents_spawned', { mission, agents: Array.from(mission.agents.values()) });
  }

  /**
   * 动态生成单个 Agent
   */
  private async spawnAgent(role: DynamicAgentRole, missionId: string): Promise<DynamicAgent> {
    const agentId = `agent-${uuidv4().slice(0, 8)}`;
    
    const agent: DynamicAgent = {
      id: agentId,
      role,
      name: `${this.getRoleDisplayName(role)}-${agentId.slice(-4)}`,
      capabilities: this.getCapabilitiesForRole(role),
      llmConfig: this.getLLMConfigForRole(role),
      context: this.buildAgentContext(role),
      status: 'idle',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      parentOrchestratorId: missionId
    };

    return agent;
  }

  /**
   * 执行 Mission
   */
  private async executeMission(mission: AgentTeamMission): Promise<void> {
    mission.status = 'executing';
    mission.startedAt = Date.now();
    
    this.emit('mission_started', mission);
    
    // 执行依赖分析，确定执行顺序
    const executionOrder = this.calculateExecutionOrder(mission.subtasks);
    
    for (const batch of executionOrder) {
      // 并行执行一批无依赖的任务
      await Promise.all(
        batch.map(subtask => this.executeSubTask(mission, subtask))
      );
      
      // 检查是否有失败
      const failed = batch.filter(t => t.status === 'failed');
      if (failed.length > 0) {
        logger.error('DynamicAgentOrchestrator', 
          `Mission ${mission.id}: ${failed.length} subtasks failed`
        );
        mission.status = 'failed';
        this.emit('mission_failed', mission);
        return;
      }
    }
    
    mission.status = 'completed';
    mission.completedAt = Date.now();
    this.emit('mission_completed', mission);
    
    logger.info('DynamicAgentOrchestrator', 
      `Mission ${mission.id} completed in ${mission.completedAt - mission.startedAt}ms`
    );
  }

  /**
   * 执行单个子任务
   */
  private async executeSubTask(
    mission: AgentTeamMission, 
    subtask: SubTask
  ): Promise<void> {
    // 找到适合执行此任务的 Agent
    const agent = this.findBestAgentForTask(mission, subtask);
    if (!agent) {
      subtask.status = 'failed';
      return;
    }

    subtask.assignedAgentId = agent.id;
    subtask.status = 'in_progress';
    subtask.startTime = Date.now();
    agent.status = 'working';
    agent.currentTask = subtask.id;
    
    this.emit('subtask_started', { mission, subtask, agent });

    try {
      // 构建执行上下文
      const context = this.buildTaskContext(mission, subtask);
      
      // 调用 LLM 执行
      const result = await this.executeAgentTask(agent, subtask, context);
      
      subtask.result = result;
      subtask.status = 'completed';
      subtask.endTime = Date.now();
      agent.status = 'idle';
      agent.currentTask = undefined;
      agent.lastActiveAt = Date.now();
      
      this.emit('subtask_completed', { mission, subtask, agent, result });
      
    } catch (error) {
      subtask.status = 'failed';
      subtask.endTime = Date.now();
      agent.status = 'error';
      
      logger.error('DynamicAgentOrchestrator', 
        `Subtask ${subtask.id} failed: ${error}`
      );
      
      this.emit('subtask_failed', { mission, subtask, agent, error });
    }
  }

  /**
   * 实际调用 LLM 执行 Agent 任务
   */
  private async executeAgentTask(
    agent: DynamicAgent,
    subtask: SubTask,
    context: string
  ): Promise<any> {
    const systemPrompt = this.buildAgentSystemPrompt(agent);
    
    const messages: ConversationMessage[] = [
      { role: 'system', content: systemPrompt, timestamp: Date.now() },
      { role: 'user', content: `## 任务上下文\n${context}\n\n## 你的任务\n${subtask.description}`, timestamp: Date.now() }
    ];

    // 使用流式响应获取中间结果
    let fullResponse = '';
    const response = await this.llmService.chatStream(
      messages,
      this.getToolsForAgent(agent),
      {
        onChunk: (chunk) => {
          fullResponse += chunk;
          agent.lastActiveAt = Date.now();
        }
      }
    );

    // 如果有工具调用，执行工具
    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolResults = await this.executeToolCalls(response.tool_calls);
      
      // 将工具结果返回给 LLM 继续处理
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
        timestamp: Date.now()
      });
      
      for (const result of toolResults) {
        messages.push({
          role: 'tool',
          content: JSON.stringify(result.result),
          tool_call_id: result.id,
          timestamp: Date.now()
        });
      }
      
      const finalResponse = await this.llmService.chat(messages);
      return {
        content: finalResponse.content,
        toolCalls: toolResults,
        rawResponse: fullResponse
      };
    }

    return {
      content: response.content || fullResponse,
      rawResponse: fullResponse
    };
  }

  /**
   * 合并所有子任务结果
   */
  private async mergeResults(mission: AgentTeamMission): Promise<any> {
    mission.status = 'merging';
    
    const completedTasks = mission.subtasks.filter(t => t.status === 'completed');
    
    if (completedTasks.length === 0) {
      throw new Error('No subtasks completed');
    }

    // 单个任务直接返回
    if (completedTasks.length === 1) {
      mission.finalResult = completedTasks[0].result;
      return mission.finalResult;
    }

    // 多个任务需要合并
    const mergePrompt = `请将以下多个子任务的结果合并为一个完整的输出：

主任务：${mission.description}

子任务结果：
${completedTasks.map((t, i) => `
--- 子任务 ${i + 1} ---
任务：${t.description}
结果：${JSON.stringify(t.result, null, 2)}
`).join('\n')}

请整合以上结果，确保：
1. 消除重复内容
2. 保持逻辑连贯
3. 格式统一
4. 输出完整的最终成果
`;

    const response = await this.llmService.chat([
      { role: 'system', content: '你是结果整合专家', timestamp: Date.now() },
      { role: 'user', content: mergePrompt, timestamp: Date.now() }
    ]);

    mission.finalResult = {
      mergedContent: response.content,
      subtaskResults: completedTasks.map(t => ({
        task: t.description,
        role: mission.agents.get(t.assignedAgentId!)?.role,
        result: t.result
      }))
    };

    return mission.finalResult;
  }

  /**
   * 清理 Mission 资源
   */
  private async cleanupMission(mission: AgentTeamMission): Promise<void> {
    logger.info('DynamicAgentOrchestrator', 
      `Cleaning up mission ${mission.id}, destroying ${mission.agents.size} agents`
    );

    // 销毁所有 Agent
    for (const [agentId, agent] of mission.agents) {
      agent.status = 'completed';
      this.emit('agent_destroyed', { mission, agent });
    }

    mission.agents.clear();
    
    // 延迟从内存中移除（保留历史记录）
    setTimeout(() => {
      this.missions.delete(mission.id);
    }, 60 * 60 * 1000); // 1小时后清理

    this.emit('mission_cleaned', mission);
  }

  // ==================== 工具方法 ====================

  private parseComplexityResponse(content: string, originalTask: string): ComplexityAnalysis {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        const scores = data.scores || {};
        
        // 计算总分 (0-100)
        const totalScore = Math.round(
          ((scores.technical || 5) + 
           (scores.codeVolume || 5) + 
           (scores.modules || 5) + 
           (scores.dependencies || 5) + 
           (scores.external || 5) + 
           (scores.uncertainty || 5)) / 60 * 100
        );

        return {
          score: totalScore,
          level: totalScore < 25 ? 'simple' : totalScore < 50 ? 'moderate' : totalScore < 75 ? 'complex' : 'very_complex',
          reasons: data.reasons || [],
          suggestedTeamSize: Math.max(1, Math.ceil(totalScore / 20)),
          suggestedRoles: data.suggestedRoles || ['coder'],
          estimatedDuration: data.estimatedDuration || 'minutes',
          canParallelize: data.canParallelize !== false
        };
      }
    } catch {
      // 解析失败使用默认值
    }

    return {
      score: 50,
      level: 'moderate',
      reasons: ['解析失败，使用默认评估'],
      suggestedTeamSize: 2,
      suggestedRoles: ['coder', 'reviewer'],
      estimatedDuration: 'hours',
      canParallelize: true
    };
  }

  private parseSubTasks(content: string): SubTask[] {
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        if (Array.isArray(data)) {
          return data.map((t: any) => ({
            id: t.id || `task-${uuidv4().slice(0, 8)}`,
            description: t.description,
            role: t.role || 'coder',
            dependencies: t.dependencies || [],
            status: 'pending'
          }));
        }
      }
    } catch {
      // 解析失败
    }
    return [];
  }

  private calculateExecutionOrder(subtasks: SubTask[]): SubTask[][] {
    const completed = new Set<string>();
    const batches: SubTask[][] = [];
    const remaining = new Set(subtasks);

    while (remaining.size > 0) {
      const batch: SubTask[] = [];
      
      for (const task of remaining) {
        // 检查所有依赖是否已完成
        const depsSatisfied = task.dependencies.every(depId => 
          completed.has(depId) || !subtasks.find(t => t.id === depId)
        );
        
        if (depsSatisfied) {
          batch.push(task);
        }
      }

      if (batch.length === 0) {
        // 存在循环依赖，强制添加剩余任务
        logger.warn('DynamicAgentOrchestrator', 'Circular dependency detected');
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

  private findBestAgentForTask(
    mission: AgentTeamMission, 
    subtask: SubTask
  ): DynamicAgent | undefined {
    // 找角色匹配的可用 Agent
    const candidates = Array.from(mission.agents.values()).filter(
      a => a.role === subtask.role && a.status === 'idle'
    );
    
    if (candidates.length > 0) {
      return candidates[0];
    }

    // 如果没有空闲的，找任意匹配的（后面会排队）
    return Array.from(mission.agents.values()).find(a => a.role === subtask.role);
  }

  private buildTaskContext(mission: AgentTeamMission, subtask: SubTask): string {
    const parentResults = subtask.dependencies
      .map(depId => mission.subtasks.find(t => t.id === depId))
      .filter(Boolean)
      .map(t => `依赖任务 "${t!.description}" 的结果：\n${JSON.stringify(t!.result, null, 2)}`)
      .join('\n\n');

    return `主任务：${mission.description}\n\n${parentResults}`;
  }

  private buildAgentContext(role: DynamicAgentRole): ConversationMessage[] {
    const rolePrompts: Record<DynamicAgentRole, string> = {
      planner: '你是任务规划专家，擅长将复杂任务分解为可执行的子任务。',
      researcher: '你是研究专家，擅长收集信息、分析需求、调研技术方案。',
      architect: '你是架构专家，擅长系统设计、技术选型、模块划分。',
      coder: '你是资深程序员，擅长编写高质量、可维护的代码。',
      reviewer: '你是代码审查专家，擅长发现代码问题、提出改进建议。',
      tester: '你是测试专家，擅长编写测试用例、发现边界情况。',
      debugger: '你是调试专家，擅长定位问题、修复 Bug。',
      writer: '你是技术写作专家，擅长编写文档、注释、使用说明。',
      validator: '你是验证专家，擅长检查完整性、确保交付质量。'
    };

    return [{
      role: 'system',
      content: rolePrompts[role],
      timestamp: Date.now()
    }];
  }

  private buildAgentSystemPrompt(agent: DynamicAgent): string {
    const capabilities = agent.capabilities;
    
    return `${this.buildAgentContext(agent.role)[0].content}

你的能力：
${capabilities.canPlan ? '- 任务规划与分解' : ''}
${capabilities.canCode ? '- 代码编写与实现' : ''}
${capabilities.canReview ? '- 代码审查与优化' : ''}
${capabilities.canTest ? '- 测试设计与执行' : ''}
${capabilities.canWrite ? '- 文档编写' : ''}

可用工具：${capabilities.tools.join(', ')}

当前角色：${this.getRoleDisplayName(agent.role)}
Agent ID：${agent.id}

请专注于你的专业领域，提供高质量的输出。`;
  }

  private getCapabilitiesForRole(role: DynamicAgentRole): AgentCapabilities {
    const capabilities: Record<DynamicAgentRole, AgentCapabilities> = {
      planner: { canPlan: true, canCode: false, canReview: false, canTest: false, canWrite: true, tools: ['read', 'fetch', 'web_fetch'] },
      researcher: { canPlan: false, canCode: false, canReview: false, canTest: false, canWrite: true, tools: ['read', 'fetch', 'web_fetch', 'grep'] },
      architect: { canPlan: true, canCode: true, canReview: true, canTest: false, canWrite: true, tools: ['read', 'write', 'edit', 'listSkills'] },
      coder: { canPlan: false, canCode: true, canReview: false, canTest: false, canWrite: false, tools: ['read', 'write', 'edit', 'exec', 'grep'] },
      reviewer: { canPlan: false, canCode: true, canReview: true, canTest: false, canWrite: true, tools: ['read', 'grep', 'write'] },
      tester: { canPlan: false, canCode: true, canReview: false, canTest: true, canWrite: false, tools: ['read', 'write', 'edit', 'exec'] },
      debugger: { canPlan: false, canCode: true, canReview: true, canTest: true, canWrite: false, tools: ['read', 'edit', 'exec', 'grep'] },
      writer: { canPlan: false, canCode: false, canReview: true, canTest: false, canWrite: true, tools: ['read', 'write', 'edit'] },
      validator: { canPlan: true, canCode: true, canReview: true, canTest: true, canWrite: true, tools: ['read', 'exec', 'grep'] }
    };

    return capabilities[role];
  }

  private getLLMConfigForRole(role: DynamicAgentRole): LLMConfig {
    // 不同角色可以使用不同的模型配置
    const baseConfig = { ...this.baseLLMConfig };
    
    // coder 使用更强的模型
    if (role === 'coder' || role === 'architect') {
      baseConfig.temperature = 0.3; // 更确定性的输出
    }
    
    // researcher 可以使用更创意的模型
    if (role === 'researcher' || role === 'planner') {
      baseConfig.temperature = 0.7;
    }

    return baseConfig;
  }

  private getRoleDisplayName(role: DynamicAgentRole): string {
    const names: Record<DynamicAgentRole, string> = {
      planner: '规划师',
      researcher: '研究员',
      architect: '架构师',
      coder: '程序员',
      reviewer: '审查员',
      tester: '测试员',
      debugger: '调试员',
      writer: '文档员',
      validator: '验证员'
    };
    return names[role];
  }

  private getAvailableTools(): any[] {
    const tools = this.toolRegistry.getAll();
    return tools.map((t: ToolDefinition) => ({
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

  private getToolsForAgent(agent: DynamicAgent): any[] {
    const allTools = this.getAvailableTools();
    const allowedToolNames = agent.capabilities.tools;
    
    return allTools.filter(t => 
      allowedToolNames.includes(t.function.name)
    );
  }

  private async executeToolCalls(toolCalls: any[]): Promise<any[]> {
    const results = [];
    
    for (const call of toolCalls) {
      try {
        const result = await this.toolRegistry.execute(
          call.function.name,
          JSON.parse(call.function.arguments),
          null as any
        );
        results.push({ id: call.id, result });
      } catch (error) {
        results.push({ id: call.id, result: { error: String(error) } });
      }
    }
    
    return results;
  }
}

// 导出单例
export const dynamicAgentOrchestrator: DynamicAgentOrchestrator | null = null;
