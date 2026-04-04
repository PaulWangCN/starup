/**
 * 项目理解工具
 * 允许 Agent 查询项目结构、API 端点、数据库实体等
 */

import { ToolDefinition } from '../../../types';
import { advancedProjectUnderstanding } from '../../project/AdvancedProjectUnderstanding';

export const projectUnderstandTool: ToolDefinition = {
  name: 'project_understand',
  description: `理解当前项目的结构、架构和代码组织。
可以获取以下信息：
- 项目整体架构和模块划分
- API 端点列表和详情
- 数据库实体和关系
- 服务层组件
- 依赖关系和数据流
- 代码复杂度分析

适用于：
- 需要了解项目整体架构时
- 查找特定 API 实现位置
- 理解数据库模型
- 分析代码模块依赖
- 生成项目文档`,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: `查询类型：
- 'overview': 项目概览
- 'apis': API 端点列表
- 'entities': 数据库实体
- 'services': 服务层组件
- 'modules': 所有模块
- 'dependencies': 依赖分析
- 'flow': 数据流追踪 (需要指定 endpoint 参数)
- 'complexity': 复杂度分析`,
      required: true,
    },
    {
      name: 'endpoint',
      type: 'string',
      description: '当 query=flow 时，指定 API 端点路径',
      required: false,
    },
    {
      name: 'format',
      type: 'string',
      description: '返回格式: summary(摘要) | detailed(详细) | report(完整报告)',
      required: false,
      default: 'summary',
    },
  ],
  handler: async (args) => {
    if (!advancedProjectUnderstanding) {
      return {
        success: false,
        error: '项目理解引擎未初始化',
      };
    }

    const context = advancedProjectUnderstanding.getContext();
    if (!context) {
      return {
        success: false,
        error: '项目分析尚未完成，请稍后重试',
      };
    }

    const { query, endpoint, format = 'summary' } = args;
    const m = context.metadata;

    try {
      switch (query) {
        case 'overview': {
          return {
            success: true,
            data: {
              name: context.name,
              type: context.type,
              language: context.language,
              framework: context.framework,
              architecture: context.architecture,
              stats: {
                files: m.totalFiles,
                lines: m.totalLines,
                modules: m.modules.length,
                apis: m.apiEndpoints?.length || 0,
                entities: m.databaseEntities?.length || 0,
                services: m.services?.length || 0,
              },
            },
          };
        }

        case 'apis': {
          const apis = m.apiEndpoints || [];
          if (format === 'summary') {
            return {
              success: true,
              data: {
                count: apis.length,
                endpoints: apis.slice(0, 20).map(api => ({
                  method: api.method,
                  path: api.path,
                  handler: `${api.controller}.${api.handler}`,
                })),
              },
            };
          }
          return {
            success: true,
            data: { apis },
          };
        }

        case 'entities': {
          const entities = m.databaseEntities || [];
          return {
            success: true,
            data: {
              count: entities.length,
              entities: entities.map(e => ({
                name: e.name,
                table: e.table,
                fields: e.fields.map(f => f.name),
                relations: e.relations,
              })),
            },
          };
        }

        case 'services': {
          const services = m.services || [];
          return {
            success: true,
            data: {
              count: services.length,
              services: services.map(s => ({
                name: s.name,
                type: s.type,
                methods: s.methods.length,
                file: s.file,
              })),
            },
          };
        }

        case 'modules': {
          const byType: Record<string, string[]> = {};
          for (const mod of m.modules) {
            if (!byType[mod.type]) byType[mod.type] = [];
            byType[mod.type].push(mod.name);
          }
          return {
            success: true,
            data: { modules: byType },
          };
        }

        case 'dependencies': {
          const deps = m.dependencies.filter(d => d.type === 'production').slice(0, 30);
          return {
            success: true,
            data: {
              total: m.dependencies.length,
              production: deps.map(d => ({ name: d.name, version: d.version })),
            },
          };
        }

        case 'flow': {
          if (!endpoint) {
            return {
              success: false,
              error: '追踪数据流需要提供 endpoint 参数',
            };
          }
          const flow = await advancedProjectUnderstanding.traceDataFlow(endpoint);
          if (!flow) {
            return {
              success: false,
              error: `未找到端点: ${endpoint}`,
            };
          }
          return {
            success: true,
            data: flow,
          };
        }

        case 'complexity': {
          const complexModules = m.modules
            .filter(m => m.complexity.cyclomatic > 10 || m.complexity.maintainability < 50)
            .sort((a, b) => a.complexity.maintainability - b.complexity.maintainability)
            .slice(0, 10);
          
          return {
            success: true,
            data: {
              averageMaintainability: Math.round(
                m.modules.reduce((sum, m) => sum + m.complexity.maintainability, 0) / m.modules.length
              ),
              highComplexity: complexModules.map(m => ({
                name: m.name,
                path: m.path,
                cyclomatic: m.complexity.cyclomatic,
                maintainability: m.complexity.maintainability,
              })),
            },
          };
        }

        case 'report': {
          const report = advancedProjectUnderstanding.generateReport();
          return {
            success: true,
            data: { report },
          };
        }

        default:
          return {
            success: false,
            error: `未知查询类型: ${query}。可用类型: overview, apis, entities, services, modules, dependencies, flow, complexity, report`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `查询失败: ${error}`,
      };
    }
  },
};
