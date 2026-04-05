# 循环检测与防止系统

## 问题背景

Agent 在执行任务时偶尔会陷入死循环，例如：
- 反复读取同一个文件
- 不断重复相同的查询操作
- 在"获取信息"阶段无限循环，从不进入"执行"阶段

典型表现：Agent 连续说"太好了！让我看看这个文件写了什么"，然后重复调用 `read` 工具读取同一文件。

## 解决方案

实现了 `LoopDetector` 循环检测器，在不干扰正常探索的前提下，智能识别并打破死循环。

## 核心机制

### 1. 三种循环检测模式

#### 完全重复检测 (Exact Repeat)
- **触发条件**：使用完全相同的参数调用同一工具 ≥2 次
- **场景**：反复读取同一文件、重复执行相同命令
- **干预方式**：提醒 LLM 查看已获取的结果

#### 相似模式检测 (Similar Pattern)
- **触发条件**：短时间内频繁使用同一类工具（如连续 grep 4次以上）
- **场景**：过度探索、信息收集癖
- **干预方式**：提醒评估是否已获得足够信息

#### 无进展检测 (No Progress)
- **触发条件**：反复读取文件但没有任何修改/写入操作
- **场景**："分析瘫痪"，只看不行动
- **干预方式**：鼓励基于已有信息行动或向用户求助

### 2. 进展追踪

系统会追踪"进展操作"（写文件、执行命令等），当检测到进展时会重置读取历史：

```
read → read → read     [触发循环警告]
read → write → read    [不触发，因为有进展]
```

### 3. 智能干预

当检测到循环时，系统会向 LLM 发送系统消息：

```
⚠️ **检测到重复操作警告** ⚠️

你刚刚已经连续 3 次使用相同的参数调用了 read 工具。

**可能的原因**：
1. 你可能忘记了已经获取过这些信息
2. 工具返回的结果可能不够清晰
3. 你可能陷入了"再确认一次"的循环

**建议**：
- 查看历史消息中该工具返回的结果
- 如果信息已获取，请基于已有信息继续下一步
...
```

这种干预方式：
- ✅ 不打断对话流程
- ✅ 给 LLM 自我纠正的机会
- ✅ 提供具体的解决建议
- ✅ 保留上下文连续性

## 配置选项

```typescript
interface LoopDetectorConfig {
  /** 完全相同的工具调用，超过此次数视为循环 (默认: 2) */
  exactRepeatThreshold: number;
  
  /** 相似调用（同工具不同参数）的阈值 (默认: 4) */
  similarPatternThreshold: number;
  
  /** 检查窗口大小（最近N次调用） (默认: 10) */
  windowSize: number;
  
  /** 无进展检测：读取相同文件后没有后续修改的最大次数 (默认: 3) */
  readWithoutActionThreshold: number;
  
  /** 是否启用强制中断 (默认: false) */
  enableForceBreak: boolean;
}
```

## 使用方式

### 在 StarUpCore 中

循环检测器已自动集成到 `processMessage` 流程中，无需额外配置：

```typescript
// 每次工具调用后自动记录
loopDetector.recordToolCall(toolName, toolArgs, result);

// 自动检测循环
const loopResult = loopDetector.detectLoop();
if (loopResult.isLooping) {
  // 添加提醒消息到对话
  sessionManager.addMessage(sessionId, {
    role: 'system',
    content: loopResult.suggestion,
  });
}
```

### 手动使用

```typescript
import { LoopDetector } from './core/resilience/LoopDetector';

const detector = new LoopDetector({
  exactRepeatThreshold: 3,
  enableForceBreak: true,
});

// 记录工具调用
detector.recordToolCall('read', { path: 'file.ts' }, result);

// 检查是否陷入循环
const result = detector.detectLoop();
if (result.isLooping) {
  console.log(`循环类型: ${result.type}`);
  console.log(`建议: ${result.suggestion}`);
}
```

## 检测示例

### 示例 1：读取死循环

```
AI: 让我看看这个文件写了什么
→ read("src/config.ts") 
[返回文件内容]

AI: 好的，让我再确认一下
→ read("src/config.ts")  // 第2次，相同参数
[返回相同内容]

AI: 我再看看...
→ read("src/config.ts")  // 第3次，触发警告！

[系统消息] ⚠️ 检测到重复操作警告...
```

### 示例 2：正常探索（不被误判）

```
AI: 先查看配置文件
→ read("src/config.ts")

AI: 再查看主文件
→ read("src/main.ts")

AI: 修改配置
→ edit("src/config.ts", ...)

AI: 验证修改
→ read("src/config.ts")  // 读取相同文件，但有编辑操作，不触发警告
```

## 为什么这样设计？

### 1. 不影响正常探索
- 合理的重复（如多次编辑同一文件）不会被误判
- 参数不同的相似调用有一定容忍度
- 进展操作会重置检测状态

### 2. 智能而非强制
- 默认只提醒，不强制中断
- 给 LLM 自我纠正的机会
- 保持对话流畅性

### 3. 自适应阈值
- 读取类工具阈值较高（允许充分探索）
- 写入类工具进展会清空历史
- 可根据任务复杂度调整配置

## 监控与调试

### 查看检测统计

```typescript
const stats = detector.getStats();
console.log(stats);
// {
//   totalCalls: 15,
//   recentReads: 8,
//   recentWrites: 2,
//   loopDetected: false
// }
```

### 日志输出

当检测到循环时，系统会输出警告日志：

```
[2026-04-05 18:26:08] [WARN] [LoopDetector] 
  Exact repeat detected: read called 3 times with same args

[2026-04-05 18:26:08] [WARN] [StarUpCore] 
  Loop detected in session xxx: exact_repeat, count: 3
```

## 未来扩展

1. **语义去重**：基于工具结果的相似度（而非参数）检测重复
2. **自适应阈值**：根据任务类型自动调整检测敏感度
3. **循环预测**：在循环形成前预警（如"您正在频繁使用 grep"）
4. **用户干预**：提供 UI 选项让用户确认是否继续
