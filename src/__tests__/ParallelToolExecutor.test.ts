/**
 * 并行工具执行器测试
 */

import { ParallelToolExecutor, ToolExecutionGraph, ParallelToolCall } from '../core/tools/ParallelToolExecutor';
import { ToolDefinition, Session } from '../types';

describe('ToolExecutionGraph', () => {
  let graph: ToolExecutionGraph;

  beforeEach(() => {
    graph = new ToolExecutionGraph();
  });

  test('should add nodes', () => {
    const call: ParallelToolCall = {
      id: 'test-1',
      tool: 'read',
      params: { path: '/test' },
      dependencies: [],
      timeout: 60000,
      retry: 2,
      priority: 1
    };

    graph.addNode(call);
    expect(graph.getNode('test-1')).toBeDefined();
  });

  test('should add edges and detect dependencies', () => {
    const call1: ParallelToolCall = {
      id: 'task-1',
      tool: 'read',
      params: {},
      dependencies: [],
      timeout: 60000,
      retry: 2,
      priority: 1
    };

    const call2: ParallelToolCall = {
      id: 'task-2',
      tool: 'write',
      params: {},
      dependencies: ['task-1'],
      timeout: 60000,
      retry: 2,
      priority: 1
    };

    graph.addNode(call1);
    graph.addNode(call2);

    expect(graph.getDependencies('task-2')).toContain('task-1');
    expect(graph.getDependents('task-1')).toContain('task-2');
  });

  test('should calculate execution batches', () => {
    const calls: ParallelToolCall[] = [
      { id: 'a', tool: 'read', params: {}, dependencies: [], timeout: 60000, retry: 2, priority: 1 },
      { id: 'b', tool: 'read', params: {}, dependencies: [], timeout: 60000, retry: 2, priority: 1 },
      { id: 'c', tool: 'write', params: {}, dependencies: ['a', 'b'], timeout: 60000, retry: 2, priority: 1 }
    ];

    calls.forEach(c => graph.addNode(c));

    const batches = graph.getExecutionBatches();
    expect(batches).toHaveLength(2);
    expect(batches[0]).toContain('a');
    expect(batches[0]).toContain('b');
    expect(batches[1]).toContain('c');
  });

  test('should detect cycles', () => {
    const calls: ParallelToolCall[] = [
      { id: 'a', tool: 'read', params: {}, dependencies: ['c'], timeout: 60000, retry: 2, priority: 1 },
      { id: 'b', tool: 'read', params: {}, dependencies: ['a'], timeout: 60000, retry: 2, priority: 1 },
      { id: 'c', tool: 'write', params: {}, dependencies: ['b'], timeout: 60000, retry: 2, priority: 1 }
    ];

    calls.forEach(c => graph.addNode(c));

    expect(graph.hasCycle()).toBe(true);
  });
});

describe('ParallelToolExecutor', () => {
  let executor: ParallelToolExecutor;
  let mockTools: ToolDefinition[];

  beforeEach(() => {
    mockTools = [
      {
        name: 'read',
        description: 'Read file',
        parameters: [{ name: 'path', type: 'string', description: 'File path', required: true }],
        handler: async (args) => ({ success: true, data: `Content of ${args.path}` })
      },
      {
        name: 'write',
        description: 'Write file',
        parameters: [{ name: 'path', type: 'string', description: 'File path', required: true }],
        handler: async (args) => ({ success: true, data: `Wrote to ${args.path}` })
      }
    ];

    executor = new ParallelToolExecutor(mockTools, {
      maxConcurrency: 2,
      defaultTimeout: 5000,
      defaultRetry: 1,
      retryDelay: 100
    });
  });

  test('should execute tools in parallel', async () => {
    const graph = new ToolExecutionGraph();
    
    graph.addNode({
      id: 'task-1',
      tool: 'read',
      params: { path: '/file1' },
      dependencies: [],
      timeout: 5000,
      retry: 1,
      priority: 1
    });

    graph.addNode({
      id: 'task-2',
      tool: 'read',
      params: { path: '/file2' },
      dependencies: [],
      timeout: 5000,
      retry: 1,
      priority: 1
    });

    const mockSession = { allowedTools: ['read', 'write'] } as Session;
    const results = await executor.execute(graph, mockSession);

    expect(results.size).toBe(2);
    expect(results.get('task-1')?.success).toBe(true);
    expect(results.get('task-2')?.success).toBe(true);
  });

  test('should handle tool not found', async () => {
    const graph = new ToolExecutionGraph();
    
    graph.addNode({
      id: 'task-1',
      tool: 'nonexistent',
      params: {},
      dependencies: [],
      timeout: 5000,
      retry: 1,
      priority: 1
    });

    const mockSession = { allowedTools: ['nonexistent'] } as Session;
    const results = await executor.execute(graph, mockSession);

    expect(results.get('task-1')?.success).toBe(false);
    expect(results.get('task-1')?.error).toContain('not found');
  });
});
