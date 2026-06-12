// ============================================================
// MiniMem — Dream Engine: Phase 1 — 审计 + Knowledge Page Lint
// ============================================================

import { getDb } from '../../store/database.js';
import { getLogger } from '../../common/logger.js';
import { getStalePages, updateLintStatus, getAllKnowledgePages } from '../../store/knowledge-pages/page-store.js';
import { enqueueCompile } from '../../store/knowledge-pages/compile-queue.js';
import type { KnowledgePage, LintStatus } from '../../common/types.js';

const log = getLogger('dream:auditor');

// ── 审计结果 ──

export interface AuditResult {
  total_new_memories: number;
  by_source: Record<string, number>;

  critical: MemoryRef[];
  important: MemoryRef[];
  routine: MemoryRef[];
  trivial: MemoryRef[];

  conflicts: ConflictItem[];
  duplicates: DuplicatePair[];
  outdated: MemoryRef[];

  pages_linted: number;
  lint_issues: LintIssue[];
}

export interface MemoryRef {
  id: string;
  layer: string;
  importance: number;
}

export interface ConflictItem {
  id_a: string;
  id_b: string;
  description: string;
}

export interface DuplicatePair {
  id_a: string;
  id_b: string;
  similarity: number;
}

export interface LintIssue {
  page_id: string;
  slug: string;
  issue: LintStatus;
  staleness: number;
}

/**
 * Phase 1: 浅睡眠 — 记忆审计
 *
 * 1. 扫描今日新增记忆，分级
 * 2. 检测冲突和重复
 * 3. Knowledge Page Lint
 */
export function runAudit(sinceDate?: string): AuditResult {
  const db = getDb();
  const since = sinceDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  log.info({ since }, 'Phase 1: Memory audit started');

  // 1. 扫描新增 L1 记忆
  const newMemories = db.prepare(`
    SELECT id, importance, source FROM experiences
    WHERE branch = 'main' AND created_at >= ?
    ORDER BY importance DESC
  `).all(since) as Array<{ id: string; importance: number; source: string }>;

  // 按来源统计
  const bySource: Record<string, number> = {};
  for (const m of newMemories) {
    bySource[m.source] = (bySource[m.source] || 0) + 1;
  }

  // 分级
  const critical: MemoryRef[] = [];
  const important: MemoryRef[] = [];
  const routine: MemoryRef[] = [];
  const trivial: MemoryRef[] = [];

  for (const m of newMemories) {
    const ref: MemoryRef = { id: m.id, layer: 'L1', importance: m.importance };
    if (m.importance >= 0.8) critical.push(ref);
    else if (m.importance >= 0.6) important.push(ref);
    else if (m.importance >= 0.3) routine.push(ref);
    else trivial.push(ref);
  }

  // 2. 检测事实冲突（同主谓不同宾）
  const conflicts: ConflictItem[] = [];
  const factConflicts = db.prepare(`
    SELECT a.id as id_a, b.id as id_b, a.subject, a.predicate, a.object as obj_a, b.object as obj_b
    FROM world_facts a
    JOIN world_facts b ON a.subject = b.subject AND a.predicate = b.predicate AND a.id < b.id
    WHERE a.branch = 'main' AND b.branch = 'main'
      AND a.object != b.object
      AND a.confidence >= 0.4 AND b.confidence >= 0.4
  `).all() as Array<{ id_a: string; id_b: string; subject: string; predicate: string; obj_a: string; obj_b: string }>;

  for (const c of factConflicts) {
    conflicts.push({
      id_a: c.id_a,
      id_b: c.id_b,
      description: `"${c.subject} ${c.predicate}" has conflicting values: "${c.obj_a}" vs "${c.obj_b}"`,
    });
  }

  // 3. Knowledge Page Lint
  const lintIssues: LintIssue[] = [];
  const allPages = getAllKnowledgePages();

  for (const page of allPages) {
    const issues = lintPage(page, db);
    if (issues) {
      lintIssues.push(issues);
      updateLintStatus(page.id, issues.issue, issues.staleness);

      // 将 lint 发现入队以供 Phase 2 处理
      if (issues.issue !== 'healthy') {
        enqueueCompile('lint_finding', `Page "${page.title}" (${page.slug}): ${issues.issue}, staleness=${issues.staleness}`, page.slug, 3);
      }
    }
  }

  const result: AuditResult = {
    total_new_memories: newMemories.length,
    by_source: bySource,
    critical,
    important,
    routine,
    trivial,
    conflicts,
    duplicates: [], // 简化：通过 content_hash 检测的重复已在摄入时处理
    outdated: [],
    pages_linted: allPages.length,
    lint_issues: lintIssues,
  };

  log.info({
    newMemories: newMemories.length,
    critical: critical.length,
    conflicts: conflicts.length,
    lintIssues: lintIssues.length,
  }, 'Phase 1: Audit complete');

  return result;
}

// ── Knowledge Page Lint ──

function lintPage(page: KnowledgePage, db: ReturnType<typeof getDb>): LintIssue | null {
  // 检查 staleness: 如果最近有新事实但页面未更新
  const recentFacts = db.prepare(`
    SELECT COUNT(*) as count FROM world_facts
    WHERE branch = 'main' AND created_at > ? AND
      (subject LIKE ? OR object LIKE ?)
  `).get(
    page.last_compiled ?? page.created_at,
    `%${page.title}%`,
    `%${page.title}%`,
  ) as { count: number };

  // 检查反向链接完整性
  const brokenLinks = db.prepare(`
    SELECT COUNT(*) as count FROM knowledge_page_links
    WHERE from_page_id = ? AND to_page_id NOT IN (SELECT id FROM knowledge_pages)
  `).get(page.id) as { count: number };

  // 检查证据链
  const evidenceCount = db.prepare(`
    SELECT COUNT(*) as count FROM knowledge_page_evidence WHERE page_id = ?
  `).get(page.id) as { count: number };

  let issue: LintStatus = 'healthy';
  let staleness = page.staleness_score;

  if (brokenLinks.count > 0) {
    issue = 'orphaned';
  } else if (recentFacts.count >= 5) {
    // 有很多新事实但页面未更新
    staleness = Math.min(1, staleness + recentFacts.count * 0.1);
    if (staleness > 0.5) issue = 'stale';
  } else if (evidenceCount.count === 0) {
    issue = 'missing';
  }

  if (issue === 'healthy' && staleness <= 0.3) {
    return null; // 无问题
  }

  return { page_id: page.id, slug: page.slug, issue, staleness };
}
