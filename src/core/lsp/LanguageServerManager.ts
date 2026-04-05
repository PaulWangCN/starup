/**
 * 语言服务器管理器 (LSP)
 * 
 * 核心功能：
 * 1. 自动检测项目语言
 * 2. 管理语言服务器生命周期
 * 3. 提供语义级代码理解
 * 
 * 参考：OpenCode和Claude Code的LSP集成
 */

import { EventEmitter } from 'events';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../utils/Logger';

/** LSP客户端接口 */
export interface LSPClient {
  id: string;
  language: string;
  process: cp.ChildProcess;
  initialized: boolean;
  
  // 核心LSP方法
  initialize(workspacePath: string): Promise<void>;
  shutdown(): Promise<void>;
  
  // 文本同步
  didOpen(uri: string, languageId: string, version: number, text: string): Promise<void>;
  didChange(uri: string, version: number, changes: TextDocumentContentChangeEvent[]): Promise<void>;
  didClose(uri: string): Promise<void>;
  didSave(uri: string): Promise<void>;
  
  // 语言特性
  goToDefinition(uri: string, position: Position): Promise<Location | Location[]>;
  findReferences(uri: string, position: Position): Promise<Location[]>;
  hover(uri: string, position: Position): Promise<Hover | null>;
  getDocumentSymbols(uri: string): Promise<DocumentSymbol[]>;
  getWorkspaceSymbols(query: string): Promise<SymbolInformation[]>;
  getCodeActions(uri: string, range: Range): Promise<CodeAction[]>;
  rename(uri: string, position: Position, newName: string): Promise<WorkspaceEdit | null>;
  
  // 诊断
  getDiagnostics(uri: string): Promise<Diagnostic[]>;
  
  // 补全
  getCompletions(uri: string, position: Position): Promise<CompletionItem[]>;
}

/** LSP位置 */
export interface Position {
  line: number;
  character: number;
}

/** LSP范围 */
export interface Range {
  start: Position;
  end: Position;
}

/** LSP位置 */
export interface Location {
  uri: string;
  range: Range;
}

/** 文档变更事件 */
export interface TextDocumentContentChangeEvent {
  range?: Range;
  rangeLength?: number;
  text: string;
}

/** Hover信息 */
export interface Hover {
  contents: string | MarkupContent;
  range?: Range;
}

/** Markup内容 */
export interface MarkupContent {
  kind: 'plaintext' | 'markdown';
  value: string;
}

/** 文档符号 */
export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

/** 符号信息 */
export interface SymbolInformation {
  name: string;
  kind: SymbolKind;
  location: Location;
  containerName?: string;
}

/** 代码动作 */
export interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: Diagnostic[];
  edit?: WorkspaceEdit;
  command?: Command;
}

/** 工作区编辑 */
export interface WorkspaceEdit {
  changes?: { [uri: string]: TextEdit[] };
  documentChanges?: TextDocumentEdit[];
}

/** 文本编辑 */
export interface TextEdit {
  range: Range;
  newText: string;
}

/** 文本文档编辑 */
export interface TextDocumentEdit {
  textDocument: VersionedTextDocumentIdentifier;
  edits: TextEdit[];
}

/** 版本化文本文档标识符 */
export interface VersionedTextDocumentIdentifier {
  uri: string;
  version: number;
}

/** 命令 */
export interface Command {
  title: string;
  command: string;
  arguments?: any[];
}

/** 诊断 */
export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
  relatedInformation?: DiagnosticRelatedInformation[];
}

/** 诊断严重程度 */
export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4
}

/** 诊断相关信息 */
export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

/** 补全项 */
export interface CompletionItem {
  label: string;
  kind?: CompletionItemKind;
  detail?: string;
  documentation?: string | MarkupContent;
  insertText?: string;
  insertTextFormat?: InsertTextFormat;
}

/** 补全项类型 */
export enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18
}

/** 插入文本格式 */
export enum InsertTextFormat {
  PlainText = 1,
  Snippet = 2
}

/** 符号类型 */
export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18
}

/** 语言服务器配置 */
interface LanguageServerConfig {
  command: string;
  args: string[];
  options?: cp.SpawnOptions;
}

/**
 * 语言服务器管理器
 */
export class LanguageServerManager extends EventEmitter {
  private clients: Map<string, LSPClient> = new Map();
  private workspacePath: string;
  private detectedLanguages: Set<string> = new Set();

  // 预配置的语言服务器
  private static readonly SERVER_CONFIGS: Record<string, LanguageServerConfig> = {
    typescript: {
      command: 'typescript-language-server',
      args: ['--stdio']
    },
    javascript: {
      command: 'typescript-language-server',
      args: ['--stdio']
    },
    python: {
      command: 'pyright-langserver',
      args: ['--stdio']
    },
    java: {
      command: 'jdtls',
      args: []
    },
    go: {
      command: 'gopls',
      args: []
    },
    rust: {
      command: 'rust-analyzer',
      args: []
    },
    csharp: {
      command: 'csharp-ls',
      args: []
    }
  };

  constructor(workspacePath: string) {
    super();
    this.workspacePath = workspacePath;
  }

  /**
   * 自动检测项目中的语言
   */
  async detectLanguages(): Promise<string[]> {
    const languages: string[] = [];
    const detected = new Set<string>();

    // 检查配置文件
    const configFiles: Record<string, string[]> = {
      typescript: ['tsconfig.json', 'package.json'],
      javascript: ['package.json', '.jsconfig.json'],
      python: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'],
      java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
      go: ['go.mod', 'go.sum'],
      rust: ['Cargo.toml', 'Cargo.lock'],
      csharp: ['.csproj', '.sln']
    };

    for (const [lang, files] of Object.entries(configFiles)) {
      for (const file of files) {
        if (fs.existsSync(path.join(this.workspacePath, file))) {
          if (!detected.has(lang)) {
            languages.push(lang);
            detected.add(lang);
          }
          break;
        }
      }
    }

    // 检查文件扩展名
    const fileExtensions: Record<string, string[]> = {
      typescript: ['.ts', '.tsx'],
      javascript: ['.js', '.jsx', '.mjs'],
      python: ['.py', '.pyw'],
      java: ['.java'],
      go: ['.go'],
      rust: ['.rs'],
      csharp: ['.cs']
    };

    const checkDirectory = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // 跳过node_modules等目录
          if (['node_modules', '.git', 'dist', 'build', 'target', '__pycache__'].includes(entry.name)) {
            continue;
          }
          checkDirectory(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          for (const [lang, exts] of Object.entries(fileExtensions)) {
            if (exts.includes(ext) && !detected.has(lang)) {
              languages.push(lang);
              detected.add(lang);
            }
          }
        }
      }
    };

    try {
      checkDirectory(this.workspacePath);
    } catch (error) {
      logger.warn('LanguageServerManager', `Failed to scan directory: ${error}`);
    }

    this.detectedLanguages = detected;
    logger.info('LanguageServerManager', `Detected languages: ${languages.join(', ')}`);
    
    return languages;
  }

  /**
   * 启动语言服务器
   */
  async startServer(language: string): Promise<LSPClient | null> {
    // 检查是否已存在
    const existingClient = this.clients.get(language);
    if (existingClient) {
      return existingClient;
    }

    const config = LanguageServerManager.SERVER_CONFIGS[language];
    if (!config) {
      logger.warn('LanguageServerManager', `No server config for language: ${language}`);
      return null;
    }

    // 检查命令是否存在
    if (!this.isCommandAvailable(config.command)) {
      logger.warn('LanguageServerManager', `Language server not found: ${config.command}`);
      return null;
    }

    try {
      logger.info('LanguageServerManager', `Starting ${language} language server`);

      // 启动进程
      const proc = cp.spawn(config.command, config.args, {
        cwd: this.workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...config.options
      });

      const client: LSPClient = {
        id: `lsp-${language}-${Date.now()}`,
        language,
        process: proc,
        initialized: false,

        initialize: async (workspacePath: string): Promise<void> => {
          // TODO: 实现LSP初始化协议
          client.initialized = true;
        },

        shutdown: async (): Promise<void> => {
          proc.kill();
          client.initialized = false;
        },

        didOpen: async (): Promise<void> => {
          // TODO: 实现textDocument/didOpen
        },

        didChange: async (): Promise<void> => {
          // TODO: 实现textDocument/didChange
        },

        didClose: async (): Promise<void> => {
          // TODO: 实现textDocument/didClose
        },

        didSave: async (): Promise<void> => {
          // TODO: 实现textDocument/didSave
        },

        goToDefinition: async (): Promise<Location | Location[]> => {
          // TODO: 实现textDocument/definition
          return [];
        },

        findReferences: async (): Promise<Location[]> => {
          // TODO: 实现textDocument/references
          return [];
        },

        hover: async (): Promise<Hover | null> => {
          // TODO: 实现textDocument/hover
          return null;
        },

        getDocumentSymbols: async (): Promise<DocumentSymbol[]> => {
          // TODO: 实现textDocument/documentSymbol
          return [];
        },

        getWorkspaceSymbols: async (): Promise<SymbolInformation[]> => {
          // TODO: 实现workspace/symbol
          return [];
        },

        getCodeActions: async (): Promise<CodeAction[]> => {
          // TODO: 实现textDocument/codeAction
          return [];
        },

        rename: async (): Promise<WorkspaceEdit | null> => {
          // TODO: 实现textDocument/rename
          return null;
        },

        getDiagnostics: async (): Promise<Diagnostic[]> => {
          // TODO: 实现textDocument/publishDiagnostics
          return [];
        },

        getCompletions: async (): Promise<CompletionItem[]> => {
          // TODO: 实现textDocument/completion
          return [];
        }
      };

      // 处理进程事件
      proc.on('error', (error) => {
        logger.error('LanguageServerManager', `LSP process error: ${error}`);
        this.emit('server_error', { language, error });
      });

      proc.on('exit', (code) => {
        logger.info('LanguageServerManager', `LSP process exited with code ${code}`);
        this.clients.delete(language);
        this.emit('server_exit', { language, code });
      });

      // 初始化
      await client.initialize(this.workspacePath);
      
      this.clients.set(language, client);
      this.emit('server_started', { language, client });

      return client;

    } catch (error) {
      logger.error('LanguageServerManager', `Failed to start ${language} server: ${error}`);
      return null;
    }
  }

  /**
   * 获取客户端
   */
  getClient(language: string): LSPClient | undefined {
    return this.clients.get(language);
  }

  /**
   * 获取所有活跃客户端
   */
  getAllClients(): LSPClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * 停止语言服务器
   */
  async stopServer(language: string): Promise<void> {
    const client = this.clients.get(language);
    if (!client) return;

    try {
      await client.shutdown();
      this.clients.delete(language);
      logger.info('LanguageServerManager', `Stopped ${language} server`);
    } catch (error) {
      logger.error('LanguageServerManager', `Error stopping ${language} server: ${error}`);
    }
  }

  /**
   * 停止所有语言服务器
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.clients.keys()).map(lang => this.stopServer(lang));
    await Promise.all(promises);
  }

  /**
   * 为文件获取合适的LSP客户端
   */
  getClientForFile(filePath: string): LSPClient | null {
    const ext = path.extname(filePath).toLowerCase();
    
    const extensionMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.cs': 'csharp'
    };

    const language = extensionMap[ext];
    if (!language) return null;

    return this.clients.get(language) || null;
  }

  /**
   * 检查命令是否可用
   */
  private isCommandAvailable(command: string): boolean {
    try {
      const result = cp.spawnSync(
        process.platform === 'win32' ? 'where' : 'which',
        [command],
        { stdio: 'pipe' }
      );
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * 获取已检测的语言
   */
  getDetectedLanguages(): string[] {
    return Array.from(this.detectedLanguages);
  }

  /**
   * 检查语言服务器是否运行
   */
  isServerRunning(language: string): boolean {
    const client = this.clients.get(language);
    return client?.initialized || false;
  }
}

export default LanguageServerManager;
