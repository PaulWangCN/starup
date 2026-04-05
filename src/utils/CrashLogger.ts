import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CrashLogEntry {
  timestamp: string;
  type: 'crash' | 'event' | 'input' | 'lifecycle' | 'error' | 'warning';
  message: string;
  stack?: string;
  context?: Record<string, any>;
  system?: {
    memory: NodeJS.MemoryUsage;
    uptime: number;
    cwd: string;
    pid: number;
    platform: string;
    nodeVersion: string;
    cpuUsage: NodeJS.CpuUsage;
    resourceUsage?: NodeJS.ResourceUsage;
  };
  inputHistory?: string[];
  lastInputs?: string[];
}

class CrashLoggerClass {
  private logFile: string;
  private inputHistory: string[] = [];
  private readonly MAX_HISTORY = 10;

  constructor() {
    const logDir = path.join(process.cwd(), '.starup', 'crash-logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logFile = path.join(logDir, `crash-${Date.now()}.jsonl`);
    this.logEvent('CrashLogger initialized', { logFile: this.logFile });
  }

  private getSystemState(): CrashLogEntry['system'] {
    return {
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      cwd: process.cwd(),
      pid: process.pid,
      platform: os.platform(),
      nodeVersion: process.version,
      cpuUsage: process.cpuUsage(),
      resourceUsage: process.resourceUsage?.(),
    };
  }

  private writeLog(entry: CrashLogEntry): void {
    try {
      fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    } catch (e) {
      // Last resort
      console.error('[CRASH LOGGER FAILED]', e);
    }
  }

  logCrash(type: string, error: Error | any, context?: Record<string, any>): void {
    const entry: CrashLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'crash',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: {
        ...context,
        inputHistory: this.inputHistory,
        lastInputs: this.inputHistory.slice(-5),
      },
      system: this.getSystemState(),
    };
    this.writeLog(entry);
    
    // Also log to stderr immediately
    console.error(`\n[CRASH CAPTURED - ${type}]`);
    console.error('Message:', entry.message);
    console.error('Context:', JSON.stringify(context, null, 2));
    console.error('Stack:', entry.stack);
    console.error(`[Log saved to: ${this.logFile}]\n`);
  }

  logEvent(message: string, context?: Record<string, any>): void {
    const entry: CrashLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'event',
      message,
      context,
      system: this.getSystemState(),
    };
    this.writeLog(entry);
  }

  logInput(input: string, context?: Record<string, any>): void {
    // Track input history for crash analysis
    this.inputHistory.push(input);
    if (this.inputHistory.length > this.MAX_HISTORY) {
      this.inputHistory.shift();
    }

    const entry: CrashLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'input',
      message: `Input: "${input.slice(0, 100)}"`,
      context: {
        inputLength: input.length,
        inputPreview: input.slice(0, 50),
        ...context,
      },
      system: this.getSystemState(),
    };
    this.writeLog(entry);
  }

  logLifecycle(component: string, event: string, context?: Record<string, any>): void {
    const entry: CrashLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'lifecycle',
      message: `[${component}] ${event}`,
      context,
      system: this.getSystemState(),
    };
    this.writeLog(entry);
  }

  logError(message: string, error: any, context?: Record<string, any>): void {
    const entry: CrashLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'error',
      message,
      stack: error instanceof Error ? error.stack : undefined,
      context: {
        error: error instanceof Error ? error.message : String(error),
        inputHistory: this.inputHistory,
        ...context,
      },
      system: this.getSystemState(),
    };
    this.writeLog(entry);
  }

  getLogFile(): string {
    return this.logFile;
  }
}

// Singleton instance
let instance: CrashLoggerClass | null = null;

export function CrashLogger(): CrashLoggerClass {
  if (!instance) {
    instance = new CrashLoggerClass();
  }
  return instance;
}

// Setup global error handlers
export function setupGlobalErrorHandling(): void {
  const logger = CrashLogger();

  process.on('uncaughtException', (error) => {
    logger.logCrash('uncaughtException', error);
    console.error('\n[FATAL] Uncaught Exception:', error);
    
    // Give time for logs to write
    setTimeout(() => {
      process.exit(1);
    }, 100);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.logCrash('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)), {
      promise: String(promise),
    });
    console.error('\n[FATAL] Unhandled Rejection:', reason);
  });

  process.on('SIGTERM', () => {
    logger.logEvent('SIGTERM received');
  });

  process.on('SIGINT', () => {
    logger.logEvent('SIGINT received');
  });

  process.on('exit', (code) => {
    logger.logEvent('Process exit', { exitCode: code });
  });

  // Handle stdin/stdout errors
  process.stdin.on('error', (err) => {
    logger.logCrash('stdin error', err);
  });

  process.stdout.on('error', (err) => {
    logger.logCrash('stdout error', err);
  });

  // Handle warnings
  process.on('warning', (warning) => {
    logger.logEvent('Node.js warning', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    });
  });

  logger.logEvent('Global error handlers installed');
}

// Reset instance (for testing)
export function resetCrashLogger(): void {
  instance = null;
}
