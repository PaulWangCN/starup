/**
 * 统一日志工具
 * 提供格式化的日志输出，包含时间戳和日志级别
 */

import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private static instance: Logger;
  private level: LogLevel = 'info';
  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private readonly levelColors: Record<LogLevel, (text: string) => string> = {
    debug: chalk.gray,
    info: chalk.blue,
    warn: chalk.yellow,
    error: chalk.red,
  };

  private constructor() {
    const envLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
    this.setLevel(envLevel);
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.level];
  }

  private formatMessage(level: LogLevel, module: string, message: string): string {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const levelStr = level.toUpperCase().padEnd(5);
    const moduleStr = module.padEnd(12);
    return `[${timestamp}] [${this.levelColors[level](levelStr)}] [${moduleStr}] ${message}`;
  }

  debug(module: string, message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', module, message), ...args);
    }
  }

  info(module: string, message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', module, message), ...args);
    }
  }

  warn(module: string, message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', module, message), ...args);
    }
  }

  error(module: string, message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', module, message), ...args);
    }
  }

  /**
   * 打印启动横幅
   */
  printBanner(service: string, version: string): void {
    const lines = [
      '╔══════════════════════════════════════════╗',
      `║  ${chalk.bold.white(`StarUp ${service}`.padEnd(38))}  ║`,
      `║  ${chalk.gray(`Version: ${version}`.padEnd(38))}  ║`,
      '╚══════════════════════════════════════════╝',
    ];
    console.log();
    for (const line of lines) {
      console.log(chalk.cyan(line));
    }
    console.log();
  }
}

export const logger = Logger.getInstance();

/**
 * 安全的 JSON 序列化，处理循环引用
 */
export function safeStringify(obj: any, space?: number): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    // 处理循环引用
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }
      seen.add(value);
    }
    // 处理 Error 对象
    if (value instanceof Error) {
      return {
        message: value.message,
        name: value.name,
        stack: value.stack,
      };
    }
    // 处理函数
    if (typeof value === 'function') {
      return '[Function]';
    }
    // 处理 Promise
    if (value instanceof Promise) {
      return '[Promise]';
    }
    // 处理 Map
    if (value instanceof Map) {
      return { '[Map]': Array.from(value.entries()) };
    }
    // 处理 Set
    if (value instanceof Set) {
      return { '[Set]': Array.from(value.values()) };
    }
    // 处理 BigInt
    if (typeof value === 'bigint') {
      return value.toString();
    }
    // 处理 Symbol
    if (typeof value === 'symbol') {
      return value.toString();
    }
    return value;
  }, space);
}

/**
 * 安全地将对象转换为字符串，用于日志输出
 */
export function safeToString(obj: any): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'boolean') return String(obj);
  if (obj instanceof Error) return obj.message;
  
  try {
    return safeStringify(obj);
  } catch {
    return '[Object with circular references]';
  }
}
