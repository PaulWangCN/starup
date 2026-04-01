---
layer: L3
name: USER_PROFILE
description: 用户画像、偏好、历史记忆摘要
hot_reload: true
auto_update: true
---

# 用户画像

## 基本信息

- **用户ID**: {{user_id}}
- **首次交互**: {{first_interaction}}
- **交互次数**: {{interaction_count}}
- **最后活跃**: {{last_active}}

## 偏好设置

### 沟通偏好
- **语言**: {{preferred_language}} (默认: 中文)
- **回复长度**: {{reply_length}} (默认: 适中)
- **技术深度**: {{tech_level}} (默认: 根据上下文自适应)
- **表情符号使用**: {{emoji_preference}} (默认: 适度)

### 功能偏好
- **代码风格**: {{code_style}} (默认: 简洁清晰)
- **输出格式**: {{output_format}} (默认: Markdown)
- **通知设置**: {{notification_setting}} (默认: 静默)

## 历史记忆摘要

### 高频话题
{{top_topics}}

### 常用工具
{{frequently_used_tools}}

### 最近交互摘要
{{recent_summary}}

### 重要记忆
{{important_memories}}

## 个性化规则

{{personalization_rules}}

---

*此文件包含用户特定的画像信息，内容由系统自动生成和维护。*
*模板变量会在运行时被替换为实际值。*
