# StarUp - AI 助手运行时环境

StarUp 是一个为 AI 助手打造的运行时环境，提供会话管理、工具调用、记忆系统和任务调度等核心能力。

## 核心特性

- 🤖 **ReAct 多轮工具调用**: 自动执行工具链，支持多轮思考-行动循环
- 🔧 **工具系统**: read / write / edit / exec / grep / fetch / web_fetch / listSkills
- 🧠 **三层记忆架构**: Session(会话) / Persistent(持久) / Team(团队) 分级管理
- 📦 **Skills 系统**: 模块化扩展，支持热加载
- 💬 **通道集成**: 飞书、钉钉、Telegram 等平台接入
- 🎯 **LLM 支持**: DeepSeek、OpenAI 等主流模型
- 🗜️ **上下文压缩**: 多层压缩策略应对 Token 限制
- ⏰ **任务调度**: Cron 定时任务 + Heartbeat 心跳轮询

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入你的 API Key
```

### 启动终端对话（推荐）

```bash
# 交互式终端对话
npm run chat
```

### 启动 Gateway

```bash
# 开发模式
npm run gateway

# 生产模式
npm run build
npm run gateway:prod
```

Gateway 默认端口：
- HTTP API: `http://127.0.0.1:18788`
- WebSocket: `ws://127.0.0.1:18789`

## 项目结构

```
src/
├── core/                   # 核心模块
│   ├── session/            # 会话管理（主会话 + 子代理）
│   ├── memory/             # 三层记忆系统
│   ├── tools/              # 工具注册与执行
│   ├── skills/             # Skills 加载与管理
│   ├── llm/                # LLM 服务封装
│   ├── scheduler/          # 定时任务与心跳调度
│   ├── compact/            # 上下文压缩（Micro/Auto/Reactive）
│   ├── prompt/             # 系统提示词组装
│   └── intent/             # 意图路由
├── channels/               # 平台通道适配器
│   ├── feishu/             # 飞书
│   ├── telegram/           # Telegram
│   └── dingtalk/           # 钉钉
├── gateway/                # Gateway 统一入口
│   ├── HttpServer.ts
│   ├── WebSocketServer.ts
│   └── AdapterRegistry.ts
├── cli/                    # 终端交互界面
└── types/                  # TypeScript 类型定义

.starup/                    # 本地运行时目录（自动创建）
├── skills/                 # 本地 Skills
├── memory/                 # 持久记忆
│   ├── user/               # 用户画像
│   ├── feedback/           # 工作方式反馈
│   ├── project/            # 项目信息
│   ├── reference/          # 外部引用
│   └── team/               # 团队记忆
├── session/                # 会话记忆
├── logs/                   # 日志文件（KAIROS 模式）
└── snapshots/              # 会话快照
```

## 终端对话

```bash
npm run chat
```

### 斜杠命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/exit`, `/quit` | 退出程序 |
| `/tools` | 列出可用工具 |
| `/skills` | 列出已加载 Skills |
| `/status` | 显示系统状态 |
| `/tasks` | 列出定时任务 |
| `/clear` | 清空屏幕 |

### 快捷键

- `↑/↓` - 浏览命令历史
- `Tab` - 自动补全命令
- `Ctrl+C` - 退出程序

## Gateway API

### REST API

```bash
# 健康检查
curl http://127.0.0.1:18788/health

# 创建会话
curl -X POST http://127.0.0.1:18788/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"clientId": "my-client"}'

# 聊天（非流式）
curl -X POST http://127.0.0.1:18788/api/chat \
  -H "Content-Type: application/json" \
  -d '{"clientId": "my-client", "message": "你好"}'

# OpenAI 兼容 API（支持 SSE 流式）
curl -X POST http://127.0.0.1:18788/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好"}], "stream": true}'
```

### WebSocket 协议

```json
{ "id": "req-1", "type": "chat", "payload": { "message": "你好" } }
{ "type": "status" }
{ "type": "ping" }
```

## 记忆系统

StarUp 采用三层记忆架构，让 AI 助手具备持续学习和长期记忆能力。

### 三层架构

| 层级 | 范围 | 存储位置 | 用途 |
|-----|------|---------|------|
| **L1 Session** | 当前会话 | `.starup/session/memory.md` | 上下文压缩素材 |
| **L2 Persistent** | 跨会话 | `.starup/memory/{type}/*.md` | 用户偏好、项目知识 |
| **L3 Team** | 跨用户 | `.starup/memory/team/*.md` | 团队协作共享 |

### L2 记忆类型

| 类型 | 用途 | 作用域 |
|-----|------|--------|
| `user/` | 用户画像、偏好、背景 | 始终私有 |
| `feedback/` | 工作方式指导 | 默认私有 |
| `project/` | 项目进展、目标 | 偏向共享 |
| `reference/` | 外部系统指针 | 通常共享 |

### 记忆格式

```markdown
---
name: 用户偏好-简洁回复
description: 用户不希望在每次回复末尾加总结
type: feedback
created: 2026-04-03T10:00:00Z
updated: 2026-04-03T10:00:00Z
tags: [communication, style]
---

不要在回复末尾总结刚做了什么，用户能看到 diff。

**Why:** 用户明确要求过"stop summarizing what you just did"
**How to apply:** 所有回复结束时，直接结束，不加回顾性总结。
```

**约束**:
- ❌ 不保存代码片段（代码是脏数据，随时会修改）
- ✅ 保存思考过程、设计决策、经验教训
- `feedback` 和 `project` 类型必须包含 `**Why:**` 和 `**How to apply:**`
- MEMORY.md 索引限制：200行 / 25000字节

### AI 召回

系统自动根据查询召回相关记忆：
- AI 选择最相关的最多 5 条记忆
- 新鲜度标注：`today` / `yesterday` / `N days ago`
- 超过 1 天的记忆附加过期警告

## 配置说明

### 环境变量

| 变量 | 说明 | 必填 |
|-----|------|-----|
| `LLM_PROVIDER` | LLM 提供商 (`deepseek` / `openai`) | 是 |
| `LLM_API_KEY` | API Key | 是 |
| `LLM_MODEL` | 模型名称（如 `deepseek-chat`） | 是 |
| `LLM_BASE_URL` | 自定义 API 基础地址 | 否 |
| `FEISHU_ENABLED` | 启用飞书 | 否 |
| `FEISHU_APP_ID` | 飞书 App ID | 条件 |
| `FEISHU_APP_SECRET` | 飞书 App Secret | 条件 |
| `TELEGRAM_ENABLED` | 启用 Telegram | 否 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | 条件 |
| `DINGTALK_ENABLED` | 启用钉钉 | 否 |
| `DINGTALK_CLIENT_ID` | 钉钉 Client ID | 条件 |
| `DINGTALK_CLIENT_SECRET` | 钉钉 Client Secret | 条件 |
| `STARUP_GATEWAY_HTTP_PORT` | Gateway HTTP 端口（默认 18788） | 否 |
| `STARUP_GATEWAY_WS_PORT` | Gateway WebSocket 端口（默认 18789） | 否 |
| `LOG_LEVEL` | 日志级别 (`debug` / `info` / `warn` / `error`) | 否 |

### Skills 开发

创建 `SKILL.md` 文件：

```markdown
---
name: my-skill
description: 描述何时使用此 Skill
tools:
  - read
  - write
---

# Skill 说明文档
...
```

放在以下位置之一：
- `./.starup/skills/my-skill/` (本地目录，推荐)
- 项目内置 `skills/` 目录

## 开发计划

### Phase 1 (MVP) ✅
- [x] 基础 Session 生命周期管理
- [x] 核心 Tools (read/write/edit/exec/grep/fetch)
- [x] 飞书 Channel Connector
- [x] 基础 Memory 文件系统
- [x] Skill 加载机制

### Phase 2 (进行中) ✅
- [x] Cron & Heartbeat 调度器
- [x] 钉钉 / Telegram Channel
- [x] 三层记忆系统（AI 召回、新鲜度、frontmatter）
- [x] 上下文压缩（Micro/Auto/Reactive）
- [ ] 微信 Channel
- [ ] 语义记忆检索（向量数据库）

### Phase 3
- [ ] 全面支持 ClawHub 和 SkillHub
- [ ] 一键安装 Skills

## 许可证

MIT
