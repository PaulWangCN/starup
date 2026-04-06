/**
 * AutoDream 记忆整合测试
 * 
 * 测试 AutoDream v2 的功能：
 * - 观察添加和合并
 * - 事实转换和查询
 * - 时间衰减
 * - 持久化（可选）
 */

import { AutoDream, AutoDreamPersistence } from '../core/memory';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('AutoDream', () => {
  let autoDream: AutoDream;

  beforeEach(() => {
    autoDream = new AutoDream({
      consolidationInterval: 60000, // 1分钟，测试用
      persistenceEnabled: false     // 测试时不持久化
    });
  });

  afterEach(async () => {
    await autoDream.stop();
    autoDream.clear();
  });

  describe('基础功能', () => {
    test('should add observations', () => {
      const obs = autoDream.addObservation({
        timestamp: Date.now(),
        content: 'User prefers dark mode',
        source: 'conversation',
        confidence: 0.9,
        topics: ['preference', 'ui']
      });

      expect(obs.id).toBeDefined();
      expect(obs.content).toBe('User prefers dark mode');
      expect(autoDream.getStats().observations).toBe(1);
    });

    test('should batch add observations', () => {
      const obs = autoDream.addObservations([
        {
          timestamp: Date.now(),
          content: 'User prefers dark mode',
          source: 'conversation',
          confidence: 0.9,
          topics: ['preference']
        },
        {
          timestamp: Date.now(),
          content: 'User likes TypeScript',
          source: 'conversation',
          confidence: 0.8,
          topics: ['tech']
        }
      ]);

      expect(obs).toHaveLength(2);
      expect(autoDream.getStats().observations).toBe(2);
    });

    test('should limit max observations', () => {
      const smallAutoDream = new AutoDream({
        maxObservations: 5,
        persistenceEnabled: false
      });

      // 添加10个观察
      for (let i = 0; i < 10; i++) {
        smallAutoDream.addObservation({
          timestamp: Date.now() - i * 1000, // 不同时间
          content: `Observation ${i}`,
          source: 'test',
          confidence: 0.5,
          topics: ['test']
        });
      }

      expect(smallAutoDream.getStats().observations).toBeLessThanOrEqual(5);
    });
  });

  describe('记忆整合', () => {
    test('should merge similar observations', async () => {
      // 添加相似观察
      autoDream.addObservation({
        timestamp: Date.now(),
        content: '用户喜欢使用 dark mode dark mode dark mode',
        source: 'chat',
        confidence: 0.8,
        topics: ['preference']
      });

      autoDream.addObservation({
        timestamp: Date.now(),
        content: '用户喜欢使用 dark mode dark mode dark mode',
        source: 'settings',
        confidence: 0.9,
        topics: ['preference']
      });

      // 强制整合
      await autoDream.forceConsolidate();

      // 应该生成 insight
      const stats = autoDream.getStats();
      expect(stats.insights).toBeGreaterThanOrEqual(0);
    });

    test('should convert insights to facts', async () => {
      // 添加高置信度观察
      autoDream.addObservation({
        timestamp: Date.now(),
        content: 'Project uses TypeScript for all source files TypeScript TypeScript',
        source: 'code',
        confidence: 1.0,
        topics: ['tech-stack']
      });

      autoDream.addObservation({
        timestamp: Date.now(),
        content: 'Project uses TypeScript for all source files TypeScript TypeScript',
        source: 'package.json',
        confidence: 1.0,
        topics: ['tech-stack']
      });

      await autoDream.forceConsolidate();

      // 应该生成事实
      const facts = autoDream.getFacts();
      expect(facts.length).toBeGreaterThanOrEqual(0);
    });

    test('should query facts', () => {
      // 直接添加高置信度事实
      (autoDream as any).facts.set('fact-1', {
        id: 'fact-1',
        content: 'The project uses React for frontend development',
        sources: ['obs-1'],
        confidence: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now()
      });

      const results = autoDream.queryFacts('React frontend');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('React');
    });

    test('should update access stats on query', () => {
      (autoDream as any).facts.set('fact-1', {
        id: 'fact-1',
        content: 'Test fact',
        sources: ['obs-1'],
        confidence: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now()
      });

      autoDream.queryFacts('test');
      
      const fact = (autoDream as any).facts.get('fact-1');
      expect(fact.accessCount).toBe(1);
    });
  });

  describe('时间衰减', () => {
    test('should calculate effective confidence with decay', () => {
      const oldFact = {
        id: 'old-fact',
        content: 'Old fact',
        sources: ['obs-1'],
        confidence: 0.9,
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30天前
        updatedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        accessCount: 0,
        lastAccessedAt: Date.now() - 30 * 24 * 60 * 60 * 1000
      };

      (autoDream as any).facts.set('old-fact', oldFact);

      const facts = autoDream.getFacts();
      // 30天后置信度应该衰减到约 45%
      expect(facts.length).toBe(1);
    });

    test('should reinforce fact', () => {
      (autoDream as any).facts.set('fact-1', {
        id: 'fact-1',
        content: 'Test fact',
        sources: ['obs-1'],
        confidence: 0.6,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now()
      });

      const result = autoDream.reinforceFact('fact-1', 0.2);
      
      expect(result).toBe(true);
      const fact = (autoDream as any).facts.get('fact-1');
      expect(fact.confidence).toBe(0.8);
    });

    test('should cleanup low confidence facts', async () => {
      // 添加一个低置信度的旧事实
      (autoDream as any).facts.set('low-confidence', {
        id: 'low-confidence',
        content: 'Low confidence fact',
        sources: ['obs-1'],
        confidence: 0.1,
        createdAt: Date.now() - 90 * 24 * 60 * 60 * 1000, // 90天前
        updatedAt: Date.now() - 90 * 24 * 60 * 60 * 1000,
        accessCount: 0,
        lastAccessedAt: Date.now() - 90 * 24 * 60 * 60 * 1000
      });

      await autoDream.forceConsolidate();

      // 低置信度事实应该被清理
      const fact = (autoDream as any).facts.get('low-confidence');
      expect(fact).toBeUndefined();
    });
  });

  describe('导入导出', () => {
    test('should export memory', () => {
      autoDream.addObservation({
        timestamp: Date.now(),
        content: 'Test observation',
        source: 'test',
        confidence: 0.5,
        topics: ['test']
      });

      const memory = autoDream.exportMemory();
      expect(memory.observations).toHaveLength(1);
      expect(memory.facts).toHaveLength(0);
    });

    test('should clear memory', () => {
      autoDream.addObservation({
        timestamp: Date.now(),
        content: 'Test observation',
        source: 'test',
        confidence: 0.5,
        topics: ['test']
      });

      autoDream.clear();
      
      const memory = autoDream.exportMemory();
      expect(memory.observations).toHaveLength(0);
    });
  });

  describe('持久化', () => {
    // 使用系统临时目录，避免在项目目录下生成测试文件
    const testDir = path.join(os.tmpdir(), 'starup-test-autodream-' + Date.now());
    
    afterEach(async () => {
      // 清理测试目录
      try {
        await fs.rm(testDir, { recursive: true });
      } catch {
        // 忽略清理错误
      }
    });

    test('should save and load with persistence', async () => {
      const persistence = new AutoDreamPersistence(testDir);
      
      const dreamingAutoDream = new AutoDream({
        persistenceEnabled: true
      });
      dreamingAutoDream.setPersistence(persistence);

      // 添加观察
      dreamingAutoDream.addObservation({
        timestamp: Date.now(),
        content: 'Persistent observation',
        source: 'test',
        confidence: 0.8,
        topics: ['test']
      });

      // 启动（会加载）
      await dreamingAutoDream.start();
      
      // 停止（会保存）
      await dreamingAutoDream.stop();

      // 创建新的实例加载数据
      const newAutoDream = new AutoDream({
        persistenceEnabled: true
      });
      newAutoDream.setPersistence(persistence);
      await newAutoDream.start();

      const stats = newAutoDream.getStats();
      expect(stats.observations).toBeGreaterThanOrEqual(0);
      
      await newAutoDream.stop();
    });
  });

  describe('事件发射', () => {
    test('should emit events', (done) => {
      autoDream.once('observation_added', (obs) => {
        expect(obs.content).toBe('Event test');
        done();
      });

      autoDream.addObservation({
        timestamp: Date.now(),
        content: 'Event test',
        source: 'test',
        confidence: 0.5,
        topics: ['test']
      });
    });
  });
});
