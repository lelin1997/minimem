// ============================================================
// MiniMem — 版本控制：分支合并
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { now } from '../common/utils.js';
import { createSnapshot } from './snapshot.js';
import { createAuditLog } from './audit.js';
import { ValidationError } from '../common/errors.js';

const log = getLogger('version:merge');

export interface MergeResult {
  source_branch: string;
  target_branch: string;
  pre_snapshot_id: string;
  post_snapshot_id: string;
  merged: {
    experiences: number;
    world_facts: number;
    observations: number;
    mental_models: number;
    knowledge_pages: number;
  };
  conflicts: number;
}

/**
 * 将源分支的记忆合并到目标分支
 * 
 * 策略：简单合并 — 将源分支的所有记忆复制到目标分支
 * 如果记忆已存在（相同内容），跳过
 */
export function mergeBranch(
  sourceBranch: string,
  targetBranch: string = 'main',
): MergeResult {
  if (sourceBranch === targetBranch) {
    throw new ValidationError('Cannot merge a branch into itself', { sourceBranch, targetBranch });
  }

  const db = getDb();

  // 合并前快照
  const preSnap = createSnapshot({
    label: `pre-merge-${sourceBranch}-to-${targetBranch}`,
    trigger: 'auto',
    branch: targetBranch,
  });

  const merged = { experiences: 0, world_facts: 0, observations: 0, mental_models: 0, knowledge_pages: 0 };
  let conflicts = 0;
  const timestamp = now();

  db.transaction(() => {
    // 合并 L1 经历
    const l1Rows = db.prepare('SELECT * FROM experiences WHERE branch = ?').all(sourceBranch) as Record<string, unknown>[];
    for (const row of l1Rows) {
      // 检查重复（通过 content_hash）
      if (row.content_hash) {
        const exists = db.prepare(
          'SELECT 1 FROM experiences WHERE content_hash = ? AND branch = ?'
        ).get(row.content_hash, targetBranch);
        if (exists) { conflicts++; continue; }
      }
      db.prepare('UPDATE experiences SET branch = ?, updated_at = ? WHERE id = ?').run(targetBranch, timestamp, row.id);
      merged.experiences++;
    }

    // 合并 L2 事实
    const l2Rows = db.prepare('SELECT * FROM world_facts WHERE branch = ?').all(sourceBranch) as Record<string, unknown>[];
    for (const row of l2Rows) {
      // 检查同主谓宾的事实
      const exists = db.prepare(
        'SELECT 1 FROM world_facts WHERE subject = ? AND predicate = ? AND object = ? AND branch = ?'
      ).get(row.subject, row.predicate, row.object, targetBranch);
      if (exists) { conflicts++; continue; }
      db.prepare('UPDATE world_facts SET branch = ?, updated_at = ? WHERE id = ?').run(targetBranch, timestamp, row.id);
      merged.world_facts++;
    }

    // 合并 L3 观察
    const l3Rows = db.prepare('SELECT * FROM observations WHERE branch = ?').all(sourceBranch) as Record<string, unknown>[];
    for (const row of l3Rows) {
      db.prepare('UPDATE observations SET branch = ?, updated_at = ? WHERE id = ?').run(targetBranch, timestamp, row.id);
      merged.observations++;
    }

    // 合并 L4 心智模型
    const l4Rows = db.prepare('SELECT * FROM mental_models WHERE branch = ?').all(sourceBranch) as Record<string, unknown>[];
    for (const row of l4Rows) {
      const exists = db.prepare(
        'SELECT 1 FROM mental_models WHERE title = ? AND branch = ?'
      ).get(row.title, targetBranch);
      if (exists) { conflicts++; continue; }
      db.prepare('UPDATE mental_models SET branch = ?, updated_at = ? WHERE id = ?').run(targetBranch, timestamp, row.id);
      merged.mental_models++;
    }

    // 合并知识页面
    const pageRows = db.prepare('SELECT * FROM knowledge_pages WHERE branch = ?').all(sourceBranch) as Record<string, unknown>[];
    for (const row of pageRows) {
      const exists = db.prepare(
        'SELECT 1 FROM knowledge_pages WHERE slug = ? AND branch = ?'
      ).get(row.slug, targetBranch);
      if (exists) { conflicts++; continue; }
      db.prepare('UPDATE knowledge_pages SET branch = ?, updated_at = ? WHERE id = ?').run(targetBranch, timestamp, row.id);
      merged.knowledge_pages++;
    }
  })();

  // 合并后快照
  const postSnap = createSnapshot({
    label: `post-merge-${sourceBranch}-to-${targetBranch}`,
    trigger: 'auto',
    branch: targetBranch,
  });

  // 审计日志
  createAuditLog({
    action: 'merge',
    target_type: 'branch',
    target_id: sourceBranch,
    before_value: JSON.stringify({ branch: sourceBranch }),
    after_value: JSON.stringify({ merged, conflicts }),
    triggered_by: 'system',
  });

  const totalMerged = merged.experiences + merged.world_facts + merged.observations + merged.mental_models + merged.knowledge_pages;
  log.info({ source: sourceBranch, target: targetBranch, totalMerged, conflicts }, 'Branch merged');

  return {
    source_branch: sourceBranch,
    target_branch: targetBranch,
    pre_snapshot_id: preSnap.id,
    post_snapshot_id: postSnap.id,
    merged,
    conflicts,
  };
}
