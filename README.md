# 🤖 StarUp - AI 终端助手与自动化平台

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue.svg" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue.svg" alt="typescript">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg" alt="node">
  <img src="https://img.shields.io/badge/tests-35%20passed-brightgreen.svg" alt="tests">
</p>

<p align="center">
  <b>智能 · 自主 · 协作 · 持续运行</b>
</p>

StarUp 是一个功能强大的 AI 助手运行时环境与集成平台，采用 **ReAct (Reasoning + Acting)** 架构，支持多智能体协作、自我修复和多通道集成。

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

### 🛠️ 工具库 (28 个)

#### 文件操作
- `read` / `write` / `edit` - 文件读写编辑
- `exec` - 执行 shell 命令
- `grep` - 代码搜索

#### Git 集成 (7 个)
- `git_status` / `git_log` / `git_diff`
- `git_branch` / `git_commit` / `git_blame` / `git_stash`

#### 项目理解 (4 个)
- `project_understand` - 项目结构分析
- `find_entry_points` - 查找入口文件
- `summarize_file` - 文件内容摘要
- `find_related_files` - 查找相关文件

#### 代码分析 (3 个)
- `analyze_complexity` - 圈复杂度分析
- `detect_code_smells` - 代码异味检测
- `analyze_dependencies` - 依赖分析

#### Web / API (4 个)
- `web_fetch` / `web_fetch2` - 网页抓取
- `api_request` - API 调用
- `check_url` - URL 可访问性检查
- `parse_html` - HTML 解析

#### 重构 (2 个)
- `suggest_refactoring` - 重构建议
- `extract_method` - 提取方法

#### 其他
- `fetch` - HTTP 请求
- `list_skills` - 技能列表

### 🛡️ 自我修复系统
- **会话持久化**: SQLite 数据库存储，崩溃后自动恢复
- **会话快照**: 定期创建恢复点
- **看门狗监控**: 内存、健康状态实时监控
- **权限系统**: 3 层权限控制 (default/bypass/strict)，危险命令检测

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

# 运行测试
npm test
```

---

## 🎨 Ink UI 界面

现代化的终端界面，提供类似 IM 的聊天体验：

```
┌─────────────────────────────────────────┐
│ StarUp AI Agent          Skills:13 Tools:28 │
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
│  │ AgentTeam│  │  KAIROS  │  │SelfHealing│  │ Permission│   │
│  │          │  │  Engine  │  │          │  │  System   │   │
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
│   │   ├── tools/            # 工具系统 (28 tools)
│   │   ├── session/          # 会话管理
│   │   ├── memory/           # 记忆系统 (AutoDream)
│   │   ├── persistence/      # 持久化 (SQLite)
│   │   ├── resilience/       # 自愈系统
│   │   └── security/         # 权限系统
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

## 🧪 测试

```bash
# 运行所有测试
npm test

# 测试覆盖
Test Suites: 5 passed, 5 total
Tests:       35 passed, 35 total
```

---

## 🛠️ 开发

### 项目统计

| 指标 | 数值 |
|------|------|
| 源代码行数 | ~8,000+ 行 |
| TypeScript 文件 | 60+ 个 |
| 核心模块 | 15+ 个 |
| 内置工具 | 28 个 |
| LLM 提供商 | 8 家 |
| 测试通过率 | 100% (35/35) |

---

## 📄 许可证

[MIT](LICENSE) © 2024 StarUp Team

---

<p align="center">
  Made with ❤️ by StarUp Team
</p>
