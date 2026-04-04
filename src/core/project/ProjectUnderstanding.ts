/**
 * 项目理解引擎
 * 深度理解代码库结构：依赖图、模块关系、入口点识别
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/Logger';

export interface ProjectStructure {
  rootPath: string;
  name: string;
  type: 'node' | 'python' | 'go' | 'rust' | 'java' | 'unknown';
  entryPoints: EntryPoint[];
  modules: ModuleInfo[];
  dependencies: DependencyInfo[];
  configFiles: ConfigFile[];
}

export interface EntryPoint {
  file: string;
  type: 'cli' | 'api' | 'library' | 'test';
  description?: string;
}

export interface ModuleInfo {
  name: string;
  path: string;
  files: string[];
  exports: string[];
  imports: string[];
  dependencies: string[];
}

export interface DependencyInfo {
  name: string;
  version: string;
  type: 'production' | 'development' | 'peer';
  usage: string[]; // 哪些文件使用了这个依赖
}

export interface ConfigFile {
  name: string;
  path: string;
  type: 'build' | 'lint' | 'test' | 'ci' | 'package';
  content?: any;
}

export interface DependencyGraph {
  nodes: Array<{ id: string; type: 'file' | 'module' | 'external'; label: string }>;
  edges: Array<{ from: string; to: string; type: 'import' | 'export' | 'depend' }>;
}

/**
 * 项目理解引擎
 */
export class ProjectUnderstanding {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  /**
   * 分析项目结构
   */
  async analyze(): Promise<ProjectStructure> {
    logger.info('ProjectUnderstanding', `Analyzing project at ${this.projectPath}`);

    const projectType = await this.detectProjectType();
    const entryPoints = await this.findEntryPoints(projectType);
    const modules = await this.analyzeModules(projectType);
    const dependencies = await this.analyzeDependencies(projectType);
    const configFiles = await this.findConfigFiles();

    const structure: ProjectStructure = {
      rootPath: this.projectPath,
      name: path.basename(this.projectPath),
      type: projectType,
      entryPoints,
      modules,
      dependencies,
      configFiles,
    };

    logger.info('ProjectUnderstanding', `Analysis complete: ${modules.length} modules, ${dependencies.length} dependencies`);

    return structure;
  }

  /**
   * 检测项目类型
   */
  private async detectProjectType(): Promise<ProjectStructure['type']> {
    const files = await fs.readdir(this.projectPath);

    if (files.includes('package.json')) return 'node';
    if (files.includes('requirements.txt') || files.includes('setup.py') || files.includes('pyproject.toml')) return 'python';
    if (files.includes('go.mod')) return 'go';
    if (files.includes('Cargo.toml')) return 'rust';
    if (files.includes('pom.xml') || files.includes('build.gradle')) return 'java';

    // 检查子目录
    try {
      const srcFiles = await fs.readdir(path.join(this.projectPath, 'src'));
      if (srcFiles.some(f => f.endsWith('.go'))) return 'go';
      if (srcFiles.some(f => f.endsWith('.rs'))) return 'rust';
      if (srcFiles.some(f => f.endsWith('.java'))) return 'java';
      if (srcFiles.some(f => f.endsWith('.py'))) return 'python';
    } catch {
      // src 目录不存在
    }

    return 'unknown';
  }

  /**
   * 查找入口点
   */
  private async findEntryPoints(type: ProjectStructure['type']): Promise<EntryPoint[]> {
    const entryPoints: EntryPoint[] = [];

    switch (type) {
      case 'node':
        try {
          const packageJson = JSON.parse(await fs.readFile(path.join(this.projectPath, 'package.json'), 'utf-8'));
          
          // 检查 main 字段
          if (packageJson.main) {
            entryPoints.push({
              file: packageJson.main,
              type: 'library',
              description: 'Main entry point',
            });
          }

          // 检查 bin 字段
          if (packageJson.bin) {
            if (typeof packageJson.bin === 'string') {
              entryPoints.push({
                file: packageJson.bin,
                type: 'cli',
                description: 'CLI entry point',
              });
            } else {
              for (const [name, file] of Object.entries(packageJson.bin)) {
                entryPoints.push({
                  file: file as string,
                  type: 'cli',
                  description: `CLI command: ${name}`,
                });
              }
            }
          }

          // 检查 scripts
          if (packageJson.scripts) {
            if (packageJson.scripts.start) {
              entryPoints.push({
                file: 'package.json:start',
                type: 'api',
                description: 'Start script',
              });
            }
          }
        } catch {
          // package.json 不存在或无效
        }

        // 查找常见的入口文件
        const commonEntries = ['index.js', 'index.ts', 'main.js', 'main.ts', 'app.js', 'server.ts'];
        for (const entry of commonEntries) {
          try {
            await fs.access(path.join(this.projectPath, 'src', entry));
            entryPoints.push({
              file: `src/${entry}`,
              type: entry.includes('server') || entry.includes('app') ? 'api' : 'library',
            });
          } catch {
            try {
              await fs.access(path.join(this.projectPath, entry));
              entryPoints.push({
                file: entry,
                type: entry.includes('server') || entry.includes('app') ? 'api' : 'library',
              });
            } catch {
              // 文件不存在
            }
          }
        }
        break;

      case 'python':
        // 查找 __main__.py 或 main.py
        const pyEntries = ['__main__.py', 'main.py', 'app.py', 'server.py'];
        for (const entry of pyEntries) {
          try {
            await fs.access(path.join(this.projectPath, entry));
            entryPoints.push({
              file: entry,
              type: entry.includes('app') || entry.includes('server') ? 'api' : 'cli',
            });
          } catch {
            // 文件不存在
          }
        }
        break;

      case 'go':
        // 查找 main.go
        try {
          await fs.access(path.join(this.projectPath, 'main.go'));
          entryPoints.push({ file: 'main.go', type: 'cli' });
        } catch {
          // 扫描 cmd 目录
          try {
            const cmdDir = await fs.readdir(path.join(this.projectPath, 'cmd'));
            for (const dir of cmdDir) {
              entryPoints.push({
                file: `cmd/${dir}/main.go`,
                type: 'cli',
                description: `Command: ${dir}`,
              });
            }
          } catch {
            // cmd 目录不存在
          }
        }
        break;

      case 'rust':
        // 查找 src/main.rs 或 src/lib.rs
        try {
          await fs.access(path.join(this.projectPath, 'src', 'main.rs'));
          entryPoints.push({ file: 'src/main.rs', type: 'cli' });
        } catch {
          try {
            await fs.access(path.join(this.projectPath, 'src', 'lib.rs'));
            entryPoints.push({ file: 'src/lib.rs', type: 'library' });
          } catch {
            // 都不存在
          }
        }
        break;
    }

    return entryPoints;
  }

  /**
   * 分析模块结构
   */
  private async analyzeModules(type: ProjectStructure['type']): Promise<ModuleInfo[]> {
    const modules: ModuleInfo[] = [];

    const srcDir = type === 'node' ? 'src' : type === 'rust' ? 'src' : '.';
    const srcPath = path.join(this.projectPath, srcDir);

    try {
      const scanModule = async (dirPath: string, moduleName: string): Promise<ModuleInfo> => {
        const moduleInfo: ModuleInfo = {
          name: moduleName,
          path: dirPath,
          files: [],
          exports: [],
          imports: [],
          dependencies: [],
        };

        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            const subModule = await scanModule(fullPath, entry.name);
            modules.push(subModule);
          } else if (this.isSourceFile(entry.name, type)) {
            moduleInfo.files.push(fullPath);
            
            // 分析导入/导出
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const { imports, exports } = this.extractImportsExports(content, type);
              moduleInfo.imports.push(...imports);
              moduleInfo.exports.push(...exports);
            } catch {
              // 读取失败，忽略
            }
          }
        }

        return moduleInfo;
      };

      const rootModule = await scanModule(srcPath, 'root');
      modules.unshift(rootModule);
    } catch {
      // src 目录不存在
    }

    return modules;
  }

  /**
   * 分析依赖
   */
  private async analyzeDependencies(type: ProjectStructure['type']): Promise<DependencyInfo[]> {
    const dependencies: DependencyInfo[] = [];

    switch (type) {
      case 'node':
        try {
          const packageJson = JSON.parse(await fs.readFile(path.join(this.projectPath, 'package.json'), 'utf-8'));

          // 生产依赖
          for (const [name, version] of Object.entries(packageJson.dependencies || {})) {
            dependencies.push({
              name,
              version: version as string,
              type: 'production',
              usage: [],
            });
          }

          // 开发依赖
          for (const [name, version] of Object.entries(packageJson.devDependencies || {})) {
            dependencies.push({
              name,
              version: version as string,
              type: 'development',
              usage: [],
            });
          }
        } catch {
          // package.json 不存在
        }
        break;

      case 'python':
        try {
          const requirements = await fs.readFile(path.join(this.projectPath, 'requirements.txt'), 'utf-8');
          const lines = requirements.split('\n');
          for (const line of lines) {
            const match = line.match(/^([a-zA-Z0-9_-]+)([=<>!~]+)?(.*)?$/);
            if (match) {
              dependencies.push({
                name: match[1],
                version: match[3] || '*',
                type: 'production',
                usage: [],
              });
            }
          }
        } catch {
          // requirements.txt 不存在
        }
        break;

      case 'go':
        try {
          const goMod = await fs.readFile(path.join(this.projectPath, 'go.mod'), 'utf-8');
          const lines = goMod.split('\n');
          let inRequire = false;
          for (const line of lines) {
            if (line.includes('require (')) {
              inRequire = true;
            } else if (line.includes(')') && inRequire) {
              inRequire = false;
            } else if (inRequire || line.trim().startsWith('require ')) {
              const match = line.match(/([\w\/.-]+)\s+v?([\d.]+)/);
              if (match) {
                dependencies.push({
                  name: match[1],
                  version: match[2],
                  type: 'production',
                  usage: [],
                });
              }
            }
          }
        } catch {
          // go.mod 不存在
        }
        break;

      case 'rust':
        try {
          const cargoToml = await fs.readFile(path.join(this.projectPath, 'Cargo.toml'), 'utf-8');
          const lines = cargoToml.split('\n');
          let inDeps = false;
          for (const line of lines) {
            if (line.startsWith('[dependencies]')) {
              inDeps = true;
            } else if (line.startsWith('[') && inDeps) {
              inDeps = false;
            } else if (inDeps) {
              const match = line.match(/^([\w-]+)\s*=\s*"?([^"]*)"?/);
              if (match) {
                dependencies.push({
                  name: match[1],
                  version: match[2],
                  type: 'production',
                  usage: [],
                });
              }
            }
          }
        } catch {
          // Cargo.toml 不存在
        }
        break;
    }

    return dependencies;
  }

  /**
   * 查找配置文件
   */
  private async findConfigFiles(): Promise<ConfigFile[]> {
    const configFiles: ConfigFile[] = [];

    const configPatterns = [
      { name: 'package.json', type: 'package' as const },
      { name: 'tsconfig.json', type: 'build' as const },
      { name: 'webpack.config.js', type: 'build' as const },
      { name: 'rollup.config.js', type: 'build' as const },
      { name: 'vite.config.ts', type: 'build' as const },
      { name: '.eslintrc.js', type: 'lint' as const },
      { name: '.eslintrc.json', type: 'lint' as const },
      { name: 'jest.config.js', type: 'test' as const },
      { name: 'vitest.config.ts', type: 'test' as const },
      { name: '.github/workflows/ci.yml', type: 'ci' as const },
      { name: 'Dockerfile', type: 'build' as const },
    ];

    for (const { name, type } of configPatterns) {
      try {
        await fs.access(path.join(this.projectPath, name));
        configFiles.push({ name, path: name, type });
      } catch {
        // 文件不存在
      }
    }

    return configFiles;
  }

  /**
   * 生成依赖图
   */
  async generateDependencyGraph(): Promise<DependencyGraph> {
    const nodes: DependencyGraph['nodes'] = [];
    const edges: DependencyGraph['edges'] = [];
    const nodeSet = new Set<string>();

    const addNode = (id: string, type: 'file' | 'module' | 'external', label: string) => {
      if (!nodeSet.has(id)) {
        nodes.push({ id, type, label });
        nodeSet.add(id);
      }
    };

    const scanDir = async (dirPath: string) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(this.projectPath, fullPath);

          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await scanDir(fullPath);
          } else if (this.isSourceFile(entry.name, 'node')) {
            addNode(relativePath, 'file', entry.name);

            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const imports = this.extractTypeScriptImports(content);

              for (const imp of imports) {
                if (imp.startsWith('.')) {
                  // 本地导入
                  const resolvedPath = path.join(path.dirname(relativePath), imp);
                  edges.push({ from: relativePath, to: resolvedPath, type: 'import' });
                } else {
                  // 外部依赖
                  addNode(imp, 'external', imp);
                  edges.push({ from: relativePath, to: imp, type: 'depend' });
                }
              }
            } catch {
              // 读取失败
            }
          }
        }
      } catch {
        // 目录不存在
      }
    };

    await scanDir(path.join(this.projectPath, 'src'));

    return { nodes, edges };
  }

  /**
   * 检查是否是源文件
   */
  private isSourceFile(filename: string, type: ProjectStructure['type']): boolean {
    const ext = path.extname(filename);
    switch (type) {
      case 'node':
        return ['.ts', '.tsx', '.js', '.jsx'].includes(ext);
      case 'python':
        return ext === '.py';
      case 'go':
        return ext === '.go';
      case 'rust':
        return ext === '.rs';
      case 'java':
        return ext === '.java';
      default:
        return ['.ts', '.js', '.py', '.go', '.rs'].includes(ext);
    }
  }

  /**
   * 提取导入和导出
   */
  private extractImportsExports(content: string, type: ProjectStructure['type']): { imports: string[]; exports: string[] } {
    const imports: string[] = [];
    const exports: string[] = [];

    if (type === 'node') {
      // TypeScript/JavaScript
      const importRegex = /import\s+(?:(?:\{[^}]*\}|[^'"]*)\s+from\s+)?['"]([^'"]+)['"]/g;
      const exportRegex = /export\s+(?:default\s+)?(?:class|interface|function|const|let|var)?\s*(\w+)/g;

      let match;
      while ((match = importRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }
      while ((match = exportRegex.exec(content)) !== null) {
        exports.push(match[1]);
      }
    }

    return { imports, exports };
  }

  /**
   * 提取 TypeScript 导入
   */
  private extractTypeScriptImports(content: string): string[] {
    const imports: string[] = [];
    const importRegex = /import\s+(?:(?:\{[^}]*\}|[^'"]*)\s+from\s+)?['"]([^'"]+)['"]/g;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  /**
   * 生成项目摘要
   */
  generateSummary(structure: ProjectStructure): string {
    let summary = `# 项目分析报告\n\n`;
    summary += `## 基本信息\n\n`;
    summary += `- **项目名称**: ${structure.name}\n`;
    summary += `- **项目类型**: ${structure.type}\n`;
    summary += `- **根目录**: ${structure.rootPath}\n\n`;

    if (structure.entryPoints.length > 0) {
      summary += `## 入口点\n\n`;
      for (const entry of structure.entryPoints) {
        summary += `- **${entry.file}** (${entry.type})${entry.description ? `: ${entry.description}` : ''}\n`;
      }
      summary += '\n';
    }

    if (structure.modules.length > 0) {
      summary += `## 模块结构\n\n`;
      for (const module of structure.modules.slice(0, 10)) {
        summary += `- **${module.name}**: ${module.files.length} files\n`;
      }
      if (structure.modules.length > 10) {
        summary += `- ... 还有 ${structure.modules.length - 10} 个模块\n`;
      }
      summary += '\n';
    }

    if (structure.dependencies.length > 0) {
      summary += `## 依赖统计\n\n`;
      const prod = structure.dependencies.filter(d => d.type === 'production').length;
      const dev = structure.dependencies.filter(d => d.type === 'development').length;
      summary += `- 生产依赖: ${prod}\n`;
      summary += `- 开发依赖: ${dev}\n\n`;
    }

    if (structure.configFiles.length > 0) {
      summary += `## 配置文件\n\n`;
      const byType: Record<string, string[]> = {};
      for (const config of structure.configFiles) {
        if (!byType[config.type]) byType[config.type] = [];
        byType[config.type].push(config.name);
      }
      for (const [type, files] of Object.entries(byType)) {
        summary += `- **${type}**: ${files.join(', ')}\n`;
      }
    }

    return summary;
  }
}

// 单例导出
export const projectUnderstanding = new ProjectUnderstanding(process.cwd());
