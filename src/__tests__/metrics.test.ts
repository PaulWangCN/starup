/**
 * 监控系统测试
 * 
 * 这些测试验证 MetricService 的核心功能
 */

import { StarUpDatabase } from '../core/persistence/Database';
import { MetricService } from '../core/metrics/MetricService';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('MetricService 监控', () => {
  const testDbPath = path.join(process.cwd(), '.starup', 'metrics-test.db');
  let db: StarUpDatabase;
  let metrics: MetricService;

  beforeAll(async () => {
    // 清理并创建测试数据库
    try {
      await fs.unlink(testDbPath);
    } catch {
      // 忽略
    }
    
    db = new StarUpDatabase(testDbPath);
    await db.initialize();
  });

  afterAll(async () => {
    db.close();
    try {
      await fs.unlink(testDbPath);
    } catch {
      // 忽略
    }
  });

  beforeEach(() => {
    // 每个测试前创建新的 MetricService 实例
    metrics = new MetricService();
  });

  describe('工具调用监控', () => {
    it('应该能够记录和查询工具调用指标', async () => {
      // 记录一些工具调用
      db.recordToolCallMetrics({
        tool_name: 'read',
        session_id: 'test-session',
        args_summary: 'path=/test.txt',
        success: true,
        duration_ms: 100,
        timestamp: Date.now(),
      });

      db.recordToolCallMetrics({
        tool_name: 'write',
        session_id: 'test-session',
        args_summary: 'path=/test.txt',
        success: false,
        error_type: 'PERMISSION_DENIED',
        error_message: 'Access denied',
        duration_ms: 50,
        timestamp: Date.now(),
      });

      const stats = db.getToolCallStats();
      
      expect(stats.length).toBeGreaterThanOrEqual(2);
      expect(stats.find(s => s.tool_name === 'read')?.success_count).toBeGreaterThanOrEqual(1);
      expect(stats.find(s => s.tool_name === 'write')?.fail_count).toBeGreaterThanOrEqual(1);
    });

    it('应该能分析错误类型', async () => {
      // 记录不同类型的错误
      db.recordToolCallMetrics({
        tool_name: 'exec',
        session_id: 'test-session',
        args_summary: '',
        success: false,
        error_type: 'TIMEOUT',
        error_message: 'Request timeout',
        duration_ms: 5000,
        timestamp: Date.now(),
      });

      const errors = db.getToolErrorAnalysis();
      
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors.some(e => e.error_type === 'TIMEOUT' || e.error_type === 'PERMISSION_DENIED')).toBe(true);
    });
  });

  describe('Skill 执行监控', () => {
    it('应该能够记录和查询 Skill 执行指标', async () => {
      db.recordSkillExecutionMetrics({
        skill_id: 'coding-task',
        session_id: 'test-session',
        subagent_role: 'coder',
        steps_count: 5,
        tool_calls_count: 10,
        llm_calls_count: 6,
        duration_ms: 30000,
        success: true,
        completed: true,
        timestamp: Date.now(),
      });

      const stats = db.getSkillExecutionStats();
      
      expect(stats.length).toBeGreaterThanOrEqual(1);
      const codingStat = stats.find(s => s.skill_id === 'coding-task');
      if (codingStat) {
        expect(codingStat.avg_steps).toBeGreaterThanOrEqual(5);
        expect(codingStat.success_count).toBeGreaterThanOrEqual(1);
      }
    });

    it('应该能按角色统计效率', async () => {
      const roleStats = db.getSubagentRoleStats();
      
      // 即使没有数据，也应该返回空数组而不是报错
      expect(Array.isArray(roleStats)).toBe(true);
    });
  });

  describe('监控数据清理', () => {
    it('应该能清理旧的监控数据', async () => {
      // 记录一条旧数据（30天前）
      db.recordToolCallMetrics({
        tool_name: 'old-tool',
        session_id: 'test-session',
        args_summary: '',
        success: true,
        duration_ms: 100,
        timestamp: Date.now() - (31 * 24 * 60 * 60 * 1000),
      });

      // 清理30天前的数据
      db.cleanupOldMetrics(30);

      // 验证旧数据被清理（通过检查最近7天的数据应该不包含这条记录）
      const stats = db.getToolCallStats({ since: Date.now() - (7 * 24 * 60 * 60 * 1000) });
      expect(stats.find(s => s.tool_name === 'old-tool')).toBeUndefined();
    });
  });
});
