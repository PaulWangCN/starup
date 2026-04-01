# INTENT.md 规范

INTENT.md 是 Skill 的意图定义文件，用于声明 Skill 可以处理的意图类型、触发条件和槽位信息。它是意图识别系统的重要组成部分。

## 文件位置

INTENT.md 位于 Skill 目录下，与 SKILL.md 同级：

```
my-skill/
├── SKILL.md          # Skill 核心指令
├── INTENT.md         # 意图定义（可选但推荐）
└── scripts/
```

## 文件格式

INTENT.md 采用 Markdown 格式，包含以下部分：

```markdown
# 意图定义

## send_email

**描述**: 发送邮件给指定收件人

**示例**:
- "给张三发邮件"
- "通知团队明天开会"
- "发送周报给经理"

**槽位**:
- recipient (string) - required - extractor: llm
- subject (string) - optional - extractor: llm
- content (string) - optional - extractor: llm
- attachments (array) - optional - extractor: regex

## query_inbox

**描述**: 查询收件箱邮件

**示例**:
- "查看未读邮件"
- "最近有什么邮件"
- "显示收件箱"

**槽位**:
- filter (string) - optional - extractor: regex
- limit (number) - optional - extractor: regex

## 回退模式

- pattern: `给(.+?)发(邮件|信)` -> send_email (+0.3)
- pattern: `查(?:询)?(.+?)邮件` -> query_inbox (+0.2)
- pattern: `(.+?)@.+?\.com` -> send_email (+0.1)
```

## 字段说明

### 意图定义部分

| 字段 | 说明 | 必需 |
|------|------|------|
| `## 意图ID` | 意图的唯一标识符，使用小写下划线命名 | 是 |
| `**描述**` | 意图的自然语言描述 | 是 |
| `**示例**` | 触发该意图的示例语句列表 | 是 |
| `**槽位**` | 需要从消息中提取的参数 | 否 |

### 槽位定义

槽位行格式：
```
- name (type) - required|optional - extractor: llm|regex
```

| 属性 | 说明 | 可选值 |
|------|------|--------|
| `name` | 槽位名称 | - |
| `type` | 数据类型 | `string`, `number`, `boolean`, `array`, `object` |
| `required\|optional` | 是否必需 | `required`, `optional` |
| `extractor` | 提取方式 | `llm` (LLM提取), `regex` (正则匹配) |

### 回退模式

当主识别器无法高置信度匹配时，使用回退模式进行兜底匹配：

```markdown
## 回退模式

- pattern: `正则表达式` -> 意图ID (+置信度加成)
```

例如：
- `pattern: `(查｜查询).{0,5}(天气｜气温)` -> query_weather (+0.3)`
- `pattern: `(发送｜写).{0,3}(邮件｜信)` -> send_email (+0.2)`

## 意图识别流程

```
用户消息
    ↓
网关层规则匹配
    ↓ (未高置信度匹配)
Skill 层 INTENT.md 匹配
    ↓
提取槽位值
    ↓
返回意图识别结果
```

## 最佳实践

### 1. 意图划分原则

- **单一职责**: 每个意图只做一件事
- **粒度适中**: 不要太细（每个词都一个意图）也不要太粗（所有事一个意图）
- **示例丰富**: 每个意图至少提供 3-5 个不同表达方式的示例

### 2. 槽位设计原则

- **必需槽位最小化**: 只将真正必需的参数设为 required
- **提供默认值**: 在 SKILL.md 中说明槽位的默认值
- **合理选择提取器**: 结构化数据用 regex，开放式数据用 llm

### 3. 示例编写技巧

```markdown
# 好的示例
**示例**:
- "给张三发邮件说项目进度"  → 包含 recipient 和隐含 content
- "发邮件通知团队明天下午两点开会"  → 包含 recipient, content, time
- "用邮件把报告发给经理"  → 包含 content 和 recipient

# 不好的示例
**示例**:
- "发邮件"  → 太简单，无法提取有效信息
- "邮件"  → 没有动作
```

## 与 SKILL.md 的关系

| 文件 | 作用 | 加载时机 |
|------|------|----------|
| SKILL.md | 定义 Skill 的能力和触发条件 | 系统启动时加载描述 |
| INTENT.md | 定义 Skill 可以处理的具体意图 | 意图识别时按需加载 |

INTENT.md 是对 SKILL.md 的补充：
- SKILL.md 告诉系统"这是什么"
- INTENT.md 告诉系统"能做什么"和"怎么做"

## 完整示例

### 天气查询 Skill

```markdown
# 意图定义

## query_weather

**描述**: 查询指定城市和日期的天气预报

**示例**:
- "北京今天天气怎么样"
- "查一下上海明天的天气"
- "纽约未来一周天气"
- "明天会下雨吗"

**槽位**:
- location (string) - required - extractor: llm
- date (string) - optional - extractor: llm
- detailed (boolean) - optional - extractor: regex

## query_air_quality

**描述**: 查询指定城市的空气质量

**示例**:
- "北京空气质量如何"
- "查一下今天的PM2.5"
- "上海空气污染指数"

**槽位**:
- location (string) - required - extractor: llm

## 回退模式

- pattern: `(查|查询).{0,5}(天气|气温|温度)` -> query_weather (+0.3)
- pattern: `(.+?)天气(怎么样|如何)` -> query_weather (+0.2)
- pattern: `(空气|PM2.5|AQI)` -> query_air_quality (+0.25)
- pattern: `明天|后天|下周|未来` -> query_weather (+0.1)
```

## 调试技巧

### 1. 验证意图定义

使用系统命令验证 INTENT.md 格式：

```bash
# 在 StarUp CLI 中
/validate-intent my-skill
```

### 2. 测试意图匹配

```bash
# 测试特定消息会匹配到哪个意图
/test-intent "北京今天天气怎么样"
```

### 3. 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 意图未被触发 | 示例不够多样化 | 增加更多变体示例 |
| 槽位提取失败 | 提取器选择不当 | 结构化数据改用 regex |
| 误触发 | 回退模式过于宽泛 | 收紧正则表达式 |
| 置信度过低 | 示例与消息差异大 | 优化示例覆盖更多表达 |

---

*本文档是 StarUp v1.1 意图识别系统的组成部分*
