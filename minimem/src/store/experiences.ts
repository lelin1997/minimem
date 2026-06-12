// ============================================================
// MiniMem — L1 经历存储
// ============================================================

import { getDb } from './database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import type { Experience, PaginationParams, PaginatedResult } from '../common/types.js';

const log = getLogger('store:experiences');

export interface CreateExperienceInput {
  /**
   * 经历内容 — 经过 PII 遮罩后的可用文本（R-015: 不是原始原文）
   * 原始内容如需保留，可通过压缩前的 context 字段回溯
   */
  raw_content: string;
  content_type?: string;
  source: string;
  importance?: number;
  tags?: string[];
  participants?: string[];
  context?: string | null;
  content_hash?: string | null;
  embedding_id?: string | null;
  domain?: string; // MINIMEM-001: 领域隔离
}

/**
 * 创建一条 L1 经历
 */
export function createExperience(input: CreateExperienceInput): Experience {
  const db = getDb();
  const id = generateId();
  const timestamp = now();

  const stmt = db.prepare(`
    INSERT INTO experiences (id, raw_content, content_type, source, importance, tags, participants, context, content_hash, embedding_id, branch, domain, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?, ?, ?)
  `);

  stmt.run(
    id,
    input.raw_content,
    input.content_type ?? 'conversation',
    input.source,
    input.importance ?? 0.5,
    JSON.stringify(input.tags ?? []),
    JSON.stringify(input.participants ?? []),
    input.context ?? null,
    input.content_hash ?? null,
    input.embedding_id ?? null,
    input.domain ?? 'default',
    timestamp,
    timestamp,
  );

  log.debug({ id, source: input.source, domain: input.domain ?? 'default' }, 'Experience created');
  return getExperienceById(id)!;
}

/**
 * 批量创建经历
 */
export function createExperiencesBatch(inputs: CreateExperienceInput[]): Experience[] {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO experiences (id, raw_content, content_type, source, importance, tags, participants, context, content_hash, embedding_id, branch, domain, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?, ?, ?)
  `);

  const ids: string[] = [];
  const timestamp = now();

  const insertMany = db.transaction(() => {
    for (const input of inputs) {
      const id = generateId();
      ids.push(id);
      stmt.run(
        id,
        input.raw_content,
        input.content_type ?? 'conversation',
        input.source,
        input.importance ?? 0.5,
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.participants ?? []),
        input.context ?? null,
        input.content_hash ?? null,
        input.embedding_id ?? null,
        input.domain ?? 'default',
        timestamp,
        timestamp,
      );
    }
  });

  insertMany();
  log.info({ count: ids.length }, 'Batch experiences created');
  return ids.map(id => getExperienceById(id)!);
}

/**
 * 按 ID 获取
 */
export function getExperienceById(id: string): Experience | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM experiences WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToExperience(row) : null;
}

/**
 * 检查内容是否已存在（通过 hash 去重）
 */
export function experienceExistsByHash(hash: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM experiences WHERE content_hash = ?').get(hash);
  return !!row;
}

/**
 * 分页查询
 */
export function listExperiences(
  params: PaginationParams & { source?: string; content_type?: string; domain?: string },
): PaginatedResult<Experience> {
  const db = getDb();
  const conditions: string[] = ["branch = 'main'"];
  const values: unknown[] = [];

  if (params.source) {
    conditions.push('source = ?');
    values.push(params.source);
  }
  if (params.content_type) {
    conditions.push('content_type = ?');
    values.push(params.content_type);
  }
  if (params.domain) {
    conditions.push('domain = ?');
    values.push(params.domain);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM experiences ${where}`).get(...values) as { count: number }).count;

  const offset = (params.page - 1) * params.page_size;
  const rows = db.prepare(
    `SELECT * FROM experiences ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...values, params.page_size, offset) as Record<string, unknown>[];

  return {
    items: rows.map(rowToExperience),
    total,
    page: params.page,
    page_size: params.page_size,
    has_more: offset + rows.length < total,
  };
}

/**
 * 获取未处理的经历（用于 L1→L2 提炼）
 */
export function getUnprocessedExperiences(limit: number = 10): Experience[] {
  const db = getDb();
  // 未处理 = 没有对应 world_facts 引用的经历
  const rows = db.prepare(`
    SELECT e.* FROM experiences e
    WHERE e.branch = 'main'
      AND e.id NOT IN (
        SELECT json_each.value
        FROM world_facts wf, json_each(wf.evidence_experience_ids)
      )
    ORDER BY e.created_at ASC
    LIMIT ?
  `).all(limit) as Record<string, unknown>[];

  return rows.map(rowToExperience);
}

/**
 * 统计数量
 */
export function countExperiences(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as count FROM experiences WHERE branch = 'main'").get() as { count: number }).count;
}

// ── 行转对象 ──

function rowToExperience(row: Record<string, unknown>): Experience {
  return {
    id: row.id as string,
    raw_content: row.raw_content as string,
    content_type: row.content_type as Experience['content_type'],
    source: row.source as string,
    importance: row.importance as number,
    tags: JSON.parse((row.tags as string) || '[]'),
    participants: JSON.parse((row.participants as string) || '[]'),
    context: (row.context as string) || null,
    embedding_id: (row.embedding_id as string) || null,
    snapshot_id: (row.snapshot_id as string) || null,
    branch: row.branch as string,
    domain: (row.domain as string) || 'default',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
