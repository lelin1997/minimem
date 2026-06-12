// ============================================================
// MiniMem — 版本控制：回滚
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import { getSnapshotById, createSnapshot } from './snapshot.js';
import { createAuditLog } from './audit.js';
import { NotFoundError } from '../common/errors.js';

const log = getLogger('version:rollback');

export interface RollbackResult {
  target_snapshot_id: string;
  safety_snapshot_id: string;
  rolled_back: {
    experiences: number;
    world_facts: number;
    observations: number;
    mental_models: number;
    knowledge_pages: number;
  };
}

/**
 * 回滚到指定快照的时间点
 * 
 * 策略：
 * 1. 先创建安全快照（以防需要恢复）
 * 2. 删除快照之后创建的所有记忆
 * 3. 恢复快照之后删除的记忆（从墓碑恢复 — 如果有的话）
 */
export function rollbackToSnapshot(snapshotId: string, branch: string = 'main'): RollbackResult {
  const snapshot = getSnapshotById(snapshotId);
  if (!snapshot) {
    throw new NotFoundError('snapshot', snapshotId);
  }

  // 安全快照
  const safetySnap = createSnapshot({
    label: `safety-before-rollback-${snapshotId}`,
    trigger: 'auto',
    branch,
  });

  const db = getDb();
  const cutoff = snapshot.created_at;
  const rolledBack = { experiences: 0, world_facts: 0, observations: 0, mental_models: 0, knowledge_pages: 0 };

  db.transaction(() => {
    // 删除快照时间之后创建的记忆
    const delL1 = db.prepare('DELETE FROM experiences WHERE branch = ? AND created_at > ?').run(branch, cutoff);
    rolledBack.experiences = delL1.changes;

    const delL2 = db.prepare('DELETE FROM world_facts WHERE branch = ? AND created_at > ?').run(branch, cutoff);
    rolledBack.world_facts = delL2.changes;

    const delL3 = db.prepare('DELETE FROM observations WHERE branch = ? AND created_at > ?').run(branch, cutoff);
    rolledBack.observations = delL3.changes;

    const delL4 = db.prepare('DELETE FROM mental_models WHERE branch = ? AND created_at > ?').run(branch, cutoff);
    rolledBack.mental_models = delL4.changes;

    const delPages = db.prepare('DELETE FROM knowledge_pages WHERE branch = ? AND created_at > ?').run(branch, cutoff);
    rolledBack.knowledge_pages = delPages.changes;

    // 同时清理相关的快照（在回滚目标之后的快照也需要清理）
    db.prepare('DELETE FROM snapshots WHERE branch = ? AND created_at > ? AND id != ?').run(branch, cutoff, safetySnap.id);

    // 清理条件索引中的悬空引用
    db.prepare(`
      DELETE FROM condition_index WHERE memory_id NOT IN (
        SELECT id FROM experiences
        UNION SELECT id FROM world_facts
        UNION SELECT id FROM observations
        UNION SELECT id FROM mental_models
      )
    `).run();

    // 清理 FTS 索引中的悬空引用
    db.prepare(`
      DELETE FROM memory_fts WHERE memory_id NOT IN (
        SELECT id FROM experiences
        UNION SELECT id FROM world_facts
        UNION SELECT id FROM observations
        UNION SELECT id FROM mental_models
        UNION SELECT id FROM knowledge_pages
      )
    `).run();
  })();

  // 审计日志
  createAuditLog({
    action: 'rollback',
    target_type: 'snapshot',
    target_id: snapshotId,
    before_value: JSON.stringify({ safety_snapshot: safetySnap.id }),
    after_value: JSON.stringify(rolledBack),
    triggered_by: 'system',
  });

  const total = rolledBack.experiences + rolledBack.world_facts + rolledBack.observations + rolledBack.mental_models + rolledBack.knowledge_pages;
  log.info({ snapshotId, branch, totalRolledBack: total }, 'Rollback completed');

  return {
    target_snapshot_id: snapshotId,
    safety_snapshot_id: safetySnap.id,
    rolled_back: rolledBack,
  };
}
