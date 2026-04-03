import { ToolDefinition } from '../../../types';
import * as fs from 'fs/promises';
import * as path from 'path';

export const listSkillsTool: ToolDefinition = {
  name: 'list_skills',
  description: '列出当前已安装的所有 skills，返回 skill 名称、描述和路径信息。',
  parameters: [],
  handler: async () => {
    try {
      const skillsDir = path.join(process.cwd(), '.starup', 'skills');
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      const skills: { name: string; description: string; path: string }[] = [];
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(skillsDir, entry.name);
          const skillFile = path.join(skillPath, 'SKILL.md');
          let description = '';
          
          try {
            const content = await fs.readFile(skillFile, 'utf-8');
            const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (frontmatterMatch) {
              const yaml = frontmatterMatch[1];
              const descMatch = yaml.match(/description:\s*(.+)/);
              if (descMatch) {
                description = descMatch[1].trim();
              }
            }
          } catch {
            // 无法读取 SKILL.md，使用空描述
          }
          
          skills.push({
            name: entry.name,
            description,
            path: skillPath,
          });
        }
      }
      
      return {
        success: true,
        data: {
          count: skills.length,
          skills,
        },
      };
    } catch (error: any) {
      return { success: false, error: `列出 skills 失败：${error.message}` };
    }
  },
};
