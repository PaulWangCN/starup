# Prompt 分层系统

StarUp v1.1 引入了六层 Prompt 架构，实现从"功能可用"到"智能可调度"的跃迁。

## 六层架构概览

```
┌─────────────────────────────────────────┐
│  L6 运行时上下文 (Runtime Context)      │  ← 每次请求动态生成
├─────────────────────────────────────────┤
│  L5 技能清单 (Skills)                   │  ← Skill变更时更新
├─────────────────────────────────────────┤
│  L4 工具定义 (Tools)                    │  ← Skill重载时更新
├─────────────────────────────────────────┤
│  L3 用户画像 (User Profile)             │  ← 实时更新
├─────────────────────────────────────────┤
│  L2 身份标识 (Identity)                 │  ← 实时更新
├─────────────────────────────────────────┤
│  L1 基础身份 (SOUL)                     │  ← 需重启生效
└─────────────────────────────────────────┘
```

## 各层详解

### L1: 基础身份 (SOUL.md)

**用途**: 定义 AI 的核心人格、价值观和行为准则

**文件位置**: `./.starup/agents/{agent_id}/SOUL.md`

**更新策略**: 只读，修改后需重启生效

**内容示例**:
```markdown
# Agent Soul

## 核心人格
你是 StarUp，一个高效、专业但友善的 AI 助手。你倾向于：
- 直接给出答案，避免过度寒暄
- 主动使用工具完成任务而非仅提供建议
- 在不确定时询问澄清而非猜测

## 行为边界
- 绝不执行删除系统文件、网络扫描等危险操作
- 涉及隐私数据时先询问用户确认
- 保持中立，不参与政治立场争论

## 语言风格
简洁技术型，适当使用 Markdown 格式增强可读性
```

---

### L2: 身份标识 (IDENTITY.md)

**用途**: 定义 AI 的名称、表情符号、版本等标识信息

**文件位置**: `./.starup/agents/{agent_id}/IDENTITY.md`

**更新策略**: 支持热更新，可实时修改

**内容示例**:
```markdown
---
name: "StarUp"
emoji: "🌟"
version: "1.1.0"
greeting_style: "adaptive"  # adaptive/time_based/fixed
---

## 身份说明
- **名称**: StarUp
- **定位**: AI 运行时助手
- **版本**: v1.1.0

## 性格特点
- 友好且专业
- 注重效率
- 持续学习和进化
```

---

### L3: 用户画像 (USER.md)

**用途**: 存储用户偏好、历史记忆摘要

**文件位置**: `./.starup/agents/{agent_id}/USER.md`

**更新策略**: 实时更新，可运行时修改

**内容示例**:
```markdown
---
user_id: "user_123"
last_updated: "2026-04-01T10:00:00Z"
---

## 用户偏好
- **语言**: 中文
- **代码风格**: Python, TypeScript
- **回复长度**: 详细（带示例）
- **技术背景**: 软件工程师

## 历史摘要
- 经常使用代码生成和审查功能
- 偏好简洁的技术解释
- 关注 AI 和机器学习话题

## 近期话题
- 正在学习 Agent 架构
- 在开发一个对话系统
```

---

### L4: 工具定义 (TOOLS)

**用途**: 当前可用的工具 JSON Schema 定义

**来源**: 从 ToolRegistry 动态生成

**更新策略**: Skill 重载时更新

**生成格式**:
```markdown
# 可用工具列表

你可以使用以下工具来帮助用户完成任务：

## 1. read
描述: 读取文本文件或图片文件内容
参数:
```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string", "description": "文件路径" },
    "offset": { "type": "number", "description": "起始行号" },
    "limit": { "type": "number", "description": "读取行数" }
  },
  "required": ["path"]
}
```

## 2. write
描述: 创建或覆盖写入文件
...
```

---

### L5: 技能清单 (SKILLS)

**用途**: 当前加载的 Skill 目录与触发条件

**来源**: 从 SkillRegistry 动态生成

**更新策略**: Skill 变更时更新

**生成格式**:
```markdown
# 已加载技能

当前系统已加载 3 个技能：

## 1. weather
描述: 查询全球任意城市的实时天气和未来预报
版本: 1.0.0

## 2. code-review
描述: 审查代码质量，检查潜在问题和改进建议
版本: 2.1.0
所需工具: read, exec

## 3. docx
描述: 创建和编辑 Word 文档
版本: 1.5.0

当用户请求与某个技能描述匹配时，你可以调用该技能来提供专业服务。
```

---

### L6: 运行时上下文 (RUNTIME)

**用途**: 当前时间、活跃会话数、系统状态等动态信息

**来源**: 内存生成

**更新策略**: 每次请求动态生成

**生成格式**:
```markdown
# 运行时上下文

## 时间信息
- 当前时间: 2026-04-01T12:00:00Z
- 时区: Asia/Shanghai
- 本地时间: 2026/4/1 20:00:00

## 系统状态
- 状态: healthy
- 活跃会话数: 3
- 内存使用: 128MB / 1024MB
- 请求ID: req_abc123

## 注意事项
- 请根据当前时间合理安排任务
- 注意系统资源使用情况
```

## Prompt 组装流程

```
会话启动/重置
    ↓
读取 ./.starup/agents/{agent_id}/SOUL.md (L1)
读取 ./.starup/agents/{agent_id}/IDENTITY.md (L2)
读取 ./.starup/agents/{agent_id}/USER.md (L3)
    ↓
扫描 ./.starup/skills/*/SKILL.md 生成 L5
    ↓
合并系统工具定义生成 L4
    ↓
注入运行时上下文 L6
    ↓
计算 token 数，必要时触发压缩
    ↓
缓存至内存，标记版本号 v{timestamp}
```

## Prompt 压缩策略

### 触发条件

当六层 Prompt 总 token 数超过 8k 时启动压缩。

### 压缩优先级

1. **保留 L1-L3**（人格层完整保留）
2. **压缩 L4**（仅保留高频工具定义）
3. **截断 L5**（仅保留触发概率高的 Skill）
4. **精简 L6**（移除非关键运行时指标）

### 压缩策略

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| `truncate` | 截断低优先级层 | 需要快速压缩 |
| `summarize` | 摘要长文本 | 保留核心信息 |
| `hybrid` | 混合策略（默认） | 平衡速度和质量 |

## 接口定义

### PromptLayerConfig

```typescript
interface PromptLayerConfig {
  version: string;
  layers: {
    soul: {
      path: string;
      hash: string;        // 内容校验
      readonly: boolean;
    };
    identity: {
      path: string;
      cache_ttl: number;   // 缓存秒数
    };
    user_profile: {
      path: string;
      auto_update: boolean;
    };
  };
  compression: {
    threshold: number;     // token 阈值，默认 8000
    strategy: 'summarize' | 'truncate' | 'hybrid';
  };
}
```

### AssembledPrompt

```typescript
interface AssembledPrompt {
  version: string;
  content: string;         // 组装后的完整 Prompt
  tokenCount: number;
  layers: {
    L1_SOUL: boolean;
    L2_IDENTITY: boolean;
    L3_USER_PROFILE: boolean;
    L4_TOOLS: boolean;
    L5_SKILLS: boolean;
    L6_RUNTIME: boolean;
  };
}
```

## 使用示例

```typescript
import { PromptAssembler, createDefaultConfig } from './core/prompt';
import { toolRegistry } from './core/tools';
import { skillRegistry } from './core/skills';

// 创建组装器
const config = createDefaultConfig();
const assembler = new PromptAssembler(config, toolRegistry, skillRegistry);

// 组装 Prompt
const runtimeContext = {
  timestamp: Date.now(),
  timezone: 'Asia/Shanghai',
  activeSessions: 3,
  systemStatus: 'healthy',
  memoryUsage: { used: 128000000, total: 1024000000 },
  requestId: 'req_abc123',
};

const prompt = await assembler.assemble('default-agent', runtimeContext);
console.log(`Assembled prompt: ${prompt.tokenCount} tokens`);
console.log(prompt.content);
```

## 性能指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| Prompt 组装延迟 | < 100ms | 六层 Prompt 读取与模板渲染 |
| Token 估算耗时 | < 10ms | 基于字符数的快速估算 |
| 压缩耗时 | < 50ms | 基于优先级的智能压缩 |

## 安全考虑

- **注入防护**: 对用户输入进行 `<user_input>` 标签包裹
- **敏感词过滤**: 在 L3 (USER.md) 加载时扫描潜在 Prompt Injection
- **权限分级**:
  - L1-L2: 只读，仅管理员可修改
  - L3: 用户自助维护
  - L4-L6: 系统生成，不可手动编辑

---

*本文档是 StarUp v1.1 主会话 Prompt 工程化体系的核心规范*
