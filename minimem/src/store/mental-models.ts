// ============================================================
// MiniMem — L4 心智模型存储
// ============================================================

import { getDb } from './database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import type { MentalModel, ModelType } from '../common/types.js';

const log = getLogger('store:mental-models');

export interface CreateMentalModelInput {
  title: string;
  content: string;
  model_type?: ModelType;
  priority?: number;
  scope?: string;
  origin?: string;
}

/**
 * 创建 L4 心智模型
 */
export function createMentalModel(input: CreateMentalModelInput): MentalModel {
  const db = getDb();
  const id = generateId();
  const timestamp = now();

  db.prepare(`
    INSERT INTO mental_models (id, title, content, model_type, priority, scope, origin, is_active, branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'main', ?, ?)
  `).run(
    id,
    input.title,
    input.content,
    input.model_type ?? 'principle',
    input.priority ?? 5,
    input.scope ?? 'global',
    input.origin ?? '',
    timestamp,
    timestamp,
  );

  log.debug({ id, title: input.title }, 'Mental model created');
  return getMentalModelById(id)!;
}

/**
 * 按 ID 获取
 */
export function getMentalModelById(id: string): MentalModel | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM mental_models WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToMentalModel(row) : null;
}

/**
 * 获取所有活跃的心智模型（按优先级排序）
 */
export function getActiveMentalModels(): MentalModel[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM mental_models WHERE is_active = 1 AND branch = 'main' ORDER BY priority DESC"
  ).all() as Record<string, unknown>[];
  return rows.map(rowToMentalModel);
}

/**
 * 按作用域查询
 */
export function findMentalModelsByScope(scope: string): MentalModel[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM mental_models WHERE (scope = ? OR scope = 'global') AND is_active = 1 AND branch = 'main' ORDER BY priority DESC"
  ).all(scope) as Record<string, unknown>[];
  return rows.map(rowToMentalModel);
}

/**
 * 更新模型
 */
export function updateMentalModel(id: string, updates: Partial<Pick<MentalModel, 'title' | 'content' | 'priority' | 'is_active'>>): void {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { sets.push('title = ?'); values.push(updates.title); }
  if (updates.content !== undefined) { sets.push('content = ?'); values.push(updates.content); }
  if (updates.priority !== undefined) { sets.push('priority = ?'); values.push(updates.priority); }
  if (updates.is_active !== undefined) { sets.push('is_active = ?'); values.push(updates.is_active ? 1 : 0); }

  sets.push('updated_at = ?');
  values.push(now());
  values.push(id);

  db.prepare(`UPDATE mental_models SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * 分页查询
 */
export function listMentalModels(
  params: { page: number; page_size: number; scope?: string; domain?: string },
): { items: MentalModel[]; total: number; page: number; page_size: number; has_more: boolean } {
  const db = getDb();
  const conditions: string[] = ["branch = 'main'"];
  const values: unknown[] = [];

  if (params.scope) {
    conditions.push("(scope = ? OR scope = 'global')");
    values.push(params.scope);
  }
  if (params.domain) {
    conditions.push('domain = ?');
    values.push(params.domain);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) as count FROM mental_models ${where}`).get(...values) as { count: number }).count;

  const offset = (params.page - 1) * params.page_size;
  const rows = db.prepare(
    `SELECT * FROM mental_models ${where} ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?`
  ).all(...values, params.page_size, offset) as Record<string, unknown>[];

  return {
    items: rows.map(rowToMentalModel),
    total,
    page: params.page,
    page_size: params.page_size,
    has_more: offset + rows.length < total,
  };
}

/**
 * 统计数量
 */
export function countMentalModels(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as count FROM mental_models WHERE branch = 'main' AND is_active = 1").get() as { count: number }).count;
}

function rowToMentalModel(row: Record<string, unknown>): MentalModel {
  return {
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    model_type: row.model_type as ModelType,
    priority: row.priority as number,
    scope: row.scope as string,
    origin: row.origin as string,
    is_active: !!(row.is_active as number),
    snapshot_id: (row.snapshot_id as string) || null,
    branch: row.branch as string,
    domain: (row.domain as string) || 'default',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
