# StarUp - AI 助手运行时环境

StarUp 的核心运行时环境，为 AI 助手提供"操作系统"级别的基础设施。

## 功能特性

- 🤖 **Session 管理**: 主会话 + 子代理架构，支持任务隔离和结果回流
- 🔧 **工具系统**: read/write/edit/exec/web_search 等核心工具
- 🧠 **记忆系统**: 四级记忆架构（短期/日记忆/长期/向量）
- 📦 **Skills 系统**: 模块化扩展，支持热加载
- 💬 **通道集成**: 飞书、钉钉、Telegram 等平台接入
- 🎯 **LLM 支持**: DeepSeek、OpenAI 等主流模型

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入你的 API Key
```

### 3. 启动 Gateway（推荐）

Gateway 是 StarUp 的统一控制平面与通信枢纽，提供 HTTP API、WebSocket 控制平面和外部适配器路由。

```bash
# 启动 Gateway（开发模式）
npm run gateway

# 或生产模式
npm run build
npm run gateway:prod
```

Gateway 默认端口：
- HTTP API: `http://127.0.0.1:18788`
- WebSocket: `ws://127.0.0.1:18789`

### 4. 启动终端对话

```bash
# 交互式终端对话
npm run chat

# 或开发模式
npm run dev

# 编译
npm run build

# 生产运行
npm run start
```

## 项目结构

```
src/
├── core/                   # 核心模块
│   ├── session/            # 会话管理
│   ├── memory/             # 内存系统
│   ├── tools/              # 工具系统
│   ├── skills/             # Skills 管理
│   ├── llm/                # LLM 服务
│   ├── scheduler/          # 任务调度（Cron / Heartbeat）
│   ├── compact/            # 会话压缩与 Token 管理
│   ├── prompt/             # 系统提示词组装
│   └── intent/             # 意图路由
├── channels/               # 平台通道（Channel）
│   ├── feishu/             # 飞书
│   ├── telegram/           # Telegram
│   └── dingtalk/           # 钉钉
├── gateway/                # Gateway 统一入口
│   ├── HttpServer.ts
│   ├── WebSocketServer.ts
│   └── AdapterRegistry.ts
├── cli/                    # 终端交互界面
├── types/                  # 类型定义
└── index.ts                # 入口文件

.skills/                    # 本地 Skills 目录（运行时创建）
├── my-skill/               # 自定义 Skill
│   └── SKILL.md
└── ...
```

## 终端对话使用

### 启动交互式终端

```bash
npm run chat
```

### 界面预览

```
╔══════════════════════════════════════════╗
║     StarUp - AI Terminal Assistant       ║
╚══════════════════════════════════════════╝

[SYSTEM] Loaded 3 skills, 5 tools
[SYSTEM] Session: main-xxx initialized

> 你好

AI: 你好！我是 StarUp AI 助手。有什么可以帮助你的吗？

> 读取 README.md 文件

AI: 我来帮你读取文件...

> /tools

可用工具:
  • read    - 读取文件内容
  • write   - 写入文件
  • edit    - 编辑文件
  • exec    - 执行命令
  • web_search - 网络搜索

> /exit

感谢使用 StarUp！再见！
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
| `/history [N]` | 显示最近 N 条对话历史（默认 10） |

### 快捷键

- `↑/↓` - 浏览命令历史
- `Tab` - 自动补全命令
- `Ctrl+C` - 退出程序

## 程序化使用示例

### Gateway API

Gateway 启动后，可通过以下接口与系统交互：

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

WebSocket 协议示例：
```json
{ "id": "req-1", "type": "chat", "payload": { "message": "你好" } }
{ "type": "status" }
{ "type": "ping" }
```

### 基础对话

```typescript
import { StarUpCore } from './src/index';

const starup = new StarUpCore();
await starup.initialize();

const mainSession = starup.sessionManager.initializeMainSession();
const response = await starup.processMessage(
  mainSession.id,
  "你好，请帮我查询北京天气"
);
console.log(response);
```

### 创建子代理会话

> 注：`spawnSubAgent` 创建的是**带有权限隔离的会话上下文**，并非完全独立的并发 Agent。它主要用于需要受限工具集、受限记忆访问或超时控制的场景（例如内部对话压缩）。创建后需由调用方自行使用 `llmService` 消费该会话。

```typescript
import { StarUpCore } from './src/index';

const starup = new StarUpCore();
await starup.initialize();

const mainSession = starup.sessionManager.initializeMainSession();

// 创建子代理会话（权限受限的上下文）
const subAgent = starup.sessionManager.spawnSubAgent(mainSession.id, {
  task: "分析销售数据并生成报告",
  tools: ["read", "write", "exec"],
  timeout: 300,
  parent_callback: true,
});

// 调用方自行使用 LLM 消费该会话
const result = await starup.llmService!.chat(subAgent.context.messages);

// 完成后销毁会话，结果可按配置回流到父会话
starup.sessionManager.destroySession(subAgent.id);
```

### 使用工具

```typescript
import { toolRegistry } from './src/core/tools/ToolRegistry';

// 读取文件
const result = await toolRegistry.execute('read', {
  path: 'docs/readme.md',
  offset: 1,
  limit: 50
});
```

## 配置说明

### 环境变量

| 变量 | 说明 | 必填 |
|-----|------|-----|
| `LLM_PROVIDER` | LLM 提供商 (`deepseek` / `openai`) | 是 |
| `LLM_API_KEY` | API Key（推荐统一使用此项） | 是 |
| `LLM_MODEL` | 模型名称（如 `deepseek-chat`） | 是 |
| `LLM_BASE_URL` | 自定义 API 基础地址 | 否 |
| `LLM_TEMPERATURE` | 采样温度 | 否 |
| `LLM_MAX_TOKENS` | 最大生成 Token 数 | 否 |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（兼容旧版） | 条件 |
| `DEEPSEEK_MODEL` | DeepSeek 模型名称（兼容旧版） | 否 |
| `OPENAI_API_KEY` | OpenAI API Key | 条件 |
| `OPENAI_MODEL` | OpenAI 模型名称 | 否 |
| `FEISHU_ENABLED` | 启用飞书 | 否 |
| `FEISHU_APP_ID` | 飞书 App ID | 条件 |
| `FEISHU_APP_SECRET` | 飞书 App Secret | 条件 |
| `WEIXIN_ENABLED` | 启用微信 | 否 |
| `WEIXIN_CORP_ID` | 微信 Corp ID | 条件 |
| `WEIXIN_SECRET` | 微信 Secret | 条件 |
| `TELEGRAM_ENABLED` | 启用 Telegram | 否 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | 条件 |
| `DINGTALK_ENABLED` | 启用钉钉 | 否 |
| `DINGTALK_CLIENT_ID` | 钉钉 Client ID (AppKey) | 条件 |
| `DINGTALK_CLIENT_SECRET` | 钉钉 Client Secret (AppSecret) | 条件 |
| `STARUP_GATEWAY_HTTP_PORT` | Gateway HTTP 端口（默认 18788） | 否 |
| `STARUP_GATEWAY_WS_PORT` | Gateway WebSocket 端口（默认 18789） | 否 |
| `STARUP_GATEWAY_TOKEN` | Gateway 访问令牌 | 否 |
| `LOG_LEVEL` | 日志级别 (`debug` / `info` / `warn` / `error`) | 否 |

### Skill 开发

创建 `SKILL.md` 文件：

```yaml
---
name: my-skill
description: 描述何时使用此 Skill
version: 1.0.0
tools:
  - read
  - write
---

# Skill 说明文档
...
```

放在以下位置之一：
- `skills/my-skill/` (项目内置，若存在)
- `./.starup/skills/my-skill/` (本地目录，推荐)

## 开发计划

### Phase 1 (MVP) ✅
- [x] 基础 Session 生命周期管理
- [x] 核心 Tools (read/write/exec)
- [x] 飞书 Channel Connector
- [x] 基础 Memory 文件系统
- [x] Skill 加载机制

### Phase 2 (进行中)
- [ ] ACP 协议对接
- [x] Cron & Heartbeat 调度器
- [x] 钉钉 / Telegram Channel
- [ ] 微信 Channel 完整实现
- [ ] 语义记忆检索

### Phase 3
- [ ] 全面支持 ClawHub 和 SkillHub
- [ ] 一键安装 Skills

## 许可证

MIT
