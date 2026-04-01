# core.updater 意图定义

## 意图定义

### skill.update
**描述**: 更新 Skill
**示例**:
- 更新所有技能
- 升级到最新版
- 更新天气插件

**槽位**:
- skill_id (string) - optional - extractor: regex
- force (boolean) - optional - extractor: llm

## 回退模式

- pattern: `^(?:更新|升级).*(?:skill|插件|功能|所有|全部)` -> skill.update (+0.15)
- pattern: `^(?:把|将).+(?:更新|升级)` -> skill.update (+0.15)
