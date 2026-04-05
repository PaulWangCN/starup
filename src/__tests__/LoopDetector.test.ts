import { LoopDetector, LoopDetectionResult } from '../core/resilience/LoopDetector';

describe('LoopDetector', () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector();
  });

  afterEach(() => {
    detector.reset();
  });

  describe('Exact Repeat Detection', () => {
    it('should detect exact repeat of read operations', () => {
      // 模拟连续3次读取相同文件
      detector.recordToolCall('read', { path: 'src/test.ts' }, { content: 'test' });
      detector.recordToolCall('read', { path: 'src/test.ts' }, { content: 'test' });
      detector.recordToolCall('read', { path: 'src/test.ts' }, { content: 'test' });

      const result = detector.detectLoop();
      
      expect(result.isLooping).toBe(true);
      expect(result.type).toBe('exact_repeat');
      expect(result.repeatCount).toBe(3);
      expect(result.shouldForceBreak).toBe(false);
    });

    it('should not flag single operations', () => {
      // 只调用1次，不应该触发
      detector.recordToolCall('read', { path: 'src/test.ts' });

      const result = detector.detectLoop();
      
      expect(result.isLooping).toBe(false);
    });

    it('should track different tools separately', () => {
      detector.recordToolCall('read', { path: 'src/a.ts' });
      detector.recordToolCall('read', { path: 'src/b.ts' });
      detector.recordToolCall('read', { path: 'src/a.ts' });

      const result = detector.detectLoop();
      
      // 不同文件，不算完全重复
      expect(result.isLooping).toBe(false);
    });
  });

  describe('Similar Pattern Detection', () => {
    it('should detect excessive grep usage', () => {
      // 连续多次 grep (threshold=4 for read tools)
      detector.recordToolCall('grep', { pattern: 'test1' });
      detector.recordToolCall('grep', { pattern: 'test2' });
      detector.recordToolCall('grep', { pattern: 'test3' });
      detector.recordToolCall('grep', { pattern: 'test4' });
      detector.recordToolCall('grep', { pattern: 'test5' });

      const result = detector.detectLoop();
      
      expect(result.isLooping).toBe(true);
      expect(result.type).toBe('similar_pattern');
    });

    it('should allow reasonable exploration', () => {
      // 3次 grep 是正常的探索
      detector.recordToolCall('grep', { pattern: 'test1' });
      detector.recordToolCall('grep', { pattern: 'test2' });
      detector.recordToolCall('grep', { pattern: 'test3' });

      const result = detector.detectLoop();
      
      expect(result.isLooping).toBe(false);
    });
  });

  describe('No Progress Detection', () => {
    it('should detect read-only loop', () => {
      // 多次读取相同文件但没有写操作
      detector.recordToolCall('read', { path: 'src/main.ts' });
      detector.recordToolCall('read', { path: 'src/main.ts' });
      detector.recordToolCall('read', { path: 'src/main.ts' });

      const result = detector.detectLoop();
      
      expect(result.isLooping).toBe(true);
      expect(result.type).toBe('exact_repeat');
    });

    it('should reset after write operation', () => {
      // 读取几次 (threshold=2, so 2 is enough to trigger)
      detector.recordToolCall('read', { path: 'src/main.ts' });
      
      // 执行写操作 - 这会清空读取历史
      detector.recordToolCall('write', { path: 'src/main.ts', content: 'new' });
      
      // 再读取几次
      detector.recordToolCall('read', { path: 'src/main.ts' });
      detector.recordToolCall('read', { path: 'src/main.ts' });

      const result = detector.detectLoop();
      
      // 虽然有写操作，但之后又有2次读取相同文件，应该触发
      expect(result.isLooping).toBe(true);
    });
  });

  describe('Intervention Message', () => {
    it('should provide suggestion for exact repeat', () => {
      detector.recordToolCall('read', { path: 'src/test.ts' });
      detector.recordToolCall('read', { path: 'src/test.ts' });
      detector.recordToolCall('read', { path: 'src/test.ts' });

      const message = detector.getInterventionMessage();
      
      expect(message).toContain('检测到重复操作警告');
      expect(message).toContain('read');
    });

    it('should return null when no loop detected', () => {
      detector.recordToolCall('read', { path: 'src/test.ts' });

      const message = detector.getInterventionMessage();
      
      expect(message).toBeNull();
    });
  });

  describe('Force Break', () => {
    it('should not force break by default', () => {
      // 大量重复
      for (let i = 0; i < 5; i++) {
        detector.recordToolCall('read', { path: 'src/test.ts' });
      }

      const result = detector.detectLoop();
      
      // 默认不强制中断
      expect(result.shouldForceBreak).toBe(false);
    });

    it('should force break when enabled and threshold exceeded', () => {
      const strictDetector = new LoopDetector({
        enableForceBreak: true,
        exactRepeatThreshold: 2,
      });

      // 超过 threshold + 2
      for (let i = 0; i < 4; i++) {
        strictDetector.recordToolCall('read', { path: 'src/test.ts' });
      }

      const result = strictDetector.detectLoop();
      
      expect(result.shouldForceBreak).toBe(true);
    });
  });

  describe('Stats', () => {
    it('should track call statistics', () => {
      detector.recordToolCall('read', { path: 'src/a.ts' });
      detector.recordToolCall('read', { path: 'src/b.ts' });
      detector.recordToolCall('write', { path: 'src/c.ts' });

      const stats = detector.getStats();
      
      expect(stats.totalCalls).toBe(3);
      expect(stats.recentReads).toBe(2);
      expect(stats.recentWrites).toBe(1);
      expect(stats.loopDetected).toBe(false);
    });
  });

  describe('Reset', () => {
    it('should clear all state on reset', () => {
      detector.recordToolCall('read', { path: 'src/test.ts' });
      detector.recordToolCall('read', { path: 'src/test.ts' });
      detector.recordToolCall('read', { path: 'src/test.ts' });

      expect(detector.detectLoop().isLooping).toBe(true);

      detector.reset();

      expect(detector.detectLoop().isLooping).toBe(false);
      expect(detector.getStats().totalCalls).toBe(0);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle the "let me check this file" loop scenario', () => {
      // 模拟用户描述的场景：反复读取同一个文件
      const toolResults = [
        { content: 'export const foo = 1;' },
        { content: 'export const foo = 1;' },
        { content: 'export const foo = 1;' },
      ];

      // 模拟 agent 连续读取相同文件
      detector.recordToolCall('read', { path: '.starup/SOUL.md' }, toolResults[0]);
      
      // 中间穿插一些思考（如 grep 搜索）
      detector.recordToolCall('grep', { pattern: '人格' });
      
      // 又回到读取相同文件
      detector.recordToolCall('read', { path: '.starup/SOUL.md' }, toolResults[1]);
      detector.recordToolCall('read', { path: '.starup/SOUL.md' }, toolResults[2]);

      const result = detector.detectLoop();
      
      // 应该检测到重复
      expect(result.isLooping).toBe(true);
      expect(result.type).toBe('exact_repeat');
      expect(result.suggestion).toContain('重复');
    });

    it('should allow valid iterative editing', () => {
      // 正常的迭代编辑流程应该不被误判
      detector.recordToolCall('read', { path: 'src/app.ts' });
      detector.recordToolCall('edit', { path: 'src/app.ts', old: 'foo', new: 'bar' });
      detector.recordToolCall('read', { path: 'src/app.ts' });
      detector.recordToolCall('edit', { path: 'src/app.ts', old: 'baz', new: 'qux' });
      
      // 只有1次读取在编辑之间，不应该触发
      const result = detector.detectLoop();
      
      // 编辑操作清空了读取历史，所以不会触发循环检测
      expect(result.isLooping).toBe(false);
    });
  });
});
