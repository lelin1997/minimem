// ============================================================
// MiniMem — GC 恢复（未完成 run 继续）
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { runLightGC, runStandardGC, runDeepGC } from './index.js';
import type { GCType } from '../common/types.js';

const log = getLogger('lifecycle:recovery');

interface IncompleteGCRun {
  run_id: string;
  gc_type: GCType;
  created_at: string;
}

/**
 * 检查是否有未完成的 GC 任务
 *
 * 判断标准：GC 日志中 duration_ms = 0 的记录认为是中断的
 */
export function findIncompleteGCRuns(): IncompleteGCRun[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT run_id, gc_type, created_at
    FROM gc_log
    WHERE duration_ms = 0
    ORDER BY created_at DESC
    LIMIT 5
  `).all() as Array<{ run_id: string; gc_type: GCType; created_at: string }>;

  return rows;
}

/**
 * 恢复未完成的 GC
 *
 * 策略：
 * - 重新执行中断的 GC 类型
 * - 标记旧的未完成记录
 */
export function recoverGC(): {
  recovered: boolean;
  runs_found: number;
  action: 'rerun' | 'none';
} {
  const incomplete = findIncompleteGCRuns();

  if (incomplete.length === 0) {
    log.info('No incomplete GC runs found');
    return { recovered: true, runs_found: 0, action: 'none' };
  }

  log.info({ count: incomplete.length }, 'Found incomplete GC runs');

  // 标记旧记录
  const db = getDb();
  for (const run of incomplete) {
    db.prepare(
      'UPDATE gc_log SET duration_ms = -1 WHERE run_id = ? AND duration_ms = 0'
    ).run(run.run_id);
  }

  // 重新执行最近一次的 GC 类型
  const latest = incomplete[0];
  const hoursSince = (Date.now() - new Date(latest.created_at).getTime()) / (1000 * 60 * 60);

  if (hoursSince > 24) {
    log.info({ gcType: latest.gc_type }, 'Incomplete GC too old, skipping rerun');
    return { recovered: true, runs_found: incomplete.length, action: 'none' };
  }

  try {
    log.info({ gcType: latest.gc_type }, 'Re-running interrupted GC');

    switch (latest.gc_type) {
      case 'light':
      case 'temperature_decay':
        runLightGC();
        break;
      case 'standard':
        runStandardGC();
        break;
      case 'deep':
        runDeepGC();
        break;
      case 'emergency':
        runDeepGC(); // emergency 降级为 deep
        break;
    }

    return { recovered: true, runs_found: incomplete.length, action: 'rerun' };
  } catch (err) {
    log.error({ err }, 'GC recovery failed');
    return { recovered: false, runs_found: incomplete.length, action: 'rerun' };
  }
}
