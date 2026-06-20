// ============================================================
// MiniMem — Dream Engine: Phase 4 — 清理 & 报告
// ============================================================

import { getLogger } from '../../common/logger.js';
import { runStandardGC } from '../../domain/lifecycle/index.js';
import { processUpdateQueue, getSurfaceFile } from '../../domain/surface/index.js';
import { syncSurfaces } from '../../domain/surface/sync.js';
import { createSnapshot } from '../../domain/version/snapshot.js';
import { diffSnapshots } from '../../domain/version/diff.js';
import { mergeBranch } from '../../domain/version/merge.js';
import { deactivateBranch } from '../../domain/version/branch.js';
import type { MemoryDiff } from '../../domain/version/diff.js';
import type { MergeResult } from '../../domain/version/merge.js';
import type { SurfaceFileName } from '../../common/types.js';

const log = getLogger('dream:cleaner');

/** TODO-027: Surface 变更记录（哪个文件改了，版本从几到几） */
export interface SurfaceChange {
  file_name: string;
  changed: boolean;
  version_before: number;
  version_after: number;
}

export interface CleanupResult {
  gc_deleted: number;
  gc_compressed: number;
  surface_synced: number;
  surface_updates: number;
  surface_changes: SurfaceChange[];
  post_snapshot_id: string;
  diff: MemoryDiff | null;
  merge: MergeResult | null;
}

/**
 * Phase 4: 清醒 — 清理与报告
 *
 * @param preSnapshotId - 做梦前快照 ID
 * @param dreamBranch - 做梦分支名
 * @param surfaceFiles - 需要更新的 Surface Files 列表（由 DreamProfile 控制）
 */
export async function runCleanup(
  preSnapshotId: string,
  dreamBranch: string,
  surfaceFiles?: SurfaceFileName[],
): Promise<CleanupResult> {
  log.info({ preSnapshotId, dreamBranch, surfaceFiles }, 'Phase 4: Cleanup started');

  // 1. 执行标准 GC
  const gcResult = runStandardGC();
  log.info({ deleted: gcResult.deleted, compressed: gcResult.compressed }, 'GC completed');

  // 2. Surface Sync（Issue-23: 从业务模块自动收集数据，写入 surface_update_queue）
  // TODO-027: 记录 sync 前各文件版本，用于检测变更
  const filesToTrack = surfaceFiles ?? [];
  const versionBefore = new Map<string, number>();
  for (const fn of filesToTrack) {
    const f = getSurfaceFile(fn);
    if (f) versionBefore.set(fn, f.version);
  }

  let surfaceSynced = 0;
  if (surfaceFiles && surfaceFiles.length > 0) {
    try {
      surfaceSynced = await syncSurfaces(surfaceFiles);
      log.info({ surfaceSynced, files: surfaceFiles }, 'Surface sync completed');
    } catch (err) {
      log.warn({ err }, 'Surface sync failed');
    }
  }

  // 3. 消费 surface_update_queue（处理 Sync + Agent suggest 产生的更新）
  // 如果指定了 surfaceFiles 列表，只更新这些文件；否则处理全部队列
  let surfaceUpdates = 0;
  try {
    surfaceUpdates = await processUpdateQueue(surfaceFiles);
    log.info({ surfaceUpdates, scope: surfaceFiles ?? 'all' }, 'Surface files updated');
  } catch (err) {
    log.warn({ err }, 'Surface update failed');
  }

  // TODO-027: 收集实际被更新的文件列表（比较版本号）
  const surfaceChanges: SurfaceChange[] = [];
  for (const fn of filesToTrack) {
    const vBefore = versionBefore.get(fn) ?? 0;
    const fAfter = getSurfaceFile(fn);
    const vAfter = fAfter?.version ?? 0;
    surfaceChanges.push({
      file_name: fn,
      changed: vAfter > vBefore,
      version_before: vBefore,
      version_after: vAfter,
    });
  }

  // 4. 创建做梦后快照
  const postSnapshot = createSnapshot({
    label: `post-dream-${new Date().toISOString().slice(0, 10)}`,
    trigger: 'dream',
    branch: 'main',
  });

  // 5. Diff 对比
  let diff: MemoryDiff | null = null;
  try {
    diff = diffSnapshots(preSnapshotId, postSnapshot.id);
    log.info({
      significance: diff.significance,
      summary: diff.summary.slice(0, 200),
    }, 'Dream diff computed');
  } catch (err) {
    log.warn({ err }, 'Diff computation failed');
  }

  // 6. 合并 dream 分支到 main
  let mergeResult: MergeResult | null = null;
  try {
    mergeResult = mergeBranch(dreamBranch, 'main');
    log.info({
      merged: mergeResult.merged,
      conflicts: mergeResult.conflicts,
    }, 'Dream branch merged to main');
  } catch (err) {
    log.warn({ err }, 'Branch merge failed (may be empty branch)');
  }

  // 7. 清理 dream 分支
  try {
    deactivateBranch(dreamBranch);
    log.debug({ branch: dreamBranch }, 'Dream branch deactivated');
  } catch (err) {
    log.warn({ err }, 'Branch deactivation failed');
  }

  const result: CleanupResult = {
    gc_deleted: gcResult.deleted,
    gc_compressed: gcResult.compressed,
    surface_synced: surfaceSynced,
    surface_updates: surfaceUpdates,
    surface_changes: surfaceChanges,
    post_snapshot_id: postSnapshot.id,
    diff,
    merge: mergeResult,
  };

  log.info(result, 'Phase 4: Cleanup complete');
  return result;
}
