// ============================================================
// MiniMem — 做梦恢复（从 checkpoint 继续未完成的 session）
// ============================================================

import { getDb } from '../../store/database.js';
import { getLogger } from '../../common/logger.js';
import { triggerDream } from './dream-engine.js';

const log = getLogger('dream:recovery');

interface DreamCheckpoint {
  session_id: string;
  last_phase: number;
  pre_snapshot_id: string;
  created_at: string;
}

/**
 * 检查是否有未完成的做梦 session
 */
export function findIncompleteDreamSessions(): DreamCheckpoint[] {
  const db = getDb();

  // 找到有 checkpoint 但没有 phase=4 完成记录的 session
  const rows = db.prepare(`
    SELECT session_id, MAX(phase) as last_phase, pre_snapshot_id, MAX(created_at) as created_at
    FROM dream_logs
    WHERE session_id NOT IN (
      SELECT session_id FROM dream_logs WHERE phase = 4 AND narrative LIKE '%completed%'
    )
    GROUP BY session_id
    HAVING last_phase < 4
    ORDER BY created_at DESC
    LIMIT 5
  `).all() as Array<{
    session_id: string;
    last_phase: number;
    pre_snapshot_id: string;
    created_at: string;
  }>;

  return rows.map(r => ({
    session_id: r.session_id,
    last_phase: r.last_phase,
    pre_snapshot_id: r.pre_snapshot_id,
    created_at: r.created_at,
  }));
}

/**
 * 恢复未完成的做梦 session
 *
 * 策略：
 * - 从上次完成的 phase + 1 继续
 * - 如果距离上次做梦超过 24 小时，放弃恢复，启动新的做梦
 */
export async function recoverDreamSession(): Promise<{
  recovered: boolean;
  session_id: string | null;
  action: 'resumed' | 'abandoned' | 'none';
}> {
  const incomplete = findIncompleteDreamSessions();

  if (incomplete.length === 0) {
    log.info('No incomplete dream sessions found');
    return { recovered: true, session_id: null, action: 'none' };
  }

  const latest = incomplete[0];
  const hoursSince = (Date.now() - new Date(latest.created_at).getTime()) / (1000 * 60 * 60);

  log.info({
    sessionId: latest.session_id,
    lastPhase: latest.last_phase,
    hoursSince: Math.round(hoursSince),
  }, 'Found incomplete dream session');

  if (hoursSince > 24) {
    // 放弃恢复
    log.info({ sessionId: latest.session_id }, 'Dream session too old, abandoning');
    markSessionAbandoned(latest.session_id);
    return { recovered: true, session_id: latest.session_id, action: 'abandoned' };
  }

  // 从断点继续
  const remainingPhases = [];
  for (let p = latest.last_phase + 1; p <= 4; p++) {
    remainingPhases.push(p);
  }

  // R-023: 验证 dream 分支数据完整性
  try {
    const db = getDb();
    const dreamBranch = `dream-${latest.session_id.slice(0, 8)}`;
    const branchExists = db.prepare('SELECT 1 FROM branches WHERE name = ? AND is_active = 1').get(dreamBranch);
    if (!branchExists) {
      log.warn({ sessionId: latest.session_id, dreamBranch }, 'Dream branch not found or inactive, abandoning');
      markSessionAbandoned(latest.session_id);
      return { recovered: true, session_id: latest.session_id, action: 'abandoned' };
    }

    // 验证 pre_snapshot 是否存在
    const snapshotExists = db.prepare('SELECT 1 FROM snapshots WHERE id = ?').get(latest.pre_snapshot_id);
    if (!snapshotExists) {
      log.warn({ sessionId: latest.session_id }, 'Pre-dream snapshot missing, abandoning');
      markSessionAbandoned(latest.session_id);
      return { recovered: true, session_id: latest.session_id, action: 'abandoned' };
    }
  } catch (err) {
    log.warn({ err, sessionId: latest.session_id }, 'Dream branch consistency check failed, abandoning');
    markSessionAbandoned(latest.session_id);
    return { recovered: true, session_id: latest.session_id, action: 'abandoned' };
  }

  log.info({
    sessionId: latest.session_id,
    remainingPhases,
  }, 'Resuming dream from checkpoint');

  try {
    await triggerDream({ mode: 'daily', phases: remainingPhases });
    return { recovered: true, session_id: latest.session_id, action: 'resumed' };
  } catch (err) {
    log.error({ err, sessionId: latest.session_id }, 'Dream recovery failed');
    return { recovered: false, session_id: latest.session_id, action: 'resumed' };
  }
}

function markSessionAbandoned(sessionId: string): void {
  const db = getDb();
  try {
    db.prepare(`
      UPDATE dream_logs SET narrative = narrative || ' [ABANDONED]'
      WHERE session_id = ? AND phase = (SELECT MAX(phase) FROM dream_logs WHERE session_id = ?)
    `).run(sessionId, sessionId);
  } catch {
    // 忽略
  }
}
