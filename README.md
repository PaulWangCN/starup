# 🤖 StarUp - AI 终端助手与自动化平台

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue.svg" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue.svg" alt="typescript">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg" alt="node">
  <img src="https://img.shields.io/badge/tests-39%20passed-brightgreen.svg" alt="tests">
</p>

<p align="center">
  <b>智能 · 自主 · 记忆 · 协作 · 持续运行</b>
</p>

StarUp 是一个功能强大的 AI 助手运行时环境与集成平台，采用 **ReAct (Reasoning + Acting)** 架构，支持**三层记忆系统**、多智能体协作、自我修复和多通道集成。

---

## ✨ 核心特性

### 🧠 三层记忆系统

StarUp 实现了与 Claude Code 类似的**三层记忆架构**，实现真正的跨会话连续性：

| 层级 | 存储位置 | 特性 | 用途 |
|-----|---------|------|------|
| **L1 Session** | `.starup/session/memory.md` | 临时，10章节格式 | 当前会话上下文压缩 |
| **L2 文件记忆** | `.starup/memory/{type}/*.md` | 持久化，YAML frontmatter | AI 主动写入的记忆 |
| **L3 AutoDream** | `.starup/memory/autodream/` | **自动整合**，时间衰减 | 系统自动学习的事实 |

#### AutoDream 自动记忆整合

**核心理念**: 观察 → 洞察 → 事实

```
用户对话
    ↓
ConversationObserver 自动提取观察（"我喜欢...", "请不要..."）
    ↓
AutoDream 定期整合
    - 相似观察合并
    - 矛盾消解
    - 高置信度转为事实
    ↓
持久化存储 + 召回使用
```

**特性**:
- 🎯 **自动观察提取**: 从对话中自动识别用户偏好、重要信息、错误修正
- 🔄 **智能整合**: 每 5 分钟自动合并相似观察，生成高置信度事实
- 📉 **时间衰减**: 30 天半衰期，不常用的事实自动降级
- 💾 **持久化**: JSON 存储 + 自动备份，支持崩溃恢复
- 🔍 **双路召回**: 文件记忆 + AutoDream Facts 同时召回

---

### 🧠 多 LLM 提供商支持
- **云端模型**: DeepSeek, OpenAI, Anthropic Claude, Google Gemini, 阿里通义千问, Moonshot, Baichuan
- **本地模型**: Ollama 支持 (Llama3, Qwen 等)
- **智能路由**: 根据任务意图自动选择最适合的模型
- **故障转移**: 自动回退机制确保服务可用性

---

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

---

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

---

### 🔥 KAIROS 始终在线模式

```
┌─────────────────────────────────────────────┐
│  KAIROS Engine (希腊语: "恰好的时刻")        │
├─────────────────────────────────────────────┤
│  • 每 5 分钟 tick                           │
│  • 代码变更自动检测                         │
│  • 空闲时执行 AutoDream 记忆整合            │
│  • HEARTBEAT.md 任务自动执行                │
└─────────────────────────────────────────────┘
```

---

### 🛡️ 自我修复系统
- **会话持久化**: SQLite 数据库存储，崩溃后自动恢复
- **会话快照**: 定期创建恢复点
- **看门狗监控**: 内存、健康状态实时监控
- **权限系统**: 3 层权限控制 (default/bypass/strict)，危险命令检测

---

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
# 启动交互式 CLI
npm run chat

# 启动 Gateway 服务
npm run gateway

# 构建生产版本
npm run build

# 运行测试
npm test
```

---

## 🎨 交互式 CLI 界面

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
- **快捷键**: 
  - `Enter`: 发送消息
  - `Ctrl+C`: 退出程序
  - `/help`: 显示帮助

---

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                            用户界面层                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  CLI     │  │Telegram  │  │  飞书    │  │  HTTP    │            │
│  │   UI     │  │   Bot    │  │          │  │  API     │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
└───────┼─────────────┴──────┬──────┴─────────────┼──────────────────┘
        │                    │                    │
        └────────────────────┴────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────────┐
│                          核心引擎层                                   │
│  ┌─────────────────────────┼─────────────────────────────────────┐  │
│  │                    ReAct Loop                                    │  │
│  │  ┌─────────┐    ┌──────┴──────┐    ┌─────────┐                │  │
│  │  │ Reason  │───→│    Plan     │───→│  Act    │                │  │
│  │  │ (思考)  │←───│   (规划)    │←───│ (执行)  │                │  │
│  │  └─────────┘    └─────────────┘    └─────────┘                │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │ AgentTeam│  │  KAIROS  │  │SelfHealing│  │ 三层记忆系统     │    │
│  │          │  │  Engine  │  │          │  │ (Session/文件/   │    │
│  │          │  │          │  │          │  │   AutoDream)     │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🧠 记忆系统详解

### 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│  L1 Session Memory                                          │
│  .starup/session/memory.md                                  │
│  • 当前会话状态                                            │
│  • 10章节格式（任务/文件/错误/学习...）                      │
│  • 服务于上下文压缩                                        │
├─────────────────────────────────────────────────────────────┤
│  L2 文件记忆 (AI 主动写入)                                   │
│  .starup/memory/{user,feedback,project,reference}/*.md      │
│  • YAML frontmatter 格式                                    │
│  • 永久保存                                                │
│  • MEMORY.md 自动索引                                       │
├─────────────────────────────────────────────────────────────┤
│  L3 AutoDream (系统自动学习)                                 │
│  .starup/memory/autodream/memory.json                       │
│  • 观察 → 洞察 → 事实                                       │
│  • 时间衰减（30天半衰期）                                   │
│  • 自动备份与恢复                                          │
└─────────────────────────────────────────────────────────────┘
```

### 记忆类型

| 类型 | 用途 | 保存方式 | 示例 |
|-----|------|---------|------|
| **user** | 用户画像、偏好 | AI 主动写入 / AutoDream 自动提取 | "用户喜欢简洁回复" |
| **feedback** | 对工作方式的指导 | AI 主动写入 | "不要总结已做的事情" |
| **project** | 项目进展、目标 | AI 主动写入 | "发布日期是 2026-04-10" |
| **reference** | 外部系统指针 | AI 主动写入 | "文档地址: ..." |
| **autodream** | 自动学习的事实 | 系统自动生成 | "项目使用 TypeScript" |

### 观察提取规则

系统自动从对话中提取以下类型的观察：

| 规则 | 模式 | 置信度 |
|-----|------|--------|
| 用户偏好 | "我喜欢..." / "我希望..." | 85% |
| 错误修正 | "错了..." / "应该是..." | 90% |
| 重要信息 | "重要..." / "请注意..." | 80% |
| 项目信息 | "项目名称..." / "技术栈..." | 75% |
| 约束条件 | "限制..." / "不能超过..." | 80% |

---

## 📁 项目结构

```
starup/
├── src/
│   ├── index.ts                    # 核心入口
│   ├── cli/                        # CLI 界面
│   │   └── index.ts
│   ├── core/                       # 核心功能
│   │   ├── llm/                    # LLM 服务 (多提供商)
│   │   ├── agentic/                # Agent Team 编排器
│   │   ├── tools/                  # 工具系统 (28 tools)
│   │   ├── session/                # 会话管理 + 上下文压缩
│   │   ├── memory/                 # 🧠 三层记忆系统
│   │   │   ├── AutoDream.ts        #   自动记忆整合引擎
│   │   │   ├── AutoDreamPersistence.ts  # 持久化层
│   │   │   ├── ConversationObserver.ts  # 对话观察器
│   │   │   └── MemoryManager.ts    #   记忆管理器
│   │   ├── persistence/            # 持久化 (SQLite)
│   │   ├── kairos/                 # KAIROS 引擎
│   │   ├── resilience/             # 自愈系统
│   │   └── security/               # 权限系统
│   ├── channels/                   # 通道集成
│   └── gateway/                    # Gateway 服务
├── .starup/                        # 运行时数据
│   ├── AGENTS.md                   # 工作区指南
│   ├── SOUL.md                     # 人格层
│   ├── IDENTITY.md                 # 身份层
│   ├── USER.md                     # 用户画像
│   ├── session/
│   │   └── memory.md               # L1 会话记忆
│   └── memory/
│       ├── MEMORY.md               # 索引
│       ├── user/                   # 用户记忆
│       ├── feedback/               # 反馈记忆
│       ├── project/                # 项目记忆
│       └── autodream/              # L3 自动学习记忆
│           ├── memory.json         #   持久化数据
│           └── facts_export.md     #   导出的人类可读事实
├── .env                            # 环境变量
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

### 记忆系统配置

AutoDream 默认配置：
- **整合间隔**: 5 分钟
- **半衰期**: 30 天
- **最低置信度**: 10%
- **最大观察数**: 1000
- **最大事实数**: 500
- **备份保留**: 最近 10 个

---

## 🧪 测试

```bash
# 运行所有测试
npm test

# 仅运行 AutoDream 测试
npm test -- AutoDream
```

**测试覆盖**:
```
Test Suites: 4 passed, 4 total
Tests:       39 passed, 39 total
  - AutoDream 基础功能
  - AutoDream 记忆整合
  - AutoDream 时间衰减
  - AutoDream 持久化
  - 其他核心模块
```

---

## 🛠️ 开发

### 项目统计

| 指标 | 数值 |
|------|------|
| 源代码行数 | ~9,000+ 行 |
| TypeScript 文件 | 70+ 个 |
| 核心模块 | 15+ 个 |
| 内置工具 | 28 个 |
| LLM 提供商 | 8 家 |
| 测试通过率 | 100% (39/39) |

---

## 📚 相关文档

- [AGENTS.md](.starup/AGENTS.md) - 工作区指南（自动加载）
- [SOUL.md](.starup/SOUL.md) - 人格层
- [IDENTITY.md](.starup/IDENTITY.md) - 身份标识

---

## 📄 许可证

[MIT](LICENSE) © 2024 StarUp Team

---

<p align="center">
  Made with ❤️ by StarUp Team
</p>
