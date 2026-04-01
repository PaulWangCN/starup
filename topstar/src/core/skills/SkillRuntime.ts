import * as fs from 'fs/promises';
import * as path from 'path';
import {
  SkillPackage,
  SkillInstance,
  SkillStatus,
  ToolDefinition,
  PromptFragment,
  SkillRuntimeType,
  VMInstance,
  SandboxConfig,
} from '../../types';
import { Sandbox } from './Sandbox';

/**
 * Skill 运行时
 * 管理 Skill 的 VM 实例、热插拔、跨 Skill 通信
 */
export class SkillRuntime {
  private instances: Map<string, SkillInstance> = new Map();
  private vmPool: Map<string, VMWorker> = new Map();
  private sandbox: Sandbox;
  private promptFragments: Map<string, PromptFragment> = new Map();

  constructor() {
    this.sandbox = new Sandbox();
  }

  /**
   * 初始化运行时
   */
  async initialize(): Promise<void> {
    console.log('[SkillRuntime] Initializing...');
    // 恢复之前激活的 Skills
    await this.restoreActiveSkills();
  }

  /**
   * 加载 Skill 到内存（非激活）
   */
  async load(pkg: SkillPackage): Promise<SkillInstance> {
    console.log(`[SkillRuntime] Loading ${pkg.manifest.id}...`);

    // 检查是否已加载
    if (this.instances.has(pkg.manifest.id)) {
      return this.instances.get(pkg.manifest.id)!;
    }

    // 创建 VM 实例
    const vm = await this.createVM(pkg);

    // 解析工具定义
    const tools = await this.parseTools(pkg);

    // 创建实例
    const instance: SkillInstance = {
      id: pkg.manifest.id,
      package: pkg,
      vm,
      tools,
      status: 'installed',
    };

    this.instances.set(pkg.manifest.id, instance);
    console.log(`[SkillRuntime] Loaded ${pkg.manifest.id}`);

    return instance;
  }

  /**
   * 激活 Skill（注册到主会话）
   */
  async activate(instance: SkillInstance): Promise<void> {
    console.log(`[SkillRuntime] Activating ${instance.id}...`);

    if (instance.status === 'active') {
      console.warn(`[SkillRuntime] ${instance.id} already active`);
      return;
    }

    // 初始化 VM
    await this.initializeVM(instance);

    // 注册工具
    for (const tool of instance.tools) {
      await this.registerTool(instance.id, tool);
    }

    // 注入 Prompt 片段（L5 层）
    await this.injectPromptFragment(instance);

    // 调用生命周期钩子
    await this.callHook(instance, 'onActivate');

    instance.status = 'active';
    console.log(`[SkillRuntime] Activated ${instance.id}`);
  }

  /**
   * 停用（保留状态）
   */
  async deactivate(skillId: string): Promise<void> {
    const instance = this.instances.get(skillId);
    if (!instance || instance.status !== 'active') {
      return;
    }

    console.log(`[SkillRuntime] Deactivating ${skillId}...`);

    // 调用生命周期钩子
    await this.callHook(instance, 'onDeactivate');

    // 注销工具
    for (const tool of instance.tools) {
      await this.unregisterTool(skillId, tool.name);
    }

    // 移除 Prompt 片段
    this.removePromptFragment(skillId);

    // 挂起 VM
    await this.suspendVM(instance);

    instance.status = 'disabled';
    console.log(`[SkillRuntime] Deactivated ${skillId}`);
  }

  /**
   * 完全卸载
   */
  async unload(skillId: string): Promise<void> {
    const instance = this.instances.get(skillId);
    if (!instance) {
      return;
    }

    console.log(`[SkillRuntime] Unloading ${skillId}...`);

    // 如果激活状态，先停用
    if (instance.status === 'active') {
      await this.deactivate(skillId);
    }

    // 调用卸载钩子
    await this.callHook(instance, 'onUninstall');

    // 销毁 VM
    if (instance.vm) {
      await this.destroyVM(instance.vm);
    }

    // 清理资源
    this.instances.delete(skillId);
    this.promptFragments.delete(skillId);

    console.log(`[SkillRuntime] Unloaded ${skillId}`);
  }

  /**
   * 热重载（蓝绿部署）
   */
  async hotReload(skillId: string, newPkg: SkillPackage): Promise<void> {
    console.log(`[SkillRuntime] Hot reloading ${skillId}...`);

    const oldInstance = this.instances.get(skillId);
    if (!oldInstance) {
      throw new Error(`Skill ${skillId} not found`);
    }

    const wasActive = oldInstance.status === 'active';

    // 加载新版本
    const newInstance = await this.load(newPkg);

    if (wasActive) {
      // 并行运行新旧版本
      await this.activate(newInstance);

      // 切换流量（原子操作）
      await this.switchTraffic(skillId, newInstance);

      // 卸载旧版本
      await this.unload(skillId);

      // 更新实例 ID
      this.instances.delete(skillId);
      newInstance.id = skillId;
      this.instances.set(skillId, newInstance);
    }

    console.log(`[SkillRuntime] Hot reloaded ${skillId}`);
  }

  /**
   * 跨 Skill 通信
   */
  async call(
    caller: string,
    target: string,
    method: string,
    args: any[]
  ): Promise<any> {
    // 检查权限
    const callerInstance = this.instances.get(caller);
    if (!callerInstance) {
      throw new Error(`Caller ${caller} not found`);
    }

    const hasPermission = this.checkInteropPermission(callerInstance, target, method);
    if (!hasPermission) {
      throw new Error(`No permission to call ${target}:${method}`);
    }

    // 获取目标实例
    const targetInstance = this.instances.get(target);
    if (!targetInstance || targetInstance.status !== 'active') {
      throw new Error(`Target ${target} not found or not active`);
    }

    // 执行调用
    return this.executeCall(targetInstance, method, args);
  }

  /**
   * 获取 Prompt 片段（用于组装 L5 层）
   */
  getPromptFragments(): PromptFragment[] {
    return Array.from(this.promptFragments.values());
  }

  /**
   * 获取激活的 Skill 列表
   */
  getActiveSkills(): SkillInstance[] {
    return Array.from(this.instances.values())
      .filter(i => i.status === 'active');
  }

  /**
   * 获取 Skill 状态
   */
  getStatus(skillId: string): SkillStatus | null {
    return this.instances.get(skillId)?.status || null;
  }

  // ==================== 私有方法 ====================

  /**
   * 创建 VM 实例
   */
  private async createVM(pkg: SkillPackage): Promise<VMInstance> {
    const runtime = pkg.manifest.runtime;
    
    // 配置沙箱
    const sandboxConfig: SandboxConfig = {
      permissions: pkg.manifest.permissions,
      skillPath: pkg.path,
      homePath: path.join(pkg.path, 'data'),
      tempPath: path.join(process.env.HOME || '.', '.starup', 'temp'),
    };

    // 创建 VM
    const vmId = `${pkg.manifest.id}-${Date.now()}`;
    const vm: VMInstance = {
      id: vmId,
      type: runtime.type,
      sandbox: sandboxConfig,
      memory: this.parseMemoryLimit(pkg.manifest.resources?.max_memory),
      cpu: pkg.manifest.resources?.max_cpu_percent || 10,
    };

    return vm;
  }

  /**
   * 初始化 VM
   */
  private async initializeVM(instance: SkillInstance): Promise<void> {
    if (!instance.vm) return;

    const runtime = instance.package.manifest.runtime;
    const entryPath = path.join(instance.package.path, runtime.entry);

    try {
      // 根据运行时类型初始化
      switch (runtime.type) {
        case 'javascript':
          await this.initializeJSVM(instance.vm, entryPath);
          break;
        case 'python':
          await this.initializePythonVM(instance.vm, entryPath);
          break;
        case 'wasm':
          await this.initializeWASMVM(instance.vm, entryPath);
          break;
        default:
          throw new Error(`Unsupported runtime: ${runtime.type}`);
      }

      // 调用安装钩子
      await this.callHook(instance, 'onInstall');
    } catch (error) {
      console.error(`[SkillRuntime] Failed to initialize VM for ${instance.id}:`, error);
      throw error;
    }
  }

  /**
   * 初始化 JavaScript VM（使用 QuickJS）
   */
  private async initializeJSVM(vm: VMInstance, entryPath: string): Promise<void> {
    // 实际应使用 QuickJS 或其他 JS 沙箱
    // 这里使用简化实现
    console.log(`[SkillRuntime] Initializing JS VM: ${vm.id}`);
    
    // 创建 Worker 上下文
    const worker = new VMWorker(vm);
    this.vmPool.set(vm.id, worker);
    
    // 注入受限 API
    worker.injectAPI({
      console: {
        log: (...args: any[]) => console.log(`[${vm.id}]`, ...args),
        error: (...args: any[]) => console.error(`[${vm.id}]`, ...args),
      },
      fetch: this.createFetchProxy(vm),
      fs: this.createFSProxy(vm),
      memory: this.createMemoryProxy(vm),
    });

    // 加载入口文件
    const code = await fs.readFile(entryPath, 'utf-8');
    await worker.execute(code);
  }

  /**
   * 初始化 Python VM
   */
  private async initializePythonVM(vm: VMInstance, entryPath: string): Promise<void> {
    // TODO: 使用 WASM Python 或子进程隔离
    console.log(`[SkillRuntime] Python VM not yet implemented`);
    throw new Error('Python VM not implemented');
  }

  /**
   * 初始化 WASM VM
   */
  private async initializeWASMVM(vm: VMInstance, entryPath: string): Promise<void> {
    // TODO: 使用 WebAssembly
    console.log(`[SkillRuntime] WASM VM not yet implemented`);
    throw new Error('WASM VM not implemented');
  }

  /**
   * 解析工具定义
   */
  private async parseTools(pkg: SkillPackage): Promise<ToolDefinition[]> {
    // 从 manifest 或代码中解析工具定义
    // 简化实现：返回空列表
    return [];
  }

  /**
   * 注册工具
   */
  private async registerTool(skillId: string, tool: ToolDefinition): Promise<void> {
    // 注册到 ToolRegistry
    console.log(`[SkillRuntime] Registered tool ${tool.name} from ${skillId}`);
  }

  /**
   * 注销工具
   */
  private async unregisterTool(skillId: string, toolName: string): Promise<void> {
    console.log(`[SkillRuntime] Unregistered tool ${toolName} from ${skillId}`);
  }

  /**
   * 注入 Prompt 片段
   */
  private async injectPromptFragment(instance: SkillInstance): Promise<void> {
    const promptPath = path.join(instance.package.path, 'PROMPT.md');
    
    try {
      const content = await fs.readFile(promptPath, 'utf-8');
      
      const fragment: PromptFragment = {
        section: 'skills',
        content,
        trigger_patterns: instance.package.manifest.integrations?.intent_recognition?.examples || [],
        context_window: instance.package.manifest.integrations?.context?.retention_turns || 5,
      };

      this.promptFragments.set(instance.id, fragment);
      console.log(`[SkillRuntime] Injected prompt fragment for ${instance.id}`);
    } catch {
      // PROMPT.md 可能不存在，忽略
    }
  }

  /**
   * 移除 Prompt 片段
   */
  private removePromptFragment(skillId: string): void {
    this.promptFragments.delete(skillId);
    console.log(`[SkillRuntime] Removed prompt fragment for ${skillId}`);
  }

  /**
   * 调用生命周期钩子
   */
  private async callHook(instance: SkillInstance, hookName: string): Promise<void> {
    const worker = instance.vm ? this.vmPool.get(instance.vm.id) : null;
    if (!worker) return;

    try {
      await worker.callFunction(`hooks.${hookName}`, []);
    } catch (error) {
      // 钩子可能不存在，忽略错误
      if ((error as Error).message.includes('not defined')) {
        return;
      }
      throw error;
    }
  }

  /**
   * 挂起 VM
   */
  private async suspendVM(instance: SkillInstance): Promise<void> {
    if (!instance.vm) return;
    
    const worker = this.vmPool.get(instance.vm.id);
    if (worker) {
      worker.suspend();
    }
  }

  /**
   * 销毁 VM
   */
  private async destroyVM(vm: VMInstance): Promise<void> {
    const worker = this.vmPool.get(vm.id);
    if (worker) {
      worker.terminate();
      this.vmPool.delete(vm.id);
    }
  }

  /**
   * 切换流量（原子操作）
   */
  private async switchTraffic(skillId: string, newInstance: SkillInstance): Promise<void> {
    // 原子切换：更新路由表
    console.log(`[SkillRuntime] Switched traffic to ${newInstance.id}`);
  }

  /**
   * 检查跨 Skill 调用权限
   */
  private checkInteropPermission(instance: SkillInstance, target: string, method: string): boolean {
    const permissions = instance.package.manifest.permissions;
    const interopPerm = permissions.find(p => p.id === 'skill.interop');
    
    if (!interopPerm) return false;
    
    const scope = interopPerm.scope as string[];
    return scope.includes(`${target}:${method}`) || scope.includes(`${target}:*`);
  }

  /**
   * 执行跨 Skill 调用
   */
  private async executeCall(instance: SkillInstance, method: string, args: any[]): Promise<any> {
    const worker = instance.vm ? this.vmPool.get(instance.vm.id) : null;
    if (!worker) {
      throw new Error(`VM not found for ${instance.id}`);
    }

    return worker.callFunction(method, args);
  }

  /**
   * 恢复之前激活的 Skills
   */
  private async restoreActiveSkills(): Promise<void> {
    // 从持久化存储恢复
    console.log('[SkillRuntime] Restoring active skills...');
  }

  /**
   * 解析内存限制
   */
  private parseMemoryLimit(limit?: string): number {
    if (!limit) return 128 * 1024 * 1024; // 默认 128MB
    
    const match = limit.match(/^(\d+)(mb|gb)$/i);
    if (!match) return 128 * 1024 * 1024;
    
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    return unit === 'gb' ? value * 1024 * 1024 * 1024 : value * 1024 * 1024;
  }

  // ==================== 代理创建方法 ====================

  private createFetchProxy(vm: VMInstance) {
    return async (url: string, options?: any) => {
      // 检查网络权限
      // TODO: 实现细粒度域名检查
      console.log(`[SkillRuntime] Fetch: ${url}`);
      return fetch(url, options);
    };
  }

  private createFSProxy(vm: VMInstance) {
    return {
      readFile: async (filePath: string) => {
        // 检查文件权限
        const fullPath = path.join(vm.sandbox.skillPath, filePath);
        return fs.readFile(fullPath, 'utf-8');
      },
      writeFile: async (filePath: string, data: string) => {
        // 检查文件权限
        const fullPath = path.join(vm.sandbox.homePath, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        return fs.writeFile(fullPath, data);
      },
    };
  }

  private createMemoryProxy(vm: VMInstance) {
    return {
      get: async (key: string) => {
        // 检查记忆权限
        return null;
      },
      set: async (key: string, value: any) => {
        // 检查记忆权限
      },
    };
  }
}

/**
 * VM Worker（简化实现）
 * 实际应使用 QuickJS、VM2 或 Worker Threads
 */
class VMWorker {
  private context: any = {};
  private suspended = false;

  constructor(private vm: VMInstance) {}

  injectAPI(api: any): void {
    this.context = { ...this.context, ...api };
  }

  async execute(code: string): Promise<void> {
    if (this.suspended) throw new Error('VM suspended');
    
    // 简化实现：使用 eval（实际应该用 VM）
    // 这里仅作为占位符
    console.log(`[VMWorker] Executing code in ${this.vm.id}`);
  }

  async callFunction(name: string, args: any[]): Promise<any> {
    if (this.suspended) throw new Error('VM suspended');
    
    const func = name.split('.').reduce((obj, key) => obj?.[key], this.context);
    if (typeof func !== 'function') {
      throw new Error(`Function ${name} not defined`);
    }
    return func(...args);
  }

  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.suspended = false;
  }

  terminate(): void {
    this.context = {};
    this.suspended = true;
  }
}

// 单例导出
export const skillRuntime = new SkillRuntime();
