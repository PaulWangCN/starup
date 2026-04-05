# 🤖 StarUp - AI 终端助手与自动化平台

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue.svg" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue.svg" alt="typescript">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg" alt="node">
</p>

<p align="center">
  <b>智能 · 自主 · 协作 · 持续运行</b>
</p>

StarUp 是一个功能强大的 AI 助手运行时环境与集成平台，采用 **ReAct (Reasoning + Acting)** 架构，支持多智能体协作、7×24 小时自主运行、自我修复和多通道集成。

---

## ✨ 核心特性

### 🧠 多 LLM 提供商支持
- **云端模型**: DeepSeek, OpenAI, Anthropic Claude, Google Gemini, 阿里通义千问, Moonshot, Baichuan
- **本地模型**: Ollama 支持 (Llama3, Qwen 等)
- **智能路由**: 根据任务意图自动选择最适合的模型
- **故障转移**: 自动回退机制确保服务可用性

### 🤖 动态 Agent Team
基于任务复杂度自动组建 Agent Team：

| 角色 | 职责 |
|------|------|
| **planner** | 任务规划与分解 |
| **architect** | 架构设计 |
| **coder** | 代码编写 |
| **reviewer** | 代码审查 |
| **tester** | 测试验证 |
| **debugger** | 调试修复 |

**自动流程**：任务复杂度分析 → 动态生成 Agent → 并行协作 → 结果合并 → 自动销毁

### 🔍 深度项目理解
- **TypeScript/JavaScript**: 使用 TS Compiler API 深度分析 AST
- **Java/Spring Boot**: 完整支持 Maven/Gradle、Spring 注解解析
- **架构识别**: 自动识别 MVC/Layered/Microservices/Clean Architecture
- **数据流追踪**: 从 API 到 DB 的完整调用链分析

### 🛡️ 自我修复系统
- **会话持久化**: SQLite 数据库存储，崩溃后自动恢复
- **会话快照**: 定期创建恢复点，支持任意时间点回滚
- **看门狗监控**: 内存、健康状态实时监控

### 🔌 多通道集成
- **Telegram Bot**: 全球接入
- **飞书 (Lark)**: 企业协作
- **钉钉**: 国内办公场景
- **WebSocket/HTTP**: 实时双向通信

---

## 🚀 快速开始

### 环境要求
- Node.js >= 18.0.0
- npm 或 yarn

### 安装

```bash
# 克隆仓库
git clone <repository-url>
cd starup

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 API Key
```

### 配置 .env

```env
# LLM 提供商: deepseek / openai / anthropic / gemini / qwen / moonshot / baichuan / ollama
LLM_PROVIDER=deepseek
LLM_API_KEY=your-api-key-here
LLM_MODEL=deepseek-chat

# 可选：自定义 API 地址
# LLM_BASE_URL=https://api.deepseek.com/v1
```

### 运行

```bash
# 启动现代化 Ink UI
npm run chat

# 启动 Gateway 服务
npm run gateway

# 构建生产版本
npm run build
```

---

## 🎨 Ink UI 界面

现代化的终端界面，提供类似 IM 的聊天体验：

```
┌─────────────────────────────────────────┐
│ StarUp AI Agent          Skills:13 Tools:12 │
├─────────────────────────────────────────┤
│                                         │
│  ┌────────────────────────┐             │
│  │ Hello!                 │ 14:32       │
│  └────────────────────────┘             │
│                                         │
│  ┌────────────────────────┐             │
│  │ AI Hi! How can I help?│             │
│  └────────────────────────┘             │
│                                         │
├─────────────────────────────────────────┤
│ > How to... ▌                   [ SEND ]│
└─────────────────────────────────────────┘
```

### 功能特点
- **对话气泡**: 用户(蓝色) / AI(绿色) 消息气泡
- **实时流式输出**: AI 回复逐字显示
- **工具调用展示**: 显示当前调用的工具
- **发送/停止按钮**: 
  - 待输入时: 绿色 **SEND** 按钮
  - AI 生成时: 红色 **STOP** 按钮（可打断）
- **快捷键**: 
  - `Enter`: 发送消息 / 停止生成
  - `Ctrl+C`: 退出程序
  - `/help`: 显示帮助

---

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                        用户界面层                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Ink UI   │  │Telegram  │  │  飞书    │  │  HTTP    │    │
│  │   CLI    │  │   Bot    │  │          │  │  API     │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
└───────┼─────────────┴──────┬──────┴─────────────┼──────────┘
        │                    │                    │
        └────────────────────┴────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────┐
│                      核心引擎层                             │
│  ┌─────────────────────────┼────────────────────────────┐   │
│  │                    ReAct Loop                         │   │
│  │  ┌─────────┐    ┌──────┴──────┐    ┌─────────┐      │   │
│  │  │ Reason  │───→│    Plan     │───→│  Act    │      │   │
│  │  │ (思考)  │←───│   (规划)    │←───│ (执行)  │      │   │
│  │  └─────────┘    └─────────────┘    └─────────┘      │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ AgentTeam│  │  KAIROS  │  │SelfHealing│  │ Project  │    │
│  │          │  │  Engine  │  │          │  │Understand│    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 项目结构

```
starup/
├── src/
│   ├── index.ts              # 核心入口
│   ├── cli.mjs               # CLI 入口
│   ├── ink-ui/               # Ink UI 界面
│   │   └── main.tsx          # 主界面组件
│   ├── core/                 # 核心功能
│   │   ├── llm/              # LLM 服务
│   │   ├── agentic/          # Agent Team 编排器
│   │   ├── project/          # 项目理解引擎
│   │   ├── session/          # 会话管理
│   │   ├── memory/           # 记忆系统
│   │   ├── tools/            # 工具系统
│   │   └── kairos/           # KAIROS 模式
│   ├── channels/             # 通道集成
│   └── gateway/              # Gateway 服务
├── .env                      # 环境变量
└── package.json
```

---

## ⚙️ 配置详解

### 按意图路由模型

```env
# 代码任务使用专门模型
LLM_MODEL_CODE=deepseek-coder

# 分析任务使用对话模型
LLM_MODEL_ANALYSIS=deepseek-chat

# 故障转移模型
LLM_FALLBACK_MODEL=deepseek-chat
```

---

## 🛠️ 开发

### 项目统计

| 指标 | 数值 |
|------|------|
| 源代码行数 | ~6,000+ 行 |
| TypeScript 文件 | 60+ 个 |
| 核心模块 | 20+ 个 |
| 内置工具 | 12 个 |
| LLM 提供商 | 8 家 |

---

## 📄 许可证

[MIT](LICENSE) © 2024 StarUp Team

---

<p align="center">
  Made with ❤️ by StarUp Team
</p>
