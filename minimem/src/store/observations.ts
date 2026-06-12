// ============================================================
// MiniMem — L3 观察存储
// ============================================================

import { getDb } from './database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import type { Observation, ObservationType } from '../common/types.js';

const log = getLogger('store:observations');

export interface CreateObservationInput {
  description: string;
  observation_type?: ObservationType;
  supporting_fact_ids?: string[];
  contradicting_fact_ids?: string[];
  confidence?: number;
  tags?: string[];
}

/**
 * 创建一条 L3 观察
 */
export function createObservation(input: CreateObservationInput): Observation {
  const db = getDb();
  const id = generateId();
  const timestamp = now();
  const initialConfidence = input.confidence ?? 0.6;

  db.prepare(`
    INSERT INTO observations (id, description, observation_type, supporting_fact_ids, contradicting_fact_ids, confidence, confidence_history, tags, branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'main', ?, ?)
  `).run(
    id,
    input.description,
    input.observation_type ?? 'pattern',
    JSON.stringify(input.supporting_fact_ids ?? []),
    JSON.stringify(input.contradicting_fact_ids ?? []),
    initialConfidence,
    JSON.stringify([{ date: timestamp, value: initialConfidence }]),
    JSON.stringify(input.tags ?? []),
    timestamp,
    timestamp,
  );

  log.debug({ id, type: input.observation_type }, 'Observation created');
  return getObservationById(id)!;
}

/**
 * 按 ID 获取
 */
export function getObservationById(id: string): Observation | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToObservation(row) : null;
}

/**
 * 更新置信度（追加历史）
 */
export function updateObservationConfidence(id: string, newConfidence: number): void {
  const db = getDb();
  const obs = getObservationById(id);
  if (!obs) return;

  const history = [...obs.confidence_history, { date: now(), value: newConfidence }];
  db.prepare(
    'UPDATE observations SET confidence = ?, confidence_history = ?, updated_at = ? WHERE id = ?'
  ).run(newConfidence, JSON.stringify(history), now(), id);
}

/**
 * 按类型查询
 */
export function findObservationsByType(type: ObservationType, limit: number = 50): Observation[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM observations WHERE observation_type = ? AND branch = 'main' ORDER BY confidence DESC LIMIT ?"
  ).all(type, limit) as Record<string, unknown>[];
  return rows.map(rowToObservation);
}

/**
 * 分页查询
 */
export function listObservations(
  params: { page: number; page_size: number; domain?: string },
): { items: Observation[]; total: number; page: number; page_size: number; has_more: boolean } {
  const db = getDb();
  const conditions: string[] = ["branch = 'main'"];
  const values: unknown[] = [];

  if (params.domain) {
    conditions.push('domain = ?');
    values.push(params.domain);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) as count FROM observations ${where}`).get(...values) as { count: number }).count;

  const offset = (params.page - 1) * params.page_size;
  const rows = db.prepare(
    `SELECT * FROM observations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...values, params.page_size, offset) as Record<string, unknown>[];

  return {
    items: rows.map(rowToObservation),
    total,
    page: params.page,
    page_size: params.page_size,
    has_more: offset + rows.length < total,
  };
}

/**
 * 统计数量
 */
export function countObservations(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as count FROM observations WHERE branch = 'main'").get() as { count: number }).count;
}

function rowToObservation(row: Record<string, unknown>): Observation {
  return {
    id: row.id as string,
    description: row.description as string,
    observation_type: row.observation_type as ObservationType,
    supporting_fact_ids: JSON.parse((row.supporting_fact_ids as string) || '[]'),
    contradicting_fact_ids: JSON.parse((row.contradicting_fact_ids as string) || '[]'),
    confidence: row.confidence as number,
    confidence_history: JSON.parse((row.confidence_history as string) || '[]'),
    tags: JSON.parse((row.tags as string) || '[]'),
    drift_risk: (row.drift_risk as number) === 1,  // SQLite INTEGER → boolean
    snapshot_id: (row.snapshot_id as string) || null,
    branch: row.branch as string,
    domain: (row.domain as string) || 'default',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
