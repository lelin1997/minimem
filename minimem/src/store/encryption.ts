// ============================================================
// MiniMem — SQLCipher 加密存储（可选模块）
// ============================================================
// 当 config.encryption.enabled = true 时启用
// 通过 better-sqlite3 + SQLCipher 扩展实现透明加密

import { getLogger } from '../common/logger.js';
import { getConfig } from '../config/index.js';
import { getOrCreateEncryptionKey } from '../security/keychain.js';

const log = getLogger('store:encryption');

/**
 * 加密配置
 */
export interface EncryptionConfig {
  enabled: boolean;
  provider: 'sqlcipher' | 'none';
  key_storage: 'keychain' | 'env';
}

/**
 * 获取加密密钥
 */
export function getEncryptionKey(): string | null {
  const config = getConfig();

  if (!config.encryption.enabled || config.encryption.provider === 'none') {
    return null;
  }

  if (config.encryption.key_storage === 'env') {
    const key = process.env.MINIMEM_ENCRYPTION_KEY;
    if (!key) {
      log.warn('Encryption enabled but MINIMEM_ENCRYPTION_KEY not set');
      return null;
    }
    return key;
  }

  if (config.encryption.key_storage === 'keychain') {
    // TODO-021.4: macOS Keychain 集成 — 自动获取或生成密钥
    const key = getOrCreateEncryptionKey();
    if (!key) {
      log.warn('Failed to get encryption key from Keychain, falling back to env');
      return process.env.MINIMEM_ENCRYPTION_KEY ?? null;
    }
    return key;
  }

  return null;
}

/**
 * 对数据库应用加密 PRAGMA
 * 必须在 initDb 后立即调用
 */
export function applyEncryption(db: { pragma: (sql: string) => unknown }): boolean {
  const key = getEncryptionKey();
  if (!key) {
    log.info('Encryption not enabled');
    return false;
  }

  try {
    // SQLCipher PRAGMA — 转义单引号防止 PRAGMA 注入
    const safeKey = key.replace(/'/g, "''");
    db.pragma(`key = '${safeKey}'`);
    db.pragma('cipher_page_size = 4096');
    db.pragma('kdf_iter = 256000');
    db.pragma('cipher_hmac_algorithm = HMAC_SHA512');

    log.info('SQLCipher encryption applied');
    return true;
  } catch (err) {
    log.error({ err }, 'Failed to apply encryption. Is SQLCipher available?');
    return false;
  }
}

/**
 * 更改加密密钥
 */
export function rekeyDatabase(db: { pragma: (sql: string) => unknown }, newKey: string): boolean {
  try {
    const safeNewKey = newKey.replace(/'/g, "''");
    db.pragma(`rekey = '${safeNewKey}'`);
    log.info('Database re-keyed successfully');
    return true;
  } catch (err) {
    log.error({ err }, 'Failed to re-key database');
    return false;
  }
}

/**
 * 检查加密状态
 */
export function isEncryptionAvailable(): boolean {
  const config = getConfig();
  return config.encryption.enabled && config.encryption.provider === 'sqlcipher' && !!getEncryptionKey();
}
