// ============================================================
// MiniMem — L2 事实存储
// ============================================================

import { getDb } from './database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import type { WorldFact } from '../common/types.js';

const log = getLogger('store:world-facts');

export interface CreateWorldFactInput {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  valid_from?: string | null;
  valid_until?: string | null;
  evidence_experience_ids: string[];
  condition_keys?: string[];
  source: string;
}

/**
 * 创建一条 L2 事实
 */
export function createWorldFact(input: CreateWorldFactInput): WorldFact {
  const db = getDb();
  const id = generateId();
  const timestamp = now();

  db.prepare(`
    INSERT INTO world_facts (id, subject, predicate, object, confidence, valid_from, valid_until, evidence_experience_ids, condition_keys, source, branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?, ?)
  `).run(
    id,
    input.subject,
    input.predicate,
    input.object,
    input.confidence ?? 0.7,
    input.valid_from ?? null,
    input.valid_until ?? null,
    JSON.stringify(input.evidence_experience_ids),
    JSON.stringify(input.condition_keys ?? []),
    input.source,
    timestamp,
    timestamp,
  );

  log.debug({ id, subject: input.subject }, 'World fact created');
  return getWorldFactById(id)!;
}

/**
 * 批量创建事实
 */
export function createWorldFactsBatch(inputs: CreateWorldFactInput[]): WorldFact[] {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO world_facts (id, subject, predicate, object, confidence, valid_from, valid_until, evidence_experience_ids, condition_keys, source, branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?, ?)
  `);

  const ids: string[] = [];
  const timestamp = now();

  db.transaction(() => {
    for (const input of inputs) {
      const id = generateId();
      ids.push(id);
      stmt.run(
        id, input.subject, input.predicate, input.object,
        input.confidence ?? 0.7, input.valid_from ?? null, input.valid_until ?? null,
        JSON.stringify(input.evidence_experience_ids),
        JSON.stringify(input.condition_keys ?? []),
        input.source, timestamp, timestamp,
      );
    }
  })();

  return ids.map(id => getWorldFactById(id)!);
}

/**
 * 按 ID 获取
 */
export function getWorldFactById(id: string): WorldFact | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM world_facts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToWorldFact(row) : null;
}

/**
 * 查找关于某主题的事实
 */
export function findFactsBySubject(subject: string): WorldFact[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM world_facts WHERE subject = ? AND branch = 'main' ORDER BY confidence DESC"
  ).all(subject) as Record<string, unknown>[];
  return rows.map(rowToWorldFact);
}

/**
 * 模糊搜索事实
 */
export function searchFacts(query: string, limit: number = 20): WorldFact[] {
  const db = getDb();
  const pattern = `%${query}%`;
  const rows = db.prepare(`
    SELECT * FROM world_facts
    WHERE branch = 'main'
      AND (subject LIKE ? OR predicate LIKE ? OR object LIKE ?)
    ORDER BY confidence DESC
    LIMIT ?
  `).all(pattern, pattern, pattern, limit) as Record<string, unknown>[];
  return rows.map(rowToWorldFact);
}

/**
 * 更新事实置信度
 */
export function updateFactConfidence(id: string, confidence: number): void {
  const db = getDb();
  db.prepare('UPDATE world_facts SET confidence = ?, updated_at = ? WHERE id = ?').run(confidence, now(), id);
}

/**
 * 分页查询
 */
export function listWorldFacts(
  params: { page: number; page_size: number; domain?: string },
): { items: WorldFact[]; total: number; page: number; page_size: number; has_more: boolean } {
  const db = getDb();
  const conditions: string[] = ["branch = 'main'"];
  const values: unknown[] = [];

  if (params.domain) {
    conditions.push('domain = ?');
    values.push(params.domain);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) as count FROM world_facts ${where}`).get(...values) as { count: number }).count;

  const offset = (params.page - 1) * params.page_size;
  const rows = db.prepare(
    `SELECT * FROM world_facts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...values, params.page_size, offset) as Record<string, unknown>[];

  return {
    items: rows.map(rowToWorldFact),
    total,
    page: params.page,
    page_size: params.page_size,
    has_more: offset + rows.length < total,
  };
}

/**
 * 统计数量
 */
export function countWorldFacts(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as count FROM world_facts WHERE branch = 'main'").get() as { count: number }).count;
}

// ── 行转对象 ──

function rowToWorldFact(row: Record<string, unknown>): WorldFact {
  return {
    id: row.id as string,
    subject: row.subject as string,
    predicate: row.predicate as string,
    object: row.object as string,
    confidence: row.confidence as number,
    valid_from: (row.valid_from as string) || null,
    valid_until: (row.valid_until as string) || null,
    evidence_experience_ids: JSON.parse((row.evidence_experience_ids as string) || '[]'),
    condition_keys: JSON.parse((row.condition_keys as string) || '[]'),
    source: row.source as string,
    snapshot_id: (row.snapshot_id as string) || null,
    branch: row.branch as string,
    domain: (row.domain as string) || 'default',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
