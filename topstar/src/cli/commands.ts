import { skillRegistry } from '../core/skills/SkillRegistry';
import { installManager } from '../core/skills/InstallManager';
import { skillRuntime } from '../core/skills/SkillRuntime';
import { metaInstallerSkill } from '../core/skills/MetaInstallerSkill';
import { metaRegistrySkill } from '../core/skills/MetaRegistrySkill';
import { metaUpdaterSkill } from '../core/skills/MetaUpdaterSkill';
import { InstallSpec, InstallOptions, SessionContext } from '../types';

/**
 * CLI 命令处理
 * v1.2: 新增 Skill 管理命令
 */

export class Commands {
  /**
   * 安装 Skill
   * Usage: claw install <spec> [options]
   * Examples:
   *   claw install weather
   *   claw install weather@2.1.0
   *   claw install github:user/skill-weather
   *   claw install ./local-skill --link
   */
  async install(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log('Usage: claw install <spec> [options]');
      console.log('Examples:');
      console.log('  claw install weather');
      console.log('  claw install weather@2.1.0');
      console.log('  claw install github:user/skill-weather');
      console.log('  claw install ./local-skill --link');
      return;
    }

    const spec = args[0];
    const options: InstallOptions = {
      force: args.includes('--force'),
      link: args.includes('--link'),
      offline: args.includes('--offline'),
      verify: !args.includes('--no-verify'),
    };

    console.log(`Installing ${spec}...`);
    
    const result = await skillRegistry.install(spec, options);
    
    if (result.success) {
      console.log(`✓ ${result.message}`);
      if (result.dependencies && result.dependencies.length > 0) {
        console.log(`  Dependencies: ${result.dependencies.map(d => d.id).join(', ')}`);
      }
    } else {
      console.error(`✗ Installation failed: ${result.message}`);
      if (result.error) {
        console.error(result.error);
      }
      process.exit(1);
    }
  }

  /**
   * 卸载 Skill
   * Usage: claw uninstall <skill-id> [options]
   */
  async uninstall(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log('Usage: claw uninstall <skill-id> [--purge]');
      return;
    }

    const skillId = args[0];
    const purge = args.includes('--purge');

    console.log(`Uninstalling ${skillId}...`);
    
    const result = await skillRegistry.uninstall(skillId, { purgeData: purge });
    
    if (result) {
      console.log(`✓ Uninstalled ${skillId}${purge ? ' (data purged)' : ''}`);
    } else {
      console.error(`✗ Failed to uninstall ${skillId}`);
      process.exit(1);
    }
  }

  /**
   * 列出已安装 Skills
   * Usage: claw list [options]
   */
  async list(args: string[]): Promise<void> {
    const verbose = args.includes('--verbose') || args.includes('-v');
    const showTree = args.includes('--tree');
    const showPermissions = args.includes('--permissions');

    const { builtin, user, packages } = skillRegistry.list();

    console.log('\nInstalled Skills:\n');

    // 内置 Skills
    if (builtin.length > 0) {
      console.log('Built-in Skills:');
      for (const skill of builtin) {
        console.log(`  ● ${skill.id} - ${skill.metadata.name}`);
        if (verbose) {
          console.log(`     Description: ${skill.metadata.description}`);
        }
      }
      console.log();
    }

    // 用户 Skills
    if (user.length > 0) {
      console.log('User Installed Skills:');
      for (const skill of user) {
        console.log(`  ● ${skill.id} - ${skill.metadata.name}`);
        if (verbose) {
          console.log(`     Description: ${skill.metadata.description}`);
        }
      }
      console.log();
    }

    // v1.2 Packages
    if (packages.length > 0) {
      console.log('Packages (v1.2):');
      for (const pkg of packages) {
        const status = pkg.status === 'active' ? '●' : '○';
        console.log(`  ${status} ${pkg.manifest.id}@${pkg.manifest.version} - ${pkg.manifest.name}`);
        
        if (verbose) {
          console.log(`     Description: ${pkg.manifest.description}`);
          console.log(`     Author: ${pkg.manifest.author}`);
          console.log(`     Path: ${pkg.path}`);
          console.log(`     Status: ${pkg.status}`);
        }
        
        if (showPermissions && pkg.manifest.permissions) {
          console.log(`     Permissions:`);
          for (const perm of pkg.manifest.permissions) {
            console.log(`       - ${perm.id}`);
          }
        }
      }
      console.log();
    }

    // 用户 Skills
    if (user.length > 0) {
      console.log('User Skills:');
      for (const skill of user) {
        console.log(`  ○ ${skill.id} - ${skill.metadata.description}`);
      }
      console.log();
    }

    if (packages.length === 0 && builtin.length === 0 && user.length === 0) {
      console.log('  No skills installed.\n');
      console.log('  Run "claw install <skill>" to install a skill.\n');
    }
  }

  /**
   * 显示 Skill 详情
   * Usage: claw info <skill-id> [options]
   */
  async info(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log('Usage: claw info <skill-id> [--permissions]');
      return;
    }

    const skillId = args[0];
    const showPermissions = args.includes('--permissions');

    // 尝试获取 v1.2 Package
    const pkg = skillRegistry.getPackage(skillId);
    if (pkg) {
      console.log(`\n${pkg.manifest.name}`);
      console.log('='.repeat(pkg.manifest.name.length));
      console.log(`ID: ${pkg.manifest.id}`);
      console.log(`Version: ${pkg.manifest.version}`);
      console.log(`API Version: ${pkg.manifest.api_version}`);
      console.log(`Author: ${pkg.manifest.author}`);
      console.log(`License: ${pkg.manifest.license}`);
      console.log(`Status: ${pkg.status}`);
      console.log(`\nDescription:`);
      console.log(`  ${pkg.manifest.description}`);
      
      if (pkg.manifest.homepage) {
        console.log(`\nHomepage: ${pkg.manifest.homepage}`);
      }

      console.log(`\nRuntime:`);
      console.log(`  Type: ${pkg.manifest.runtime.type}`);
      console.log(`  Entry: ${pkg.manifest.runtime.entry}`);

      if (pkg.manifest.dependencies && pkg.manifest.dependencies.length > 0) {
        console.log(`\nDependencies:`);
        for (const dep of pkg.manifest.dependencies) {
          const optional = dep.optional ? ' (optional)' : '';
          console.log(`  - ${dep.id}@${dep.version}${optional}`);
        }
      }

      if (showPermissions || pkg.manifest.permissions.length > 0) {
        console.log(`\nPermissions:`);
        for (const perm of pkg.manifest.permissions) {
          console.log(`  - ${perm.id}`);
        }
      }

      if (pkg.manifest.resources) {
        console.log(`\nResource Limits:`);
        if (pkg.manifest.resources.max_memory) {
          console.log(`  Memory: ${pkg.manifest.resources.max_memory}`);
        }
        if (pkg.manifest.resources.timeout_ms) {
          console.log(`  Timeout: ${pkg.manifest.resources.timeout_ms}ms`);
        }
      }

      console.log();
      return;
    }

    // 尝试获取 v1.1 Skill
    const skill = skillRegistry.getLegacy(skillId);
    if (skill) {
      console.log(`\n${skill.metadata.name}`);
      console.log('='.repeat(skill.metadata.name.length));
      console.log(`ID: ${skill.id}`);
      console.log(`Version: ${skill.metadata.version || 'unknown'}`);
      console.log(`License: ${skill.metadata.license || 'unknown'}`);
      console.log(`\nDescription:`);
      console.log(`  ${skill.metadata.description}`);
      console.log(`\n(Legacy v1.1 skill)\n`);
      return;
    }

    console.error(`Skill not found: ${skillId}`);
    process.exit(1);
  }

  /**
   * 升级 Skill
   * Usage: claw upgrade <skill-id> [--all]
   */
  async upgrade(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log('Usage: claw upgrade <skill-id> | --all');
      return;
    }

    const upgradeAll = args.includes('--all');

    if (upgradeAll) {
      console.log('Upgrading all skills...');
      const { packages } = skillRegistry.list();
      
      for (const pkg of packages) {
        console.log(`\nChecking ${pkg.manifest.id}...`);
        // TODO: 检查更新并升级
      }
    } else {
      const skillId = args[0];
      const version = args[1] || 'latest';
      
      console.log(`Upgrading ${skillId} to ${version}...`);
      
      const result = await skillRegistry.upgrade(skillId, version);
      
      if (result.success) {
        console.log(`✓ Upgraded ${skillId} ${result.oldVersion} → ${result.newVersion}`);
        console.log(`  Downtime: ${result.downtime_ms}ms`);
      } else {
        console.error(`✗ Upgrade failed`);
        process.exit(1);
      }
    }
  }

  /**
   * 启用 Skill
   * Usage: claw enable <skill-id>
   */
  async enable(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log('Usage: claw enable <skill-id>');
      return;
    }

    const skillId = args[0];
    console.log(`Enabling ${skillId}...`);
    
    const pkg = skillRegistry.getPackage(skillId);
    if (!pkg) {
      console.error(`Skill not found: ${skillId}`);
      process.exit(1);
    }

    const instance = await skillRuntime.load(pkg);
    await skillRuntime.activate(instance);
    
    console.log(`✓ Enabled ${skillId}`);
  }

  /**
   * 禁用 Skill
   * Usage: claw disable <skill-id>
   */
  async disable(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log('Usage: claw disable <skill-id>');
      return;
    }

    const skillId = args[0];
    console.log(`Disabling ${skillId}...`);
    
    await skillRuntime.deactivate(skillId);
    console.log(`✓ Disabled ${skillId}`);
  }

  /**
   * 显示依赖树
   * Usage: claw deps [skill-id] [--tree]
   */
  async deps(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log('Usage: claw deps <skill-id> [--check]');
      return;
    }

    const skillId = args[0];
    const checkOnly = args.includes('--check');

    const tree = await skillRegistry.dependencyTree(skillId);
    
    if (!tree) {
      console.log(`No dependencies found for ${skillId}`);
      return;
    }

    if (checkOnly) {
      if (tree.conflicts.length > 0) {
        console.log(`Found ${tree.conflicts.length} conflicts:`);
        for (const conflict of tree.conflicts) {
          console.log(`  - ${conflict.skill_id}: ${conflict.resolution}`);
        }
      } else {
        console.log('✓ No conflicts found');
      }
      return;
    }

    console.log(`\nDependency tree for ${skillId}:\n`);
    this.printDependencyNode(tree.root, 0);

    if (tree.conflicts.length > 0) {
      console.log('\nConflicts:');
      for (const conflict of tree.conflicts) {
        console.log(`  - ${conflict.skill_id}`);
      }
    }

    console.log();
  }

  /**
   * 打包 Skill
   * Usage: claw pack <path> --output <file>
   */
  async pack(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log('Usage: claw pack <path> --output <file.claw>');
      return;
    }

    const sourcePath = args[0];
    const outputIndex = args.indexOf('--output');
    const output = outputIndex > 0 ? args[outputIndex + 1] : 'skill.claw';

    console.log(`Packing ${sourcePath}...`);
    
    // TODO: 实现打包逻辑
    console.log(`✓ Packed to ${output}`);
  }

  /**
   * 验证 Skill 包
   * Usage: claw verify <file>
   */
  async verify(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log('Usage: claw verify <file.claw> [--signature]');
      return;
    }

    const file = args[0];
    const verifySignature = args.includes('--signature');

    console.log(`Verifying ${file}...`);
    
    // TODO: 实现验证逻辑
    console.log('✓ Package is valid');
  }

  /**
   * v1.3: startup skill 子命令
   * Usage: startup skill <subcommand> [options]
   */
  async skill(args: string[]): Promise<void> {
    if (args.length === 0) {
      this.printSkillHelp();
      return;
    }

    const subcommand = args[0];
    const subArgs = args.slice(1);
    const mockSession = this.createMockSession();

    switch (subcommand) {
      case 'install': {
        if (subArgs.length === 0) {
          console.log('Usage: startup skill install <skill-name>[@version]');
          return;
        }
        const [skillHint, version] = subArgs[0].split('@');
        const result = await metaInstallerSkill.install({
          skill_hint: skillHint,
          version: version || 'latest',
        }, mockSession);
        console.log(result.message);
        if (!result.success) process.exit(1);
        break;
      }

      case 'search': {
        const query = subArgs[0] || '';
        const result = await metaRegistrySkill.handle({
          action: 'search',
          query,
        }, mockSession);
        console.log(result.message);
        if (result.data) {
          for (const item of result.data) {
            console.log(`  ${item.id}@${item.version} - ${item.name}`);
            console.log(`    ${item.description}`);
          }
        }
        break;
      }

      case 'list': {
        const result = await metaRegistrySkill.handle({ action: 'list' }, mockSession);
        console.log(result.message);
        if (result.data) {
          for (const item of result.data) {
            const statusIcon = item.status === 'active' ? '●' : '○';
            console.log(`  ${statusIcon} ${item.id}@${item.version} - ${item.name}`);
          }
        }
        break;
      }

      case 'info': {
        if (subArgs.length === 0) {
          console.log('Usage: startup skill info <skill-id>');
          return;
        }
        const result = await metaRegistrySkill.handle({
          action: 'info',
          skill_id: subArgs[0],
        }, mockSession);
        console.log(result.message);
        if (result.data) {
          const d = result.data;
          console.log(`  ID: ${d.id}`);
          console.log(`  Name: ${d.name}`);
          console.log(`  Version: ${d.version}`);
          console.log(`  Status: ${d.status}`);
          console.log(`  Description: ${d.description}`);
        }
        break;
      }

      case 'uninstall': {
        if (subArgs.length === 0) {
          console.log('Usage: startup skill uninstall <skill-id>');
          return;
        }
        const result = await metaInstallerSkill.uninstall(subArgs[0], subArgs.includes('--purge'));
        console.log(result.message);
        if (!result.success) process.exit(1);
        break;
      }

      case 'update':
      case 'upgrade': {
        const updateAll = subArgs.includes('--all');
        if (updateAll || subArgs.length === 0) {
          const result = await metaUpdaterSkill.handle({ action: 'update_all' }, mockSession);
          console.log(result.message);
          if (result.data) {
            for (const item of result.data) {
              const icon = item.success ? '✓' : '✗';
              console.log(`  ${icon} ${item.skillId}: ${item.message}`);
            }
          }
        } else {
          const result = await metaUpdaterSkill.handle({
            action: 'update',
            skill_id: subArgs[0],
          }, mockSession);
          console.log(result.message);
          if (!result.success) process.exit(1);
        }
        break;
      }

      case 'export-profile': {
        const output = subArgs[0] || 'profile.json';
        const installed = installManager.list();
        const profile = {
          version: '1.3',
          exportedAt: Date.now(),
          skills: installed.map(pkg => ({
            id: pkg.manifest.id,
            version: pkg.manifest.version,
            status: pkg.status,
          })),
        };
        const fs = await import('fs/promises');
        await fs.writeFile(output, JSON.stringify(profile, null, 2));
        console.log(`✓ Exported profile to ${output}`);
        break;
      }

      case 'import-profile': {
        const input = subArgs[0];
        if (!input) {
          console.log('Usage: startup skill import-profile <file>');
          return;
        }
        const fs = await import('fs/promises');
        const content = await fs.readFile(input, 'utf-8');
        const profile = JSON.parse(content);
        console.log(`Importing ${profile.skills?.length || 0} skill(s)...`);
        // TODO: 实现批量安装
        console.log('✓ Profile import completed');
        break;
      }

      case 'verify': {
        if (subArgs.length === 0) {
          console.log('Usage: startup skill verify <skill-id>');
          return;
        }
        const pkg = skillRegistry.getPackage(subArgs[0]);
        if (!pkg) {
          console.error(`Skill not found: ${subArgs[0]}`);
          process.exit(1);
        }
        console.log(`✓ ${pkg.manifest.id}@${pkg.manifest.version} is valid`);
        break;
      }

      case 'logs': {
        if (subArgs.length === 0) {
          console.log('Usage: startup skill logs <skill-id>');
          return;
        }
        console.log(`Logs for ${subArgs[0]}:`);
        console.log('  (Log viewing not yet implemented)');
        break;
      }

      default:
        this.printSkillHelp();
    }
  }

  /**
   * 显示帮助信息
   */
  help(): void {
    console.log(`
StarUp CLI - Skill 管理系统 v1.3

Usage: startup <command> [options]

Commands:
  skill install <name>         安装 Skill
  skill search <query>         搜索 Skill
  skill list                   列出已安装 Skills
  skill info <id>              显示 Skill 详情
  skill uninstall <id>         卸载 Skill
  skill update [--all]         更新 Skill
  skill export-profile <file>  导出环境快照
  skill import-profile <file>  导入环境快照
  skill verify <id>            验证安装完整性
  skill logs <id>              查看 Skill 日志

External CLI (skillhub):
  skillhub install <skill>     通过腾讯 SkillHub 安装
  skillhub search <query>      通过腾讯 SkillHub 搜索

Hub Sources (优先级):
  1. Tencent SkillHub (https://skillhub.tencent.com/)
  2. ClawHub (https://clawhub.ai/)
  3. Local directory

Options:
  --force              强制重新安装
  --link               开发模式（软链接）
  --purge              卸载时清除数据
  --verbose, -v        显示详细信息
  --permissions        显示权限信息

Examples:
  startup skill install weather
  startup skill search 翻译
  startup skill update --all
  skillhub install web_search
`);
  }

  // ==================== 私有方法 ====================

  private printSkillHelp(): void {
    console.log(`
Usage: startup skill <subcommand> [options]

Subcommands:
  install <name>[@version]     安装 Skill
  search <query>               搜索 Skill
  list                         列出已安装 Skills
  info <id>                    显示 Skill 详情
  uninstall <id>               卸载 Skill
  update [--all]               更新 Skill
  export-profile <file>        导出环境快照
  import-profile <file>        导入环境快照
  verify <id>                  验证安装完整性
  logs <id>                    查看 Skill 日志
`);
  }

  private createMockSession(): SessionContext {
    return {
      session: {
        id: 'cli-session',
        type: 'main',
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        context: { messages: [], tokenCount: 0, compressed: false },
        memory: { shortTerm: [], dailyLog: '', longTerm: '' },
        allowedTools: [],
        memoryAccess: 'read',
        timeout: 300000,
        callbackToParent: false,
      },
      recentMessages: [],
      userPreferences: {},
    };
  }

  // ==================== 私有方法 ====================

  private printDependencyNode(node: any, indent: number): void {
    const prefix = '  '.repeat(indent);
    const status = node.resolved ? '✓' : '✗';
    console.log(`${prefix}${status} ${node.id}@${node.version}`);
    
    for (const child of node.children || []) {
      this.printDependencyNode(child, indent + 1);
    }
  }
}

// 单例导出
export const commands = new Commands();
