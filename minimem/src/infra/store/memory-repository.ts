// ============================================================
// MiniMem — MemoryRepository 接口实现 (TODO-039 P3 C4)
// ============================================================
// 基于 memories 视图 + 物理表路由的实现
// ============================================================

import { getDb } from './database.js';
import { generateId, now } from '../../common/utils.js';
import type { MemoryRepository, UnifiedMemory, MemoryQuery } from '../../domain/ports/memory-repository.js';
import type { MemoryLayer } from '../../common/types.js';

/**
 * 通过 memories 视图查询统一记忆
 */
export function queryMemories(query: MemoryQuery): UnifiedMemory[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.layer) {
    conditions.push('layer = ?');
    params.push(query.layer);
  }
  if (query.domain) {
    conditions.push('domain = ?');
    params.push(query.domain);
  }
  if (query.branch) {
    conditions.push('branch = ?');
    params.push(query.branch);
  }
  if (query.minImportance != null) {
    conditions.push('importance IS NOT NULL AND importance >= ?');
    params.push(query.minImportance);
  }
  if (query.minConfidence != null) {
    conditions.push('confidence IS NOT NULL AND confidence >= ?');
    params.push(query.minConfidence);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = query.orderBy ?? 'created_at';
  const order = query.order ?? 'DESC';
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const rows = db.prepare(
    `SELECT * FROM memories ${where} ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as Array<Record<string, unknown>>;

  return rows.map(rowToUnifiedMemory);
}

/**
 * 按 ID 查询统一记忆（通过视图）
 */
export function getMemoryById(id: string): UnifiedMemory | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToUnifiedMemory(row) : null;
}

/**
 * 按 layer 统计
 */
export function countMemoriesByLayer(): Record<MemoryLayer, number> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT layer, COUNT(*) as count FROM memories GROUP BY layer`
  ).all() as Array<{ layer: string; count: number }>;

  const result: Record<MemoryLayer, number> = { L1: 0, L2: 0, L3: 0, L4: 0 };
  for (const r of rows) {
    if (r.layer in result) {
      result[r.layer as MemoryLayer] = r.count;
    }
  }
  return result;
}

// ── 写入路由 ──

export function addL1Memory(data: {
  raw_content: string;
  source: string;
  content_type?: string;
  importance?: number;
  tags?: string[];
  participants?: string[];
  context?: string;
  domain?: string;
}): string {
  const db = getDb();
  const id = generateId();
  const ts = now();
  db.prepare(`
    INSERT INTO experiences (id, raw_content, content_type, source, importance, tags, participants, context, domain, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.raw_content,
    data.content_type ?? 'conversation',
    data.source,
    data.importance ?? 0.5,
    JSON.stringify(data.tags ?? []),
    JSON.stringify(data.participants ?? []),
    data.context ?? null,
    data.domain ?? 'default',
    ts, ts,
  );
  return id;
}

export function addL2Fact(data: {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  source?: string;
  domain?: string;
}): string {
  const db = getDb();
  const id = generateId();
  const ts = now();
  db.prepare(`
    INSERT INTO world_facts (id, subject, predicate, object, confidence, source, domain, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.subject, data.predicate, data.object,
    data.confidence ?? 0.7,
    data.source ?? 'system',
    data.domain ?? 'default',
    ts, ts,
  );
  return id;
}

export function addL3Observation(data: {
  description: string;
  observation_type?: string;
  confidence?: number;
  tags?: string[];
  domain?: string;
}): string {
  const db = getDb();
  const id = generateId();
  const ts = now();
  db.prepare(`
    INSERT INTO observations (id, description, observation_type, confidence, tags, domain, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.description,
    data.observation_type ?? 'pattern',
    data.confidence ?? 0.6,
    JSON.stringify(data.tags ?? []),
    data.domain ?? 'default',
    ts, ts,
  );
  return id;
}

export function addL4Model(data: {
  title: string;
  content: string;
  model_type?: string;
  priority?: number;
  domain?: string;
}): string {
  const db = getDb();
  const id = generateId();
  const ts = now();
  db.prepare(`
    INSERT INTO mental_models (id, title, content, model_type, priority, domain, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.title, data.content,
    data.model_type ?? 'principle',
    data.priority ?? 5,
    data.domain ?? 'default',
    ts, ts,
  );
  return id;
}

/**
 * 按 ID 删除（通过视图找到 layer，再从物理表删）
 */
export function deleteMemory(id: string): boolean {
  const db = getDb();
  const mem = getMemoryById(id);
  if (!mem) return false;

  const tableMap: Record<MemoryLayer, string> = {
    L1: 'experiences',
    L2: 'world_facts',
    L3: 'observations',
    L4: 'mental_models',
  };
  const result = db.prepare(`DELETE FROM ${tableMap[mem.layer]} WHERE id = ?`).run(id);
  return result.changes > 0;
}

/**
 * 列出所有 domain 的记忆分布
 */
export function listMemoryDomains(): Array<{ domain: string; count: number; layers: MemoryLayer[] }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT domain, COUNT(*) as count, GROUP_CONCAT(DISTINCT layer) as layers
    FROM memories
    GROUP BY domain
    ORDER BY count DESC
  `).all() as Array<{ domain: string; count: number; layers: string }>;

  return rows.map(r => ({
    domain: r.domain,
    count: r.count,
    layers: r.layers.split(',') as MemoryLayer[],
  }));
}

// ── 工具函数 ──

function rowToUnifiedMemory(row: Record<string, unknown>): UnifiedMemory {
  return {
    id: row.id as string,
    layer: row.layer as MemoryLayer,
    content: row.content as string,
    source: row.source as string | null,
    importance: row.importance as number | null,
    tags: safeParseArray(row.tags),
    participants: safeParseArray(row.participants),
    context: row.context as string | null,
    embedding_id: row.embedding_id as string | null,
    snapshot_id: row.snapshot_id as string | null,
    branch: row.branch as string,
    domain: row.domain as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    subject: row.subject as string | null ?? undefined,
    predicate: row.predicate as string | null ?? undefined,
    object: row.object as string | null ?? undefined,
    confidence: row.confidence as number | null ?? undefined,
    description: row.description as string | null ?? undefined,
    observation_type: row.observation_type as string | null ?? undefined,
    title: row.title as string | null ?? undefined,
    model_type: row.model_type as string | null ?? undefined,
    priority: row.priority as number | null ?? undefined,
    is_active: row.is_active as number | null ?? undefined,
  };
}

function safeParseArray(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
}

// ── 导出 Repository 实例 ──

export const memoryRepository: MemoryRepository = {
  query: async (q: MemoryQuery) => queryMemories(q),
  getById: async (id: string) => getMemoryById(id),
  countByLayer: async () => countMemoriesByLayer(),
  addL1: async (data: Parameters<typeof addL1Memory>[0]) => addL1Memory(data),
  addL2: async (data: Parameters<typeof addL2Fact>[0]) => addL2Fact(data),
  addL3: async (data: Parameters<typeof addL3Observation>[0]) => addL3Observation(data),
  addL4: async (data: Parameters<typeof addL4Model>[0]) => addL4Model(data),
  delete: async (id: string) => deleteMemory(id),
  listDomains: async () => listMemoryDomains(),
};
