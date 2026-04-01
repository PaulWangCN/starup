# core.installer 意图定义

## 意图定义

### skill.install
**描述**: 安装新 Skill
**示例**:
- 安装天气 skill
- 添加邮件功能
- 我需要翻译插件
- 给我装一个计算器

**槽位**:
- skill (string) - required - extractor: regex
- version (string) - optional - extractor: regex
- source (string) - optional - extractor: llm

### skill.uninstall
**描述**: 卸载 Skill
**示例**:
- 卸载天气
- 删除这个插件
- 移除翻译功能

**槽位**:
- skill_id (string) - required - extractor: regex
- purge_data (boolean) - optional - extractor: llm

## 回退模式

- pattern: `^(?:安装|添加|给我装).+` -> skill.install (+0.15)
- pattern: `^(?:卸载|删除|移除).+` -> skill.uninstall (+0.15)
