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
