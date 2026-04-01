# Capability 权限系统

Capability 是 StarUp Skill 的权限模型，采用**显式声明 + 动态授权**机制，确保 Skill 只能在声明的权限范围内运行。

## 1. 概述

### 1.1 设计原则

- **默认拒绝**: 未声明的权限一律禁止
- **最小权限**: Skill 只能申请必需的权限
- **细粒度控制**: 支持域名、路径、操作类型的精确控制
- **动态授权**: 敏感操作可配置二次确认
- **可审计**: 所有权限操作记录日志

### 1.2 安全层级

```
┌─────────────────────────────────────────────────┐
│                 用户授权层                        │
│         （安装时确认权限清单）                      │
├─────────────────────────────────────────────────┤
│                 静态分析层                        │
│      （代码扫描，禁止 eval/child_process）         │
├─────────────────────────────────────────────────┤
│                 VM 隔离层                         │
│      （QuickJS/V8 沙箱，内存隔离）                 │
├─────────────────────────────────────────────────┤
│              Capability 仲裁层                    │
│      （运行时权限检查，API 网关）                   │
├─────────────────────────────────────────────────┤
│              系统服务层                           │
│    （Network, Filesystem, Memory, Tools）        │
└─────────────────────────────────────────────────┘
```

## 2. 权限类型

### 2.1 网络权限 (network)

控制 Skill 的 HTTP/HTTPS 请求能力。

```yaml
permissions:
  - id: "network.fetch"
    scope:
      allow:
        - "https://api.openai.com/v1/*"
        - "https://*.weather.com"
        - "https://api.example.com:8080/*"
      deny:
        - "127.0.0.1"
        - "10.0.0.0/8"
        - "192.168.0.0/16"
        - "*.internal.company.com"
```

**scope 格式**:

| 模式 | 示例 | 说明 |
|------|------|------|
| 精确匹配 | `https://api.example.com` | 仅该域名 |
| 通配符子域 | `https://*.example.com` | 所有子域 |
| 路径通配 | `https://api.com/v1/*` | 路径前缀 |
| 端口指定 | `https://api.com:8080` | 特定端口 |
| CIDR 块 | `10.0.0.0/8` | IP 范围 |

### 2.2 文件系统权限 (fs)

控制 Skill 的文件读写能力。

```yaml
permissions:
  - id: "fs.read"
    scope:
      - "${SKILL_PATH}/assets/*"
      - "${SKILL_PATH}/templates/*"
      - "${SHARED_TEMP}/*"
  
  - id: "fs.write"
    scope:
      - "${SKILL_HOME}/data/*"
      - "${SKILL_HOME}/cache/*"
  
  - id: "fs.append"
    scope:
      - "${SKILL_HOME}/logs/*.log"
```

**模板变量**:

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `${SKILL_PATH}` | Skill 安装目录 | `./.starup/skills/weather-query/` |
| `${SKILL_HOME}` | Skill 数据目录 | `./.starup/skills/weather-query/data/` |
| `${SHARED_TEMP}` | 共享临时目录 | `./.starup/temp/` |

### 2.3 记忆权限 (memory)

控制 Skill 对记忆系统的访问。

```yaml
permissions:
  - id: "memory.read"
    scope:
      - "user_preferences"
      - "session_context"
      - "skill_state:${SKILL_ID}"
  
  - id: "memory.write"
    scope:
      - "cached_results"
      - "skill_state:${SKILL_ID}"
    retention: "7d"                    # 自动过期时间
  
  - id: "memory.vector"
    scope:
      - "embeddings"
    limit: 100                         # 最大向量数
```

**记忆类型**:

| 类型 | 说明 | 访问模式 |
|------|------|----------|
| user_preferences | 用户偏好设置 | 只读 |
| session_context | 当前会话上下文 | 只读 |
| skill_state | Skill 私有状态 | 读写 |
| cached_results | 缓存结果 | 读写 |
| embeddings | 向量嵌入 | 读写 |

### 2.4 工具权限 (tools)

控制 Skill 可调用的系统工具。

```yaml
permissions:
  - id: "tools.use"
    scope:
      - "browser_visit"
      - "browser_click"
      - "code_interpreter:readonly"     # 只读模式
      - "shell:restricted"              # 受限 shell
  
  - id: "tools.register"
    scope:
      - "dynamic"                       # 允许动态注册工具
```

**工具修饰符**:

| 修饰符 | 说明 |
|--------|------|
| `:readonly` | 只读访问，禁止修改 |
| `:restricted` | 受限模式，限制参数 |
| `:sandbox` | 完全沙箱隔离 |

### 2.5 跨 Skill 权限 (skill)

控制 Skill 间的通信能力。

```yaml
permissions:
  - id: "skill.interop"
    scope:
      - "http-client:request"           # 调用 http-client Skill 的 request 方法
      - "math-utils:*"                  # 调用 math-utils 的所有方法
  
  - id: "skill.event"
    scope:
      - "subscribe"                     # 订阅事件
      - "publish"                       # 发布事件
```

**调用格式**: `{skillId}:{method}` 或 `{skillId}:*`

## 3. 运行时行为

### 3.1 权限检查流程

```
Skill 代码调用 API
        ↓
┌───────────────────┐
│   VM 拦截层        │ 拦截 require/import
└─────────┬─────────┘
          ↓
┌───────────────────┐
│  Capability 检查   │ 检查 manifest 权限声明
│  - 权限是否声明？   │
│  - 范围是否匹配？   │
└─────────┬─────────┘
          ↓
    ┌─────┴─────┐
    ▼           ▼
┌───────┐   ┌───────┐
│  允许  │   │  拒绝  │
│ 执行   │   │ 抛异常 │
└───────┘   └───────┘
```

### 3.2 权限违规处理

| 场景 | 处理方式 |
|------|----------|
| 未声明权限 | 抛出 `CapabilityError`，记录警告日志 |
| 范围不匹配 | 抛出 `ScopeError`，提示具体限制 |
| 敏感操作 | 触发二次确认（UI 弹窗或命令行确认） |
| 重复违规 | 自动禁用 Skill，通知用户 |

### 3.3 动态权限申请

某些场景下 Skill 需要动态申请额外权限：

```typescript
import { Capability } from '@openclaw/sdk';

// 动态申请权限（需要用户确认）
const granted = await Capability.request({
  id: 'network.fetch',
  scope: { allow: ['https://new-api.com'] },
  reason: '需要访问新数据源'
});

if (granted) {
  // 使用新权限
  const res = await fetch('https://new-api.com/data');
}
```

## 4. 安全配置示例

### 4.1 最小权限 Skill

```yaml
# 仅读取配置文件，无网络、无文件写
permissions:
  - id: "fs.read"
    scope: ["${SKILL_PATH}/config.yaml"]
```

### 4.2 数据处理 Skill

```yaml
# 数据处理，需要文件读写和缓存
permissions:
  - id: "fs.read"
    scope: ["${SKILL_PATH}/assets/*"]
  
  - id: "fs.write"
    scope: ["${SKILL_HOME}/output/*"]
  
  - id: "memory.write"
    scope: ["cached_results"]
    retention: "1h"
```

### 4.3 API 集成 Skill

```yaml
# 第三方 API 集成
permissions:
  - id: "network.fetch"
    scope:
      allow: ["https://api.service.com/*"]
      deny: ["*.internal.*", "127.0.0.1"]
  
  - id: "memory.read"
    scope: ["user_preferences"]
  
  - id: "memory.write"
    scope: ["skill_state", "api_tokens"]
    retention: "30d"
```

### 4.4 复杂集成 Skill

```yaml
# 浏览器自动化 + 代码执行
permissions:
  - id: "network.fetch"
    scope:
      allow: ["https://*"]
      deny: ["*.internal.*", "10.0.0.0/8"]
  
  - id: "tools.use"
    scope: ["browser_visit", "browser_click", "code_interpreter:readonly"]
  
  - id: "fs.read"
    scope: ["${SKILL_PATH}/*", "${SHARED_TEMP}/*"]
  
  - id: "fs.write"
    scope: ["${SKILL_HOME}/screenshots/*"]
  
  - id: "skill.interop"
    scope: ["image-processor:compress"]
```

## 5. 最佳实践

### 5.1 Skill 开发者

1. **最小权限原则**: 只申请真正需要的权限
2. **范围精确**: 网络权限精确到域名和路径
3. **时效限制**: 敏感数据设置合理的 retention
4. **错误处理**: 处理权限拒绝的异常情况

```typescript
// 好的做法：处理权限错误
try {
  const res = await fetch('https://api.example.com');
} catch (err) {
  if (err instanceof CapabilityError) {
    return { error: '需要网络权限才能查询天气' };
  }
  throw err;
}
```

### 5.2 用户

1. **审查权限**: 安装前仔细审查权限清单
2. **质疑过度授权**: 拒绝权限与功能不匹配的 Skill
3. **定期审计**: 使用 `claw list --permissions` 审查已安装 Skill

```bash
# 查看 Skill 权限
claw info weather-query --permissions

# 查看所有 Skill 权限概览
claw list --permissions
```

### 5.3 企业管理员

1. **Registry 白名单**: 限制可安装的 Registry
2. **权限策略**: 配置企业级权限模板
3. **审计日志**: 定期检查权限变更记录

```yaml
# ./.starup/config.yaml
security:
  allowed_registries:
    - "https://marketplace.company.com"
  
  permission_policy:
    max_network_domains: 5
    deny_permissions:
      - "fs.write:${HOME}/*"
      - "network.fetch:*.internal.*"
```

## 6. 审计与日志

### 6.1 日志记录

所有权限操作记录在 `./.starup/logs/capability.log`：

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "skill_id": "com.example.weather",
  "action": "network.fetch",
  "target": "https://api.weather.com/v1/current",
  "result": "allowed",
  "duration_ms": 245
}
```

### 6.2 审计命令

```bash
# 查看 Skill 权限使用统计
claw audit weather-query

# 查看权限违规记录
claw audit --violations

# 导出审计报告
claw audit --export report.json
```

---

*Capability 系统保障 Skill 生态的安全运行 - v1.2*
