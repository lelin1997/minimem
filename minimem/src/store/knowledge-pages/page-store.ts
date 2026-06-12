// ============================================================
// MiniMem — Knowledge Pages 存储 (Karpathy Compile)
// ============================================================

import { getDb } from '../database.js';
import { getLogger } from '../../common/logger.js';
import { generateId, now, slugify } from '../../common/utils.js';
import type { KnowledgePage, KnowledgePageStatus, PageType, LintStatus } from '../../common/types.js';

const log = getLogger('store:knowledge-pages');

export interface CreateKnowledgePageInput {
  title: string;
  slug?: string;
  page_type?: PageType;
  content: string;
  summary?: string;
  domain?: string;
  tags?: string[];
  confidence?: number;
}

/**
 * 创建知识页面
 */
export function createKnowledgePage(input: CreateKnowledgePageInput): KnowledgePage {
  const db = getDb();
  const id = generateId();
  const slug = input.slug ?? slugify(input.title);
  const timestamp = now();

  db.prepare(`
    INSERT INTO knowledge_pages (id, slug, title, page_type, content, summary, domain, tags, compile_count, last_compiled, lint_status, staleness_score, confidence, branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'healthy', 0.0, ?, 'main', ?, ?)
  `).run(
    id, slug, input.title,
    input.page_type ?? 'topic',
    input.content,
    input.summary ?? '',
    input.domain ?? 'default',
    JSON.stringify(input.tags ?? []),
    timestamp, // last_compiled
    input.confidence ?? 0.5,
    timestamp, timestamp,
  );

  log.info({ id, slug, type: input.page_type }, 'Knowledge page created');
  return getKnowledgePageById(id)!;
}

/**
 * 按 ID 获取
 */
export function getKnowledgePageById(id: string): KnowledgePage | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM knowledge_pages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToPage(row) : null;
}

/**
 * 按 slug 获取
 */
export function getKnowledgePageBySlug(slug: string): KnowledgePage | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM knowledge_pages WHERE slug = ?').get(slug) as Record<string, unknown> | undefined;
  return row ? rowToPage(row) : null;
}

/**
 * 更新知识页面内容（增量追加模式）
 * R-013: 更新前保存版本历史
 */
export function updateKnowledgePageContent(id: string, newContent: string): void {
  const db = getDb();
  const timestamp = now();

  // R-013: 保存当前版本到历史表
  const current = db.prepare('SELECT content, compile_count FROM knowledge_pages WHERE id = ?').get(id) as { content: string; compile_count: number } | undefined;
  if (current) {
    db.prepare(`
      INSERT INTO knowledge_page_versions (id, page_id, version, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(generateId(), id, current.compile_count, current.content, timestamp);
  }

  db.prepare(`
    UPDATE knowledge_pages
    SET content = ?, compile_count = compile_count + 1, last_compiled = ?, staleness_score = 0.0, lint_status = 'healthy', updated_at = ?
    WHERE id = ?
  `).run(newContent, timestamp, timestamp, id);
}

/**
 * 更新知识页面元数据（summary/domain/tags）
 * 由 Dream 编译器在更新页面时调用，不触发版本历史
 */
export function updateKnowledgePageMeta(id: string, meta: { summary?: string; domain?: string; tags?: string[] }): void {
  const db = getDb();
  const sets: string[] = ['updated_at = ?'];
  const values: unknown[] = [now()];

  if (meta.summary !== undefined) {
    sets.push('summary = ?');
    values.push(meta.summary);
  }
  if (meta.domain !== undefined) {
    sets.push('domain = ?');
    values.push(meta.domain);
  }
  if (meta.tags !== undefined) {
    sets.push('tags = ?');
    values.push(JSON.stringify(meta.tags));
  }

  if (sets.length > 1) { // 至少有一个字段要更新（除了 updated_at）
    values.push(id);
    db.prepare(`UPDATE knowledge_pages SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
}

/**
 * 更新 Lint 状态
 */
export function updateLintStatus(id: string, status: LintStatus, stalenessScore?: number): void {
  const db = getDb();
  const sets = ['lint_status = ?', 'updated_at = ?'];
  const values: unknown[] = [status, now()];

  if (stalenessScore !== undefined) {
    sets.push('staleness_score = ?');
    values.push(stalenessScore);
  }
  values.push(id);

  db.prepare(`UPDATE knowledge_pages SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * 获取所有页面（用于 INDEX 生成）
 */
export function getAllKnowledgePages(): KnowledgePage[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM knowledge_pages WHERE branch = 'main' ORDER BY updated_at DESC"
  ).all() as Record<string, unknown>[];
  return rows.map(rowToPage);
}

/**
 * 获取需要 Lint 的页面
 */
export function getStalePages(maxStaleness: number = 0.5): KnowledgePage[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM knowledge_pages WHERE branch = 'main' AND (staleness_score > ? OR lint_status != 'healthy') ORDER BY staleness_score DESC"
  ).all(maxStaleness) as Record<string, unknown>[];
  return rows.map(rowToPage);
}

/**
 * 搜索页面
 * R-017: 优先使用 FTS5 索引搜索，降级到 LIKE
 */
export function searchKnowledgePages(query: string, limit: number = 10): KnowledgePage[] {
  const db = getDb();

  // 尝试 FTS5 搜索（通过 memory_fts 查找关联的知识页面内容）
  try {
    // 先用 FTS5 搜索，匹配 knowledge_pages 中内容
    const ftsQuery = query.replace(/['"]/g, '').trim();
    if (ftsQuery.length > 0) {
      const ftsRows = db.prepare(`
        SELECT DISTINCT kp.* FROM knowledge_pages kp
        WHERE kp.branch = 'main' AND kp.id IN (
          SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ? AND memory_type IN ('L3', 'L4')
        )
        ORDER BY kp.confidence DESC
        LIMIT ?
      `).all(ftsQuery, limit) as Record<string, unknown>[];

      if (ftsRows.length > 0) {
        return ftsRows.map(rowToPage);
      }
    }
  } catch {
    // FTS 查询失败，降级到 LIKE
  }

  // 降级: LIKE 搜索
  const pattern = `%${query}%`;
  const rows = db.prepare(`
    SELECT * FROM knowledge_pages
    WHERE branch = 'main' AND (title LIKE ? OR content LIKE ? OR slug LIKE ?)
    ORDER BY confidence DESC
    LIMIT ?
  `).all(pattern, pattern, pattern, limit) as Record<string, unknown>[];
  return rows.map(rowToPage);
}

/**
 * 统计页面数量
 */
export function countKnowledgePages(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as count FROM knowledge_pages WHERE branch = 'main'").get() as { count: number }).count;
}

function rowToPage(row: Record<string, unknown>): KnowledgePage {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    page_type: row.page_type as PageType,
    content: row.content as string,
    summary: (row.summary as string) || '',
    domain: (row.domain as string) || 'default',
    tags: JSON.parse((row.tags as string) || '[]'),
    status: (row.status as KnowledgePageStatus) || 'active',
    compile_count: row.compile_count as number,
    last_compiled: (row.last_compiled as string) || null,
    lint_status: row.lint_status as LintStatus,
    staleness_score: row.staleness_score as number,
    confidence: row.confidence as number,
    embedding_id: (row.embedding_id as string) || null,
    snapshot_id: (row.snapshot_id as string) || null,
    branch: row.branch as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// ── Console Knowledge API 支撑函数 ──

export interface ListKnowledgePagesOptions {
  page?: number;
  page_size?: number;
  search?: string;
  tag?: string;
  domain?: string;
  status?: string;
}

export interface ListKnowledgePagesResult {
  items: KnowledgePage[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * 分页列表 + 多条件筛选（Console 知识列表 API）
 */
export function listKnowledgePages(options: ListKnowledgePagesOptions = {}): ListKnowledgePagesResult {
  const db = getDb();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.page_size ?? 20));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ["branch = 'main'"];
  const values: unknown[] = [];

  // 状态筛选
  if (options.status) {
    conditions.push('status = ?');
    values.push(options.status);
  } else {
    // 默认不展示 archived
    conditions.push("status != 'archived'");
  }

  // 领域筛选
  if (options.domain) {
    conditions.push('domain = ?');
    values.push(options.domain);
  }

  // 标签筛选（JSON 数组 LIKE 匹配）
  if (options.tag) {
    conditions.push("tags LIKE ?");
    values.push(`%"${options.tag}"%`);
  }

  // 全文搜索
  if (options.search) {
    const pattern = `%${options.search}%`;
    conditions.push('(title LIKE ? OR content LIKE ? OR summary LIKE ?)');
    values.push(pattern, pattern, pattern);
  }

  const whereClause = conditions.join(' AND ');

  // 统计总数
  const countSql = `SELECT COUNT(*) as total FROM knowledge_pages WHERE ${whereClause}`;
  const totalRow = db.prepare(countSql).get(...values) as { total: number };
  const total = totalRow.total;

  // 获取分页数据
  const dataSql = `SELECT * FROM knowledge_pages WHERE ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(dataSql).all(...values, pageSize, offset) as Record<string, unknown>[];

  return {
    items: rows.map(rowToPage),
    total,
    page,
    page_size: pageSize,
  };
}

/**
 * 删除或归档知识页面（Console DELETE API）
 * 
 * @param id - 页面 ID
 * @param mode - 'archive'（默认）= 改 status 为 archived；'delete' = 物理删除
 */
export function deleteOrArchiveKnowledgePage(id: string, mode: 'archive' | 'delete' = 'archive'): boolean {
  const db = getDb();

  // 检查页面是否存在
  const exists = db.prepare("SELECT id FROM knowledge_pages WHERE id = ?").get(id);
  if (!exists) return false;

  if (mode === 'delete') {
    // 物理删除（级联会自动删除 links / evidence / versions）
    db.transaction(() => {
      db.prepare('DELETE FROM knowledge_page_links WHERE from_page_id = ? OR to_page_id = ?').run(id, id);
      db.prepare('DELETE FROM knowledge_page_evidence WHERE page_id = ?').run(id);
      db.prepare('DELETE FROM knowledge_page_versions WHERE page_id = ?').run(id);
      db.prepare('DELETE FROM knowledge_pages WHERE id = ?').run(id);
    })();
    log.info({ id, mode }, 'Knowledge page permanently deleted');
  } else {
    // 归档
    db.prepare("UPDATE knowledge_pages SET status = 'archived', updated_at = ? WHERE id = ?").run(now(), id);
    log.info({ id, mode }, 'Knowledge page archived');
  }

  return true;
}

/**
 * 获取所有知识标签（去重）
 */
export function getAllKnowledgeTags(): string[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT tags FROM knowledge_pages WHERE branch = 'main' AND status != 'archived' AND tags != '[]'"
  ).all() as Array<{ tags: string }>;

  const tagSet = new Set<string>();
  for (const row of rows) {
    try {
      const tags = JSON.parse(row.tags) as string[];
      for (const tag of tags) {
        if (tag) tagSet.add(tag);
      }
    } catch {
      // 忽略解析错误
    }
  }

  return Array.from(tagSet).sort();
}
