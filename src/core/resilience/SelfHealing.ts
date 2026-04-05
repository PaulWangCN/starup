/**
 * 自我恢复系统
 * 实现看门狗监控、崩溃检测和自动恢复
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { starupDB } from '../persistence/Database';
import { sessionPersistence } from '../persistence/SessionPersistence';
import { logger } from '../../utils/Logger';

export interface HealthStatus {
  healthy: boolean;
  lastHeartbeat: number;
  memoryUsage: NodeJS.MemoryUsage;
  uptime: number;
  activeSessions: number;
}

export interface RecoveryAction {
  type: 'restart_session' | 'restart_process' | 'clear_state' | 'notify';
  target?: string;
  reason: string;
}

export class SelfHealingSystem {
  private watchdogTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private heartbeatTimestamp: number = Date.now();
  private readonly HEARTBEAT_TIMEOUT = 60000; // 60 秒心跳超时
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 秒健康检查
  private readonly MAX_RESTART_ATTEMPTS = 3;
  private restartAttempts: number = 0;
  private lastRestartTime: number = 0;
  private childProcess: ChildProcess | null = null;
  private onRecoveryCallback?: (action: RecoveryAction) => void;
  private isRunning: boolean = false;

  /**
   * 初始化自我恢复系统
   */
  async initialize(): Promise<void> {
    await sessionPersistence.initialize();
    
    // 检查是否需要恢复（上次崩溃）
    await this.checkForRecovery();
    
    this.startHealthMonitoring();
    this.isRunning = true;
    
    logger.info('SelfHealing', 'Self-healing system initialized');
  }

  /**
   * 设置恢复回调
   */
  onRecovery(callback: (action: RecoveryAction) => void): void {
    this.onRecoveryCallback = callback;
  }

  /**
   * 发送心跳（由主进程定期调用）
   */
  heartbeat(): void {
    this.heartbeatTimestamp = Date.now();
    
    // 记录系统状态
    starupDB.setSystemState('last_heartbeat', this.heartbeatTimestamp.toString());
    starupDB.setSystemState('memory_usage', JSON.stringify(process.memoryUsage()));
    starupDB.setSystemState('pid', process.pid.toString());
  }

  /**
   * 检查是否需要恢复（系统启动时调用）
   */
  private async checkForRecovery(): Promise<void> {
    const lastState = starupDB.getAllSystemState();
    const lastHeartbeat = parseInt(lastState.last_heartbeat || '0');
    const lastPid = parseInt(lastState.pid || '0');
    
    // 如果没有上次状态，正常启动
    if (!lastHeartbeat) {
      logger.info('SelfHealing', 'No previous state found, fresh start');
      return;
    }

    // 检查上次进程是否还在运行
    const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
    const wasRunning = lastPid && this.isProcessRunning(lastPid);
    
    if (wasRunning) {
      logger.warn('SelfHealing', `Another instance is already running (PID: ${lastPid})`);
      // 可以在这里选择退出或进入只读模式
    } else if (timeSinceLastHeartbeat < this.HEARTBEAT_TIMEOUT * 2) {
      // 看起来像是崩溃了，尝试恢复
      logger.warn('SelfHealing', `Previous instance may have crashed (${Math.round(timeSinceLastHeartbeat / 1000)}s ago)`);
      await this.performRecovery();
    }
  }

  /**
   * 检查进程是否还在运行
   */
  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 执行恢复
   */
  private async performRecovery(): Promise<void> {
    const sessionsToRecover = sessionPersistence.getSessionsToRecover();
    
    if (sessionsToRecover.length === 0) {
      logger.info('SelfHealing', 'No sessions to recover');
      return;
    }

    logger.info('SelfHealing', `Recovering ${sessionsToRecover.length} sessions`);

    for (const persisted of sessionsToRecover) {
      const action: RecoveryAction = {
        type: 'restart_session',
        target: persisted.session.id,
        reason: `Session ${persisted.session.id} recovered from snapshot`,
      };

      this.onRecoveryCallback?.(action);
      
      // 记录恢复日志
      starupDB.logKairos('info', 'self_healing', `Recovered session ${persisted.session.id}`, {
        timestamp: persisted.timestamp,
        messageCount: persisted.messages.length,
      });
    }

    // 检查待处理任务
    const pendingTasks = sessionPersistence.getPendingTasks();
    if (pendingTasks.length > 0) {
      logger.info('SelfHealing', `Found ${pendingTasks.length} pending tasks to retry`);
      
      for (const task of pendingTasks) {
        if (task.retryCount < 3) {
          const action: RecoveryAction = {
            type: 'restart_session',
            target: task.sessionId,
            reason: `Retrying pending task ${task.id}`,
          };
          this.onRecoveryCallback?.(action);
        }
      }
    }
  }

  /**
   * 启动健康监控
   */
  private startHealthMonitoring(): void {
    // 健康检查定时器
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL);
    (this.healthCheckTimer as any).unref();

    logger.debug('SelfHealing', 'Health monitoring started');
  }

  /**
   * 执行健康检查
   */
  private performHealthCheck(): void {
    const status = this.getHealthStatus();
    
    // 检查内存使用
    const memoryThreshold = 2 * 1024 * 1024 * 1024; // 2GB
    if (status.memoryUsage.heapUsed > memoryThreshold) {
      logger.warn('SelfHealing', `High memory usage: ${Math.round(status.memoryUsage.heapUsed / 1024 / 1024)}MB`);
      
      // 触发垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
        logger.info('SelfHealing', 'Triggered garbage collection');
      }
    }

    // 记录健康状态
    starupDB.setSystemState('health_status', JSON.stringify({
      healthy: status.healthy,
      memoryUsage: status.memoryUsage,
      uptime: status.uptime,
      timestamp: Date.now(),
    }));
  }

  /**
   * 获取健康状态
   */
  getHealthStatus(): HealthStatus {
    const now = Date.now();
    const timeSinceLastHeartbeat = now - this.heartbeatTimestamp;
    
    return {
      healthy: timeSinceLastHeartbeat < this.HEARTBEAT_TIMEOUT,
      lastHeartbeat: this.heartbeatTimestamp,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      activeSessions: sessionPersistence.getStats().activeSessions,
    };
  }

  /**
   * 优雅重启
   */
  async gracefulRestart(reason: string): Promise<void> {
    logger.info('SelfHealing', `Graceful restart initiated: ${reason}`);
    
    // 检查重启频率
    const now = Date.now();
    if (now - this.lastRestartTime < 60000) {
      this.restartAttempts++;
    } else {
      this.restartAttempts = 1;
    }
    this.lastRestartTime = now;

    if (this.restartAttempts > this.MAX_RESTART_ATTEMPTS) {
      logger.error('SelfHealing', 'Max restart attempts reached, giving up');
      const action: RecoveryAction = {
        type: 'notify',
        reason: 'Max restart attempts reached',
      };
      this.onRecoveryCallback?.(action);
      return;
    }

    // 保存所有状态
    await sessionPersistence.shutdown();

    // 通知恢复
    const action: RecoveryAction = {
      type: 'restart_process',
      reason,
    };
    this.onRecoveryCallback?.(action);

    // 实际重启逻辑由调用者处理
    logger.info('SelfHealing', 'State saved, ready for restart');
  }

  /**
   * 紧急恢复（严重错误时）
   */
  async emergencyRecovery(): Promise<void> {
    logger.error('SelfHealing', 'Emergency recovery initiated');

    try {
      // 尝试保存所有会话
      await sessionPersistence.shutdown();
    } catch (error) {
      logger.error('SelfHealing', `Failed to save state during emergency: ${error}`);
    }

    // 清空可能导致问题的状态
    starupDB.setSystemState('emergency_recovery', Date.now().toString());

    const action: RecoveryAction = {
      type: 'clear_state',
      reason: 'Emergency recovery - clearing problematic state',
    };
    this.onRecoveryCallback?.(action);
  }

  /**
   * 启动守护进程模式（作为独立进程监控主进程）
   */
  startDaemonMode(scriptPath: string): void {
    if (this.childProcess) {
      logger.warn('SelfHealing', 'Daemon already running');
      return;
    }

    const startChild = () => {
      logger.info('SelfHealing', `Starting daemon child process: ${scriptPath}`);

      this.childProcess = spawn('node', [scriptPath], {
        stdio: 'inherit',
        env: { ...process.env, STARUP_DAEMON_MODE: 'true' },
      });

      this.childProcess.on('exit', (code) => {
        logger.warn('SelfHealing', `Child process exited with code ${code}`);
        this.childProcess = null;

        if (code !== 0 && this.isRunning) {
          // 非正常退出，尝试重启
          const delay = Math.min(1000 * Math.pow(2, this.restartAttempts), 30000);
          logger.info('SelfHealing', `Restarting in ${delay}ms...`);
          
          setTimeout(() => {
            if (this.isRunning) {
              startChild();
            }
          }, delay);
        }
      });

      this.childProcess.on('error', (error) => {
        logger.error('SelfHealing', `Child process error: ${error}`);
      });
    };

    startChild();
  }

  /**
   * 停止守护进程
   */
  stopDaemon(): void {
    this.isRunning = false;
    
    if (this.childProcess) {
      this.childProcess.kill('SIGTERM');
      this.childProcess = null;
    }
  }

  /**
   * 关闭自我恢复系统
   */
  async shutdown(): Promise<void> {
    this.isRunning = false;
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    this.stopDaemon();
    await sessionPersistence.shutdown();

    logger.info('SelfHealing', 'Self-healing system shutdown complete');
  }
}

// 单例导出
export const selfHealing = new SelfHealingSystem();
