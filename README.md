# 🤖 StarUp - AI 终端助手与自动化平台

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue.svg" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue.svg" alt="typescript">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg" alt="node">
</p>

<p align="center">
  <b>智能 · 自主 · 协作 · 持续运行</b>
</p>

StarUp 是一个功能强大的 AI 助手运行时环境与集成平台，采用 **ReAct (Reasoning + Acting)** 架构，支持多智能体协作、7×24 小时自主运行、自我修复和多通道集成。无论你是需要编程助手、自动化工具还是智能客服，StarUp 都能胜任。

---

## ✨ 核心特性

### 🧠 多 LLM 提供商支持
- **云端模型**: DeepSeek, OpenAI, Anthropic Claude, Google Gemini, 阿里通义千问, Moonshot, Baichuan
- **本地模型**: Ollama 支持 (Llama3, Qwen 等)
- **智能路由**: 根据任务意图自动选择最适合的模型
- **故障转移**: 自动回退机制确保服务可用性

### 👥 Agent Team 多智能体协作
内置 6 种专业角色的智能体团队，协同处理复杂任务：

| 角色 | 职责 | 适用场景 |
|------|------|----------|
| **Architect** | 系统设计、架构决策、技术选型 | 项目初始化、架构评审 |
| **Coder** | 代码编写、功能实现、Bug 修复 | 功能开发、代码生成 |
| **Reviewer** | 代码审查、质量把控、规范检查 | PR 审查、代码优化 |
| **Tester** | 测试用例生成、测试执行、覆盖率分析 | 质量保证、自动化测试 |
| **Doc** | 文档编写、注释生成、使用说明 | API 文档、README 维护 |
| **General** | 通用任务、问题解答、信息查询 | 日常问答、简单任务 |

### 🔄 KAIROS 自主运行模式
- **7×24 小时运行**: 后台持续监控和任务处理
- **自我反思**: 定期回顾操作历史，总结改进点
- **autoDream**: 空闲时自动整合记忆，生成洞察
- **代码感知**: 监听文件变更，自动分析影响范围

### 🛡️ 自我修复系统
- **会话持久化**: SQLite 数据库存储，崩溃后自动恢复
- **会话快照**: 定期创建恢复点，支持任意时间点回滚
- **看门狗监控**: 内存、健康状态实时监控
- **自动恢复**: 检测到异常时自动重启并恢复上下文

### 🔧 强大的工具系统
内置 11+ 个核心工具，支持自定义扩展：

| 工具 | 功能 |
|------|------|
| `read` | 读取文件内容，支持行范围指定 |
| `write` | 写入文件，自动创建目录 |
| `edit` | 行级精确编辑，支持多行替换 |
| `exec` | 执行终端命令，安全沙箱限制 |
| `fetch` | HTTP 请求，支持 JSON/文本 |
| `web_fetch` | 网页抓取，HTML 转 Markdown |
| `grep` | 代码搜索，支持正则表达式 |
| `skill_list` | 查看可用技能 |

### 💻 编程增强功能
- **LSP 客户端**: 支持 Language Server Protocol，提供智能补全、定义跳转、诊断信息
- **代码审查**: 自动 PR 审查，支持静态分析和问题分级
- **项目理解**: 自动分析项目结构、依赖关系、技术栈

### 📡 多通道集成
- **Telegram Bot**: 全球接入，支持代理
- **飞书 (Lark)**: 企业协作，卡片消息
- **钉钉**: 国内办公场景
- **微信**: 企业微信支持
- **WebSocket**: 实时双向通信
- **HTTP API**: RESTful 接口，SSE 流式输出

---

## 🚀 快速开始

### 环境要求
- Node.js >= 18.0.0
- npm 或 yarn
- (可选) Ollama 本地模型

### 安装

```bash
# 克隆仓库
git clone <repository-url>
cd starup

# 安装依赖
npm install

# 复制环境变量配置
cp .env.example .env

# 编辑 .env，填入你的 API Key
vim .env
```

### 配置 .env

```env
# 选择 LLM 提供商: deepseek / openai / anthropic / gemini / qwen / moonshot / baichuan / ollama
LLM_PROVIDER=deepseek
LLM_API_KEY=your-api-key-here
LLM_MODEL=deepseek-chat

# 可选：自定义 API 地址（默认使用官方地址）
# LLM_BASE_URL=https://api.deepseek.com/v1

# Ollama 本地模型配置（如使用 Ollama）
# LLM_PROVIDER=ollama
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3.2
```

### 运行

```bash
# 交互式终端聊天（推荐入门）
npm run chat

# 启动 Gateway 服务（HTTP + WebSocket）
npm run gateway

# 开发模式
npm run dev

# 构建生产版本
npm run build
npm start
```

---

## 📖 使用指南

### 终端聊天

```bash
$ npm run chat

╔══════════════════════════════════════════╗
║    🤖 StarUp - AI Terminal Assistant    ║
║           Version: 1.0.0                ║
╠══════════════════════════════════════════╣
║  输入 /help 查看可用命令                ║
║  输入 /exit 退出程序                    ║
╚══════════════════════════════════════════╝

> 你是谁？
我是 StarUp AI 助手，可以帮助你编程、写作、数据分析等各种任务...

> /help
可用命令：
  /new         - 创建新会话
  /agents      - 查看 Agent Team 状态
  /compact     - 压缩会话上下文
  /save        - 保存会话快照
  /restore     - 恢复快照
  /exit        - 退出程序
```

### 编程助手示例

```
> 帮我创建一个 Express API，包含用户注册和登录功能

🤔 AI 思考中...
  → 调用工具: Architect
  ← 工具执行成功
  → 调用工具: Coder
  ← 工具执行成功

✅ 已为你生成完整的 Express 用户认证 API：
- 用户模型设计 (Mongoose)
- JWT 认证中间件
- 注册/登录路由
- 密码加密 (bcrypt)
- 输入验证

文件已保存到 src/routes/auth.js
```

### Agent Team 协作

```javascript
// 程序化使用 Agent Team
const { StarUpCore } = require('./dist/index');

const core = new StarUpCore();
await core.initialize();

// 分派复杂任务给 Agent Team
const result = await core.agentTeam.executeComplexTask({
  task: '重构用户模块',
  description: '将回调函数改为 async/await，添加类型定义',
  context: { files: ['src/user.js'], requirements: ['TypeScript', 'Error Handling'] }
});

console.log(result.summary);
```

---

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                        用户界面层                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Terminal │  │Telegram  │  │  飞书    │  │  HTTP    │    │
│  │   Chat   │  │   Bot    │  │          │  │  API     │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
└───────┼─────────────┼─────────────┼─────────────┼──────────┘
        │             │             │             │
        └─────────────┴──────┬──────┴─────────────┘
                             │
┌────────────────────────────┼────────────────────────────────┐
│                      核心引擎层                             │
│  ┌─────────────────────────┼────────────────────────────┐   │
│  │                    ReAct Loop                         │   │
│  │   ┌─────────┐    ┌──────┴──────┐    ┌─────────┐     │   │
│  │   │ Reason  │───→│    Plan     │───→│  Act    │     │   │
│  │   │ (思考)  │←───│   (规划)    │←───│ (执行)  │     │   │
│  │   └─────────┘    └─────────────┘    └─────────┘     │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ AgentTeam│  │  KAIROS  │  │SelfHealing│  │  Intent  │    │
│  │          │  │  Engine  │  │          │  │  Router  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────┐
│                      服务支撑层                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │   LLM    │  │  Memory  │  │  Tools   │  │ Session  │    │
│  │ Service  │  │ Manager  │  │ Registry │  │ Manager  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │   LSP    │  │CodeReview│  │ Project  │  │  SQLite  │    │
│  │  Client  │  │          │  │Understanding│ │   DB    │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚙️ 配置详解

### LLM 配置

```env
# 提供商选择
LLM_PROVIDER=deepseek  # deepseek | openai | anthropic | gemini | qwen | moonshot | baichuan | ollama

# API 密钥
LLM_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# 模型名称
LLM_MODEL=deepseek-chat

# 可选：自定义基础 URL
# LLM_BASE_URL=https://api.deepseek.com/v1

# 可选：温度参数 (0.0 - 1.0)
LLM_TEMPERATURE=0.7

# 可选：最大 Token 数
LLM_MAX_TOKENS=8192
```

### 按意图路由模型

```env
# 代码任务使用专门模型
LLM_MODEL_CODE=deepseek-coder

# 分析任务使用对话模型
LLM_MODEL_ANALYSIS=deepseek-chat

# 搜索任务
LLM_MODEL_SEARCH=deepseek-chat

# 解释说明任务
LLM_MODEL_EXPLANATION=deepseek-chat

# 通用任务
LLM_MODEL_GENERAL=deepseek-chat

# 故障转移模型
LLM_FALLBACK_MODEL=deepseek-chat
```

### 通道配置

**Telegram:**
```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your-bot-token
HTTPS_PROXY=http://127.0.0.1:7890  # 中国大陆需要
```

**飞书:**
```env
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxx
```

**钉钉:**
```env
DINGTALK_ENABLED=true
DINGTALK_CLIENT_ID=xxxxxxxx
DINGTALK_CLIENT_SECRET=xxxxxxxx
```

### Gateway 配置

```env
STARUP_GATEWAY_HTTP_PORT=18788
STARUP_GATEWAY_WS_PORT=18789
STARUP_GATEWAY_TOKEN=your-secure-token
```

---

## 🔌 API 接口

### HTTP API

```bash
# 发送聊天消息
curl -X POST http://localhost:18788/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "sessionId": "session-001",
    "message": "你好，请帮我写一个快速排序"
  }'

# 流式响应 (SSE)
curl -N http://localhost:18788/api/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "sessionId": "session-001",
    "message": "讲个故事"
  }'

# 查看会话列表
curl http://localhost:18788/api/sessions \
  -H "Authorization: Bearer your-token"

# 创建快照
curl -X POST http://localhost:18788/api/snapshots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "sessionId": "session-001",
    "name": "重要节点"
  }'
```

### WebSocket API

```javascript
const ws = new WebSocket('ws://localhost:18789?token=your-token');

ws.onopen = () => {
  // 发送消息
  ws.send(JSON.stringify({
    type: 'chat',
    sessionId: 'session-001',
    content: '你好'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.content); // 流式输出
};
```

---

## 🛠️ 开发指南

### 项目结构

```
starup/
├── src/
│   ├── index.ts              # 核心入口
│   ├── cli.ts                # 终端聊天
│   ├── cli/                  # CLI 相关
│   │   ├── TerminalChat.ts
│   │   └── Renderer.ts
│   ├── core/                 # 核心功能
│   │   ├── llm/              # LLM 服务
│   │   │   ├── LLMService.ts
│   │   │   ├── LLMProviders.ts
│   │   │   └── ModelRouter.ts
│   │   ├── session/          # 会话管理
│   │   │   ├── SessionManager.ts
│   │   │   ├── SessionSnapshot.ts
│   │   │   └── ContextManager.ts
│   │   ├── memory/           # 记忆系统
│   │   │   └── MemoryManager.ts
│   │   ├── tools/            # 工具系统
│   │   │   ├── ToolRegistry.ts
│   │   │   └── definitions/  # 工具定义
│   │   ├── skills/           # 技能系统
│   │   │   └── SkillRegistry.ts
│   │   ├── orchestration/    # 编排系统
│   │   │   └── AgentTeam.ts
│   │   ├── kairos/           # KAIROS 模式
│   │   │   └── KairosEngine.ts
│   │   ├── resilience/       # 弹性/自愈
│   │   │   └── SelfHealing.ts
│   │   ├── persistence/      # 持久化
│   │   │   ├── Database.ts
│   │   │   └── SessionPersistence.ts
│   │   ├── codeReview/       # 代码审查
│   │   │   └── CodeReviewer.ts
│   │   ├── lsp/              # LSP 客户端
│   │   │   └── LSPClient.ts
│   │   └── project/          # 项目理解
│   │       └── ProjectUnderstanding.ts
│   ├── channels/             # 通道集成
│   │   ├── telegram/
│   │   ├── feishu/
│   │   └── dingtalk/
│   ├── gateway/              # Gateway 服务
│   │   ├── Gateway.ts
│   │   ├── HttpServer.ts
│   │   └── WebSocketServer.ts
│   ├── types/                # 类型定义
│   └── utils/                # 工具函数
│       └── Logger.ts
├── .starup/                  # 运行时数据
│   └── sessions.db           # SQLite 数据库
├── .env                      # 环境变量
└── package.json
```

### 添加新工具

```typescript
// src/core/tools/definitions/myTool.ts
import { ToolDefinition } from '../../../types';

export const myTool: ToolDefinition = {
  name: 'my_tool',
  description: '工具描述',
  parameters: [
    { name: 'param1', type: 'string', description: '参数1', required: true },
    { name: 'param2', type: 'number', description: '参数2', required: false },
  ],
  handler: async (args) => {
    // 实现逻辑
    return { success: true, data: result };
  },
};

// 注册到 src/core/tools/definitions/index.ts
export { myTool } from './myTool';
```

### 添加新技能 (Skill)

```typescript
// skills/my-skill/index.ts
import { Skill } from '../types';

export default {
  name: 'my-skill',
  description: '技能描述',
  tools: [
    {
      name: 'skill_tool',
      description: '工具描述',
      parameters: [...],
      handler: async (args) => { ... }
    }
  ],
  // 生命周期钩子
  async onInstall() { ... },
  async onUninstall() { ... },
} as Skill;
```

---

## 📊 项目统计

| 指标 | 数值 |
|------|------|
 源代码行数 | ~5,200+ 行 |
 TypeScript 文件 | 62+ 个 |
 核心模块 | 20+ 个 |
 内置工具 | 11 个 |
 技能数量 | 13 个 |
 LLM 提供商 | 8 家 |
 通道集成 | 4 个 |

---

## 🤝 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

---

## 📄 许可证

[MIT](LICENSE) © 2024 StarUp Team

---

## 🙏 致谢

感谢以下开源项目：
- [axios](https://github.com/axios/axios) - HTTP 客户端
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - SQLite 数据库
- [chalk](https://github.com/chalk/chalk) - 终端样式
- [ink](https://github.com/vadimdemedes/ink) - React 终端 UI
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) - Telegram Bot
- [Express](https://expressjs.com/) - Web 框架

---

<p align="center">
  Made with ❤️ by StarUp Team
</p>
