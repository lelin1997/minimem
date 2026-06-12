// ============================================================
// MiniMem — Knowledge Page 反向链接管理
// ============================================================

import { getDb } from '../database.js';
import { getLogger } from '../../common/logger.js';
import { generateId, now } from '../../common/utils.js';
import type { KnowledgePageLink } from '../../common/types.js';

const log = getLogger('store:kp-links');

/**
 * 创建链接（双向）
 */
export function createPageLink(fromPageId: string, toPageId: string, context: string = ''): KnowledgePageLink {
  const db = getDb();
  const id = generateId();

  db.prepare(`
    INSERT OR IGNORE INTO knowledge_page_links (id, from_page_id, to_page_id, link_context, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, fromPageId, toPageId, context, now());

  log.debug({ from: fromPageId, to: toPageId }, 'Page link created');
  return { id, from_page_id: fromPageId, to_page_id: toPageId, link_context: context, created_at: now() };
}

/**
 * 获取某页面的出链
 */
export function getOutboundLinks(pageId: string): KnowledgePageLink[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM knowledge_page_links WHERE from_page_id = ?'
  ).all(pageId) as KnowledgePageLink[];
}

/**
 * 获取某页面的入链
 */
export function getInboundLinks(pageId: string): KnowledgePageLink[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM knowledge_page_links WHERE to_page_id = ?'
  ).all(pageId) as KnowledgePageLink[];
}

/**
 * 获取孤立页面（入链为 0）
 */
export function getOrphanedPageIds(): string[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT kp.id FROM knowledge_pages kp
    LEFT JOIN knowledge_page_links kpl ON kpl.to_page_id = kp.id
    WHERE kpl.id IS NULL AND kp.branch = 'main'
  `).all() as Array<{ id: string }>;
  return rows.map(r => r.id);
}

/**
 * 删除某页面的所有链接
 */
export function deletePageLinks(pageId: string): number {
  const db = getDb();
  const info = db.prepare(
    'DELETE FROM knowledge_page_links WHERE from_page_id = ? OR to_page_id = ?'
  ).run(pageId, pageId);
  return info.changes;
}

/**
 * 同步页面中 [[backlink]] 到链接表
 */
export function syncBacklinks(pageId: string, content: string, allSlugsToIds: Map<string, string>): void {
  const db = getDb();

  // 解析 [[slug]] 语法
  const backlinkPattern = /\[\[([^\]]+)\]\]/g;
  const foundSlugs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = backlinkPattern.exec(content)) !== null) {
    foundSlugs.add(match[1].trim().toLowerCase());
  }

  // 删除旧的出链
  db.prepare('DELETE FROM knowledge_page_links WHERE from_page_id = ?').run(pageId);

  // 创建新链接
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO knowledge_page_links (id, from_page_id, to_page_id, link_context, created_at)
    VALUES (?, ?, ?, '', ?)
  `);

  const timestamp = now();
  for (const slug of foundSlugs) {
    const targetId = allSlugsToIds.get(slug);
    if (targetId && targetId !== pageId) {
      stmt.run(generateId(), pageId, targetId, timestamp);
    }
  }

  log.debug({ pageId, linkCount: foundSlugs.size }, 'Backlinks synced');
}
