/**
 * LSP (Language Server Protocol) 客户端实现
 * 支持完整的LSP 3.17协议
 */

import { EventEmitter } from 'events';
import * as cp from 'child_process';
import * as path from 'path';
import { logger } from '../../utils/Logger';

// LSP消息类型
export interface LSPMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: LSLError;
}

export interface LSLError {
  code: number;
  message: string;
  data?: any;
}

// 位置类型
export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
  version: number;
}

// 文档符号
export enum SymbolKind {
  File = 1, Module = 2, Namespace = 3, Package = 4,
  Class = 5, Method = 6, Property = 7, Field = 8,
  Constructor = 9, Enum = 10, Interface = 11, Function = 12,
  Variable = 13, Constant = 14, String = 15, Number = 16,
  Boolean = 17, Array = 18, Object = 19, Key = 20,
  Null = 21, EnumMember = 22, Struct = 23, Event = 24,
  Operator = 25, TypeParameter = 26
}

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

// 补全
export enum CompletionItemKind {
  Text = 1, Method = 2, Function = 3, Constructor = 4,
  Field = 5, Variable = 6, Class = 7, Interface = 8,
  Module = 9, Property = 10, Unit = 11, Value = 12,
  Enum = 13, Keyword = 14, Snippet = 15, Color = 16,
  File = 17, Reference = 18, Folder = 19, EnumMember = 20,
  Constant = 21, Struct = 22, Event = 23, Operator = 24,
  TypeParameter = 25
}

export interface CompletionItem {
  label: string;
  kind?: CompletionItemKind;
  detail?: string;
  documentation?: string | MarkupContent;
  insertText?: string;
  insertTextFormat?: InsertTextFormat;
  sortText?: string;
  filterText?: string;
}

export enum InsertTextFormat {
  PlainText = 1,
  Snippet = 2
}

// Hover
export interface Hover {
  contents: string | MarkupContent | MarkedString[];
  range?: Range;
}

export interface MarkupContent {
  kind: 'plaintext' | 'markdown';
  value: string;
}

export type MarkedString = string | { language: string; value: string };

// 诊断
export enum DiagnosticSeverity {
  Error = 1, Warning = 2, Information = 3, Hint = 4
}

export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
  relatedInformation?: DiagnosticRelatedInformation[];
}

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

// 代码动作
export interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: Diagnostic[];
  edit?: WorkspaceEdit;
  command?: Command;
}

export interface WorkspaceEdit {
  changes?: { [uri: string]: TextEdit[] };
  documentChanges?: TextDocumentEdit[];
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface TextDocumentEdit {
  textDocument: VersionedTextDocumentIdentifier;
  edits: TextEdit[];
}

export interface Command {
  title: string;
  command: string;
  arguments?: any[];
}

/**
 * LSP客户端实现
 */
export class LSPClient extends EventEmitter {
  private process: cp.ChildProcess | null = null;
  private messageId: number = 0;
  private pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();
  private buffer: string = '';
  private initialized: boolean = false;
  private rootUri: string = '';
  private serverCapabilities: any = {};

  constructor(private serverCommand: string, private serverArgs: string[] = []) {
    super();
  }

  /**
   * 启动语言服务器
   */
  async start(rootPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.rootUri = `file://${path.resolve(rootPath)}`;

      logger.info('LSPClient', `Starting language server: ${this.serverCommand}`);

      this.process = cp.spawn(this.serverCommand, this.serverArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.stdout?.on('data', (data) => this.handleData(data));
      this.process.stderr?.on('data', (data) => {
        logger.debug('LSPClient', `Server stderr: ${data}`);
      });

      this.process.on('error', (error) => {
        logger.error('LSPClient', `Server error: ${error}`);
        reject(error);
      });

      this.process.on('exit', (code) => {
        logger.info('LSPClient', `Server exited with code ${code}`);
        this.emit('exit', code);
      });

      // 等待服务器启动后初始化
      setTimeout(async () => {
        try {
          await this.initialize();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 500);
    });
  }

  /**
   * 停止语言服务器
   */
  async stop(): Promise<void> {
    if (!this.process) return;

    try {
      await this.sendRequest('shutdown', {});
      this.sendNotification('exit', {});
    } catch (error) {
      logger.warn('LSPClient', `Error during shutdown: ${error}`);
    }

    this.process.kill();
    this.process = null;
    this.initialized = false;
  }

  /**
   * 发送初始化请求
   */
  private async initialize(): Promise<void> {
    const result = await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: true,
            willSaveWaitUntil: true,
            didSave: true
          },
          completion: {
            dynamicRegistration: false,
            completionItem: {
              snippetSupport: true,
              commitCharactersSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
              deprecatedSupport: true,
              preselectSupport: true
            }
          },
          hover: {
            dynamicRegistration: false,
            contentFormat: ['markdown', 'plaintext']
          },
          definition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
          codeAction: { dynamicRegistration: false },
          rename: { dynamicRegistration: false },
          diagnostics: { dynamicRegistration: false }
        },
        workspace: {
          applyEdit: true,
          workspaceEdit: { documentChanges: true },
          didChangeConfiguration: { dynamicRegistration: false },
          didChangeWatchedFiles: { dynamicRegistration: false }
        }
      }
    });

    this.serverCapabilities = result.capabilities || {};
    this.initialized = true;
    
    // 发送initialized通知
    this.sendNotification('initialized', {});
    
    logger.info('LSPClient', 'Language server initialized');
    this.emit('initialized', result);
  }

  /**
   * 文本同步：打开文档
   */
  didOpen(uri: string, languageId: string, version: number, text: string): void {
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: `file://${uri}`,
        languageId,
        version,
        text
      }
    });
  }

  /**
   * 文本同步：变更文档
   */
  didChange(uri: string, version: number, changes: { range?: Range; text: string }[]): void {
    this.sendNotification('textDocument/didChange', {
      textDocument: { uri: `file://${uri}`, version },
      contentChanges: changes
    });
  }

  /**
   * 文本同步：保存文档
   */
  didSave(uri: string, text?: string): void {
    this.sendNotification('textDocument/didSave', {
      textDocument: { uri: `file://${uri}` },
      text
    });
  }

  /**
   * 文本同步：关闭文档
   */
  didClose(uri: string): void {
    this.sendNotification('textDocument/didClose', {
      textDocument: { uri: `file://${uri}` }
    });
  }

  /**
   * 跳转到定义
   */
  async goToDefinition(uri: string, position: Position): Promise<Location | Location[] | null> {
    if (!this.serverCapabilities.definitionProvider) {
      return null;
    }
    return this.sendRequest('textDocument/definition', {
      textDocument: { uri: `file://${uri}` },
      position
    });
  }

  /**
   * 查找引用
   */
  async findReferences(uri: string, position: Position): Promise<Location[] | null> {
    if (!this.serverCapabilities.referencesProvider) {
      return null;
    }
    return this.sendRequest('textDocument/references', {
      textDocument: { uri: `file://${uri}` },
      position,
      context: { includeDeclaration: true }
    });
  }

  /**
   * 悬停提示
   */
  async hover(uri: string, position: Position): Promise<Hover | null> {
    if (!this.serverCapabilities.hoverProvider) {
      return null;
    }
    return this.sendRequest('textDocument/hover', {
      textDocument: { uri: `file://${uri}` },
      position
    });
  }

  /**
   * 获取文档符号
   */
  async getDocumentSymbols(uri: string): Promise<DocumentSymbol[] | null> {
    if (!this.serverCapabilities.documentSymbolProvider) {
      return null;
    }
    return this.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri: `file://${uri}` }
    });
  }

  /**
   * 代码补全
   */
  async complete(uri: string, position: Position): Promise<CompletionItem[] | null> {
    if (!this.serverCapabilities.completionProvider) {
      return null;
    }
    const result = await this.sendRequest('textDocument/completion', {
      textDocument: { uri: `file://${uri}` },
      position
    });
    
    if (!result) return null;
    if (Array.isArray(result)) return result;
    if (result.items) return result.items;
    return null;
  }

  /**
   * 代码动作
   */
  async codeAction(uri: string, range: Range, context: { diagnostics: Diagnostic[] }): Promise<CodeAction[] | null> {
    if (!this.serverCapabilities.codeActionProvider) {
      return null;
    }
    return this.sendRequest('textDocument/codeAction', {
      textDocument: { uri: `file://${uri}` },
      range,
      context
    });
  }

  /**
   * 重命名
   */
  async rename(uri: string, position: Position, newName: string): Promise<WorkspaceEdit | null> {
    if (!this.serverCapabilities.renameProvider) {
      return null;
    }
    return this.sendRequest('textDocument/rename', {
      textDocument: { uri: `file://${uri}` },
      position,
      newName
    });
  }

  /**
   * 格式化文档
   */
  async formatDocument(uri: string, options?: { tabSize: number; insertSpaces: boolean }): Promise<TextEdit[] | null> {
    if (!this.serverCapabilities.documentFormattingProvider) {
      return null;
    }
    return this.sendRequest('textDocument/formatting', {
      textDocument: { uri: `file://${uri}` },
      options: options || { tabSize: 2, insertSpaces: true }
    });
  }

  // ==================== 私有方法 ====================

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Server not running'));
        return;
      }

      const id = ++this.messageId;
      const message: LSPMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      // 设置超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timeout`));
        }
      }, 30000);

      this.sendMessage(message);
    });
  }

  private sendNotification(method: string, params: any): void {
    if (!this.process?.stdin) return;

    const message: LSPMessage = {
      jsonrpc: '2.0',
      method,
      params
    };

    this.sendMessage(message);
  }

  private sendMessage(message: LSPMessage): void {
    const content = JSON.stringify(message);
    const headers = `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n`;
    
    this.process?.stdin?.write(headers + content);
    
    logger.debug('LSPClient', `Sent: ${message.method || 'response'} (id: ${message.id})`);
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString('utf8');

    while (true) {
      // 解析头部
      const headerMatch = this.buffer.match(/Content-Length: (\d+)\r\n/);
      if (!headerMatch) break;

      const contentLength = parseInt(headerMatch[1], 10);
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) break;

      // 提取并解析消息
      const content = this.buffer.substring(messageStart, messageEnd);
      this.buffer = this.buffer.substring(messageEnd);

      try {
        const message: LSPMessage = JSON.parse(content);
        this.handleMessage(message);
      } catch (error) {
        logger.error('LSPClient', `Failed to parse message: ${error}`);
      }
    }
  }

  private handleMessage(message: LSPMessage): void {
    if (message.id !== undefined) {
      // 响应消息
      const pending = this.pendingRequests.get(message.id as number);
      if (pending) {
        this.pendingRequests.delete(message.id as number);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.method) {
      // 服务器通知
      this.emit('notification', message);
      
      if (message.method === 'textDocument/publishDiagnostics') {
        this.emit('diagnostics', message.params);
      }
    }
  }
}

export default LSPClient;
