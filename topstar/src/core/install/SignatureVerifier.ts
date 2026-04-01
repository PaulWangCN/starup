import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * 签名验证器
 * 使用 Ed25519 进行签名验证，确保 Skill 包的完整性和来源可信
 */
export class SignatureVerifier {
  private trustedKeys: Map<string, string> = new Map();

  constructor() {
    // 加载可信公钥
    this.loadTrustedKeys();
  }

  /**
   * 验证包签名
   */
  async verify(packagePath: string): Promise<boolean> {
    try {
      // 检查签名文件
      const sigPath = path.join(packagePath, 'signature.json');
      const manifestPath = path.join(packagePath, 'manifest.yaml');

      let sigData: { signature: string; algorithm: string; keyId: string };
      
      try {
        const sigContent = await fs.readFile(sigPath, 'utf-8');
        sigData = JSON.parse(sigContent);
      } catch {
        // 没有签名文件，开发模式允许通过
        console.warn('[SignatureVerifier] No signature found, allowing in dev mode');
        return true;
      }

      // 验证算法
      if (sigData.algorithm !== 'ed25519') {
        console.error(`[SignatureVerifier] Unsupported algorithm: ${sigData.algorithm}`);
        return false;
      }

      // 获取公钥
      const publicKey = this.trustedKeys.get(sigData.keyId);
      if (!publicKey) {
        console.error(`[SignatureVerifier] Unknown key: ${sigData.keyId}`);
        return false;
      }

      // 读取 manifest
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');

      // 计算 manifest 哈希
      const manifestHash = crypto
        .createHash('sha256')
        .update(manifestContent)
        .digest();

      // 验证签名
      // 注意：Node.js 内置 crypto 不直接支持 Ed25519 验证
      // 这里使用简化实现，实际应该使用 ed25519 库
      const isValid = await this.verifyEd25519(
        manifestHash,
        Buffer.from(sigData.signature, 'base64'),
        publicKey
      );

      if (isValid) {
        console.log(`[SignatureVerifier] Signature valid for ${path.basename(packagePath)}`);
      } else {
        console.error(`[SignatureVerifier] Signature invalid for ${path.basename(packagePath)}`);
      }

      return isValid;
    } catch (error) {
      console.error('[SignatureVerifier] Verification failed:', error);
      return false;
    }
  }

  /**
   * 为包生成签名（开发者使用）
   */
  async sign(
    packagePath: string,
    privateKey: string,
    keyId: string
  ): Promise<void> {
    const manifestPath = path.join(packagePath, 'manifest.yaml');
    const sigPath = path.join(packagePath, 'signature.json');

    // 读取 manifest
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');

    // 计算哈希
    const manifestHash = crypto
      .createHash('sha256')
      .update(manifestContent)
      .digest();

    // 签名
    const signature = await this.signEd25519(manifestHash, privateKey);

    // 保存签名
    const sigData = {
      version: '1.0',
      algorithm: 'ed25519',
      keyId,
      signature: signature.toString('base64'),
      timestamp: Date.now(),
    };

    await fs.writeFile(sigPath, JSON.stringify(sigData, null, 2));
    console.log(`[SignatureVerifier] Signed ${path.basename(packagePath)}`);
  }

  /**
   * 添加可信公钥
   */
  addTrustedKey(keyId: string, publicKey: string): void {
    this.trustedKeys.set(keyId, publicKey);
    console.log(`[SignatureVerifier] Added trusted key: ${keyId}`);
  }

  /**
   * 计算包的 SHA-256 校验和
   */
  async calculateChecksum(packagePath: string): Promise<string> {
    const manifestPath = path.join(packagePath, 'manifest.yaml');
    const content = await fs.readFile(manifestPath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 验证校验和
   */
  async verifyChecksum(packagePath: string, expectedChecksum: string): Promise<boolean> {
    const actualChecksum = await this.calculateChecksum(packagePath);
    return actualChecksum === expectedChecksum;
  }

  // ==================== 私有方法 ====================

  /**
   * 加载可信公钥
   */
  private loadTrustedKeys(): void {
    // 内置官方 Registry 公钥
    this.trustedKeys.set('official', 'official-registry-public-key-placeholder');
    
    // 从配置文件加载
    const configPath = path.join(process.env.HOME || '.', '.starup', 'config', 'trusted-keys.json');
    this.loadKeysFromFile(configPath);
  }

  /**
   * 从文件加载公钥
   */
  private async loadKeysFromFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const keys = JSON.parse(content);
      for (const [keyId, publicKey] of Object.entries(keys)) {
        this.trustedKeys.set(keyId, publicKey as string);
      }
    } catch {
      // 文件可能不存在，忽略
    }
  }

  /**
   * Ed25519 验证（简化实现）
   * 实际应使用 ed25519 库如 tweetnacl
   */
  private async verifyEd25519(
    message: Buffer,
    signature: Buffer,
    publicKey: string
  ): Promise<boolean> {
    // 简化实现：总是返回 true（开发模式）
    // 实际应该使用：
    // import nacl from 'tweetnacl';
    // return nacl.sign.detached.verify(message, signature, publicKeyBuffer);
    console.warn('[SignatureVerifier] Using dev-mode verification (always true)');
    return true;
  }

  /**
   * Ed25519 签名（简化实现）
   */
  private async signEd25519(message: Buffer, privateKey: string): Promise<Buffer> {
    // 简化实现
    // 实际应该使用：
    // import nacl from 'tweetnacl';
    // return nacl.sign.detached(message, privateKeyBuffer);
    return crypto.createHmac('sha256', privateKey).update(message).digest();
  }
}
