// ============================================================
// MiniMem — 版本控制：Diff 对比
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import type { Snapshot } from '../common/types.js';
import { getSnapshotById } from './snapshot.js';
import { NotFoundError } from '../common/errors.js';

const log = getLogger('version:diff');

export interface MemoryDiff {
  snapshot_a: { id: string; label: string; created_at: string };
  snapshot_b: { id: string; label: string; created_at: string };
  changes: {
    l1: LayerDiff;
    l2: LayerDiff;
    l3: LayerDiff;
    l4: LayerDiff;
    pages: LayerDiff;
  };
  summary: string;
  significance: number; // 0-1
}

export interface LayerDiff {
  before: number;
  after: number;
  delta: number;
  added_ids: string[];
  removed_ids: string[];
  modified_ids: string[]; // R-019: 内容变化的记忆
}

/**
 * 对比两个快照之间的差异
 * 
 * 使用 snapshot 的创建时间作为时间边界进行差异分析：
 * - added: 在 snapshot_b 之后但 snapshot_a 之前不存在的记忆
 * - removed: 在 snapshot_a 时存在但 snapshot_b 时不存在的记忆
 */
export function diffSnapshots(snapshotAId: string, snapshotBId: string): MemoryDiff {
  const snapA = getSnapshotById(snapshotAId);
  const snapB = getSnapshotById(snapshotBId);

  if (!snapA || !snapB) {
    throw new NotFoundError('snapshot', !snapA ? snapshotAId : snapshotBId);
  }

  // 确保 A 在 B 之前
  const [earlier, later] = snapA.created_at <= snapB.created_at ? [snapA, snapB] : [snapB, snapA];

  const db = getDb();
  const branch = earlier.branch; // 假设同一分支

  // 计算各层差异
  const l1Diff = computeLayerDiff(db, 'experiences', branch, earlier.created_at, later.created_at, earlier.stats_l1, later.stats_l1);
  const l2Diff = computeLayerDiff(db, 'world_facts', branch, earlier.created_at, later.created_at, earlier.stats_l2, later.stats_l2);
  const l3Diff = computeLayerDiff(db, 'observations', branch, earlier.created_at, later.created_at, earlier.stats_l3, later.stats_l3);
  const l4Diff = computeLayerDiff(db, 'mental_models', branch, earlier.created_at, later.created_at, earlier.stats_l4, later.stats_l4);
  const pagesDiff = computeLayerDiff(db, 'knowledge_pages', branch, earlier.created_at, later.created_at, earlier.stats_pages, later.stats_pages);

  // 计算显著程度
  const totalBefore = earlier.stats_l1 + earlier.stats_l2 + earlier.stats_l3 + earlier.stats_l4 + earlier.stats_pages;
  const totalAfter = later.stats_l1 + later.stats_l2 + later.stats_l3 + later.stats_l4 + later.stats_pages;
  const totalChanges = Math.abs(l1Diff.delta) + Math.abs(l2Diff.delta) + Math.abs(l3Diff.delta) + Math.abs(l4Diff.delta) + Math.abs(pagesDiff.delta)
    + l1Diff.modified_ids.length + l2Diff.modified_ids.length + l3Diff.modified_ids.length + l4Diff.modified_ids.length + pagesDiff.modified_ids.length;
  const base = Math.max(totalBefore, totalAfter, 1);
  const significance = Math.min(1, totalChanges / base);

  // 生成摘要
  const summary = generateDiffSummary(l1Diff, l2Diff, l3Diff, l4Diff, pagesDiff, earlier, later);

  const diff: MemoryDiff = {
    snapshot_a: { id: earlier.id, label: earlier.label, created_at: earlier.created_at },
    snapshot_b: { id: later.id, label: later.label, created_at: later.created_at },
    changes: { l1: l1Diff, l2: l2Diff, l3: l3Diff, l4: l4Diff, pages: pagesDiff },
    summary,
    significance,
  };

  log.info({ snapA: snapshotAId, snapB: snapshotBId, significance: significance.toFixed(2) }, 'Diff computed');
  return diff;
}

// ── 内部工具 ──

function computeLayerDiff(
  db: ReturnType<typeof getDb>,
  table: string,
  branch: string,
  timeA: string,
  timeB: string,
  countBefore: number,
  countAfter: number,
): LayerDiff {
  // 在两个快照时间之间新增的记忆
  const added = db.prepare(
    `SELECT id FROM ${table} WHERE branch = ? AND created_at > ? AND created_at <= ?`
  ).all(branch, timeA, timeB) as Array<{ id: string }>;

  // 在时间 A 之前存在但已不存在的（通过墓碑记录查找）
  const removed = db.prepare(
    `SELECT original_id as id FROM memory_tombstones WHERE created_at > ? AND created_at <= ?`
  ).all(timeA, timeB) as Array<{ id: string }>;

  // R-019: 检测修改的记忆（created_at 在 A 之前，updated_at 在 A 和 B 之间）
  const modified = db.prepare(
    `SELECT id FROM ${table} WHERE branch = ? AND created_at <= ? AND updated_at > ? AND updated_at <= ?`
  ).all(branch, timeA, timeA, timeB) as Array<{ id: string }>;

  return {
    before: countBefore,
    after: countAfter,
    delta: countAfter - countBefore,
    added_ids: added.map(r => r.id),
    removed_ids: removed.map(r => r.id),
    modified_ids: modified.map(r => r.id),
  };
}

function generateDiffSummary(
  l1: LayerDiff, l2: LayerDiff, l3: LayerDiff, l4: LayerDiff, pages: LayerDiff,
  earlier: Snapshot, later: Snapshot,
): string {
  const parts: string[] = [];

  parts.push(`从 "${earlier.label}" 到 "${later.label}" 的变化：`);

  if (l1.delta !== 0) parts.push(`  L1 经历: ${l1.delta > 0 ? '+' : ''}${l1.delta} (${l1.before} → ${l1.after})`);
  if (l2.delta !== 0) parts.push(`  L2 事实: ${l2.delta > 0 ? '+' : ''}${l2.delta} (${l2.before} → ${l2.after})`);
  if (l3.delta !== 0) parts.push(`  L3 观察: ${l3.delta > 0 ? '+' : ''}${l3.delta} (${l3.before} → ${l3.after})`);
  if (l4.delta !== 0) parts.push(`  L4 模型: ${l4.delta > 0 ? '+' : ''}${l4.delta} (${l4.before} → ${l4.after})`);
  if (pages.delta !== 0) parts.push(`  知识页面: ${pages.delta > 0 ? '+' : ''}${pages.delta} (${pages.before} → ${pages.after})`);

  if (parts.length === 1) parts.push('  无变化');

  return parts.join('\n');
}
