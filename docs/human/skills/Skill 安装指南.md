# Skill 安装指南

本文档介绍如何在 StarUp 中安装、管理和使用 Skill。

## 1. 快速开始

### 1.1 从 Marketplace 安装

```bash
# 安装最新版本
claw install weather

# 安装指定版本
claw install weather@2.1.0

# 安装版本范围
claw install weather@^2.0.0
```

### 1.2 验证安装

```bash
# 查看已安装 Skill
claw list

# 查看 Skill 详情
claw info weather

# 测试 Skill
claw test weather "今天北京天气怎么样"
```

## 2. 安装渠道

### 2.1 Marketplace（官方市场）

默认安装源，提供审核过的 Skill。

```bash
# 使用官方市场（默认）
claw install weather

# 指定 Registry
claw install weather --registry https://marketplace.starup.ai

# 企业私有 Registry
claw install weather --registry https://skills.company.com
```

### 2.2 Git 仓库

从 Git 仓库直接安装。

```bash
# GitHub
claw install github:username/skill-weather

# GitHub 指定分支/标签
claw install github:username/skill-weather#v2.0

# 完整 Git URL
claw install git+https://github.com/username/skill-weather.git

# 私有仓库（需要 SSH 密钥）
claw install git@github.com:company/internal-skill.git
```

### 2.3 本地路径

开发阶段使用本地路径安装。

```bash
# 安装本地目录
claw install ./my-skill

# 开发模式（软链接，修改实时生效）
claw install ./my-skill --link

# 强制重新安装
claw install ./my-skill --force
```

### 2.4 URL 直链

从 URL 直接下载安装。

```bash
# 下载 .claw 包
claw install https://example.com/skill/weather.claw

# 下载并指定名称
claw install https://cdn.company.com/skills/data.claw --name data-processor
```

## 3. 管理 Skill

### 3.1 列出 Skill

```bash
# 列出所有已安装 Skill
claw list

# 显示详细信息
claw list --verbose

# 显示依赖树
claw list --tree

# 只显示激活的 Skill
claw list --active

# 显示权限概览
claw list --permissions
```

### 3.2 启用/禁用

```bash
# 临时禁用 Skill
claw disable weather

# 重新启用
claw enable weather

# 批量禁用
claw disable weather news translator
```

### 3.3 卸载

```bash
# 卸载 Skill（保留数据）
claw uninstall weather

# 卸载并清除数据
claw uninstall weather --purge

# 强制卸载（忽略依赖检查）
aw uninstall weather --force
```

### 3.4 升级

```bash
# 检查更新
claw update

# 升级指定 Skill
claw upgrade weather

# 升级所有 Skill
claw upgrade --all

# 升级到最新主版本
claw upgrade weather@latest
```

## 4. 依赖管理

### 4.1 查看依赖

```bash
# 查看 Skill 依赖树
claw deps weather

# 查看依赖树（图形化）
claw deps weather --graph

# 检查依赖冲突
claw deps --check
```

输出示例：
```
weather@2.1.0
├── http-client@2.3.1
├── math-utils@1.5.2
└── cache-manager@3.0.0
    └── fs-helper@1.0.0
```

### 4.2 解决冲突

当多个 Skill 依赖不同版本时：

```bash
# 自动解决冲突
claw resolve

# 查看冲突详情
claw resolve --dry-run

# 强制使用特定版本
claw resolve --prefer http-client@2.3.0
```

冲突解决策略：

| 策略 | 说明 |
|------|------|
| auto | 自动选择最新兼容版本 |
| isolate | 多版本共存（隔离加载） |
| prompt | 询问用户选择 |

## 5. 开发调试

### 5.1 本地开发

```bash
# 创建 Skill 模板
claw create my-skill

# 开发模式安装（热重载）
cd my-skill
claw install . --link

# 查看实时日志
claw logs my-skill --follow

# 手动重载
claw reload my-skill
```

### 5.2 打包验证

```bash
# 打包 Skill
claw pack ./my-skill --output my-skill.claw

# 验证包完整性
claw verify my-skill.claw

# 验证签名
claw verify my-skill.claw --signature

# 检查 manifest
claw inspect my-skill.claw
```

### 5.3 调试命令

```bash
# 测试 Skill 意图匹配
claw test my-skill "用户输入文本"

# 测试工具调用
claw test my-skill --tool get_weather '{"city": "北京"}'

# 性能分析
claw test my-skill --profile

# 调试模式（详细日志）
claw test my-skill --debug
```

## 6. 配置文件

### 6.1 用户配置

`~/.starup/config.yaml`：

```yaml
# Registry 配置
registries:
  - name: "official"
    url: "https://marketplace.starup.ai"
    priority: 1
  
  - name: "company"
    url: "https://skills.company.com"
    priority: 2
    auth:
      type: "token"
      token: "${COMPANY_TOKEN}"

# 安装默认设置
install:
  default_registry: "official"
  auto_update: true
  verify_signature: true
  
# 依赖解析策略
dependency:
  resolution: "auto"           # auto | conservative | latest
  allow_multi_version: true
  cache_ttl: "1h"
```

### 6.2 项目配置

项目根目录 `.clawrc.yaml`：

```yaml
# 项目级 Skill 锁定
skills:
  weather: "2.1.0"
  translator: "^1.0.0"

# 开发依赖
dev_skills:
  - test-helper
  - mock-server
```

## 7. 故障排除

### 7.1 安装失败

```bash
# 查看详细错误
claw install weather --verbose

# 清除缓存重试
claw cache clean
claw install weather

# 检查网络
claw doctor --network
```

常见错误：

| 错误 | 原因 | 解决 |
|------|------|------|
| `SignatureError` | 签名验证失败 | 检查来源是否可信 |
| `DependencyError` | 依赖无法满足 | 更新依赖或联系开发者 |
| `CapabilityError` | 权限声明冲突 | 检查权限配置 |
| `VersionError` | 版本不兼容 | 升级 Core 或选择兼容版本 |

### 7.2 运行时问题

```bash
# 检查 Skill 状态
claw status weather

# 查看日志
claw logs weather --tail 100

# 重置 Skill 状态
claw reset weather

# 诊断问题
claw doctor
```

### 7.3 性能问题

```bash
# 查看 Skill 资源使用
claw stats

# 内存分析
claw stats --memory

# 清理未使用 Skill
claw prune
```

## 8. 企业部署

### 8.1 私有 Registry

配置企业内部 Registry：

```yaml
# ~/.starup/config.yaml
registries:
  - name: "enterprise"
    url: "https://skills.company.com"
    auth:
      type: "oauth"
      client_id: "${CLIENT_ID}"
      
security:
  allowed_registries:
    - "https://skills.company.com"
  require_signature: true
```

### 8.2 离线安装

```bash
# 下载 Skill 包到本地
claw download weather --output ./packages/

# 离线安装
claw install ./packages/weather.claw --offline

# 批量安装
claw install ./packages/*.claw
```

### 8.3 权限控制

```yaml
# 企业权限策略
security:
  permission_policy:
    deny_permissions:
      - "network.fetch:*"
    require_approval:
      - "fs.write"
      - "tools.use:shell"
```

---

*掌握 Skill 安装管理，构建强大的 AI 助手能力 - v1.2*
