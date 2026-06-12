// ============================================================
// MiniMem — 安全密钥管理 (TODO-021)
// ============================================================
// macOS Keychain 集成 + JWT secret 自动生成

import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { getLogger } from '../common/logger.js';

const log = getLogger('security:keychain');

const KEYCHAIN_SERVICE = 'com.minimem.encryption';
const KEYCHAIN_ACCOUNT = 'encryption-key';
const JWT_KEYCHAIN_SERVICE = 'com.minimem.jwt';
const JWT_KEYCHAIN_ACCOUNT = 'jwt-secret';

/**
 * 检测当前平台是否支持 Keychain
 */
export function isKeychainSupported(): boolean {
  return process.platform === 'darwin';
}

/**
 * 从 macOS Keychain 读取密钥
 * 使用 execFileSync 避免 shell 注入（不经过 shell 解释）
 */
export function keychainGet(service: string, account: string): string | null {
  if (!isKeychainSupported()) return null;

  try {
    const result = execFileSync('security', [
      'find-generic-password', '-s', service, '-a', account, '-w',
    ], { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * 向 macOS Keychain 写入密钥
 * 使用 execFileSync 避免 shell 注入（不经过 shell 解释）
 */
export function keychainSet(service: string, account: string, password: string): boolean {
  if (!isKeychainSupported()) return false;

  try {
    // 先尝试删除旧条目（忽略错误）
    try {
      execFileSync('security', [
        'delete-generic-password', '-s', service, '-a', account,
      ], { timeout: 5000, stdio: 'pipe' });
    } catch {
      // 不存在则忽略
    }

    execFileSync('security', [
      'add-generic-password', '-s', service, '-a', account, '-w', password, '-U',
    ], { timeout: 5000, stdio: 'pipe' });
    return true;
  } catch (err) {
    log.warn({ err }, 'Failed to store key in Keychain');
    return false;
  }
}

/**
 * 从 macOS Keychain 删除密钥
 * 使用 execFileSync 避免 shell 注入（不经过 shell 解释）
 */
export function keychainDelete(service: string, account: string): boolean {
  if (!isKeychainSupported()) return false;

  try {
    execFileSync('security', [
      'delete-generic-password', '-s', service, '-a', account,
    ], { timeout: 5000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ── 加密密钥管理 ──

/**
 * 从 Keychain 获取加密密钥，不存在则自动生成并存储
 */
export function getOrCreateEncryptionKey(): string | null {
  if (!isKeychainSupported()) {
    log.warn('Keychain not supported on this platform, falling back to env');
    return process.env.MINIMEM_ENCRYPTION_KEY ?? null;
  }

  // 尝试从 Keychain 读取
  let key = keychainGet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  if (key) {
    log.debug('Encryption key retrieved from Keychain');
    return key;
  }

  // 首次使用：生成新密钥并存储到 Keychain
  key = randomBytes(32).toString('hex');
  const stored = keychainSet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key);
  if (stored) {
    log.info('New encryption key generated and stored in Keychain');
    return key;
  }

  // Keychain 写入失败，回退到环境变量
  log.warn('Failed to store encryption key in Keychain, falling back to env');
  return process.env.MINIMEM_ENCRYPTION_KEY ?? null;
}

// ── JWT Secret 管理 ──

/**
 * 获取或自动生成 JWT secret
 * 优先级：环境变量 > Keychain > 自动生成存入 Keychain
 */
export function getOrCreateJwtSecret(envVarName: string = 'MINIMEM_JWT_SECRET'): string | null {
  // 1. 环境变量最高优先
  const envSecret = process.env[envVarName];
  if (envSecret) {
    log.debug('JWT secret loaded from environment variable');
    return envSecret;
  }

  // 2. 尝试从 Keychain 读取
  if (isKeychainSupported()) {
    const keychainSecret = keychainGet(JWT_KEYCHAIN_SERVICE, JWT_KEYCHAIN_ACCOUNT);
    if (keychainSecret) {
      log.debug('JWT secret retrieved from Keychain');
      // 设置到环境变量，让后续代码（如 auth.ts）能直接读取
      process.env[envVarName] = keychainSecret;
      return keychainSecret;
    }

    // 3. 自动生成并存储
    const newSecret = randomBytes(48).toString('base64url');
    const stored = keychainSet(JWT_KEYCHAIN_SERVICE, JWT_KEYCHAIN_ACCOUNT, newSecret);
    if (stored) {
      log.info('New JWT secret generated and stored in Keychain');
      process.env[envVarName] = newSecret;
      return newSecret;
    }
  }

  log.warn('No JWT secret available and Keychain not accessible');
  return null;
}
