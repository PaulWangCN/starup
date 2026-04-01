# core.registry 意图定义

## 意图定义

### skill.query
**描述**: 查询已安装 Skill
**示例**:
- 列出已安装技能
- 有什么功能
- 装了哪些插件

**槽位**:
- filter (string) - optional - extractor: llm
- verbose (boolean) - optional - extractor: llm

### skill.search
**描述**: 搜索 Skill
**示例**:
- 找一下翻译相关的 skill
- 搜索日历插件
- 有没有天气功能

**槽位**:
- keyword (string) - required - extractor: regex
- source (string) - optional - extractor: llm

### skill.info
**描述**: 查看 Skill 详情
**示例**:
- 天气插件的详细信息
- 查看翻译 skill 的权限

**槽位**:
- skill_id (string) - required - extractor: regex

## 回退模式

- pattern: `^(?:列出|查看|显示).*(?:skill|插件|功能)` -> skill.query (+0.1)
- pattern: `^(?:搜索|查找|找|搜).+` -> skill.search (+0.1)
