/**
 * 高级项目理解引擎
 * 
 * 核心能力：
 * 1. TypeScript/JavaScript - 使用 TS Compiler API 深度分析
 * 2. Java/Spring - 解析 Maven/Gradle + Java AST 分析
 * 3. Python/Go/Rust - 增强的静态分析
 * 4. 代码语义理解 - LLM 辅助分析
 * 5. 架构模式识别 - MVC/Microservices/Layered 等
 * 6. 数据流追踪 - 从 API 到 DB 的完整链路
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as ts from 'typescript';
import { logger } from '../../utils/Logger';
import { LLMService } from '../llm/LLMService';
import { glob } from 'glob';

// ==================== 类型定义 ====================

export interface ProjectContext {
  rootPath: string;
  name: string;
  type: ProjectType;
  language: LanguageType;
  framework?: string;
  architecture?: ArchitecturePattern;
  metadata: ProjectMetadata;
}

export type ProjectType = 'application' | 'library' | 'service' | 'monorepo';
export type LanguageType = 'typescript' | 'javascript' | 'java' | 'python' | 'go' | 'rust' | 'kotlin';
export type ArchitecturePattern = 'mvc' | 'microservices' | 'layered' | 'clean' | 'hexagonal' | 'serverless' | 'unknown';

export interface ProjectMetadata {
  totalFiles: number;
  totalLines: number;
  entryPoints: EntryPoint[];
  modules: Module[];
  dependencies: Dependency[];
  configFiles: ConfigFile[];
  databaseEntities?: DatabaseEntity[];
  apiEndpoints?: APIEndpoint[];
  services?: ServiceInfo[];
}

export interface EntryPoint {
  file: string;
  type: 'cli' | 'api' | 'library' | 'test' | 'worker';
  description: string;
  framework?: string;
}

export interface Module {
  id: string;
  name: string;
  path: string;
  type: 'controller' | 'service' | 'repository' | 'entity' | 'component' | 'util' | 'config';
  exports: SymbolInfo[];
  imports: ImportInfo[];
  dependencies: string[];
  complexity: ComplexityMetrics;
  documentation?: string;
}

export interface SymbolInfo {
  name: string;
  type: 'class' | 'interface' | 'function' | 'variable' | 'enum';
  visibility: 'public' | 'protected' | 'private';
  signature?: string;
  documentation?: string;
  decorators?: string[];
  parameters?: ParameterInfo[];
  methods?: MethodInfo[];
  extends?: string[];
  implements?: string[];
}

export interface MethodInfo {
  name: string;
  visibility: 'public' | 'protected' | 'private';
  returnType: string;
  parameters: ParameterInfo[];
  decorators?: string[];
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  route?: string;
  async: boolean;
  complexity: number;
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
  decorators?: string[];
}

export interface ImportInfo {
  source: string;
  symbols: string[];
  isExternal: boolean;
}

export interface Dependency {
  name: string;
  version: string;
  type: 'production' | 'development' | 'peer';
  usedBy: string[];
  description?: string;
}

export interface ConfigFile {
  name: string;
  path: string;
  type: 'build' | 'lint' | 'test' | 'ci' | 'package' | 'database' | 'docker';
  content?: any;
}

export interface DatabaseEntity {
  name: string;
  table: string;
  fields: EntityField[];
  relations: EntityRelation[];
  file: string;
}

export interface EntityField {
  name: string;
  type: string;
  nullable: boolean;
  isPrimary: boolean;
  isIndexed: boolean;
  defaultValue?: string;
}

export interface EntityRelation {
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  target: string;
  field: string;
  inverseField?: string;
}

export interface APIEndpoint {
  method: string;
  path: string;
  controller: string;
  handler: string;
  parameters: ParameterInfo[];
  requestBody?: string;
  responseType?: string;
  authentication?: boolean;
  file: string;
  line: number;
}

export interface ServiceInfo {
  name: string;
  type: 'business' | 'data' | 'external' | 'utility';
  dependencies: string[];
  dependents: string[];
  methods: MethodInfo[];
  file: string;
}

export interface ComplexityMetrics {
  cyclomatic: number;
  cognitive: number;
  lines: number;
  maintainability: number; // 0-100
}

export interface DataFlow {
  entry: APIEndpoint;
  services: string[];
  repositories: string[];
  entities: string[];
  flow: string[];
}

// ==================== 主引擎 ====================

export class AdvancedProjectUnderstanding {
  private projectPath: string;
  private llmService?: LLMService;
  private program?: ts.Program;
  private checker?: ts.TypeChecker;
  private context: ProjectContext | null = null;

  constructor(projectPath: string, llmService?: LLMService) {
    this.projectPath = projectPath;
    this.llmService = llmService;
  }

  /**
   * 深度分析项目
   */
  async analyze(): Promise<ProjectContext> {
    logger.info('AdvancedProjectUnderstanding', `开始深度分析项目: ${this.projectPath}`);
    const startTime = Date.now();

    // 1. 检测项目类型
    const { type, language, framework } = await this.detectProjectType();

    // 2. 创建基础上下文
    this.context = {
      rootPath: this.projectPath,
      name: path.basename(this.projectPath),
      type,
      language,
      framework,
      metadata: {
        totalFiles: 0,
        totalLines: 0,
        entryPoints: [],
        modules: [],
        dependencies: [],
        configFiles: [],
      },
    };

    // 3. 按语言类型进行深度分析
    switch (language) {
      case 'typescript':
      case 'javascript':
        await this.analyzeTypeScriptProject();
        break;
      case 'java':
      case 'kotlin':
        await this.analyzeJavaProject();
        break;
      case 'python':
        await this.analyzePythonProject();
        break;
      case 'go':
        await this.analyzeGoProject();
        break;
    }

    // 4. 识别架构模式
    this.context.architecture = await this.detectArchitecturePattern();

    // 5. 使用 LLM 进行语义理解
    if (this.llmService) {
      await this.enhanceWithLLM();
    }

    const duration = Date.now() - startTime;
    logger.info('AdvancedProjectUnderstanding', 
      `分析完成: ${this.context.metadata.modules.length} 模块, ` +
      `${this.context.metadata.apiEndpoints?.length || 0} API端点, ` +
      `${this.context.metadata.databaseEntities?.length || 0} 实体, ` +
      `耗时 ${duration}ms`
    );

    return this.context;
  }

  /**
   * 获取分析结果
   */
  getContext(): ProjectContext | null {
    return this.context;
  }

  /**
   * 查找 API 到 DB 的数据流
   */
  async traceDataFlow(endpointPath: string): Promise<DataFlow | null> {
    if (!this.context) return null;

    const endpoint = this.context.metadata.apiEndpoints?.find(
      e => e.path === endpointPath
    );
    if (!endpoint) return null;

    const flow: DataFlow = {
      entry: endpoint,
      services: [],
      repositories: [],
      entities: [],
      flow: [endpoint.handler],
    };

    // 追踪调用链
    const visited = new Set<string>();
    const trace = (symbolName: string) => {
      if (visited.has(symbolName)) return;
      visited.add(symbolName);

      const module = this.context!.metadata.modules.find(m =>
        m.exports.some(e => e.name === symbolName)
      );
      if (!module) return;

      flow.flow.push(`${module.name}.${symbolName}`);

      if (module.type === 'service') {
        flow.services.push(module.name);
      } else if (module.type === 'repository') {
        flow.repositories.push(module.name);
      }

      // 递归追踪依赖
      for (const dep of module.dependencies) {
        trace(dep);
      }
    };

    trace(endpoint.handler);

    return flow;
  }

  /**
   * 生成项目报告
   */
  generateReport(): string {
    if (!this.context) return '未进行分析';

    const m = this.context.metadata;
    let report = `# 项目深度分析报告\n\n`;

    // 基本信息
    report += `## 📋 基本信息\n\n`;
    report += `- **项目名称**: ${this.context.name}\n`;
    report += `- **项目类型**: ${this.context.type}\n`;
    report += `- **主要语言**: ${this.context.language}\n`;
    report += `- **框架**: ${this.context.framework || '未知'}\n`;
    report += `- **架构模式**: ${this.context.architecture || '未知'}\n`;
    report += `- **文件总数**: ${m.totalFiles}\n`;
    report += `- **代码行数**: ${m.totalLines}\n\n`;

    // 入口点
    if (m.entryPoints.length > 0) {
      report += `## 🚀 入口点\n\n`;
      for (const ep of m.entryPoints) {
        report += `- **${ep.file}** \`${ep.type}\`\n`;
        if (ep.description) report += `  - ${ep.description}\n`;
      }
      report += '\n';
    }

    // API 端点
    if (m.apiEndpoints && m.apiEndpoints.length > 0) {
      report += `## 🔌 API 端点 (${m.apiEndpoints.length})\n\n`;
      for (const api of m.apiEndpoints.slice(0, 20)) {
        report += `- **${api.method}** \`${api.path}\`\n`;
        report += `  - 处理器: \`${api.controller}.${api.handler}\`\n`;
        if (api.authentication) report += `  - 🔒 需要认证\n`;
      }
      if (m.apiEndpoints.length > 20) {
        report += `- ... 还有 ${m.apiEndpoints.length - 20} 个端点\n`;
      }
      report += '\n';
    }

    // 数据库实体
    if (m.databaseEntities && m.databaseEntities.length > 0) {
      report += `## 🗄️ 数据库实体 (${m.databaseEntities.length})\n\n`;
      for (const entity of m.databaseEntities.slice(0, 15)) {
        report += `- **${entity.name}** (表: \`${entity.table}\`)\n`;
        report += `  - 字段: ${entity.fields.map(f => f.name).join(', ')}\n`;
      }
      if (m.databaseEntities.length > 15) {
        report += `- ... 还有 ${m.databaseEntities.length - 15} 个实体\n`;
      }
      report += '\n';
    }

    // 服务层
    if (m.services && m.services.length > 0) {
      report += `## ⚙️ 服务层 (${m.services.length})\n\n`;
      for (const svc of m.services.slice(0, 15)) {
        report += `- **${svc.name}** \`${svc.type}\`\n`;
        report += `  - 方法: ${svc.methods.length} 个\n`;
      }
      report += '\n';
    }

    // 模块结构
    report += `## 📦 模块结构\n\n`;
    const byType: Record<string, Module[]> = {};
    for (const mod of m.modules) {
      if (!byType[mod.type]) byType[mod.type] = [];
      byType[mod.type].push(mod);
    }
    for (const [type, modules] of Object.entries(byType)) {
      report += `- **${type}**: ${modules.length} 个\n`;
    }
    report += '\n';

    // 依赖
    report += `## 📚 主要依赖\n\n`;
    const prodDeps = m.dependencies.filter(d => d.type === 'production').slice(0, 15);
    for (const dep of prodDeps) {
      report += `- ${dep.name}@${dep.version}\n`;
    }
    report += '\n';

    return report;
  }

  // ==================== TypeScript/JavaScript 分析 ====================

  private async analyzeTypeScriptProject(): Promise<void> {
    logger.info('AdvancedProjectUnderstanding', '分析 TypeScript/JavaScript 项目');

    // 查找 tsconfig.json
    const configPath = ts.findConfigFile(this.projectPath, ts.sys.fileExists);
    
    if (configPath) {
      // 使用项目配置
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
      );
      this.program = ts.createProgram({
        rootNames: parsedConfig.fileNames,
        options: parsedConfig.options,
      });
    } else {
      // 扫描所有 TS/JS 文件
      const files = await this.findSourceFiles(['.ts', '.tsx', '.js', '.jsx']);
      this.program = ts.createProgram(files, {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        allowJs: true,
        checkJs: false,
      });
    }

    this.checker = this.program.getTypeChecker();

    // 分析每个源文件
    const sourceFiles = this.program.getSourceFiles().filter(sf => !sf.isDeclarationFile);
    
    for (const sourceFile of sourceFiles) {
      await this.analyzeTypeScriptFile(sourceFile);
    }

    // 统计信息
    this.context!.metadata.totalFiles = sourceFiles.length;
  }

  private async analyzeTypeScriptFile(sourceFile: ts.SourceFile): Promise<void> {
    const filePath = path.relative(this.projectPath, sourceFile.fileName);
    const module: Module = {
      id: `mod-${Buffer.from(filePath).toString('base64').slice(0, 8)}`,
      name: path.basename(filePath, path.extname(filePath)),
      path: filePath,
      type: this.detectModuleType(filePath),
      exports: [],
      imports: [],
      dependencies: [],
      complexity: { cyclomatic: 0, cognitive: 0, lines: 0, maintainability: 100 },
    };

    // 计算代码行数
    module.complexity.lines = sourceFile.getLineStarts().length;
    this.context!.metadata.totalLines += module.complexity.lines;

    // 遍历 AST
    const visit = (node: ts.Node) => {
      // 处理导入
      if (ts.isImportDeclaration(node)) {
        const importInfo = this.parseTypeScriptImport(node, sourceFile);
        if (importInfo) module.imports.push(importInfo);
      }

      // 处理类
      if (ts.isClassDeclaration(node) && node.name) {
        const symbol = this.parseTypeScriptClass(node, sourceFile);
        if (symbol) module.exports.push(symbol);
      }

      // 处理接口
      if (ts.isInterfaceDeclaration(node) && node.name) {
        const symbol = this.parseTypeScriptInterface(node, sourceFile);
        if (symbol) module.exports.push(symbol);
      }

      // 处理函数
      if (ts.isFunctionDeclaration(node) && node.name) {
        const symbol = this.parseTypeScriptFunction(node, sourceFile);
        if (symbol) module.exports.push(symbol);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // 解析依赖关系
    for (const imp of module.imports) {
      if (!imp.isExternal) {
        module.dependencies.push(imp.source);
      }
    }

    // 计算复杂度
    module.complexity = this.calculateComplexity(sourceFile);

    this.context!.metadata.modules.push(module);

    // 检测 API 端点
    if (module.type === 'controller') {
      const endpoints = this.extractAPIEndpointsFromModule(module, sourceFile);
      this.context!.metadata.apiEndpoints = [
        ...(this.context!.metadata.apiEndpoints || []),
        ...endpoints,
      ];
    }

    // 检测数据库实体
    if (module.type === 'entity') {
      const entities = this.extractDatabaseEntities(module, sourceFile);
      this.context!.metadata.databaseEntities = [
        ...(this.context!.metadata.databaseEntities || []),
        ...entities,
      ];
    }
  }

  private parseTypeScriptImport(
    node: ts.ImportDeclaration,
    sourceFile: ts.SourceFile
  ): ImportInfo | null {
    const moduleSpecifier = node.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) return null;

    const source = moduleSpecifier.text;
    const symbols: string[] = [];

    if (node.importClause) {
      if (node.importClause.name) {
        symbols.push(node.importClause.name.text);
      }
      if (node.importClause.namedBindings) {
        if (ts.isNamedImports(node.importClause.namedBindings)) {
          for (const element of node.importClause.namedBindings.elements) {
            symbols.push(element.name.text);
          }
        } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
          symbols.push(node.importClause.namedBindings.name.text);
        }
      }
    }

    return {
      source,
      symbols,
      isExternal: !source.startsWith('.') && !source.startsWith('/'),
    };
  }

  private parseTypeScriptClass(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile
  ): SymbolInfo | null {
    if (!node.name) return null;

    const name = node.name.text;
    const decorators = this.getDecorators(node);
    const methods: MethodInfo[] = [];

    // 解析方法
    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) && member.name) {
        const method = this.parseMethodDeclaration(member, decorators);
        if (method) methods.push(method);
      }
    }

    return {
      name,
      type: 'class',
      visibility: 'public',
      decorators,
      methods,
      extends: node.heritageClauses
        ?.flatMap(h => h.types.map(t => t.expression.getText(sourceFile))),
    };
  }

  private parseTypeScriptInterface(
    node: ts.InterfaceDeclaration,
    sourceFile: ts.SourceFile
  ): SymbolInfo {
    return {
      name: node.name.text,
      type: 'interface',
      visibility: 'public',
    };
  }

  private parseTypeScriptFunction(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile
  ): SymbolInfo | null {
    if (!node.name) return null;

    return {
      name: node.name.text,
      type: 'function',
      visibility: 'public',
    };
  }

  private parseMethodDeclaration(
    node: ts.MethodDeclaration,
    classDecorators: string[]
  ): MethodInfo | null {
    if (!node.name || !ts.isIdentifier(node.name)) return null;

    const name = node.name.text;
    const decorators = this.getDecorators(node);
    const isPublic = node.modifiers?.some(m => m.kind === ts.SyntaxKind.PublicKeyword);
    const isAsync = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword);

    // 解析 HTTP 方法
    let httpMethod: MethodInfo['httpMethod'] | undefined;
    let route: string | undefined;

    for (const dec of [...classDecorators, ...decorators]) {
      const httpMatch = dec.match(/@(Get|Post|Put|Delete|Patch)\s*\(?['"]([^'"]*)['"]\)?/);
      if (httpMatch) {
        httpMethod = httpMatch[1].toUpperCase() as MethodInfo['httpMethod'];
        route = httpMatch[2];
        break;
      }
    }

    return {
      name,
      visibility: isPublic ? 'public' : 'private',
      returnType: node.type?.getText() || 'void',
      parameters: this.parseParameters(node.parameters),
      decorators,
      httpMethod: httpMethod!,
      route: route!,
      async: isAsync || false,
      complexity: 1,
    };
  }

  private parseParameters(params: ts.NodeArray<ts.ParameterDeclaration>): ParameterInfo[] {
    return params.map(p => ({
      name: p.name.getText(),
      type: p.type?.getText() || 'any',
      optional: p.questionToken !== undefined,
      defaultValue: p.initializer?.getText(),
      decorators: this.getDecorators(p),
    }));
  }

  private getDecorators(node: ts.Node): string[] {
    const decorators: string[] = [];
    if ((node as any).decorators) {
      for (const dec of (node as any).decorators) {
        decorators.push(dec.expression.getText());
      }
    }
    return decorators;
  }

  private detectModuleType(filePath: string): Module['type'] {
    const lower = filePath.toLowerCase();
    if (lower.includes('controller')) return 'controller';
    if (lower.includes('service')) return 'service';
    if (lower.includes('repository') || lower.includes('dao')) return 'repository';
    if (lower.includes('entity') || lower.includes('model')) return 'entity';
    if (lower.includes('component')) return 'component';
    if (lower.includes('config')) return 'config';
    return 'util';
  }

  private extractAPIEndpointsFromModule(
    module: Module,
    sourceFile: ts.SourceFile
  ): APIEndpoint[] {
    const endpoints: APIEndpoint[] = [];

    for (const symbol of module.exports) {
      if (symbol.type === 'class' && symbol.methods) {
        for (const method of symbol.methods) {
          if (method.httpMethod) {
            endpoints.push({
              method: method.httpMethod,
              path: method.route || '/',
              controller: symbol.name,
              handler: method.name,
              parameters: method.parameters,
              authentication: symbol.decorators?.some(d => d.includes('Auth') || d.includes('Guard')),
              file: module.path,
              line: 1,
            });
          }
        }
      }
    }

    return endpoints;
  }

  private extractDatabaseEntities(
    module: Module,
    sourceFile: ts.SourceFile
  ): DatabaseEntity[] {
    const entities: DatabaseEntity[] = [];

    for (const symbol of module.exports) {
      if (symbol.decorators?.some(d => d.includes('Entity'))) {
        const entity: DatabaseEntity = {
          name: symbol.name,
          table: symbol.name.toLowerCase(),
          fields: [],
          relations: [],
          file: module.path,
        };

        // 从装饰器提取表名
        const entityDec = symbol.decorators.find(d => d.includes('Entity'));
        if (entityDec) {
          const tableMatch = entityDec.match(/@Entity\s*\(\s*['"]([^'"]+)['"]\s*\)/);
          if (tableMatch) entity.table = tableMatch[1];
        }

        entities.push(entity);
      }
    }

    return entities;
  }

  private calculateComplexity(sourceFile: ts.SourceFile): ComplexityMetrics {
    let cyclomatic = 1;
    let cognitive = 0;

    const visit = (node: ts.Node) => {
      // 圈复杂度：分支语句
      if (
        ts.isIfStatement(node) ||
        ts.isConditionalExpression(node) ||
        ts.isWhileStatement(node) ||
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isCaseClause(node) ||
        ts.isCatchClause(node)
      ) {
        cyclomatic++;
      }

      // 认知复杂度：嵌套增加复杂度
      if (ts.isIfStatement(node) || ts.isForStatement(node) || ts.isWhileStatement(node)) {
        cognitive++;
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    const lines = sourceFile.getLineStarts().length;
    // Halstead 估算的可维护性指数
    const maintainability = Math.max(0, 100 - (cyclomatic * 2) - (cognitive * 3) - (lines / 50));

    return { cyclomatic, cognitive, lines, maintainability };
  }

  // ==================== Java/Spring 分析 ====================

  private async analyzeJavaProject(): Promise<void> {
    logger.info('AdvancedProjectUnderstanding', '分析 Java/Spring 项目');

    // 1. 解析 Maven/Gradle 配置
    const dependencies = await this.parseJavaDependencies();
    this.context!.metadata.dependencies = dependencies;

    // 2. 检测是否为 Spring Boot
    const isSpringBoot = dependencies.some(d => d.name.includes('spring-boot'));
    if (isSpringBoot) {
      this.context!.framework = 'Spring Boot';
    }

    // 3. 扫描 Java 源文件
    const javaFiles = await this.findSourceFiles(['.java', '.kt']);
    this.context!.metadata.totalFiles = javaFiles.length;

    for (const file of javaFiles) {
      await this.analyzeJavaFile(file);
    }
  }

  private async parseJavaDependencies(): Promise<Dependency[]> {
    const dependencies: Dependency[] = [];

    // 解析 pom.xml (Maven)
    try {
      const pomContent = await fs.readFile(
        path.join(this.projectPath, 'pom.xml'),
        'utf-8'
      );
      
      // 提取依赖
      const depRegex = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*(?:<version>([^<]+)<\/version>)?\s*(?:<scope>([^<]+)<\/scope>)?/g;
      let match;
      while ((match = depRegex.exec(pomContent)) !== null) {
        dependencies.push({
          name: `${match[1]}:${match[2]}`,
          version: match[3] || 'unknown',
          type: match[4] === 'test' ? 'development' : 'production',
          usedBy: [],
        });
      }
    } catch {
      // pom.xml 不存在
    }

    // 解析 build.gradle (Gradle)
    try {
      const gradleContent = await fs.readFile(
        path.join(this.projectPath, 'build.gradle'),
        'utf-8'
      );

      // 解析 implementation/compile 依赖
      const depRegex = /(?:implementation|compile|compileOnly|testImplementation)\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = depRegex.exec(gradleContent)) !== null) {
        const parts = match[1].split(':');
        dependencies.push({
          name: parts.length > 1 ? `${parts[0]}:${parts[1]}` : parts[0],
          version: parts[2] || 'unknown',
          type: match[0].includes('test') ? 'development' : 'production',
          usedBy: [],
        });
      }
    } catch {
      // build.gradle 不存在
    }

    return dependencies;
  }

  private async analyzeJavaFile(filePath: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');
    const relativePath = path.relative(this.projectPath, filePath);

    const module: Module = {
      id: `mod-${Buffer.from(relativePath).toString('base64').slice(0, 8)}`,
      name: path.basename(filePath, path.extname(filePath)),
      path: relativePath,
      type: this.detectJavaModuleType(content),
      exports: [],
      imports: [],
      dependencies: [],
      complexity: { cyclomatic: 0, cognitive: 0, lines: 0, maintainability: 100 },
    };

    // 统计行数
    const lines = content.split('\n');
    module.complexity.lines = lines.length;
    this.context!.metadata.totalLines += lines.length;

    // 解析包声明
    const packageMatch = content.match(/package\s+([\w.]+);/);
    const packageName = packageMatch ? packageMatch[1] : '';

    // 解析导入
    const importRegex = /import\s+([\w.*]+);/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      module.imports.push({
        source: match[1],
        symbols: [match[1]],
        isExternal: !match[1].startsWith(packageName),
      });
    }

    // 解析类定义
    const classRegex = /(?:@\w+\s*)*(?:public\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g;
    while ((match = classRegex.exec(content)) !== null) {
      const symbol: SymbolInfo = {
        name: match[1],
        type: 'class',
        visibility: 'public',
        extends: match[2] ? [match[2]] : undefined,
        implements: match[3] ? match[3].split(',').map(s => s.trim()) : undefined,
        decorators: this.extractJavaAnnotations(content, match.index),
      };
      module.exports.push(symbol);
    }

    // 解析方法
    const methodRegex = /(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:<[\w,\s<>]+>\s+)?([\w<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)/g;
    while ((match = methodRegex.exec(content)) !== null) {
      const returnType = match[1];
      const methodName = match[2];
      const params = match[3];

      const method: MethodInfo = {
        name: methodName,
        visibility: 'public',
        returnType,
        parameters: this.parseJavaParameters(params),
        decorators: this.extractJavaAnnotations(content, match.index),
        async: false,
        complexity: 1,
      };

      // 检测 Spring 注解
      if (method.decorators?.some(d => d.includes('GetMapping'))) {
        method.httpMethod = 'GET';
        const routeMatch = content.slice(match.index).match(/@GetMapping\s*\(\s*["']([^"']+)["']\s*\)/);
        method.route = routeMatch ? routeMatch[1] : '/';
      }
      if (method.decorators?.some(d => d.includes('PostMapping'))) {
        method.httpMethod = 'POST';
      }
      if (method.decorators?.some(d => d.includes('PutMapping'))) {
        method.httpMethod = 'PUT';
      }
      if (method.decorators?.some(d => d.includes('DeleteMapping'))) {
        method.httpMethod = 'DELETE';
      }

      // 添加到最近的类
      if (module.exports.length > 0) {
        const lastClass = module.exports[module.exports.length - 1];
        if (!lastClass.methods) lastClass.methods = [];
        lastClass.methods.push(method);
      }
    }

    // 计算复杂度
    module.complexity.cyclomatic = this.calculateJavaComplexity(content);

    this.context!.metadata.modules.push(module);

    // 提取 Spring API 端点
    if (module.type === 'controller') {
      const endpoints = this.extractSpringEndpoints(module);
      this.context!.metadata.apiEndpoints = [
        ...(this.context!.metadata.apiEndpoints || []),
        ...endpoints,
      ];
    }

    // 提取 JPA 实体
    if (module.type === 'entity') {
      const entities = this.extractJPAEntities(module, content);
      this.context!.metadata.databaseEntities = [
        ...(this.context!.metadata.databaseEntities || []),
        ...entities,
      ];
    }
  }

  private detectJavaModuleType(content: string): Module['type'] {
    if (content.includes('@RestController') || content.includes('@Controller')) return 'controller';
    if (content.includes('@Service')) return 'service';
    if (content.includes('@Repository')) return 'repository';
    if (content.includes('@Entity')) return 'entity';
    if (content.includes('@Component')) return 'component';
    if (content.includes('@Configuration')) return 'config';
    return 'util';
  }

  private extractJavaAnnotations(content: string, position: number): string[] {
    const annotations: string[] = [];
    const beforeContent = content.slice(0, position);
    const lines = beforeContent.split('\n');
    
    // 向前查找注解
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('@')) {
        annotations.unshift(line);
      } else if (line && !line.startsWith('//') && !line.startsWith('/*')) {
        break;
      }
    }

    return annotations;
  }

  private parseJavaParameters(params: string): ParameterInfo[] {
    if (!params.trim()) return [];

    return params.split(',').map(p => {
      const parts = p.trim().split(/\s+/);
      if (parts.length >= 2) {
        return {
          name: parts[parts.length - 1].replace(/\[\]$/, ''),
          type: parts[parts.length - 2],
          optional: false,
        };
      }
      return { name: p.trim(), type: 'Object', optional: false };
    });
  }

  private calculateJavaComplexity(content: string): number {
    let complexity = 1;
    const keywords = ['if', 'for', 'while', 'case', 'catch', '&&', '||', '?'];
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${kw}\\b`, 'g');
      const matches = content.match(regex);
      if (matches) complexity += matches.length;
    }
    return complexity;
  }

  private extractSpringEndpoints(module: Module): APIEndpoint[] {
    const endpoints: APIEndpoint[] = [];

    for (const symbol of module.exports) {
      if (symbol.methods) {
        // 提取类级别的 RequestMapping
        let basePath = '';
        const classMapping = symbol.decorators?.find(d => d.includes('RequestMapping'));
        if (classMapping) {
          const match = classMapping.match(/["']([^"']+)["']/);
          if (match) basePath = match[1];
        }

        for (const method of symbol.methods) {
          if (method.httpMethod) {
            endpoints.push({
              method: method.httpMethod,
              path: basePath + (method.route || ''),
              controller: symbol.name,
              handler: method.name,
              parameters: method.parameters,
              file: module.path,
              line: 1,
            });
          }
        }
      }
    }

    return endpoints;
  }

  private extractJPAEntities(module: Module, content: string): DatabaseEntity[] {
    const entities: DatabaseEntity[] = [];

    for (const symbol of module.exports) {
      if (symbol.decorators?.some(d => d.includes('@Entity'))) {
        const entity: DatabaseEntity = {
          name: symbol.name,
          table: symbol.name.toLowerCase(),
          fields: [],
          relations: [],
          file: module.path,
        };

        // 提取 @Table 注解
        const tableDec = symbol.decorators.find(d => d.includes('@Table'));
        if (tableDec) {
          const match = tableDec.match(/name\s*=\s*["']([^"']+)["']/);
          if (match) entity.table = match[1];
        }

        // 解析字段
        const fieldRegex = /(?:@(\w+)\s*)*(?:private|protected|public)\s+(\w+)\s+(\w+)\s*;/g;
        let match;
        while ((match = fieldRegex.exec(content)) !== null) {
          const annotations = match[1] ? match[1].split(' ') : [];
          entity.fields.push({
            name: match[3],
            type: match[2],
            nullable: !annotations.includes('NotNull') && !annotations.includes('Column'),
            isPrimary: annotations.includes('Id'),
            isIndexed: annotations.includes('Indexed') || annotations.includes('Column'),
          });
        }

        entities.push(entity);
      }
    }

    return entities;
  }

  // ==================== Python/Go 分析（简化版） ====================

  private async analyzePythonProject(): Promise<void> {
    logger.info('AdvancedProjectUnderstanding', '分析 Python 项目');
    
    const pyFiles = await this.findSourceFiles(['.py']);
    this.context!.metadata.totalFiles = pyFiles.length;

    for (const file of pyFiles) {
      const content = await fs.readFile(file, 'utf-8');
      const lines = content.split('\n').length;
      this.context!.metadata.totalLines += lines;

      const relativePath = path.relative(this.projectPath, file);
      
      // 检测 Flask/Django
      if (content.includes('from flask import') || content.includes('import flask')) {
        this.context!.framework = 'Flask';
      } else if (content.includes('from django') || content.includes('import django')) {
        this.context!.framework = 'Django';
      } else if (content.includes('from fastapi import') || content.includes('import fastapi')) {
        this.context!.framework = 'FastAPI';
      }

      // 解析导入
      const imports: ImportInfo[] = [];
      const importRegex = /(?:from\s+([\w.]+)\s+import\s+([\w,\s]+)|import\s+([\w.]+))/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        if (match[1]) {
          imports.push({
            source: match[1],
            symbols: match[2].split(',').map(s => s.trim()),
            isExternal: !match[1].startsWith('.'),
          });
        } else if (match[3]) {
          imports.push({
            source: match[3],
            symbols: [],
            isExternal: !match[3].startsWith('.'),
          });
        }
      }

      this.context!.metadata.modules.push({
        id: `mod-${Buffer.from(relativePath).toString('base64').slice(0, 8)}`,
        name: path.basename(file, '.py'),
        path: relativePath,
        type: 'util',
        exports: [],
        imports,
        dependencies: imports.filter(i => !i.isExternal).map(i => i.source),
        complexity: { cyclomatic: 1, cognitive: 0, lines, maintainability: 100 },
      });
    }
  }

  private async analyzeGoProject(): Promise<void> {
    logger.info('AdvancedProjectUnderstanding', '分析 Go 项目');

    const goFiles = await this.findSourceFiles(['.go']);
    this.context!.metadata.totalFiles = goFiles.length;

    for (const file of goFiles) {
      const content = await fs.readFile(file, 'utf-8');
      const lines = content.split('\n').length;
      this.context!.metadata.totalLines += lines;

      const relativePath = path.relative(this.projectPath, file);

      // 解析导入
      const imports: ImportInfo[] = [];
      const importBlock = content.match(/import\s*\(([^)]+)\)|import\s+"([^"]+)"/);
      if (importBlock) {
        const importContent = importBlock[1] || importBlock[2];
        const importLines = importContent.split('\n');
        for (const line of importLines) {
          const match = line.match(/"([^"]+)"/);
          if (match) {
            imports.push({
              source: match[1],
              symbols: [],
              isExternal: !match[1].includes('.'),
            });
          }
        }
      }

      this.context!.metadata.modules.push({
        id: `mod-${Buffer.from(relativePath).toString('base64').slice(0, 8)}`,
        name: path.basename(file, '.go'),
        path: relativePath,
        type: 'util',
        exports: [],
        imports,
        dependencies: [],
        complexity: { cyclomatic: 1, cognitive: 0, lines, maintainability: 100 },
      });
    }
  }

  // ==================== 通用工具方法 ====================

  private async detectProjectType(): Promise<{ type: ProjectType; language: LanguageType; framework?: string }> {
    const files = await fs.readdir(this.projectPath);

    // TypeScript/JavaScript
    if (files.includes('package.json')) {
      const packageJson = JSON.parse(await fs.readFile(path.join(this.projectPath, 'package.json'), 'utf-8'));
      
      // 检测框架
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      if (deps['@nestjs/core']) return { type: 'application', language: 'typescript', framework: 'NestJS' };
      if (deps['express']) return { type: 'application', language: 'typescript', framework: 'Express' };
      if (deps['fastify']) return { type: 'application', language: 'typescript', framework: 'Fastify' };
      if (deps['koa']) return { type: 'application', language: 'typescript', framework: 'Koa' };
      if (deps['next']) return { type: 'application', language: 'typescript', framework: 'Next.js' };
      if (deps['react']) return { type: 'application', language: 'typescript', framework: 'React' };
      if (deps['vue']) return { type: 'application', language: 'typescript', framework: 'Vue' };
      
      if (packageJson.name?.startsWith('@')) return { type: 'library', language: 'typescript' };
      if (packageJson.main || packageJson.module) return { type: 'library', language: 'typescript' };
      
      return { type: 'application', language: 'typescript' };
    }

    // Java/Kotlin
    if (files.includes('pom.xml') || files.includes('build.gradle')) {
      return { type: 'application', language: 'java', framework: 'Spring Boot' };
    }

    // Python
    if (files.includes('requirements.txt') || files.includes('setup.py') || files.includes('pyproject.toml')) {
      return { type: 'application', language: 'python' };
    }

    // Go
    if (files.includes('go.mod')) {
      return { type: 'application', language: 'go' };
    }

    // Rust
    if (files.includes('Cargo.toml')) {
      return { type: 'application', language: 'rust' };
    }

    return { type: 'application', language: 'typescript' };
  }

  private async detectArchitecturePattern(): Promise<ArchitecturePattern> {
    if (!this.context) return 'unknown';

    const modules = this.context.metadata.modules;
    const hasController = modules.some(m => m.type === 'controller');
    const hasService = modules.some(m => m.type === 'service');
    const hasRepository = modules.some(m => m.type === 'repository');
    const hasEntity = modules.some(m => m.type === 'entity');

    // Layered Architecture (Controller-Service-Repository)
    if (hasController && hasService && hasRepository) {
      return 'layered';
    }

    // Clean Architecture / Hexagonal
    if (modules.some(m => m.path.includes('domain') || m.path.includes('application'))) {
      return 'clean';
    }

    // Microservices (检测多个服务模块)
    const serviceDirs = new Set(modules.map(m => m.path.split('/')[0]));
    if (serviceDirs.size > 3) {
      return 'microservices';
    }

    // MVC
    if (hasController && modules.some(m => m.path.includes('view') || m.path.includes('template'))) {
      return 'mvc';
    }

    return 'unknown';
  }

  private async enhanceWithLLM(): Promise<void> {
    if (!this.llmService || !this.context) return;

    logger.info('AdvancedProjectUnderstanding', '使用 LLM 增强项目理解');

    // 为每个模块生成描述
    for (const module of this.context.metadata.modules) {
      if (module.exports.length === 0) continue;

      const prompt = `分析以下代码模块，用一句话描述它的职责：

文件: ${module.path}
类型: ${module.type}
导出: ${module.exports.map(e => e.name).join(', ')}
方法: ${module.exports.flatMap(e => e.methods?.map(m => m.name) || []).slice(0, 5).join(', ')}

用一句话描述这个模块的职责：`;

      try {
        const response = await this.llmService.chat([
          { role: 'system', content: '你是代码分析专家', timestamp: Date.now() },
          { role: 'user', content: prompt, timestamp: Date.now() }
        ]);
        module.documentation = response.content.trim();
      } catch {
        // 忽略 LLM 错误
      }
    }
  }

  private async findSourceFiles(extensions: string[]): Promise<string[]> {
    const files: string[] = [];

    const scan = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && 
                entry.name !== 'node_modules' && 
                entry.name !== 'dist' &&
                entry.name !== 'build' &&
                entry.name !== 'target') {
              await scan(fullPath);
            }
          } else if (extensions.some(ext => entry.name.endsWith(ext))) {
            files.push(fullPath);
          }
        }
      } catch {
        // 忽略错误
      }
    };

    await scan(this.projectPath);
    return files;
  }
}

// 导出单例
export let advancedProjectUnderstanding: AdvancedProjectUnderstanding | null = null;

export function initProjectUnderstanding(projectPath: string, llmService?: LLMService): AdvancedProjectUnderstanding {
  advancedProjectUnderstanding = new AdvancedProjectUnderstanding(projectPath, llmService);
  return advancedProjectUnderstanding;
}
