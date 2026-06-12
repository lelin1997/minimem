// ============================================================
// MiniMem — 访问审计日志
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now, truncate } from '../common/utils.js';
import type { AccessLogEntry } from '../common/types.js';
import type { Context, Next } from 'hono';

const log = getLogger('gateway:audit');

/**
 * Hono 中间件：自动记录访问日志
 */
export function auditMiddleware() {
  return async (c: Context, next: Next) => {
    const start = Date.now();

    await next();

    const latency = Date.now() - start;
    const client = c.get('client') as { id: string } | undefined;

    try {
      writeAccessLog({
        client_id: client?.id ?? 'anonymous',
        action: c.req.method,
        tool_name: c.req.path,
        params_summary: truncate(c.req.url, 500),
        result_summary: truncate(`${c.res.status}`, 200),
        latency_ms: latency,
      });
    } catch (err) {
      // 审计日志写入失败不应影响请求
      log.warn({ err }, 'Failed to write access log');
    }
  };
}

/**
 * 写入访问日志
 */
export function writeAccessLog(entry: {
  client_id: string;
  action: string;
  tool_name: string;
  params_summary?: string | null;
  result_summary?: string | null;
  latency_ms: number;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO access_log (id, client_id, action, tool_name, params_summary, result_summary, latency_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateId(),
    entry.client_id,
    entry.action,
    entry.tool_name,
    entry.params_summary ?? null,
    entry.result_summary ?? null,
    entry.latency_ms,
    now(),
  );
}

/**
 * 查询访问日志（用于审计）
 */
export function queryAccessLogs(options: {
  client_id?: string;
  since?: string;
  limit?: number;
}): AccessLogEntry[] {
  const db = getDb();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.client_id) {
    conditions.push('client_id = ?');
    values.push(options.client_id);
  }
  if (options.since) {
    conditions.push('created_at >= ?');
    values.push(options.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 100;

  return db.prepare(
    `SELECT * FROM access_log ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...values, limit) as AccessLogEntry[];
}

/**
 * 获取访问统计
 */
export function getAccessStats(sinceDate?: string): {
  total_requests: number;
  by_client: Record<string, number>;
  by_action: Record<string, number>;
  avg_latency_ms: number;
} {
  const db = getDb();
  const since = sinceDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const total = db.prepare(
    'SELECT COUNT(*) as count FROM access_log WHERE created_at >= ?'
  ).get(since) as { count: number };

  const byClient = db.prepare(
    'SELECT client_id, COUNT(*) as count FROM access_log WHERE created_at >= ? GROUP BY client_id'
  ).all(since) as Array<{ client_id: string; count: number }>;

  const byAction = db.prepare(
    'SELECT action, COUNT(*) as count FROM access_log WHERE created_at >= ? GROUP BY action'
  ).all(since) as Array<{ action: string; count: number }>;

  const avgLatency = db.prepare(
    'SELECT AVG(latency_ms) as avg FROM access_log WHERE created_at >= ?'
  ).get(since) as { avg: number | null };

  return {
    total_requests: total.count,
    by_client: Object.fromEntries(byClient.map(r => [r.client_id, r.count])),
    by_action: Object.fromEntries(byAction.map(r => [r.action, r.count])),
    avg_latency_ms: Math.round(avgLatency.avg ?? 0),
  };
}
