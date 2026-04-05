# StarUp 项目增强设计文档
## 目标：打造超越 OpenClaw 和 Claude Code 的编程怪物 Agent

---

## 一、研究总结

### 1.1 当前项目状态 (StarUp)
- **优势**: ReAct架构、Agent Team动态编排、三层记忆系统、多通道集成、KAIROS始终在线
- **不足**: 工具调用串行、缺少AST级代码编辑、无LSP集成、缺少代码重构工具

### 1.2 OpenClaw 关键功能
- 本地优先执行，50+平台集成
- 完整系统访问（文件、shell、浏览器）
- Heartbeat主动调度
- Subagent编排
- ClawHub Skills市场

### 1.3 Claude Code 泄漏代码关键发现
- **40+ 工具**的插件架构
- **Coordinator Mode**多agent编排
- **三层记忆架构**（MEMORY.md索引 + topic文件）
- **KAIROS**自主守护进程 + autoDream
- **50+ slash命令**
- **LSP集成**（语言服务器协议）
- **权限系统**（default/bypass/strict）
- **上下文压缩策略**

### 1.4 其他热门项目最佳实践
- **OpenCode**: 75+ LLM提供商、LSP集成、双agent模式（build/plan）
- **Aider**: Git-native、自动commit、repo map
- **CrewAI**: 角色定义、任务流程
- **LangGraph**: 图状态机、复杂工作流

---

## 二、增强架构设计

### 2.1 核心增强模块

```
┌─────────────────────────────────────────────────────────────────┐
│                     增强架构总览                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Agent Core   │  │ Programming  │  │ Tool System  │          │
│  │  Enhance     │  │  Enhance     │  │  Enhance     │          │
│  │              │  │              │  │              │          │
│  │ • 并行工具    │  │ • AST编辑    │  │ • 40+工具    │          │
│  │ • Subagent   │  │ • LSP集成    │  │ • 权限系统    │          │
│  │ • Plan/Act   │  │ • 代码重构    │  │ • 上下文压缩  │          │
│  │ • 协调器     │  │ • 测试生成    │  │ • 技能系统    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                  │
│         └─────────────────┼─────────────────┘                  │
│                           │                                    │
│  ┌────────────────────────┼────────────────────────┐          │
│  │              Enhanced Memory System               │          │
│  │                                                   │          │
│  │  • MEMORY.md 索引层                              │          │
│  │  • Topic Files 知识层                            │          │
│  │  • Raw Transcripts 原始层                        │          │
│  │  • autoDream 记忆整合                            │          │
│  └───────────────────────────────────────────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 实施优先级

| 优先级 | 模块 | 功能 | 价值/复杂度 |
|--------|------|------|------------|
| P0 | 工具系统 | 并行工具调用 | 高/中 |
| P0 | 编程能力 | AST级代码编辑 | 高/高 |
| P0 | Agent系统 | Subagent编排 | 高/高 |
| P1 | 编程能力 | LSP集成 | 高/中 |
| P1 | 工具系统 | 权限系统 | 高/低 |
| P1 | 记忆系统 | autoDream | 中/中 |
| P2 | 编程能力 | 代码重构 | 中/高 |
| P2 | 编程能力 | 测试生成 | 中/中 |

---

## 三、详细设计

### 3.1 并行工具调用 (P0)

**问题**: 当前工具调用是串行的，效率低下
**方案**: 实现真正的并行工具调用，支持工具依赖图

```typescript
interface ParallelToolCall {
  id: string;
  tool: string;
  params: any;
  dependencies: string[]; // 依赖的其他工具调用ID
  timeout: number;
}

interface ToolExecutionGraph {
  nodes: ParallelToolCall[];
  edges: { from: string; to: string }[];
}
```

### 3.2 AST级代码编辑 (P0)

**问题**: 当前edit工具使用字符串替换，容易出错
**方案**: 集成tree-sitter，实现AST级别的精确编辑

```typescript
interface ASTEditTool {
  // 基于AST节点的编辑
  findAndReplace(options: {
    language: string;
    selector: string; // AST选择器，如 "function[name='foo']"
    transform: (node: ASTNode) => ASTNode;
  });
  
  // 重构操作
  refactor(options: {
    type: 'extract_method' | 'rename_symbol' | 'inline_variable';
    target: ASTNode;
    params: any;
  });
}
```

### 3.3 Subagent编排 (P0)

**参考**: Claude Code的Coordinator Mode

```typescript
interface SubagentOrchestrator {
  // 创建子agent
  spawnSubagent(config: {
    role: string;
    tools: string[];
    memory: boolean;
    timeout: number;
  }): Subagent;
  
  // 委派任务
  delegateTask(subagent: Subagent, task: Task): Promise<Result>;
  
  // 并行执行
  parallelExecute(tasks: Task[], subagents: Subagent[]): Promise<Results>;
  
  // 结果合并
  mergeResults(results: Results[]): Result;
}
```

### 3.4 LSP集成 (P1)

**参考**: OpenCode的LSP集成

```typescript
interface LSPS Integration {
  // 自动检测和启动语言服务器
  autoDetectLanguageServers(): LanguageServer[];
  
  // 语义工具
  goToDefinition(file: string, position: Position): Location;
  findReferences(file: string, position: Position): Location[];
  getDiagnostics(file: string): Diagnostic[];
  hover(file: string, position: Position): HoverInfo;
  
  // 代码补全
  getCompletions(file: string, position: Position): CompletionItem[];
}
```

### 3.5 权限系统 (P1)

**参考**: Claude Code的三级权限系统

```typescript
type PermissionMode = 'default' | 'bypass' | 'strict';

interface PermissionSystem {
  mode: PermissionMode;
  
  // 工具级权限
  toolPermissions: Map<string, PermissionLevel>;
  
  // 命令级权限
  commandPermissions: Map<string, PermissionLevel>;
  
  // 路径级权限
  pathPermissions: Map<string, PermissionLevel>;
  
  // 检查权限
  checkPermission(action: Action): boolean | 'ask';
}
```

### 3.6 autoDream记忆整合 (P1)

**参考**: Claude Code的autoDream

```typescript
interface AutoDream {
  // 后台记忆整合
  consolidateMemory(): void;
  
  // 合并观察
  mergeObservations(observations: Observation[]): ConsolidatedMemory;
  
  // 消除矛盾
  resolveContradictions(memories: Memory[]): Memory[];
  
  // 转换为绝对事实
  convertToFacts(insights: Insight[]): Fact[];
}
```

---

## 四、实施计划

### Phase 1: 核心基础设施 (P0)
1. 并行工具调用系统
2. AST编辑工具集成
3. Subagent编排框架

### Phase 2: 编程能力增强 (P1)
1. LSP集成
2. 代码重构工具
3. 测试生成工具

### Phase 3: 系统优化 (P2)
1. 权限系统
2. autoDream记忆整合
3. 性能优化

---

## 五、成功指标

1. **效率指标**: 工具调用延迟降低50%
2. **准确性指标**: 代码编辑准确率提升至95%
3. **覆盖率指标**: 支持40+工具
4. **用户体验**: 支持并行任务，减少等待时间
