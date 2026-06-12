// ============================================================
// MiniMem — 认证中间件 + 权限模型
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { getConfig } from '../config/index.js';
import { AuthenticationError, AuthorizationError } from '../common/errors.js';
import type { PermissionLevel, Client, MemoryLayer } from '../common/types.js';
import type { SignOptions } from 'jsonwebtoken';
import type { Context, Next } from 'hono';

const log = getLogger('gateway:auth');

// ── JWT 认证中间件 ──

/**
 * Hono 中间件：JWT 认证
 * 如果 auth.enabled = false，默认以 trusted 权限放行
 */
export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const config = getConfig();

    if (!config.auth.enabled) {
      // 认证未启用，默认 standard 权限（非 trusted，降低未认证时的风险面）
      c.set('client', {
        id: 'local',
        name: 'local',
        permission_level: 'standard' as PermissionLevel,
        can_write: true,
        can_dream: false,
        can_snapshot: true,
        read_layers: ['L1', 'L2', 'L3', 'L4'] as MemoryLayer[],
      });
      await next();
      return;
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    const jwtSecret = process.env[config.auth.jwt_secret_env];
    if (!jwtSecret) {
      throw new AuthenticationError('JWT secret not configured');
    }

    try {
      // 动态导入 jsonwebtoken
      const jwt = await import('jsonwebtoken');
      const payload = jwt.default.verify(token, jwtSecret, {
        algorithms: ['HS256'],  // 限定签名算法，防止 None 算法攻击
      }) as { client_id: string; iat: number; exp: number };

      // 查找客户端
      const client = getClientById(payload.client_id);
      if (!client) {
        throw new AuthenticationError('Client not found');
      }
      if (!client.is_active) {
        throw new AuthenticationError('Client is deactivated');
      }

      c.set('client', client);
      await next();
    } catch (err) {
      if (err instanceof AuthenticationError) throw err;
      // 不透出 JWT 库内部错误信息，防止信息泄露
      throw new AuthenticationError('Invalid or expired token');
    }
  };
}

// ── 权限检查 ──

/**
 * 检查写入权限
 */
export function requireWrite(client: Partial<Client>): void {
  if (!client.can_write) {
    throw new AuthorizationError('Write permission required');
  }
}

/**
 * 检查做梦权限
 */
export function requireDream(client: Partial<Client>): void {
  if (!client.can_dream) {
    throw new AuthorizationError('Dream permission required (trusted only)');
  }
}

/**
 * 检查快照权限
 */
export function requireSnapshot(client: Partial<Client>): void {
  if (!client.can_snapshot) {
    throw new AuthorizationError('Snapshot permission required');
  }
}

/**
 * 检查读取层级权限
 */
export function requireLayerRead(client: Partial<Client>, layer: MemoryLayer): void {
  const readLayers = client.read_layers ?? [];
  if (!readLayers.includes(layer)) {
    throw new AuthorizationError(`No read access to layer ${layer}`);
  }
}

/**
 * 检查权限等级
 */
export function requirePermissionLevel(client: Partial<Client>, required: PermissionLevel): void {
  const levels: Record<PermissionLevel, number> = {
    trusted: 3,
    standard: 2,
    readonly: 1,
  };
  const clientLevel = levels[client.permission_level ?? 'readonly'] ?? 0;
  const requiredLevel = levels[required] ?? 0;

  if (clientLevel < requiredLevel) {
    throw new AuthorizationError(`Permission level '${required}' required, but client has '${client.permission_level}'`);
  }
}

// ── 客户端管理 ──

export function getClientById(id: string): Client | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToClient(row) : null;
}

/**
 * 生成 JWT Token
 */
export async function generateToken(clientId: string): Promise<string> {
  const config = getConfig();
  const jwtSecret = process.env[config.auth.jwt_secret_env];
  if (!jwtSecret) throw new AuthenticationError('JWT secret not configured');

  const jwt = await import('jsonwebtoken');
  return jwt.default.sign(
    { client_id: clientId },
    jwtSecret,
    { expiresIn: config.auth.token_expiry } as SignOptions,
  );
}

function rowToClient(row: Record<string, unknown>): Client {
  return {
    id: row.id as string,
    name: row.name as string,
    client_secret_hash: row.client_secret_hash as string,
    permission_level: row.permission_level as PermissionLevel,
    read_layers: JSON.parse((row.read_layers as string) || '["L2","L3","L4"]'),
    can_write: !!(row.can_write as number),
    can_dream: !!(row.can_dream as number),
    can_snapshot: !!(row.can_snapshot as number),
    reads_per_minute: row.reads_per_minute as number,
    writes_per_minute: row.writes_per_minute as number,
    is_active: !!(row.is_active as number),
    created_at: row.created_at as string,
  };
}
