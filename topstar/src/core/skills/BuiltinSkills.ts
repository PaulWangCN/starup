/**
 * 内置 Skill 列表
 * 当 Hub 无法访问时作为 fallback 使用
 */

export interface BuiltinSkillInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  install_url?: string;
}

/**
 * 内置 Skill 列表
 * 这些 skill 可以通过常见的 ID 直接安装
 */
export const BUILTIN_SKILLS: BuiltinSkillInfo[] = [
  {
    id: 'web_search',
    name: 'Web Search',
    version: '1.0.0',
    description: '网络搜索功能，支持多搜索引擎',
    author: 'community',
    tags: ['search', 'web', 'internet'],
  },
  {
    id: 'search',
    name: 'Search',
    version: '1.0.0',
    description: '通用搜索技能',
    author: 'community',
    tags: ['search'],
  },
  {
    id: 'weather',
    name: 'Weather',
    version: '1.0.0',
    description: '天气查询功能',
    author: 'community',
    tags: ['weather', 'forecast'],
  },
  {
    id: 'translator',
    name: 'Translator',
    version: '1.0.0',
    description: '翻译功能，支持多语言互译',
    author: 'community',
    tags: ['translate', 'language'],
  },
  {
    id: 'code_review',
    name: 'Code Review',
    version: '1.0.0',
    description: '代码审查功能',
    author: 'community',
    tags: ['code', 'review', 'development'],
  },
  {
    id: 'git_helper',
    name: 'Git Helper',
    version: '1.0.0',
    description: 'Git 操作辅助',
    author: 'community',
    tags: ['git', 'version-control'],
  },
  {
    id: 'file_manager',
    name: 'File Manager',
    version: '1.0.0',
    description: '文件管理增强',
    author: 'community',
    tags: ['file', 'filesystem'],
  },
  {
    id: 'note_taker',
    name: 'Note Taker',
    version: '1.0.0',
    description: '笔记记录功能',
    author: 'community',
    tags: ['note', 'productivity'],
  },
];

/**
 * 搜索内置 Skill
 */
export function searchBuiltinSkills(query: string): BuiltinSkillInfo[] {
  const queryLower = query.toLowerCase();
  return BUILTIN_SKILLS.filter(skill => 
    skill.id.toLowerCase().includes(queryLower) ||
    skill.name.toLowerCase().includes(queryLower) ||
    skill.description.toLowerCase().includes(queryLower) ||
    skill.tags.some(tag => tag.toLowerCase().includes(queryLower))
  );
}

/**
 * 获取内置 Skill
 */
export function getBuiltinSkill(id: string): BuiltinSkillInfo | undefined {
  return BUILTIN_SKILLS.find(skill => skill.id.toLowerCase() === id.toLowerCase());
}
