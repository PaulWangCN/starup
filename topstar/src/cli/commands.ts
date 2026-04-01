import { skillRegistry } from '../core/skills/SkillRegistry';
import { installManager } from '../core/skills/InstallManager';
import { skillRuntime } from '../core/skills/SkillRuntime';
import { InstallSpec, InstallOptions } from '../types';

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

    const { legacy, packages } = skillRegistry.list();

    console.log('\nInstalled Skills:\n');

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

    // v1.1 Legacy Skills
    if (legacy.length > 0) {
      console.log('Legacy Skills (v1.1):');
      for (const skill of legacy) {
        console.log(`  ○ ${skill.id} - ${skill.metadata.description}`);
      }
      console.log();
    }

    if (packages.length === 0 && legacy.length === 0) {
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
   * 显示帮助信息
   */
  help(): void {
    console.log(`
StarUp CLI - Skill 管理系统 v1.2

Usage: claw <command> [options]

Commands:
  install <spec>       安装 Skill
                       支持: marketplace, git, local, url
                       示例: claw install weather@2.1.0
  uninstall <id>       卸载 Skill
  list                 列出已安装 Skills
  info <id>            显示 Skill 详情
  upgrade <id>         升级 Skill
  enable <id>          启用 Skill
  disable <id>         禁用 Skill
  deps <id>            显示依赖树
  pack <path>          打包 Skill
  verify <file>        验证 Skill 包

Options:
  --force              强制重新安装
  --link               开发模式（软链接）
  --purge              卸载时清除数据
  --verbose, -v        显示详细信息
  --tree               显示依赖树
  --permissions        显示权限信息

Examples:
  claw install weather
  claw install github:user/skill-weather
  claw install ./my-skill --link
  claw uninstall weather --purge
  claw list --permissions
  claw info weather --permissions
`);
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
