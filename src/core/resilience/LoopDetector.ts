/**
 * 循环检测与防止系统
 * 
 * 核心功能：
 * 1. 检测重复的工具调用（相同工具+相同参数）
 * 2. 检测无进展循环（读取相同文件但没有新动作）
 * 3. 智能干预（提醒 LLM 避免重复）
 * 4. 自适应限制（根据任务复杂度动态调整）
 * 
 * 设计原则：
 * - 不影响正常探索：允许合理的重复（如多次编辑同一文件）
 * - 精准识别死循环：基于调用签名和结果进展
 * - 优雅干预：通过系统消息提醒而非强制中断
 */

import { logger } from '../../utils/Logger';

/** 工具调用记录 */
interface ToolCallRecord {
  id: string;
  toolName: string;
  args: any;
  argsHash: string;
  timestamp: number;
  result?: any;
  resultHash?: string;
}

/** 循环检测结果 */
export interface LoopDetectionResult {
  /** 是否检测到循环 */
  isLooping: boolean;
  /** 循环类型 */
  type: 'exact_repeat' | 'similar_pattern' | 'no_progress' | 'none';
  /** 重复次数 */
  repeatCount: number;
  /** 相关调用记录 */
  relatedCalls: ToolCallRecord[];
  /** 建议的系统提示 */
  suggestion?: string;
  /** 是否需要强制中断 */
  shouldForceBreak: boolean;
}

/** 检测配置 */
export interface LoopDetectorConfig {
  /** 完全相同的工具调用，超过此次数视为循环 */
  exactRepeatThreshold: number;
  /** 相似调用（同工具不同参数）的阈值 */
  similarPatternThreshold: number;
  /** 检查窗口大小（最近N次调用） */
  windowSize: number;
  /** 无进展检测：读取相同文件后没有后续修改的最大次数 */
  readWithoutActionThreshold: number;
  /** 是否启用强制中断 */
  enableForceBreak: boolean;
}

/** 默认配置 */
const DEFAULT_CONFIG: LoopDetectorConfig = {
  exactRepeatThreshold: 2,      // 完全相同的调用超过2次就警告
  similarPatternThreshold: 4,   // 相似调用超过4次警告
  windowSize: 10,               // 检查最近10次调用
  readWithoutActionThreshold: 3, // 读3次不行动就提醒
  enableForceBreak: false,      // 默认不强制中断，只提醒
};

/**
 * 循环检测器
 */
export class LoopDetector {
  private config: LoopDetectorConfig;
  private callHistory: ToolCallRecord[] = [];
  private readFileHistory: Map<string, number> = new Map(); // 文件路径 -> 读取次数
  private lastActionTimestamp: number = Date.now();
  
  // 用于检测进展的工具类型
  private readonly PROGRESS_TOOLS = new Set([
    'write', 'edit', 'StrReplaceFile', 'WriteFile', 'exec', 'Shell'
  ]);
  
  // 纯读取类工具
  private readonly READ_TOOLS = new Set([
    'read', 'ReadFile', 'grep', 'Grep', 'glob', 'Glob', 'fetch', 'FetchURL'
  ]);

  constructor(config?: Partial<LoopDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 记录一次工具调用
   */
  recordToolCall(toolName: string, args: any, result?: any): void {
    const argsHash = this.hashObject(args);
    const resultHash = result ? this.hashObject(result) : undefined;
    
    const record: ToolCallRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      toolName,
      args,
      argsHash,
      timestamp: Date.now(),
      result,
      resultHash,
    };

    this.callHistory.push(record);
    
    // 维护窗口大小
    if (this.callHistory.length > this.config.windowSize * 2) {
      this.callHistory = this.callHistory.slice(-this.config.windowSize);
    }

    // 追踪读取操作
    if (this.READ_TOOLS.has(toolName)) {
      const filePath = this.extractFilePath(args);
      if (filePath) {
        const count = this.readFileHistory.get(filePath) || 0;
        this.readFileHistory.set(filePath, count + 1);
      }
    }

    // 追踪进展操作
    if (this.PROGRESS_TOOLS.has(toolName)) {
      this.lastActionTimestamp = Date.now();
      // 有进展时清空读取历史
      this.readFileHistory.clear();
    }

    logger.debug('LoopDetector', 
      `Recorded ${toolName} call, history size: ${this.callHistory.length}`
    );
  }

  /**
   * 检测是否陷入循环
   */
  detectLoop(): LoopDetectionResult {
    if (this.callHistory.length < 2) {
      return {
        isLooping: false,
        type: 'none',
        repeatCount: 0,
        relatedCalls: [],
        shouldForceBreak: false,
      };
    }

    const window = this.callHistory.slice(-this.config.windowSize);

    // 检测1：完全相同的调用重复
    const exactRepeatResult = this.detectExactRepeat(window);
    if (exactRepeatResult.isLooping) {
      return exactRepeatResult;
    }

    // 检测2：相似模式（相同工具，相似参数）
    const similarResult = this.detectSimilarPattern(window);
    if (similarResult.isLooping) {
      return similarResult;
    }

    // 检测3：只读不写（查询死循环）
    const noProgressResult = this.detectNoProgress(window);
    if (noProgressResult.isLooping) {
      return noProgressResult;
    }

    return {
      isLooping: false,
      type: 'none',
      repeatCount: 0,
      relatedCalls: [],
      shouldForceBreak: false,
    };
  }

  /**
   * 检测完全相同的调用重复
   */
  private detectExactRepeat(window: ToolCallRecord[]): LoopDetectionResult {
    const recent = window.slice(-5); // 只看最近5次
    const signatureCount = new Map<string, number>();
    const signatureCalls = new Map<string, ToolCallRecord[]>();

    for (const call of recent) {
      const signature = `${call.toolName}:${call.argsHash}`;
      signatureCount.set(signature, (signatureCount.get(signature) || 0) + 1);
      
      if (!signatureCalls.has(signature)) {
        signatureCalls.set(signature, []);
      }
      signatureCalls.get(signature)!.push(call);
    }

    for (const [signature, count] of signatureCount.entries()) {
      if (count >= this.config.exactRepeatThreshold) {
        const calls = signatureCalls.get(signature) || [];
        const toolName = calls[0]?.toolName || 'unknown';
        
        // 对于读取操作，更宽容一些
        if (this.READ_TOOLS.has(toolName) && count < this.config.exactRepeatThreshold + 1) {
          continue;
        }

        logger.warn('LoopDetector', 
          `Exact repeat detected: ${toolName} called ${count} times with same args`
        );

        return {
          isLooping: true,
          type: 'exact_repeat',
          repeatCount: count,
          relatedCalls: calls,
          suggestion: this.buildSuggestion('exact_repeat', toolName, count),
          shouldForceBreak: this.config.enableForceBreak && count >= this.config.exactRepeatThreshold + 2,
        };
      }
    }

    return { isLooping: false, type: 'none', repeatCount: 0, relatedCalls: [], shouldForceBreak: false };
  }

  /**
   * 检测相似模式（相同工具，可能是不同但相似的参数）
   */
  private detectSimilarPattern(window: ToolCallRecord[]): LoopDetectionResult {
    const toolCount = new Map<string, number>();
    const toolCalls = new Map<string, ToolCallRecord[]>();

    for (const call of window) {
      toolCount.set(call.toolName, (toolCount.get(call.toolName) || 0) + 1);
      
      if (!toolCalls.has(call.toolName)) {
        toolCalls.set(call.toolName, []);
      }
      toolCalls.get(call.toolName)!.push(call);
    }

    for (const [toolName, count] of toolCount.entries()) {
      // 对于 grep/read 工具，多次调用是正常的探索行为
      if (this.READ_TOOLS.has(toolName) && count <= this.config.similarPatternThreshold) {
        continue;
      }

      if (count >= this.config.similarPatternThreshold) {
        logger.warn('LoopDetector', 
          `Similar pattern detected: ${toolName} called ${count} times in window`
        );

        return {
          isLooping: true,
          type: 'similar_pattern',
          repeatCount: count,
          relatedCalls: toolCalls.get(toolName) || [],
          suggestion: this.buildSuggestion('similar_pattern', toolName, count),
          shouldForceBreak: false, // 相似模式不强制中断
        };
      }
    }

    return { isLooping: false, type: 'none', repeatCount: 0, relatedCalls: [], shouldForceBreak: false };
  }

  /**
   * 检测无进展（只读不写）
   */
  private detectNoProgress(window: ToolCallRecord[]): LoopDetectionResult {
    // 检查是否一直在读取相同文件
    const maxReadCount = Math.max(...this.readFileHistory.values(), 0);
    
    if (maxReadCount >= this.config.readWithoutActionThreshold) {
      const mostReadFile = Array.from(this.readFileHistory.entries())
        .sort((a, b) => b[1] - a[1])[0];
      
      if (mostReadFile) {
        const [filePath, count] = mostReadFile;
        logger.warn('LoopDetector', 
          `No progress detected: ${filePath} read ${count} times without action`
        );

        return {
          isLooping: true,
          type: 'no_progress',
          repeatCount: count,
          relatedCalls: window.filter(c => this.extractFilePath(c.args) === filePath),
          suggestion: this.buildSuggestion('no_progress', 'read', count, filePath),
          shouldForceBreak: false,
        };
      }
    }

    return { isLooping: false, type: 'none', repeatCount: 0, relatedCalls: [], shouldForceBreak: false };
  }

  /**
   * 构建建议消息
   */
  private buildSuggestion(
    type: LoopDetectionResult['type'], 
    toolName: string, 
    count: number,
    extraInfo?: string
  ): string {
    const suggestions: Record<string, string> = {
      exact_repeat: `
⚠️ **检测到重复操作警告** ⚠️

你刚刚已经连续 ${count} 次使用相同的参数调用了 ${toolName} 工具。

**可能的原因**：
1. 你可能忘记了已经获取过这些信息
2. 工具返回的结果可能不够清晰
3. 你可能陷入了"再确认一次"的循环

**建议**：
- 查看历史消息中该工具返回的结果
- 如果信息已获取，请基于已有信息继续下一步
- 如果需要不同信息，请修改查询参数
- 如果卡住了，直接告诉用户当前进展和遇到的困难

**记住**：重复读取相同信息不会获得新内容。
`,
      similar_pattern: `
⚠️ **操作模式警告** ⚠️

你最近频繁使用 ${toolName} 工具（${count} 次）。

**可能的情况**：
1. 正在进行合理的深度探索 ✓
2. 可能在原地打转，没有实质进展 ⚠️

**自检问题**：
- 每次调用是否获得了新信息？
- 是否已经足够了解，可以开始行动了？
- 是否在拖延/回避做决策？

如果已经收集足够信息，请开始执行或总结当前发现。
`,
      no_progress: `
⚠️ **进展停滞警告** ⚠️

你已经在 ${extraInfo || '相同文件'} 上进行了 ${count} 次读取操作，但没有后续行动。

**可能的原因**：
1. 不知道该做什么 → 请向用户说明情况并寻求指导
2. 害怕做错 → 明确告知用户你的计划，请求确认
3. 信息不足 → 说明还需要什么信息，而不是重复读取

**建议行动**：
- 基于已有信息做出最佳判断并执行
- 或明确告知用户："我已了解X，计划做Y，请确认"
- 不要反复读取相同内容期待新信息出现

**行动胜于完美**。
`,
    };

    return suggestions[type] || '';
  }

  /**
   * 获取干预消息（如果检测到循环）
   */
  getInterventionMessage(): string | null {
    const result = this.detectLoop();
    if (result.isLooping && result.suggestion) {
      return result.suggestion;
    }
    return null;
  }

  /**
   * 检查是否应该强制中断
   */
  shouldForceBreak(): boolean {
    const result = this.detectLoop();
    return result.shouldForceBreak;
  }

  /**
   * 获取检测统计
   */
  getStats(): {
    totalCalls: number;
    recentReads: number;
    recentWrites: number;
    loopDetected: boolean;
  } {
    const recent = this.callHistory.slice(-this.config.windowSize);
    return {
      totalCalls: this.callHistory.length,
      recentReads: recent.filter(c => this.READ_TOOLS.has(c.toolName)).length,
      recentWrites: recent.filter(c => this.PROGRESS_TOOLS.has(c.toolName)).length,
      loopDetected: this.detectLoop().isLooping,
    };
  }

  /**
   * 重置检测器状态
   */
  reset(): void {
    this.callHistory = [];
    this.readFileHistory.clear();
    this.lastActionTimestamp = Date.now();
    logger.debug('LoopDetector', 'State reset');
  }

  // ============ 私有工具方法 ============

  /**
   * 对象哈希（简单实现）
   */
  private hashObject(obj: any): string {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (typeof obj !== 'object') return String(obj);
    
    try {
      // 排序键后序列化，确保相同对象产生相同哈希
      const sorted = this.sortKeys(obj);
      return JSON.stringify(sorted);
    } catch {
      return String(obj);
    }
  }

  /**
   * 递归排序对象键
   */
  private sortKeys(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sortKeys(item));
    }
    
    const sorted: any = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      sorted[key] = this.sortKeys(obj[key]);
    }
    return sorted;
  }

  /**
   * 从参数中提取文件路径
   */
  private extractFilePath(args: any): string | null {
    if (!args || typeof args !== 'object') return null;
    
    // 常见的文件路径参数名
    const pathKeys = ['path', 'file', 'filePath', 'filepath', 'filename'];
    
    for (const key of pathKeys) {
      if (typeof args[key] === 'string') {
        return args[key];
      }
    }
    
    // 如果参数本身是一个字符串路径
    if (typeof args === 'string' && args.length < 500) {
      return args;
    }
    
    return null;
  }
}

// 单例导出
export const loopDetector = new LoopDetector();
