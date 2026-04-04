/**
 * 代码审查工具
 * 集成静态分析、安全扫描、最佳实践检查
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { logger } from '../../utils/Logger';

export interface CodeIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file: string;
  line: number;
  column: number;
  rule?: string;
  category: 'style' | 'security' | 'performance' | 'maintainability' | 'bug';
  suggestion?: string;
}

export interface ReviewResult {
  filePath: string;
  issues: CodeIssue[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  score: number; // 0-100
}

export interface CodeMetrics {
  complexity: number;
  linesOfCode: number;
  commentRatio: number;
  functionCount: number;
  averageFunctionLength: number;
}

/**
 * 代码审查器
 */
export class CodeReviewer {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * 审查单个文件
   */
  async reviewFile(filePath: string): Promise<ReviewResult> {
    const issues: CodeIssue[] = [];
    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath);

    // 基础静态分析
    issues.push(...this.basicStaticAnalysis(filePath, content, ext));

    // 语言特定分析
    if (ext === '.ts' || ext === '.tsx') {
      issues.push(...await this.analyzeTypeScript(filePath, content));
    } else if (ext === '.js' || ext === '.jsx') {
      issues.push(...await this.analyzeJavaScript(filePath, content));
    } else if (ext === '.py') {
      issues.push(...await this.analyzePython(filePath, content));
    }

    // 安全扫描
    issues.push(...this.securityScan(filePath, content));

    // 计算分数
    const score = this.calculateScore(issues);

    return {
      filePath,
      issues,
      summary: {
        total: issues.length,
        errors: issues.filter(i => i.severity === 'error').length,
        warnings: issues.filter(i => i.severity === 'warning').length,
        infos: issues.filter(i => i.severity === 'info').length,
      },
      score,
    };
  }

  /**
   * 基础静态分析
   */
  private basicStaticAnalysis(filePath: string, content: string, ext: string): CodeIssue[] {
    const issues: CodeIssue[] = [];
    const lines = content.split('\n');

    // 检查文件长度
    if (lines.length > 500) {
      issues.push({
        severity: 'warning',
        message: `File is too long (${lines.length} lines). Consider breaking it into smaller modules.`,
        file: filePath,
        line: 1,
        column: 1,
        category: 'maintainability',
        rule: 'file-length',
      });
    }

    // 检查行长度
    lines.forEach((line, index) => {
      if (line.length > 120) {
        issues.push({
          severity: 'info',
          message: 'Line exceeds 120 characters',
          file: filePath,
          line: index + 1,
          column: 121,
          category: 'style',
          rule: 'max-line-length',
        });
      }
    });

    // 检查尾随空格
    lines.forEach((line, index) => {
      if (line.endsWith(' ') || line.endsWith('\t')) {
        issues.push({
          severity: 'info',
          message: 'Trailing whitespace',
          file: filePath,
          line: index + 1,
          column: line.length,
          category: 'style',
          rule: 'no-trailing-spaces',
        });
      }
    });

    // 检查 console.log/debugger
    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      lines.forEach((line, index) => {
        if (line.includes('console.log') || line.includes('console.debug')) {
          issues.push({
            severity: 'warning',
            message: 'Console statement found. Consider removing for production code.',
            file: filePath,
            line: index + 1,
            column: line.indexOf('console'),
            category: 'maintainability',
            rule: 'no-console',
          });
        }

        if (line.includes('debugger;')) {
          issues.push({
            severity: 'error',
            message: 'Debugger statement found. Remove before committing.',
            file: filePath,
            line: index + 1,
            column: line.indexOf('debugger'),
            category: 'bug',
            rule: 'no-debugger',
          });
        }
      });
    }

    // 检查 TODO/FIXME
    lines.forEach((line, index) => {
      const todoMatch = line.match(/TODO|FIXME|XXX/i);
      if (todoMatch) {
        issues.push({
          severity: 'info',
          message: `Found ${todoMatch[0]} comment`,
          file: filePath,
          line: index + 1,
          column: line.indexOf(todoMatch[0]),
          category: 'maintainability',
          rule: 'todo-comment',
        });
      }
    });

    return issues;
  }

  /**
   * TypeScript 分析
   */
  private async analyzeTypeScript(filePath: string, content: string): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = [];
    const lines = content.split('\n');

    // 检查 any 类型使用
    lines.forEach((line, index) => {
      if (line.includes(': any') || line.includes('as any')) {
        issues.push({
          severity: 'warning',
          message: 'Avoid using "any" type. Use specific types or unknown instead.',
          file: filePath,
          line: index + 1,
          column: line.indexOf('any'),
          category: 'maintainability',
          rule: 'no-any',
          suggestion: 'Replace with specific type or use type assertion with validation',
        });
      }
    });

    // 检查非空断言
    lines.forEach((line, index) => {
      if (line.includes('!.')) {
        issues.push({
          severity: 'warning',
          message: 'Non-null assertion used. Ensure the value is actually not null.',
          file: filePath,
          line: index + 1,
          column: line.indexOf('!.'),
          category: 'bug',
          rule: 'no-non-null-assertion',
        });
      }
    });

    // 检查 var 使用
    lines.forEach((line, index) => {
      if (line.match(/\bvar\b/)) {
        issues.push({
          severity: 'warning',
          message: 'Use "let" or "const" instead of "var"',
          file: filePath,
          line: index + 1,
          column: line.indexOf('var'),
          category: 'style',
          rule: 'no-var',
        });
      }
    });

    // 尝试运行 ESLint
    try {
      const eslintIssues = await this.runESLint(filePath);
      issues.push(...eslintIssues);
    } catch {
      // ESLint 未安装或失败，忽略
    }

    return issues;
  }

  /**
   * JavaScript 分析
   */
  private async analyzeJavaScript(filePath: string, content: string): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = [];
    const lines = content.split('\n');

    // 检查 == 使用
    lines.forEach((line, index) => {
      if (line.match(/[^=!]==[^=]/) && !line.includes('//')) {
        issues.push({
          severity: 'warning',
          message: 'Use "===" instead of "=="',
          file: filePath,
          line: index + 1,
          column: line.indexOf('=='),
          category: 'bug',
          rule: 'eqeqeq',
        });
      }
    });

    // 检查 eval
    lines.forEach((line, index) => {
      if (line.includes('eval(')) {
        issues.push({
          severity: 'error',
          message: 'eval() is dangerous and should be avoided',
          file: filePath,
          line: index + 1,
          column: line.indexOf('eval'),
          category: 'security',
          rule: 'no-eval',
        });
      }
    });

    return issues;
  }

  /**
   * Python 分析
   */
  private async analyzePython(filePath: string, content: string): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = [];
    const lines = content.split('\n');

    // 检查行长度
    lines.forEach((line, index) => {
      if (line.length > 79) {
        issues.push({
          severity: 'info',
          message: 'Line exceeds 79 characters (PEP 8)',
          file: filePath,
          line: index + 1,
          column: 80,
          category: 'style',
          rule: 'E501',
        });
      }
    });

    // 检查导入风格
    lines.forEach((line, index) => {
      if (line.startsWith('from ') && line.includes(' import *')) {
        issues.push({
          severity: 'warning',
          message: 'Avoid wildcard imports',
          file: filePath,
          line: index + 1,
          column: 1,
          category: 'maintainability',
          rule: 'F403',
        });
      }
    });

    return issues;
  }

  /**
   * 安全扫描
   */
  private securityScan(filePath: string, content: string): CodeIssue[] {
    const issues: CodeIssue[] = [];
    const lines = content.split('\n');
    const ext = path.extname(filePath);

    // 检查硬编码密码/密钥
    const sensitivePatterns = [
      { pattern: /password\s*=\s*['"][^'"]+['"]/i, name: 'password' },
      { pattern: /secret\s*=\s*['"][^'"]+['"]/i, name: 'secret' },
      { pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/i, name: 'API key' },
      { pattern: /token\s*=\s*['"][^'"]+['"]/i, name: 'token' },
      { pattern: /private[_-]?key\s*=\s*['"][^'"]+['"]/i, name: 'private key' },
    ];

    lines.forEach((line, index) => {
      for (const { pattern, name } of sensitivePatterns) {
        if (pattern.test(line) && !line.includes('process.env') && !line.includes('getenv')) {
          issues.push({
            severity: 'error',
            message: `Possible hardcoded ${name} detected`,
            file: filePath,
            line: index + 1,
            column: 1,
            category: 'security',
            rule: 'no-hardcoded-secrets',
            suggestion: 'Use environment variables or secure secret management',
          });
        }
      }
    });

    // SQL 注入检查
    if (ext === '.ts' || ext === '.js' || ext === '.py') {
      lines.forEach((line, index) => {
        if (line.match(/SELECT|INSERT|UPDATE|DELETE/i) && line.includes('+')) {
          issues.push({
            severity: 'error',
            message: 'Possible SQL injection vulnerability',
            file: filePath,
            line: index + 1,
            column: 1,
            category: 'security',
            rule: 'sql-injection',
            suggestion: 'Use parameterized queries or ORM',
          });
        }
      });
    }

    // 检查不安全的 HTTP
    lines.forEach((line, index) => {
      if (line.includes('http://') && !line.includes('localhost') && !line.includes('127.0.0.1')) {
        issues.push({
          severity: 'warning',
          message: 'Using insecure HTTP protocol',
          file: filePath,
          line: index + 1,
          column: line.indexOf('http://'),
          category: 'security',
          rule: 'insecure-http',
          suggestion: 'Use HTTPS instead',
        });
      }
    });

    return issues;
  }

  /**
   * 运行 ESLint
   */
  private async runESLint(filePath: string): Promise<CodeIssue[]> {
    return new Promise((resolve) => {
      const issues: CodeIssue[] = [];
      const eslint = spawn('npx', ['eslint', '--format', 'json', filePath], {
        cwd: this.workspacePath,
      });

      let output = '';
      eslint.stdout.on('data', (data) => {
        output += data.toString();
      });

      eslint.on('close', () => {
        try {
          const results = JSON.parse(output);
          for (const result of results) {
            for (const message of result.messages) {
              issues.push({
                severity: message.severity === 2 ? 'error' : 'warning',
                message: message.message,
                file: filePath,
                line: message.line,
                column: message.column,
                rule: message.ruleId,
                category: this.categorizeESLintRule(message.ruleId),
              });
            }
          }
        } catch {
          // 解析失败，忽略
        }
        resolve(issues);
      });

      // 超时处理
      setTimeout(() => {
        eslint.kill();
        resolve(issues);
      }, 30000);
    });
  }

  /**
   * 分类 ESLint 规则
   */
  private categorizeESLintRule(ruleId: string | null): CodeIssue['category'] {
    if (!ruleId) return 'style';
    
    const securityRules = ['no-eval', 'no-implied-eval', 'no-new-func'];
    const bugRules = ['no-undef', 'no-unused-vars', 'no-unreachable'];
    const performanceRules = ['no-console', 'no-debugger'];

    if (securityRules.some(r => ruleId.includes(r))) return 'security';
    if (bugRules.some(r => ruleId.includes(r))) return 'bug';
    if (performanceRules.some(r => ruleId.includes(r))) return 'performance';
    
    return 'style';
  }

  /**
   * 计算代码分数
   */
  private calculateScore(issues: CodeIssue[]): number {
    let score = 100;
    
    for (const issue of issues) {
      switch (issue.severity) {
        case 'error':
          score -= 10;
          break;
        case 'warning':
          score -= 5;
          break;
        case 'info':
          score -= 1;
          break;
      }
    }

    return Math.max(0, score);
  }

  /**
   * 获取代码度量
   */
  async getMetrics(filePath: string): Promise<CodeMetrics | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      // 计算圈复杂度（简化版）
      let complexity = 1;
      const complexityPatterns = [/\bif\b/, /\bwhile\b/, /\bfor\b/, /\bcase\b/, /\bcatch\b/, /&&/, /\|\|/];
      for (const line of lines) {
        for (const pattern of complexityPatterns) {
          if (pattern.test(line)) complexity++;
        }
      }

      // 计算代码行数
      const codeLines = lines.filter(line => line.trim() && !line.trim().startsWith('//'));
      
      // 计算注释比例
      const commentLines = lines.filter(line => 
        line.trim().startsWith('//') || 
        line.trim().startsWith('/*') || 
        line.trim().startsWith('*')
      );
      const commentRatio = codeLines.length > 0 ? commentLines.length / codeLines.length : 0;

      // 估算函数数量
      const functionMatches = content.match(/\b(function|const|let|var)\s+\w+\s*[=:]\s*(\([^)]*\)\s*=>|\bfunction\b)/g);
      const functionCount = functionMatches?.length || 0;

      return {
        complexity,
        linesOfCode: codeLines.length,
        commentRatio,
        functionCount,
        averageFunctionLength: functionCount > 0 ? codeLines.length / functionCount : 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * 批量审查目录
   */
  async reviewDirectory(dirPath: string, extensions: string[] = ['.ts', '.tsx', '.js', '.jsx']): Promise<ReviewResult[]> {
    const results: ReviewResult[] = [];

    const scanDir = async (currentDir: string) => {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await scanDir(fullPath);
          } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
            const result = await this.reviewFile(fullPath);
            results.push(result);
          }
        }
      } catch {
        // 忽略扫描错误
      }
    };

    await scanDir(dirPath);
    return results;
  }

  /**
   * 生成审查报告
   */
  generateReport(results: ReviewResult[]): string {
    const totalIssues = results.reduce((sum, r) => sum + r.summary.total, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.summary.errors, 0);
    const totalWarnings = results.reduce((sum, r) => sum + r.summary.warnings, 0);
    const averageScore = results.length > 0 
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length 
      : 0;

    let report = '# 代码审查报告\n\n';
    report += `## 概览\n\n`;
    report += `- 审查文件数: ${results.length}\n`;
    report += `- 总问题数: ${totalIssues}\n`;
    report += `  - 错误: ${totalErrors}\n`;
    report += `  - 警告: ${totalWarnings}\n`;
    report += `- 平均分数: ${averageScore.toFixed(1)}/100\n\n`;

    // 按严重程度排序
    const allIssues = results.flatMap(r => 
      r.issues.map(i => ({ ...i, file: r.filePath }))
    );
    
    const errors = allIssues.filter(i => i.severity === 'error');
    const warnings = allIssues.filter(i => i.severity === 'warning');

    if (errors.length > 0) {
      report += `## 错误 (${errors.length})\n\n`;
      for (const issue of errors.slice(0, 20)) {
        report += `- **${path.basename(issue.file)}:${issue.line}** - ${issue.message}\n`;
      }
      if (errors.length > 20) {
        report += `- ... 还有 ${errors.length - 20} 个错误\n`;
      }
      report += '\n';
    }

    if (warnings.length > 0) {
      report += `## 警告 (${warnings.length})\n\n`;
      for (const issue of warnings.slice(0, 20)) {
        report += `- **${path.basename(issue.file)}:${issue.line}** - ${issue.message}\n`;
      }
      if (warnings.length > 20) {
        report += `- ... 还有 ${warnings.length - 20} 个警告\n`;
      }
      report += '\n';
    }

    // 文件分数详情
    report += `## 文件分数\n\n`;
    const sortedResults = [...results].sort((a, b) => a.score - b.score);
    for (const result of sortedResults.slice(0, 10)) {
      const emoji = result.score >= 90 ? '✅' : result.score >= 70 ? '⚠️' : '❌';
      report += `- ${emoji} **${path.basename(result.filePath)}**: ${result.score}/100 (${result.summary.total} issues)\n`;
    }

    return report;
  }
}

// 单例导出
export const codeReviewer = new CodeReviewer(process.cwd());
