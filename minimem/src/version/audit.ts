// ============================================================
// MiniMem — 版本控制：审计日志
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import type { AuditLogEntry } from '../common/types.js';

const log = getLogger('version:audit');

export interface CreateAuditLogInput {
  action: string;
  target_type: string;
  target_id: string;
  before_value?: string | null;
  after_value?: string | null;
  triggered_by?: string;
}

/**
 * 创建审计日志条目
 */
export function createAuditLog(input: CreateAuditLogInput): AuditLogEntry {
  const db = getDb();
  const id = generateId();
  const timestamp = now();

  db.prepare(`
    INSERT INTO audit_log (id, action, target_type, target_id, before_value, after_value, triggered_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.action,
    input.target_type,
    input.target_id,
    input.before_value ?? null,
    input.after_value ?? null,
    input.triggered_by ?? 'system',
    timestamp,
  );

  log.debug({ id, action: input.action, target: `${input.target_type}:${input.target_id}` }, 'Audit log created');
  return getAuditLogById(id)!;
}

/**
 * 按 ID 获取审计日志
 */
export function getAuditLogById(id: string): AuditLogEntry | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToAuditLog(row) : null;
}

/**
 * 查询审计日志
 */
export function queryAuditLogs(filter: {
  target_type?: string;
  target_id?: string;
  action?: string;
  triggered_by?: string;
  since?: string;
  limit?: number;
} = {}): AuditLogEntry[] {
  const db = getDb();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filter.target_type) {
    conditions.push('target_type = ?');
    values.push(filter.target_type);
  }
  if (filter.target_id) {
    conditions.push('target_id = ?');
    values.push(filter.target_id);
  }
  if (filter.action) {
    conditions.push('action = ?');
    values.push(filter.action);
  }
  if (filter.triggered_by) {
    conditions.push('triggered_by = ?');
    values.push(filter.triggered_by);
  }
  if (filter.since) {
    conditions.push('created_at >= ?');
    values.push(filter.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ?? 100;

  const rows = db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...values, limit) as Record<string, unknown>[];

  return rows.map(rowToAuditLog);
}

/**
 * 统计审计日志数量
 */
export function countAuditLogs(targetType?: string): number {
  const db = getDb();
  if (targetType) {
    return (db.prepare('SELECT COUNT(*) as count FROM audit_log WHERE target_type = ?').get(targetType) as { count: number }).count;
  }
  return (db.prepare('SELECT COUNT(*) as count FROM audit_log').get() as { count: number }).count;
}

// ── 行转对象 ──

function rowToAuditLog(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: row.id as string,
    action: row.action as string,
    target_type: row.target_type as string,
    target_id: row.target_id as string,
    before_value: (row.before_value as string) || null,
    after_value: (row.after_value as string) || null,
    triggered_by: row.triggered_by as string,
    created_at: row.created_at as string,
  };
}
