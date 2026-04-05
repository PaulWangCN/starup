/**
 * AutoDream 时间衰减测试
 */

import { AutoDreamWithDecay } from '../core/memory/AutoDreamWithDecay';

describe('AutoDreamWithDecay', () => {
  let autoDream: AutoDreamWithDecay;

  beforeEach(() => {
    // 使用短半衰期便于测试（1秒）
    autoDream = new AutoDreamWithDecay({
      halfLife: 1000, // 1秒半衰期
      minConfidence: 0.1,
      refreshOnAccess: true,
      refreshBoost: 0.1
    });
  });

  afterEach(() => {
    autoDream.stop();
    autoDream.clear();
  });

  test('should calculate decay correctly', () => {
    const fact = {
      id: 'test-fact',
      content: 'Test',
      sources: [],
      confidence: 0.9,
      createdAt: Date.now() - 1000, // 1秒前
      updatedAt: Date.now() - 1000
    };

    const effectiveConfidence = autoDream.calculateEffectiveConfidence(fact);
    
    // 1个半衰期后应该约为 0.9 * 0.5 = 0.45（允许一定误差）
    expect(effectiveConfidence).toBeLessThan(0.5);
    expect(effectiveConfidence).toBeGreaterThan(0.3);
  });

  test('should filter low confidence facts in query', () => {
    // 直接添加事实（绕过观察合并）
    (autoDream as any).facts.set('fact-1', {
      id: 'fact-1',
      content: 'TypeScript is preferred programming language',
      sources: ['obs-1'],
      confidence: 0.9,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    // 立即查询应该能找到
    let facts = autoDream.queryFacts('TypeScript', 5);
    expect(facts.length).toBe(1);

    // 模拟时间流逝（修改updatedAt为过去）
    const facts_list = autoDream.getFacts();
    if (facts_list.length > 0) {
      facts_list[0].updatedAt = Date.now() - 5000; // 5秒前
    }

    // 再次查询（此时置信度已衰减到 0.9 * exp(-5) ≈ 0.006）
    facts = autoDream.queryFacts('TypeScript', 5);
    // 由于衰减低于阈值0.1，应该被过滤掉
    expect(facts.length).toBe(0);
  });

  test('should refresh confidence on access', () => {
    // 添加事实
    (autoDream as any).facts.set('test-1', {
      id: 'test-1',
      content: 'Test fact',
      sources: [],
      confidence: 0.5,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const beforeConfidence = (autoDream as any).facts.get('test-1').confidence;
    
    autoDream.accessFact('test-1');
    
    const afterConfidence = (autoDream as any).facts.get('test-1').confidence;
    
    expect(afterConfidence).toBeGreaterThan(beforeConfidence);
  });

  test('should reinforce fact', () => {
    // 添加事实
    (autoDream as any).facts.set('test-1', {
      id: 'test-1',
      content: 'Test fact',
      sources: [],
      confidence: 0.5,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    autoDream.reinforceFact('test-1', 0.2);
    
    const fact = (autoDream as any).facts.get('test-1');
    expect(fact.confidence).toBeCloseTo(0.7, 1);
  });

  test('should provide decay stats', () => {
    // 添加一些事实
    (autoDream as any).facts.set('fresh', {
      id: 'fresh',
      content: 'Fresh fact',
      sources: [],
      confidence: 0.9,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    (autoDream as any).facts.set('old', {
      id: 'old',
      content: 'Old fact',
      sources: [],
      confidence: 0.9,
      createdAt: Date.now() - 5000,
      updatedAt: Date.now() - 5000
    });

    const stats = autoDream.getDecayStats();
    
    expect(stats.totalFacts).toBe(2);
    expect(stats.avgEffectiveConfidence).toBeGreaterThan(0);
  });
});
