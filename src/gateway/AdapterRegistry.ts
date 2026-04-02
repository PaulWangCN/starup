/**
 * AdapterRegistry
 * 管理外部消息适配器（飞书、微信、钉钉等）
 */

import { Adapter, GatewayClient } from './types';
import { UnifiedMessage, OutgoingMessage } from '../types';

export class AdapterRegistry {
  private adapters: Map<string, Adapter> = new Map();
  private messageCallback: ((msg: UnifiedMessage) => void) | null = null;

  register(adapter: Adapter): void {
    this.adapters.set(adapter.name, adapter);
    adapter.onMessage((msg) => {
      this.messageCallback?.(msg);
    });
  }

  unregister(name: string): void {
    const adapter = this.adapters.get(name);
    if (adapter) {
      adapter.stop().catch(() => {});
      this.adapters.delete(name);
    }
  }

  get(name: string): Adapter | undefined {
    return this.adapters.get(name);
  }

  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  onMessage(callback: (msg: UnifiedMessage) => void): void {
    this.messageCallback = callback;
  }

  async initializeAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.initialize();
    }
  }

  async startAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.start();
    }
  }

  async stopAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
    }
    this.adapters.clear();
  }

  async sendTo(channel: string, message: OutgoingMessage): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      throw new Error(`Adapter '${channel}' not found`);
    }
    await adapter.send(message);
  }
}

export const adapterRegistry = new AdapterRegistry();
