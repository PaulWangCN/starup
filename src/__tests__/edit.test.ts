/**
 * Edit 工具测试
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createEditTool } from '../core/tools/definitions/edit';
import { Session } from '../types';

describe('Edit Tool', () => {
  const testDir = path.join(process.cwd(), '.starup', 'test-edit');
  const tool = createEditTool(testDir);
  const mockSession = { id: 'test-session' } as Session;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('单编辑模式（向后兼容）', () => {
    it('应该支持单次替换', async () => {
      const testFile = path.join(testDir, 'test1.txt');
      await fs.writeFile(testFile, 'hello world', 'utf-8');

      const result = await tool.handler({
        path: 'test1.txt',
        old: 'world',
        new: 'universe',
      }, mockSession);

      expect(result.success).toBe(true);
      expect(result.data?.totalReplacements).toBe(1);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('hello universe');
    });

    it('应该支持 replace_all 替换所有匹配', async () => {
      const testFile = path.join(testDir, 'test2.txt');
      await fs.writeFile(testFile, 'foo bar foo baz foo', 'utf-8');

      const result = await tool.handler({
        path: 'test2.txt',
        old: 'foo',
        new: 'FOO',
        replace_all: true,
      }, mockSession);

      expect(result.success).toBe(true);
      expect(result.data?.totalReplacements).toBe(3);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('FOO bar FOO baz FOO');
    });

    it('当旧文本不存在时应该返回错误', async () => {
      const testFile = path.join(testDir, 'test3.txt');
      await fs.writeFile(testFile, 'hello world', 'utf-8');

      const result = await tool.handler({
        path: 'test3.txt',
        old: 'nonexistent',
        new: 'replacement',
      }, mockSession);

      expect(result.success).toBe(false);
      expect(result.error).toContain('未找到');
    });
  });

  describe('批量编辑模式', () => {
    it('应该支持批量多编辑', async () => {
      const testFile = path.join(testDir, 'test4.txt');
      await fs.writeFile(testFile, 'aaa bbb ccc', 'utf-8');

      const result = await tool.handler({
        path: 'test4.txt',
        edit: [
          { old: 'aaa', new: 'AAA' },
          { old: 'bbb', new: 'BBB' },
          { old: 'ccc', new: 'CCC' },
        ],
      }, mockSession);

      expect(result.success).toBe(true);
      expect(result.data?.totalEdits).toBe(3);
      expect(result.data?.totalReplacements).toBe(3);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('AAA BBB CCC');
    });

    it('批量编辑应该支持 replace_all', async () => {
      const testFile = path.join(testDir, 'test5.txt');
      await fs.writeFile(testFile, 'x y x z x', 'utf-8');

      const result = await tool.handler({
        path: 'test5.txt',
        edit: [
          { old: 'x', new: 'X', replace_all: true },
          { old: 'y', new: 'Y' },
        ],
      }, mockSession);

      expect(result.success).toBe(true);
      expect(result.data?.totalReplacements).toBe(4); // 3个x + 1个y

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('X Y X z X');
    });

    it('批量编辑中任一编辑项未找到时应该返回错误', async () => {
      const testFile = path.join(testDir, 'test6.txt');
      await fs.writeFile(testFile, 'hello world', 'utf-8');

      const result = await tool.handler({
        path: 'test6.txt',
        edit: [
          { old: 'hello', new: 'HELLO' },
          { old: 'nonexistent', new: 'REPLACEMENT' },
        ],
      }, mockSession);

      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent');
      // 文件应该保持不变
      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('hello world');
    });

    it('应该处理多行编辑', async () => {
      const testFile = path.join(testDir, 'test7.txt');
      await fs.writeFile(testFile, 'line1\nline2\nline3', 'utf-8');

      const result = await tool.handler({
        path: 'test7.txt',
        edit: [
          { old: 'line1', new: 'LINE_ONE' },
          { old: 'line2\nline3', new: 'LINES_TWO_AND_THREE' },
        ],
      }, mockSession);

      expect(result.success).toBe(true);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('LINE_ONE\nLINES_TWO_AND_THREE');
    });
  });

  describe('路径安全检查', () => {
    it('应该拒绝超出工作目录的路径', async () => {
      const result = await tool.handler({
        path: '../../../etc/passwd',
        old: 'root',
        new: 'admin',
      }, mockSession);

      expect(result.success).toBe(false);
      expect(result.error).toContain('访问被拒绝');
    });
  });
});
