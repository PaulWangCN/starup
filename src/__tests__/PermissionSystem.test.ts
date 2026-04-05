/**
 * 权限系统测试
 */

import { PermissionSystem, PermissionRequest, PermissionMode } from '../core/security/PermissionSystem';

describe('PermissionSystem', () => {
  let system: PermissionSystem;

  beforeEach(() => {
    system = new PermissionSystem('default');
  });

  test('should set and get mode', () => {
    system.setMode('bypass');
    expect(system.getMode()).toBe('bypass');

    system.setMode('strict');
    expect(system.getMode()).toBe('strict');
  });

  test('should allow all in bypass mode', () => {
    system.setMode('bypass');
    
    const request: PermissionRequest = {
      action: 'exec_command',
      resource: 'rm -rf /'
    };

    const decision = system.checkPermission(request);
    expect(decision.allowed).toBe(true);
    expect(decision.level).toBe('allow');
  });

  test('should deny all in strict mode', () => {
    system.setMode('strict');
    
    const request: PermissionRequest = {
      action: 'file_read',
      resource: '/safe/file.txt'
    };

    const decision = system.checkPermission(request);
    expect(decision.allowed).toBe(false);
    expect(decision.level).toBe('deny');
  });

  test('should detect dangerous commands', () => {
    const dangerousCommands = [
      { cmd: 'rm -rf /', reason: 'recursive delete root' },
      { cmd: 'rm -rf ~', reason: 'recursive delete home' },
      { cmd: 'dd if=/dev/zero of=/dev/sda', reason: 'direct device write' },
      { cmd: ':(){ :|:& };:', reason: 'fork bomb' }
    ];

    for (const { cmd, reason } of dangerousCommands) {
      const request: PermissionRequest = {
        action: 'exec_command',
        resource: cmd
      };

      const decision = system.checkPermission(request);
      expect(decision.allowed).toBe(false);
      expect(decision.reason.toLowerCase()).toContain('dangerous');
    }
  });

  test('should ask for sensitive files', () => {
    const sensitiveFiles = [
      '/home/user/.ssh/id_rsa',
      '/home/user/.aws/credentials'
    ];

    for (const file of sensitiveFiles) {
      const request: PermissionRequest = {
        action: 'file_read',
        resource: file
      };

      const decision = system.checkPermission(request);
      expect(decision.level).toBe('ask');
    }
  });

  test('should add and apply custom rules', () => {
    system.addRule({
      pattern: '.*\\.test\\.ts$',
      action: 'file_write',
      level: 'allow',
      description: 'Allow writing test files'
    });

    const request: PermissionRequest = {
      action: 'file_write',
      resource: '/path/to/file.test.ts'
    };

    const decision = system.checkPermission(request);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain('Rule');
  });

  test('should check tool permissions', () => {
    const decision = system.canUseTool('read');
    expect(decision.level).toBeDefined();
  });
});
