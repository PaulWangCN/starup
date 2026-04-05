/**
 * 并行工具调用执行器
 * 
 * 核心功能：
 * 1. 支持工具依赖图，自动解析执行顺序
 * 2. 支持真正的并行执行
 * 3. 支持超时控制和错误重试
 * 4. 支持并发限制
 * 
 * 参考：Claude Code泄漏代码中的并行工具调用实现
 */

import { EventEmitter } from 'events';
import { ToolDefinition, ToolResult, Session } from '../../types';
import { logger } from '../../utils/Logger';

/** 并行工具调用定义 */
export interface ParallelToolCall {
  id: string;
  tool: string;
  params: any;
  dependencies: string[]; // 依赖的其他工具调用ID
  timeout: number; // 超时时间（毫秒）
  retry: number; // 重试次数
  priority: number; // 优先级（数字越小优先级越高）
}

/** 工具执行图节点 */
interface ExecutionNode {
  call: ParallelToolCall;
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed';
  result?: ToolResult;
  error?: Error;
  startTime?: number;
  endTime?: number;
  retryCount: number;
}

/** 工具执行图 */
export class ToolExecutionGraph extends EventEmitter {
  private nodes: Map<string, ExecutionNode> = new Map();
  private edges: Map<string, Set<string>> = new Map(); // 依赖图：task -> tasks that depend on it
  private reverseEdges: Map<string, Set<string>> = new Map(); // 反向依赖图

  /**
   * 添加工具调用节点
   */
  addNode(call: ParallelToolCall): void {
    if (this.nodes.has(call.id)) {
      throw new Error(`Tool call with id '${call.id}' already exists`);
    }

    this.nodes.set(call.id, {
      call,
      status: 'pending',
      retryCount: 0
    });

    // 初始化边
    if (!this.edges.has(call.id)) {
      this.edges.set(call.id, new Set());
    }
    if (!this.reverseEdges.has(call.id)) {
      this.reverseEdges.set(call.id, new Set());
    }

    // 建立依赖关系
    for (const depId of call.dependencies) {
      this.addEdge(depId, call.id);
    }

    this.emit('node_added', call);
  }

  /**
   * 添加依赖边：from -> to (to depends on from)
   */
  addEdge(from: string, to: string): void {
    if (!this.edges.has(from)) {
      this.edges.set(from, new Set());
    }
    if (!this.reverseEdges.has(to)) {
      this.reverseEdges.set(to, new Set());
    }

    this.edges.get(from)!.add(to);
    this.reverseEdges.get(to)!.add(from);
    this.emit('edge_added', { from, to });
  }

  /**
   * 获取执行批次（可并行执行的任务组）
   */
  getExecutionBatches(): string[][] {
    const batches: string[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(this.nodes.keys());

    while (remaining.size > 0) {
      const batch: string[] = [];

      for (const nodeId of remaining) {
        const node = this.nodes.get(nodeId)!;
        const deps = node.call.dependencies;

        // 检查所有依赖是否已完成
        const depsSatisfied = deps.every(depId => {
          const depNode = this.nodes.get(depId);
          return depNode?.status === 'completed' || completed.has(depId);
        });

        if (depsSatisfied) {
          batch.push(nodeId);
        }
      }

      if (batch.length === 0) {
        // 存在循环依赖，强制添加剩余任务
        logger.warn('ToolExecutionGraph', 'Circular dependency detected, forcing execution');
        batch.push(...remaining);
        remaining.clear();
      } else {
        for (const id of batch) {
          remaining.delete(id);
          completed.add(id);
        }
      }

      batches.push(batch);
    }

    return batches;
  }

  /**
   * 获取指定节点的依赖
   */
  getDependencies(nodeId: string): string[] {
    const node = this.nodes.get(nodeId);
    return node ? node.call.dependencies : [];
  }

  /**
   * 获取依赖于指定节点的所有节点
   */
  getDependents(nodeId: string): string[] {
    const dependents = this.edges.get(nodeId);
    return dependents ? Array.from(dependents) : [];
  }

  /**
   * 更新节点状态
   */
  updateNodeStatus(nodeId: string, status: ExecutionNode['status'], result?: ToolResult, error?: Error): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.status = status;
    
    if (status === 'running') {
      node.startTime = Date.now();
    } else if (status === 'completed' || status === 'failed') {
      node.endTime = Date.now();
      node.result = result;
      node.error = error;
    }

    this.emit('node_status_changed', { nodeId, status, result, error });
  }

  /**
   * 获取节点
   */
  getNode(nodeId: string): ExecutionNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * 获取所有节点
   */
  getAllNodes(): ExecutionNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * 检查是否存在循环依赖
   */
  hasCycle(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycleFrom = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const dependents = this.edges.get(nodeId) || new Set();
      for (const dependent of dependents) {
        if (!visited.has(dependent)) {
          if (hasCycleFrom(dependent)) return true;
        } else if (recursionStack.has(dependent)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (hasCycleFrom(nodeId)) return true;
      }
    }

    return false;
  }

  /**
   * 获取执行统计
   */
  getStats(): {
    total: number;
    pending: number;
    ready: number;
    running: number;
    completed: number;
    failed: number;
    totalDuration: number;
  } {
    const nodes = this.getAllNodes();
    return {
      total: nodes.length,
      pending: nodes.filter(n => n.status === 'pending').length,
      ready: nodes.filter(n => n.status === 'ready').length,
      running: nodes.filter(n => n.status === 'running').length,
      completed: nodes.filter(n => n.status === 'completed').length,
      failed: nodes.filter(n => n.status === 'failed').length,
      totalDuration: nodes.reduce((sum, n) => {
        if (n.startTime && n.endTime) {
          return sum + (n.endTime - n.startTime);
        }
        return sum;
      }, 0)
    };
  }
}

/** 并行工具执行器配置 */
export interface ParallelExecutorConfig {
  maxConcurrency: number; // 最大并发数
  defaultTimeout: number; // 默认超时时间（毫秒）
  defaultRetry: number; // 默认重试次数
  retryDelay: number; // 重试延迟（毫秒）
}

/** 并行工具执行器 */
export class ParallelToolExecutor extends EventEmitter {
  private config: ParallelExecutorConfig;
  private toolRegistry: Map<string, ToolDefinition>;

  constructor(
    tools: ToolDefinition[],
    config: Partial<ParallelExecutorConfig> = {}
  ) {
    super();
    this.config = {
      maxConcurrency: 5,
      defaultTimeout: 60000,
      defaultRetry: 2,
      retryDelay: 1000,
      ...config
    };
    this.toolRegistry = new Map(tools.map(t => [t.name, t]));
  }

  /**
   * 执行工具调用图
   */
  async execute(graph: ToolExecutionGraph, session: Session): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>();
    
    if (graph.hasCycle()) {
      logger.warn('ParallelToolExecutor', 'Execution graph contains cycles');
    }

    const batches = graph.getExecutionBatches();
    logger.info('ParallelToolExecutor', `Executing ${batches.length} batches`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.debug('ParallelToolExecutor', `Executing batch ${i + 1}/${batches.length} with ${batch.length} tools`);

      // 限制并发数
      const chunks = this.chunkArray(batch, this.config.maxConcurrency);
      
      for (const chunk of chunks) {
        const batchResults = await this.executeBatch(chunk, graph, session);
        
        for (const [id, result] of batchResults) {
          results.set(id, result);
          
          if (result.success) {
            graph.updateNodeStatus(id, 'completed', result);
          } else {
            graph.updateNodeStatus(id, 'failed', result, new Error(result.error));
          }
        }
      }
    }

    this.emit('execution_complete', { results, stats: graph.getStats() });
    return results;
  }

  /**
   * 执行一批工具调用
   */
  private async executeBatch(
    nodeIds: string[],
    graph: ToolExecutionGraph,
    session: Session
  ): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>();

    await Promise.all(
      nodeIds.map(async (nodeId) => {
        const node = graph.getNode(nodeId)!;
        const result = await this.executeWithRetry(node, session);
        results.set(nodeId, result);
      })
    );

    return results;
  }

  /**
   * 执行单个工具调用（带重试）
   */
  private async executeWithRetry(node: ExecutionNode, session: Session): Promise<ToolResult> {
    const { call } = node;
    const tool = this.toolRegistry.get(call.tool);

    if (!tool) {
      return {
        success: false,
        error: `Tool '${call.tool}' not found`
      };
    }

    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= call.retry; attempt++) {
      try {
        node.retryCount = attempt;
        
        if (attempt > 0) {
          logger.info('ParallelToolExecutor', `Retrying ${call.tool} (attempt ${attempt + 1}/${call.retry + 1})`);
          await this.delay(this.config.retryDelay * attempt);
        }

        const result = await this.executeWithTimeout(tool, call.params, session, call.timeout);
        
        logger.debug('ParallelToolExecutor', `Tool ${call.tool} completed successfully`);
        return result;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn('ParallelToolExecutor', `Tool ${call.tool} failed (attempt ${attempt + 1}): ${lastError.message}`);
      }
    }

    return {
      success: false,
      error: `Failed after ${call.retry + 1} attempts: ${lastError?.message}`
    };
  }

  /**
   * 执行工具调用（带超时）
   */
  private async executeWithTimeout(
    tool: ToolDefinition,
    params: any,
    session: Session,
    timeout: number
  ): Promise<ToolResult> {
    return Promise.race([
      tool.handler(params, session),
      this.createTimeoutPromise(timeout, tool.name)
    ]);
  }

  /**
   * 创建超时Promise
   */
  private createTimeoutPromise(timeout: number, toolName: string): Promise<ToolResult> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Tool '${toolName}' timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * 数组分块
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ParallelExecutorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 注册工具
   */
  registerTool(tool: ToolDefinition): void {
    this.toolRegistry.set(tool.name, tool);
  }
}

export default ParallelToolExecutor;
