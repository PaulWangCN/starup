/**
 * HeartbeatManager
 * 在 Gateway 层管理心跳任务
 * 定时读取 HEARTBEAT.md，调用 Agent 处理，并根据规则发送给用户
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Gateway } from './Gateway';
import { OutgoingMessage } from '../types';

export interface HeartbeatResult {
  hasTask: boolean;
  content: string;
  preferredChannel?: string;
}

export class HeartbeatManager {
  private gateway: Gateway;
  private timer: NodeJS.Timeout | null = null;
  private interval: number;
  private heartbeatPath: string;
  private sessionId: string | null = null;
  
  // 记录用户最近沟通的渠道: userId -> channel
  private recentChannels: Map<string, string> = new Map();

  constructor(gateway: Gateway, intervalMs?: number) {
    this.gateway = gateway;
    this.interval = intervalMs || 30 * 60 * 1000; // 默认30分钟
    this.heartbeatPath = path.join(process.cwd(), '.starup', 'HEARTBEAT.md');
  }

  /**
   * 记录用户最近使用的渠道
   */
  recordUserChannel(userId: string, channel: string): void {
    this.recentChannels.set(userId, channel);
  }

  /**
   * 启动心跳定时器
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runHeartbeat().catch((err) => {
        console.error('[HeartbeatManager] Error:', err);
      });
    }, this.interval);
    console.log(`[HeartbeatManager] Started (interval: ${this.interval}ms)`);
  }

  /**
   * 停止心跳定时器
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[HeartbeatManager] Stopped');
    }
    if (this.sessionId) {
      try {
        this.gateway.core.sessionManager.destroySession(this.sessionId);
      } catch {
        // ignore
      }
      this.sessionId = null;
    }
  }

  /**
   * 执行一次心跳任务
   */
  private async runHeartbeat(): Promise<void> {
    // 1. 读取心跳文件
    let content: string;
    try {
      content = await fs.readFile(this.heartbeatPath, 'utf-8');
    } catch {
      console.log('[HeartbeatManager] HEARTBEAT.md not found, skipping');
      return;
    }

    // 2. 检查是否有实际任务内容
    if (!this.hasRealTask(content)) {
      console.log('[HeartbeatManager] No real task in heartbeat, skipping');
      return;
    }

    // 3. 获取已启用的渠道列表
    const enabledChannels = this.gateway.adapters.list();
    if (enabledChannels.length === 0) {
      console.log('[HeartbeatManager] No channels enabled, skipping notification');
      return;
    }

    // 4. 确保心跳会话存在
    if (!this.sessionId) {
      const systemPrompt = this.gateway.core.getSystemPrompt();
      if (!systemPrompt) {
        console.log('[HeartbeatManager] System prompt not ready, skipping');
        return;
      }
      const session = this.gateway.core.sessionManager.createStandaloneSession(systemPrompt);
      this.sessionId = session.id;
    }

    // 5. 调用 Agent 处理心跳
    let result: string;
    try {
      const response = await this.gateway.core.processMessage(this.sessionId, content.trim());
      result = response.finalReply;
      
      // 清理会话历史，只保留 system prompt
      const session = this.gateway.core.sessionManager.getSession(this.sessionId);
      if (session) {
        session.context.messages = session.context.messages.filter((m) => m.role === 'system');
        session.updatedAt = Date.now();
      }
    } catch (error) {
      console.error('[HeartbeatManager] Failed to process heartbeat:', error);
      return;
    }

    // 6. 判断结果是否包含实际内容（不是 HEARTBEAT_OK 或空）
    if (!result || result.trim() === 'HEARTBEAT_OK' || result.trim() === '') {
      console.log('[HeartbeatManager] Agent returned HEARTBEAT_OK or empty, no notification needed');
      return;
    }

    // 7. 解析渠道信息并发送
    const { channel, cleanContent } = this.extractChannel(result);
    const targetChannel = this.selectChannel(channel, enabledChannels);
    
    if (!targetChannel) {
      console.log('[HeartbeatManager] No suitable channel found, skipping notification');
      return;
    }

    // 8. 发送消息
    await this.sendToChannel(targetChannel, cleanContent);
  }

  /**
   * 检查内容中是否有实际任务
   * 排除注释、标题、HEARTBEAT_OK 等
   */
  private hasRealTask(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed) return false;
    
    // 移除 Markdown 注释
    const noComments = trimmed.replace(/<!--[\s\S]*?-->/g, '');
    // 移除标题
    const noHeaders = noComments.replace(/^#+\s*.+/gm, '');
    // 移除 HEARTBEAT_OK
    const noOk = noHeaders.replace(/HEARTBEAT_OK/gi, '');
    // 检查是否有实质内容
    return noOk.trim().length > 10; // 至少10个字符才算有内容
  }

  /**
   * 从 AI 回复中提取渠道信息
   * 格式: [CHANNEL:xxx] 或 <!-- channel: xxx -->
   */
  private extractChannel(content: string): { channel?: string; cleanContent: string } {
    // 匹配 [CHANNEL:xxx] 格式
    const channelMatch = content.match(/\[CHANNEL:(\w+)\]/i);
    if (channelMatch) {
      return {
        channel: channelMatch[1].toLowerCase(),
        cleanContent: content.replace(/\[CHANNEL:\w+\]\s*/i, '').trim(),
      };
    }
    
    // 匹配 <!-- channel: xxx --> 格式
    const commentMatch = content.match(/<!--\s*channel:\s*(\w+)\s*-->/i);
    if (commentMatch) {
      return {
        channel: commentMatch[1].toLowerCase(),
        cleanContent: content.replace(/<!--\s*channel:\s*\w+\s*-->\s*/i, '').trim(),
      };
    }
    
    return { cleanContent: content };
  }

  /**
   * 选择发送渠道
   */
  private selectChannel(
    preferredChannel: string | undefined,
    enabledChannels: string[]
  ): string | null {
    // 1. 如果指定了渠道且已启用，直接使用
    if (preferredChannel && enabledChannels.includes(preferredChannel)) {
      return preferredChannel;
    }
    
    // 2. 如果指定了渠道但未启用，放弃
    if (preferredChannel) {
      console.log(`[HeartbeatManager] Preferred channel '${preferredChannel}' not enabled`);
      return null;
    }
    
    // 3. 没有指定渠道，找最近使用的渠道
    // 简化处理：取第一个有记录的渠道
    for (const [userId, channel] of this.recentChannels) {
      if (enabledChannels.includes(channel)) {
        return channel;
      }
    }
    
    // 4. 没有记录，使用第一个启用的渠道
    return enabledChannels[0] || null;
  }

  /**
   * 发送消息到指定渠道
   */
  private async sendToChannel(channel: string, content: string): Promise<void> {
    // 获取该渠道最近的用户
    let targetUserId: string | undefined;
    for (const [userId, ch] of this.recentChannels) {
      if (ch === channel) {
        targetUserId = userId;
        break;
      }
    }
    
    if (!targetUserId) {
      console.log(`[HeartbeatManager] No target user for channel '${channel}'`);
      return;
    }

    const message: OutgoingMessage = {
      channel,
      target: { user_id: targetUserId },
      content: { type: 'text', body: content },
    };

    try {
      await this.gateway.adapters.sendTo(channel, message);
      console.log(`[HeartbeatManager] Notification sent via ${channel} to ${targetUserId}`);
    } catch (error) {
      console.error(`[HeartbeatManager] Failed to send via ${channel}:`, error);
    }
  }
}
