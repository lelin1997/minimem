// ============================================================
// MiniMem — Knowledge Page 证据链管理
// ============================================================

import { getDb } from '../database.js';
import { generateId, now } from '../../common/utils.js';
import type { KnowledgePageEvidence } from '../../common/types.js';

/**
 * 添加证据关联
 */
export function addEvidence(
  pageId: string,
  evidenceType: 'l1' | 'l2' | 'l3',
  evidenceId: string,
  sectionHint?: string,
): KnowledgePageEvidence {
  const db = getDb();
  const id = generateId();

  db.prepare(`
    INSERT INTO knowledge_page_evidence (id, page_id, evidence_type, evidence_id, section_hint, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, pageId, evidenceType, evidenceId, sectionHint ?? null, now());

  return { id, page_id: pageId, evidence_type: evidenceType, evidence_id: evidenceId, section_hint: sectionHint ?? null, created_at: now() };
}

/**
 * 获取某页面的所有证据
 */
export function getPageEvidence(pageId: string): KnowledgePageEvidence[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM knowledge_page_evidence WHERE page_id = ? ORDER BY created_at DESC'
  ).all(pageId) as KnowledgePageEvidence[];
}

/**
 * 获取引用某证据的所有页面
 */
export function findPagesByEvidence(evidenceType: string, evidenceId: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT DISTINCT page_id FROM knowledge_page_evidence WHERE evidence_type = ? AND evidence_id = ?'
  ).all(evidenceType, evidenceId) as Array<{ page_id: string }>;
  return rows.map(r => r.page_id);
}

/**
 * 删除某页面的所有证据
 */
export function deletePageEvidence(pageId: string): number {
  const db = getDb();
  return db.prepare('DELETE FROM knowledge_page_evidence WHERE page_id = ?').run(pageId).changes;
}
