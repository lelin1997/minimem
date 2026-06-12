// ============================================================
// MiniMem — MCP 认证 & Tool 分级鉴权
// ============================================================
// 为 MCP HTTP 模式提供 Token 校验和 Tool 级别权限控制。
// stdio 模式不需要认证（进程间通信已有 OS 级隔离）。

import { getConfig } from '../config/index.js';
import { getLogger } from '../common/logger.js';
import { getClientById } from './auth.js';
import { writeAccessLog } from './audit.js';
import { AuthenticationError, AuthorizationError } from '../common/errors.js';
import type { Client, PermissionLevel } from '../common/types.js';
import type { IncomingMessage } from 'node:http';

const log = getLogger('gateway:mcp-auth');

// ── Tool 风险分级 ──

export type ToolRiskLevel = 'read' | 'write' | 'dangerous';

/**
 * 每个 MCP Tool 的风险等级
 * - read: readonly 即可访问
 * - write: 需要 standard 以上权限
 * - dangerous: 需要 trusted 权限（不可逆/高隐私操作）
 */
export const TOOL_RISK_MAP: Record<string, ToolRiskLevel> = {
  // 🟢 只读 — readonly 即可
  search_memory: 'read',
  get_memory_by_id: 'read',
  list_memories: 'read',
  recall_about: 'read',
  get_relevant_context: 'read',
  get_summary: 'read',
  get_memory_health: 'read',
  check_surface_version: 'read',
  get_surface_file: 'read',
  load_surfaces: 'read',
  get_owner_profile: 'read',
  get_owner_preference: 'read',
  get_person_profile: 'read',
  list_persons: 'read',
  diff_memory: 'read',
  list_domains: 'read',       // MINIMEM-001: 领域隔离
  get_inspirations: 'read',  // MINIMEM-002: 灵感层

  // 🟡 写入 — 需要 standard 权限
  add_memory: 'write',
  add_memories_batch: 'write',
  import_knowledge: 'write',   // MINIMEM-005: 知识导入
  update_memory: 'write',
  feedback_memory: 'write',
  suggest_surface_update: 'write',
  pin_memory: 'write',
  create_person: 'write',
  update_person: 'write',
  start_onboarding: 'write',
  create_domain: 'write',     // MINIMEM-001: 领域隔离
  act_on_inspiration: 'write',    // MINIMEM-002: 灵感层
  rate_inspiration: 'write',      // MINIMEM-002: 灵感层

  // 🔴 危险操作 — 需要 trusted 权限
  delete_memory: 'dangerous',
  forget_about: 'dangerous',
  delete_person: 'dangerous',
  trigger_dream: 'dangerous',
  export_memories: 'dangerous',
  import_memories: 'dangerous',
  create_snapshot: 'dangerous',
  trigger_inspiration: 'dangerous',  // MINIMEM-002: 灵感层（独立触发属于高权限操作）
  dismiss_inspiration: 'dangerous',  // MINIMEM-002: 灵感层（删除/归档灵感）
};

/**
 * 风险等级 → 最低权限要求
 */
const RISK_TO_PERMISSION: Record<ToolRiskLevel, PermissionLevel> = {
  read: 'readonly',
  write: 'standard',
  dangerous: 'trusted',
};

/**
 * 权限等级数值化（用于比较）
 */
const PERMISSION_WEIGHT: Record<PermissionLevel, number> = {
  trusted: 3,
  standard: 2,
  readonly: 1,
};

// ── 默认 Client（认证关闭时 / stdio 模式）──

export const DEFAULT_TRUSTED_CLIENT: Partial<Client> = {
  id: 'local',
  name: 'local',
  permission_level: 'trusted',
  can_write: true,
  can_dream: true,
  can_snapshot: true,
  read_layers: ['L1', 'L2', 'L3', 'L4'],
  reads_per_minute: 999,
  writes_per_minute: 999,
};

// ── 认证函数 ──

/**
 * 从 HTTP 请求中提取并校验 Bearer Token，返回 Client
 * 认证关闭时返回默认 trusted client
 */
export async function authenticateRequest(req: IncomingMessage): Promise<Partial<Client>> {
  const config = getConfig();

  if (!config.auth.enabled) {
    return DEFAULT_TRUSTED_CLIENT;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);
  const jwtSecret = process.env[config.auth.jwt_secret_env];
  if (!jwtSecret) {
    throw new AuthenticationError('JWT secret not configured');
  }

  try {
    const jwt = await import('jsonwebtoken');
    const payload = jwt.default.verify(token, jwtSecret) as { client_id: string; iat: number; exp: number };

    const client = getClientById(payload.client_id);
    if (!client) {
      throw new AuthenticationError('Client not found');
    }
    if (!client.is_active) {
      throw new AuthenticationError('Client is deactivated');
    }

    log.debug({ clientId: client.id, level: client.permission_level }, 'MCP client authenticated');
    return client;
  } catch (err) {
    if (err instanceof AuthenticationError) throw err;
    throw new AuthenticationError(`Token verification failed: ${(err as Error).message}`);
  }
}

// ── Tool 鉴权 ──

/**
 * 检查 client 是否有权调用指定 Tool
 * @throws AuthorizationError 如果权限不足
 */
export function authorizeToolCall(client: Partial<Client>, toolName: string): void {
  const risk = TOOL_RISK_MAP[toolName];
  if (!risk) {
    // 未知 Tool，默认需要 trusted
    log.warn({ toolName }, 'Unknown tool risk level, requiring trusted');
    requireLevel(client, 'trusted', toolName);
    return;
  }

  const requiredLevel = RISK_TO_PERMISSION[risk];
  requireLevel(client, requiredLevel, toolName);

  // 额外细粒度检查
  if (risk === 'write' && !client.can_write) {
    throw new AuthorizationError(`Tool '${toolName}' requires write permission`);
  }

  if (toolName === 'trigger_dream' && !client.can_dream) {
    throw new AuthorizationError(`Tool '${toolName}' requires dream permission`);
  }

  if (toolName === 'create_snapshot' && !client.can_snapshot) {
    throw new AuthorizationError(`Tool '${toolName}' requires snapshot permission`);
  }
}

function requireLevel(client: Partial<Client>, required: PermissionLevel, toolName: string): void {
  const clientWeight = PERMISSION_WEIGHT[client.permission_level ?? 'readonly'] ?? 0;
  const requiredWeight = PERMISSION_WEIGHT[required] ?? 0;

  if (clientWeight < requiredWeight) {
    throw new AuthorizationError(
      `Tool '${toolName}' requires '${required}' permission, but client '${client.id}' has '${client.permission_level}'`
    );
  }
}

// ── 审计日志 ──

/**
 * 为 MCP Tool 调用写审计日志
 * dangerous 级别的操作一定会记录；其他级别根据配置决定
 */
export function auditToolCall(opts: {
  client: Partial<Client>;
  toolName: string;
  args?: Record<string, unknown>;
  result?: string;
  latencyMs: number;
  error?: string;
}): void {
  const risk = TOOL_RISK_MAP[opts.toolName] ?? 'dangerous';

  // dangerous 操作必须审计，其他操作也记录（便于排查）
  try {
    writeAccessLog({
      client_id: opts.client.id ?? 'unknown',
      action: `MCP:${opts.toolName}`,
      tool_name: opts.toolName,
      params_summary: opts.args ? truncateJson(opts.args, 500) : null,
      result_summary: opts.error ? `ERROR: ${opts.error}` : (opts.result ? truncateStr(opts.result, 200) : 'ok'),
      latency_ms: opts.latencyMs,
    });

    if (risk === 'dangerous') {
      log.info(
        { clientId: opts.client.id, tool: opts.toolName, risk, latencyMs: opts.latencyMs, error: opts.error },
        `AUDIT: dangerous tool invoked`
      );
    }
  } catch (err) {
    // 审计日志写入失败不应影响主流程
    log.warn({ err }, 'Failed to write MCP audit log');
  }
}

// ── 辅助 ──

function truncateJson(obj: Record<string, unknown>, maxLen: number): string {
  const str = JSON.stringify(obj);
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

function truncateStr(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}
