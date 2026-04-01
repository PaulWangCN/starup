# OpenPack 规范 (v1.2)

OpenPack 是 StarUp Skill 的标准化打包协议，定义了 Skill 的目录结构、元数据格式和分发标准。

## 1. 概述

### 1.1 设计目标

- **标准化**: 统一的 Skill 包结构，便于解析和加载
- **可移植**: 单文件 (.claw) 或目录结构双模式支持
- **安全**: 内置签名验证和权限声明机制
- **扩展**: 支持多种运行时（JavaScript/Python/WASM）

### 1.2 包格式

Skill 包有两种分发形式：

| 格式 | 扩展名 | 适用场景 |
|------|--------|----------|
| 目录包 | 文件夹 | 开发阶段、本地测试 |
| 压缩包 | .claw | 分发、Registry 发布 |

.claw 文件本质是一个 ZIP 压缩包，包含完整的 Skill 目录内容。

## 2. 目录结构标准

### 2.1 标准结构

```
my-skill/
├── manifest.yaml          # 必需：技能元数据与权限声明
├── INTENTS.md             # 可选：意图定义（v1.1 兼容）
├── PROMPT.md              # 可选：系统提示词片段
├── assets/                # 可选：静态资源
│   ├── icon.svg
│   └── templates/
├── dist/                  # 必需：编译产物
│   ├── main.js            # 入口脚本（ES Module）
│   └── handler.wasm       # 可选：WASM 插件
├── schemas/               # 可选：JSON Schema 定义
│   └── config.schema.json # 配置项校验
└── tests/                 # 可选：测试文件
    └── *.test.js
```

### 2.2 必需文件

- **manifest.yaml**: Skill 的核心元数据，包含 id、版本、权限等
- **dist/main.js**: Skill 代码入口（JavaScript 运行时）

### 2.3 可选文件

| 文件 | 用途 |
|------|------|
| INTENTS.md | v1.1 风格意图定义，用于简单 Skill |
| PROMPT.md | 注入到 L5 层的 Prompt 片段 |
| assets/ | 图标、模板等静态资源 |
| schemas/ | 配置校验 JSON Schema |

## 3. Manifest 规范

### 3.1 基本结构

```yaml
# manifest.yaml 必需字段
id: "com.example.weather-query"         # 全局唯一标识（反向域名格式）
name: "天气查询"
version: "2.1.0"
api_version: "1.2"                      # 兼容的 OpenClaw API 版本
author: "StarUp Team <team@startup.ai>"
license: "MIT"
description: "实时查询全球天气，支持多数据源"
homepage: "https://github.com/openclaw/skill-weather"
```

### 3.2 字段说明

#### 核心字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | string | ✅ | 全局唯一标识，反向域名格式 |
| name | string | ✅ | 显示名称 |
| version | string | ✅ | 语义化版本 (semver) |
| api_version | string | ✅ | 兼容的 API 版本 |
| author | string | ✅ | 作者信息 |
| license | string | ✅ | 开源许可证 |
| description | string | ✅ | 简短描述 |
| homepage | string | ❌ | 项目主页 |

#### 运行时配置

```yaml
runtime:
  type: "javascript"                    # javascript | python | wasm
  entry: "dist/main.js"
  compatible_with: ["node18", "bun1.0"]  # 兼容的运行时
```

| 字段 | 类型 | 说明 |
|------|------|------|
| runtime.type | string | 运行时类型：javascript / python / wasm |
| runtime.entry | string | 入口文件路径 |
| runtime.compatible_with | string[] | 兼容的运行时版本 |

#### 权限声明（Capability）

```yaml
permissions:
  - id: "network.fetch"
    scope: 
      allow: ["https://api.weather.com/*", "https://*.openai.com"]
      deny: ["127.0.0.1", "10.0.0.0/8"]   # 防止 SSRF
  
  - id: "fs.read"
    scope: ["${SKILL_PATH}/assets", "${SHARED_TEMP}"]
  
  - id: "fs.write"
    scope: ["${SKILL_HOME}/data"]
  
  - id: "memory.read"
    scope: ["user_preferences", "session_context"]
  
  - id: "memory.write"
    scope: ["skill_state", "cached_results"]
    retention: "7d"
  
  - id: "tools.use"
    scope: ["browser_visit", "code_interpreter"]
  
  - id: "skill.interop"
    scope: ["http-client:request"]
```

支持的权限类型：

| 权限 ID | 说明 | scope 格式 |
|---------|------|------------|
| network.fetch | HTTP 请求 | { allow: string[], deny: string[] } |
| fs.read | 文件读取 | string[] 路径模板 |
| fs.write | 文件写入 | string[] 路径模板 |
| memory.read | 记忆读取 | string[] 记忆类型 |
| memory.write | 记忆写入 | { scope: string[], retention?: string } |
| tools.use | 工具使用 | string[] 工具名白名单 |
| skill.interop | 跨 Skill 调用 | string[] "skillId:method" |

模板变量：
- `${SKILL_PATH}`: Skill 安装目录
- `${SKILL_HOME}`: Skill 数据目录 (./.starup/skills/{id}/)
- `${SHARED_TEMP}`: 共享临时目录

#### 依赖声明

```yaml
dependencies:
  - id: "http-client"
    version: "^2.0.0"                   # 语义化版本范围
    optional: false
    registry: "https://marketplace.starup.ai"  # 可选：私有源
  
  - id: "math-utils"
    version: "~1.5.0"
    optional: true                      # 可选依赖
```

版本范围语法：

| 符号 | 含义 | 示例 |
|------|------|------|
| ^ | 兼容次要版本 | ^2.0.0 → 2.x.x |
| ~ | 兼容补丁版本 | ~1.5.0 → 1.5.x |
| >= | 最低版本 | >=1.0.0 |
| * | 任意版本 | * |

#### 集成配置

```yaml
integrations:
  intent_recognition:
    model: "light"                      # light | standard | heavy
    examples: ["查天气", "今天几度", "明天会下雨吗"]
  
  context:
    retention_turns: 5                  # 默认上下文保持轮数
```

#### 资源限制

```yaml
resources:
  max_memory: "128mb"                   # 内存限制
  timeout_ms: 5000                      # 单次调用超时
  max_cpu_percent: 10                   # CPU 使用率限制
```

## 4. 完整示例

### 4.1 manifest.yaml

```yaml
id: "com.example.weather-query"
name: "天气查询"
version: "2.1.0"
api_version: "1.2"
author: "StarUp Team <team@startup.ai>"
license: "MIT"
description: "实时查询全球天气，支持多数据源"
homepage: "https://github.com/openclaw/skill-weather"

runtime:
  type: "javascript"
  entry: "dist/main.js"
  compatible_with: ["node18", "node20"]

permissions:
  - id: "network.fetch"
    scope:
      allow: ["https://api.weather.com/*", "https://geocode.xyz/*"]
      deny: ["127.0.0.1", "10.0.0.0/8", "192.168.0.0/16"]
  
  - id: "fs.read"
    scope: ["${SKILL_PATH}/assets"]
  
  - id: "fs.write"
    scope: ["${SKILL_HOME}/cache"]
  
  - id: "memory.read"
    scope: ["user_preferences"]
  
  - id: "memory.write"
    scope: ["cached_results"]
    retention: "24h"

dependencies:
  - id: "http-client"
    version: "^2.0.0"
    optional: false

integrations:
  intent_recognition:
    model: "light"
    examples:
      - "查天气"
      - "今天几度"
      - "明天会下雨吗"
      - "北京天气怎么样"
  
  context:
    retention_turns: 3

resources:
  max_memory: "64mb"
  timeout_ms: 3000
```

### 4.2 dist/main.js

```typescript
import { Skill, Tool, Memory } from '@openclaw/sdk';

export default Skill.define({
  id: 'com.example.weather-query',
  version: '2.1.0',
  
  tools: [
    Tool.define({
      name: 'get_weather',
      description: '查询指定城市天气',
      parameters: {
        city: { type: 'string', required: true },
        date: { type: 'string', format: 'date', required: false }
      },
      handler: async ({ city, date }, context) => {
        // Capability 自动检查 network.fetch 权限
        const res = await fetch(`https://api.weather.com/v1/current?city=${city}`);
        return res.json();
      }
    })
  ],
  
  hooks: {
    onInstall: async () => {
      await Memory.set('default_city', '北京');
      console.log('[Weather] Skill installed');
    },
    
    onActivate: async () => {
      console.log('[Weather] Skill activated');
    },
    
    onUninstall: async () => {
      await Memory.purge();
      console.log('[Weather] Skill uninstalled');
    }
  }
});
```

## 5. 打包与分发

### 5.1 打包命令

```bash
# 打包当前目录的 Skill
claw pack ./my-skill --output weather.claw

# 验证包完整性
claw verify weather.claw
```

### 5.2 签名流程

```
开发者打包 → 私钥签名 → Registry 验签 → 用户下载 → 公钥验签 → 安装
```

### 5.3 Registry 发布

```bash
# 登录 Registry
claw login --registry https://marketplace.starup.ai

# 发布 Skill
claw publish weather.claw

# 版本更新
claw publish weather.claw --version 2.1.1
```

## 6. 版本兼容

### 6.1 API 版本

| api_version | 说明 | 兼容 Core 版本 |
|-------------|------|----------------|
| 1.0 | 基础 Skill 支持 | 1.0.x |
| 1.1 | 意图识别、Prompt 分层 | 1.1.x |
| 1.2 | OpenPack、热插拔、Capability | 1.2.x |

### 6.2 兼容性检查

安装时 Core 会检查：
1. api_version 是否在支持范围内
2. runtime.compatible_with 是否匹配当前环境
3. dependencies 是否可满足

不兼容时会拒绝安装并提示原因。

## 7. 最佳实践

1. **id 命名**: 使用反向域名格式，避免冲突
2. **版本管理**: 遵循语义化版本规范
3. **权限最小化**: 只申请必需的权限
4. **依赖声明**: 明确依赖版本范围，避免冲突
5. **资源限制**: 合理设置内存和超时限制
6. **错误处理**: 在 hooks 中妥善处理异常

---

*本文档属于 OpenClaw 规范的一部分 - v1.2*
