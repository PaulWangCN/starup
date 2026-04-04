/**
 * LSP Client - Language Server Protocol 客户端
 * 提供代码智能感知能力：补全、跳转、重构、诊断
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  createMessageConnection,
  MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import {
  InitializeParams,
  InitializeResult,
  TextDocumentItem,
  TextDocumentIdentifier,
  Position,
  CompletionItem,
  Hover,
  Location,
  DocumentSymbol,
  SymbolInformation,
  Diagnostic,
  WorkspaceEdit,
  TextEdit,
  DidOpenTextDocumentParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DefinitionParams,
  CompletionParams,
  HoverParams,
  DocumentSymbolParams,
  WorkspaceSymbolParams,
  RenameParams,
  CodeActionParams,
  CodeAction,
  TextDocumentSyncKind,
} from 'vscode-languageserver-protocol';
import { logger } from '../../utils/Logger';

export type LSPLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'java';

export interface LSPConfig {
  language: LSPLanguage;
  command: string;
  args: string[];
  workspacePath: string;
}

export interface CodeContext {
  filePath: string;
  content: string;
  language: LSPLanguage;
  version: number;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  location: { file: string; line: number; character: number };
  containerName?: string;
}

export interface CodeSuggestion {
  label: string;
  detail?: string;
  documentation?: string;
  insertText?: string;
  kind: string;
}

/**
 * LSP 客户端管理器
 */
export class LSPClient {
  private config: LSPConfig;
  private process: ChildProcess | null = null;
  private connection: MessageConnection | null = null;
  private initialized: boolean = false;
  private documentVersions: Map<string, number> = new Map();
  private openDocuments: Set<string> = new Set();
  private diagnostics: Map<string, Diagnostic[]> = new Map();

  constructor(config: LSPConfig) {
    this.config = config;
  }

  /**
   * 启动 LSP 服务器
   */
  async start(): Promise<boolean> {
    try {
      logger.info('LSP', `Starting ${this.config.language} language server...`);

      // 检查工作目录是否存在
      try {
        await fs.access(this.config.workspacePath);
      } catch {
        logger.error('LSP', `Workspace path does not exist: ${this.config.workspacePath}`);
        return false;
      }

      // 启动语言服务器进程
      this.process = spawn(this.config.command, this.config.args, {
        cwd: this.config.workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // 创建消息连接
      this.connection = createMessageConnection(
        new StreamMessageReader(this.process.stdout!),
        new StreamMessageWriter(this.process.stdin!)
      );

      // 设置错误处理
      this.connection.onError((error) => {
        logger.error('LSP', `Connection error: ${error}`);
      });

      this.connection.onClose(() => {
        logger.info('LSP', 'Connection closed');
        this.initialized = false;
      });

      // 监听诊断信息
      this.connection.onNotification('textDocument/publishDiagnostics', (params) => {
        this.diagnostics.set(params.uri, params.diagnostics);
      });

      this.connection.listen();

      // 初始化
      const initParams: InitializeParams = {
        processId: process.pid,
        rootUri: `file://${this.config.workspacePath}`,
        capabilities: {
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: true,
              willSaveWaitUntil: true,
              didSave: true,
            },
            completion: {
              dynamicRegistration: false,
              completionItem: {
                snippetSupport: true,
                commitCharactersSupport: true,
                documentationFormat: ['markdown', 'plaintext'],
                deprecatedSupport: true,
                preselectSupport: true,
              },
            },
            hover: {
              dynamicRegistration: false,
              contentFormat: ['markdown', 'plaintext'],
            },
            definition: {
              dynamicRegistration: false,
              linkSupport: true,
            },
            documentSymbol: {
              dynamicRegistration: false,
              hierarchicalDocumentSymbolSupport: true,
            },
            codeAction: {
              dynamicRegistration: false,
            },
            rename: {
              dynamicRegistration: false,
              prepareSupport: true,
            },
          },
          workspace: {
            workspaceFolders: true,
            configuration: true,
          },
        },
        workspaceFolders: [
          {
            uri: `file://${this.config.workspacePath}`,
            name: path.basename(this.config.workspacePath),
          },
        ],
      };

      const result = await this.connection.sendRequest<InitializeResult>('initialize', initParams);
      
      if (result) {
        await this.connection.sendNotification('initialized', {});
        this.initialized = true;
        logger.info('LSP', `${this.config.language} language server initialized`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('LSP', `Failed to start language server: ${error}`);
      return false;
    }
  }

  /**
   * 停止 LSP 服务器
   */
  async stop(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.sendRequest('shutdown');
        this.connection.sendNotification('exit');
      } catch {
        // 忽略关闭错误
      }
      this.connection.dispose();
      this.connection = null;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.initialized = false;
    this.openDocuments.clear();
    this.documentVersions.clear();
    logger.info('LSP', `${this.config.language} language server stopped`);
  }

  /**
   * 打开文档
   */
  async openDocument(filePath: string, content: string, languageId: string): Promise<void> {
    if (!this.initialized || !this.connection) return;

    const uri = `file://${filePath}`;
    const version = 1;

    const params: DidOpenTextDocumentParams = {
      textDocument: {
        uri,
        languageId,
        version,
        text: content,
      },
    };

    await this.connection.sendNotification('textDocument/didOpen', params);
    
    this.openDocuments.add(uri);
    this.documentVersions.set(uri, version);
  }

  /**
   * 更新文档内容
   */
  async updateDocument(filePath: string, content: string): Promise<void> {
    if (!this.initialized || !this.connection) return;

    const uri = `file://${filePath}`;
    const currentVersion = this.documentVersions.get(uri) || 0;
    const newVersion = currentVersion + 1;

    const params: DidChangeTextDocumentParams = {
      textDocument: {
        uri,
        version: newVersion,
      },
      contentChanges: [
        {
          text: content,
        },
      ],
    };

    await this.connection.sendNotification('textDocument/didChange', params);
    this.documentVersions.set(uri, newVersion);
  }

  /**
   * 关闭文档
   */
  async closeDocument(filePath: string): Promise<void> {
    if (!this.initialized || !this.connection) return;

    const uri = `file://${filePath}`;

    const params: DidCloseTextDocumentParams = {
      textDocument: {
        uri,
      },
    };

    await this.connection.sendNotification('textDocument/didClose', params);
    
    this.openDocuments.delete(uri);
    this.documentVersions.delete(uri);
  }

  /**
   * 获取代码补全
   */
  async getCompletions(filePath: string, line: number, character: number): Promise<CodeSuggestion[]> {
    if (!this.initialized || !this.connection) return [];

    const uri = `file://${filePath}`;

    const params: CompletionParams = {
      textDocument: {
        uri,
      },
      position: {
        line,
        character,
      },
    };

    try {
      const result = await this.connection.sendRequest<{
        items?: CompletionItem[];
        isIncomplete?: boolean;
      }>('textDocument/completion', params);

      if (!result || !result.items) return [];

      return result.items.map((item) => ({
        label: item.label,
        detail: item.detail,
        documentation: typeof item.documentation === 'string' 
          ? item.documentation 
          : item.documentation?.value,
        insertText: item.insertText || item.label,
        kind: this.mapCompletionKind(item.kind),
      }));
    } catch (error) {
      logger.warn('LSP', `Failed to get completions: ${error}`);
      return [];
    }
  }

  /**
   * 获取悬停提示
   */
  async getHover(filePath: string, line: number, character: number): Promise<string | null> {
    if (!this.initialized || !this.connection) return null;

    const uri = `file://${filePath}`;

    const params: HoverParams = {
      textDocument: {
        uri,
      },
      position: {
        line,
        character,
      },
    };

    try {
      const result = await this.connection.sendRequest<Hover>('textDocument/hover', params);

      if (!result || !result.contents) return null;

      if (typeof result.contents === 'string') {
        return result.contents;
      } else if (Array.isArray(result.contents)) {
        return result.contents.join('\n');
      } else {
        return result.contents.value;
      }
    } catch (error) {
      logger.warn('LSP', `Failed to get hover: ${error}`);
      return null;
    }
  }

  /**
   * 跳转到定义
   */
  async gotoDefinition(filePath: string, line: number, character: number): Promise<SymbolInfo | null> {
    if (!this.initialized || !this.connection) return null;

    const uri = `file://${filePath}`;

    const params: DefinitionParams = {
      textDocument: {
        uri,
      },
      position: {
        line,
        character,
      },
    };

    try {
      const result = await this.connection.sendRequest<Location | Location[] | null>(
        'textDocument/definition',
        params
      );

      if (!result) return null;

      const location = Array.isArray(result) ? result[0] : result;
      
      return {
        name: '',
        kind: 'definition',
        location: {
          file: location.uri.replace('file://', ''),
          line: location.range.start.line,
          character: location.range.start.character,
        },
      };
    } catch (error) {
      logger.warn('LSP', `Failed to get definition: ${error}`);
      return null;
    }
  }

  /**
   * 获取文档符号
   */
  async getDocumentSymbols(filePath: string): Promise<SymbolInfo[]> {
    if (!this.initialized || !this.connection) return [];

    const uri = `file://${filePath}`;

    const params: DocumentSymbolParams = {
      textDocument: {
        uri,
      },
    };

    try {
      const result = await this.connection.sendRequest<
        (DocumentSymbol | SymbolInformation)[] | null
      >('textDocument/documentSymbol', params);

      if (!result) return [];

      return result.map((symbol) => {
        if ('location' in symbol) {
          // SymbolInformation
          return {
            name: symbol.name,
            kind: this.mapSymbolKind(symbol.kind),
            location: {
              file: symbol.location.uri.replace('file://', ''),
              line: symbol.location.range.start.line,
              character: symbol.location.range.start.character,
            },
            containerName: symbol.containerName,
          };
        } else {
          // DocumentSymbol
          return {
            name: symbol.name,
            kind: this.mapSymbolKind(symbol.kind),
            location: {
              file: filePath,
              line: symbol.range.start.line,
              character: symbol.range.start.character,
            },
            containerName: symbol.detail,
          };
        }
      });
    } catch (error) {
      logger.warn('LSP', `Failed to get document symbols: ${error}`);
      return [];
    }
  }

  /**
   * 重命名符号
   */
  async rename(filePath: string, line: number, character: number, newName: string): Promise<WorkspaceEdit | null> {
    if (!this.initialized || !this.connection) return null;

    const uri = `file://${filePath}`;

    const params: RenameParams = {
      textDocument: {
        uri,
      },
      position: {
        line,
        character,
      },
      newName,
    };

    try {
      const result = await this.connection.sendRequest<WorkspaceEdit | null>(
        'textDocument/rename',
        params
      );
      return result;
    } catch (error) {
      logger.warn('LSP', `Failed to rename: ${error}`);
      return null;
    }
  }

  /**
   * 获取代码操作（快速修复）
   */
  async getCodeActions(filePath: string, startLine: number, startChar: number, endLine: number, endChar: number): Promise<CodeAction[]> {
    if (!this.initialized || !this.connection) return [];

    const uri = `file://${filePath}`;

    const params: CodeActionParams = {
      textDocument: {
        uri,
      },
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      context: {
        diagnostics: this.diagnostics.get(uri) || [],
      },
    };

    try {
      const result = await this.connection.sendRequest<(CodeAction | any)[] | null>(
        'textDocument/codeAction',
        params
      );
      return result?.filter((item): item is CodeAction => 'kind' in item) || [];
    } catch (error) {
      logger.warn('LSP', `Failed to get code actions: ${error}`);
      return [];
    }
  }

  /**
   * 获取诊断信息
   */
  getDiagnostics(filePath: string): Diagnostic[] {
    const uri = `file://${filePath}`;
    return this.diagnostics.get(uri) || [];
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 映射补全项类型
   */
  private mapCompletionKind(kind?: number): string {
    const kinds: Record<number, string> = {
      1: 'text',
      2: 'method',
      3: 'function',
      4: 'constructor',
      5: 'field',
      6: 'variable',
      7: 'class',
      8: 'interface',
      9: 'module',
      10: 'property',
      11: 'unit',
      12: 'value',
      13: 'enum',
      14: 'keyword',
      15: 'snippet',
      16: 'color',
      17: 'file',
      18: 'reference',
      19: 'folder',
      20: 'enumMember',
      21: 'constant',
      22: 'struct',
      23: 'event',
      24: 'operator',
      25: 'typeParameter',
    };
    return kinds[kind || 1] || 'unknown';
  }

  /**
   * 映射符号类型
   */
  private mapSymbolKind(kind: number): string {
    const kinds: Record<number, string> = {
      1: 'file',
      2: 'module',
      3: 'namespace',
      4: 'package',
      5: 'class',
      6: 'method',
      7: 'property',
      8: 'field',
      9: 'constructor',
      10: 'enum',
      11: 'interface',
      12: 'function',
      13: 'variable',
      14: 'constant',
      15: 'string',
      16: 'number',
      17: 'boolean',
      18: 'array',
      19: 'object',
      20: 'key',
      21: 'null',
      22: 'enumMember',
      23: 'struct',
      24: 'event',
      25: 'operator',
      26: 'typeParameter',
    };
    return kinds[kind] || 'unknown';
  }
}

/**
 * LSP 管理器 - 管理多个语言服务器
 */
export class LSPManager {
  private clients: Map<LSPLanguage, LSPClient> = new Map();

  /**
   * 创建 TypeScript 语言服务器
   */
  async createTypeScriptClient(workspacePath: string): Promise<LSPClient | null> {
    // 尝试多种方式启动 TypeScript 语言服务器
    const candidates = [
      { cmd: 'typescript-language-server', args: ['--stdio'] },
      { cmd: 'npx', args: ['typescript-language-server', '--stdio'] },
      { cmd: 'node', args: [require.resolve('typescript/lib/tsserver.js'), '--syntaxOnly'] },
    ];

    for (const candidate of candidates) {
      try {
        const client = new LSPClient({
          language: 'typescript',
          command: candidate.cmd,
          args: candidate.args,
          workspacePath,
        });

        const success = await client.start();
        if (success) {
          this.clients.set('typescript', client);
          return client;
        }
      } catch {
        continue;
      }
    }

    logger.warn('LSP', 'Failed to start TypeScript language server');
    return null;
  }

  /**
   * 创建 Python 语言服务器
   */
  async createPythonClient(workspacePath: string): Promise<LSPClient | null> {
    const candidates = [
      { cmd: 'pylsp', args: [] },
      { cmd: 'python-lsp-server', args: [] },
      { cmd: 'pyls', args: [] },
    ];

    for (const candidate of candidates) {
      try {
        const client = new LSPClient({
          language: 'python',
          command: candidate.cmd,
          args: candidate.args,
          workspacePath,
        });

        const success = await client.start();
        if (success) {
          this.clients.set('python', client);
          return client;
        }
      } catch {
        continue;
      }
    }

    logger.warn('LSP', 'Failed to start Python language server');
    return null;
  }

  /**
   * 获取客户端
   */
  getClient(language: LSPLanguage): LSPClient | undefined {
    return this.clients.get(language);
  }

  /**
   * 停止所有客户端
   */
  async stopAll(): Promise<void> {
    for (const [language, client] of this.clients) {
      await client.stop();
    }
    this.clients.clear();
  }
}

// 单例导出
export const lspManager = new LSPManager();
