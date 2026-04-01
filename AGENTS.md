# StarUp 项目指南

## 项目概述

StarUp 是一个 AI 助手运行时环境与集成平台，采用模块化架构设计，支持：

- **主会话和子代理架构**：支持任务分解和并行处理
- **六层 Prompt 工程化体系**（v1.1）：SOUL → IDENTITY → USER → TOOLS → SKILLS → RUNTIME
- **双层意图识别引擎**（v1.1）：网关层规则匹配 + Skill 层语义匹配
- **Skill 生态系统**（v1.2）：开放式 Skill 动态发现、安全安装与热插拔管理
- **多平台连接器**：飞书、微信等 IM 平台集成

## 目录结构

```
starup/
├── docs/                       # 文档目录
│   ├── human/                 # 人类创建的 PRD 文档（AI 只读）
│   │   ├── system/            # 系统设计文档
│   │   │   ├── 系统设计v1.0.md
│   │   │   ├── 系统设计v1.1.md
│   │   │   └── 系统设计v1.2.md
│   │   ├── skills/            # Skills 系统文档
│   │   │   ├── 什么是skills.md
│   │   │   ├── Skills 的结构与组成.md
│   │   │   ├── 如何创建自定义skills.md
│   │   │   ├── OpenPack 规范.md           # v1.2
│   │   │   ├── Capability 权限系统.md      # v1.2
│   │   │   └── Skill 安装指南.md           # v1.2
│   │   └── 目录管理.md
│   └── ai/                    # AI 生成的 PRD 文档
│       └── 项目开发记录.md
├── topstar/                   # 源代码目录
│   └── src/
│       ├── core/              # 核心模块
│       │   ├── session/       # 会话管理（v1.1）
│       │   ├── memory/        # 记忆系统
│       │   ├── tools/         # 工具注册表
│       │   ├── skills/        # Skill 管理（v1.2 扩展）
│       │   ├── llm/           # LLM 服务
│       │   ├── prompt/        # Prompt 组装引擎（v1.1）
│       │   ├── intent/        # 意图识别系统（v1.1）
│       │   └── install/       # 安装流水线（v1.2）
│       ├── cli/               # 命令行界面
│       ├── connectors/        # 平台连接器
│       └── types/             # 类型定义
└── AGENTS.md                  # 本文件
```

## 核心模块

### v1.1 模块

| 模块 | 路径 | 说明 |
|------|------|------|
| SessionManager | `core/session/SessionManager.ts` | 会话生命周期管理 |
| PromptAssembler | `core/prompt/PromptAssembler.ts` | 六层 Prompt 组装 |
| IntentRouter | `core/intent/IntentRouter.ts` | 意图识别与路由 |
| ContextManager | `core/session/ContextManager.ts` | 上下文继承管理 |

### v1.2 Skill 生态系统

| 模块 | 路径 | 说明 |
|------|------|------|
| InstallManager | `core/skills/InstallManager.ts` | 多源 Skill 安装管理 |
| SkillRuntime | `core/skills/SkillRuntime.ts` | VM 热插拔运行时 |
| DependencyResolver | `core/skills/DependencyResolver.ts` | SAT 依赖求解 |
| Sandbox | `core/skills/Sandbox.ts` | Capability 权限沙箱 |
| PackageDownloader | `core/install/PackageDownloader.ts` | 多源包下载 |
| SignatureVerifier | `core/install/SignatureVerifier.ts` | Ed25519 签名验证 |

## 开发规范

### 代码风格

- **语言**: TypeScript 5.0+
- **引号**: 单引号
- **缩进**: 2 空格
- **分号**: 必需
- **尾随逗号**: 使用

### 文件命名

- 类文件: PascalCase (如 `InstallManager.ts`)
- 工具文件: camelCase (如 `packageDownloader.ts`)

### 模块模式

```typescript
// 单例模式
export class XxxManager { ... }
export const xxxManager = new XxxManager();
```

### 错误处理

```typescript
try {
  await operation();
} catch (error) {
  console.error('[ModuleName] Operation failed:', error);
  throw new SkillError('Message', 'CODE');
}
```

## CLI 命令

### Skill 管理（v1.2）

```bash
# 安装
claw install weather                    # 从 Marketplace
claw install weather@2.1.0             # 指定版本
claw install github:user/skill-repo    # 从 Git
claw install ./local-skill --link      # 本地开发模式

# 管理
claw list [--verbose] [--permissions]
claw info <skill-id>
claw enable <skill-id>
claw disable <skill-id>
claw uninstall <skill-id> [--purge]

# 升级
claw upgrade <skill-id>
claw upgrade --all

# 依赖
claw deps <skill-id> [--check]

# 开发
claw pack <path> --output <file.claw>
claw verify <file.claw>
```

### 交互模式

```bash
claw chat              # 启动终端聊天界面
```

## 构建与运行

```bash
cd topstar

# 安装依赖
npm install

# 编译
npm run build

# 开发模式
npm run dev

# 运行 CLI
npm run chat
```

## AI 使用权限

| 目录 | 读取 | 编辑 | 删除 |
|------|------|------|------|
| docs/human/ | ✅ | ❌ | ❌ |
| docs/ai/ | ✅ | ✅ | ✅ |
| topstar/ | ✅ | ✅ | ✅ |

## 参考文档

- [项目规范](docs/项目规范.md)
- [系统设计 v1.2](docs/human/system/系统设计v1.2.md)
- [OpenPack 规范](docs/human/skills/OpenPack%20规范.md)
- [Capability 权限系统](docs/human/skills/Capability%20权限系统.md)
- [Skill 安装指南](docs/human/skills/Skill%20安装指南.md)

---

*本文档由 AI 助手维护 - v1.2*
