// ============================================================
// MiniMem — Time Signal (MINIMEM-006 T-H01.4)
// ============================================================
// 时间信号：解析时间表达式 + 近期记忆加权

import { getLogger } from '../../common/logger.js';
import { getDb } from '../../store/database.js';
import type { MemoryLayer } from '../../common/types.js';
import type { SignalResult } from '../types.js';

const log = getLogger('recall:signal:time');

/**
 * 时间信号：
 * - 有明确时间表达时：过滤对应时间范围的记忆
 * - 无时间表达时：近 7 天的记忆微弱加权
 */
export function computeTimeSignal(
  message: string,
  candidateIds?: string[],
  topK: number = 10,
  domain?: string,
): SignalResult[] {
  const timeRange = parseTimeExpression(message);
  const db = getDb();
  const results: SignalResult[] = [];

  try {
    if (timeRange) {
      // 有时间信号：查找时间范围内的记忆
      results.push(...queryByTimeRange(db, timeRange.from, timeRange.to, topK, domain));
    } else {
      // 无时间信号：对近 7 天记忆轻微加权（只在有候选 ID 时给分）
      if (candidateIds && candidateIds.length > 0) {
        results.push(...boostRecentMemories(db, candidateIds));
      }
    }
  } catch (err) {
    log.warn({ err }, 'Time signal computation failed');
  }

  return results.slice(0, topK);
}

// ── 时间表达式解析 ──

interface TimeRange {
  from: string;
  to: string;
}

/**
 * 解析用户消息中的时间表达式
 * 支持中文和英文常见时间表达
 */
function parseTimeExpression(message: string): TimeRange | null {
  const now = new Date();

  // "之前" / "上次" / "以前" — 模糊过去，默认 30 天
  if (/之前|上次|以前|previously|last\s*time|before/i.test(message)) {
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: now.toISOString() };
  }

  // "昨天"
  if (/昨天|yesterday/i.test(message)) {
    const from = new Date(now);
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setHours(23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  // "上周"
  if (/上周|上个星期|last\s*week/i.test(message)) {
    const from = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  // "N天前" / "N days ago"
  const daysAgoMatch = message.match(/(\d+)\s*(天前|天以前|days?\s*ago)/i);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1], 10);
    const from = new Date(now.getTime() - (days + 1) * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  // "最近" / "recently" — 7 天内
  if (/最近|近期|recently|recent/i.test(message)) {
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: now.toISOString() };
  }

  // "N周前" / "N weeks ago"
  const weeksAgoMatch = message.match(/(\d+)\s*(周前|星期前|weeks?\s*ago)/i);
  if (weeksAgoMatch) {
    const weeks = parseInt(weeksAgoMatch[1], 10);
    const from = new Date(now.getTime() - (weeks + 1) * 7 * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() - (weeks - 1) * 7 * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  return null;
}

/**
 * 按时间范围查询记忆
 */
function queryByTimeRange(
  db: ReturnType<typeof getDb>,
  from: string,
  to: string,
  limit: number,
  domain?: string,
): SignalResult[] {
  const results: SignalResult[] = [];
  const domainCondition = domain ? ' AND domain = ?' : '';
  const domainValues = domain ? [domain] : [];
  const perLayerLimit = Math.ceil(limit / 3);

  // L2: world_facts
  const l2Rows = db.prepare(
    `SELECT id, confidence FROM world_facts WHERE branch = 'main' AND created_at >= ? AND created_at <= ?${domainCondition} ORDER BY confidence DESC LIMIT ?`
  ).all(from, to, ...domainValues, perLayerLimit) as Array<{ id: string; confidence: number }>;
  for (const row of l2Rows) {
    results.push({ memory_id: row.id, score: Math.min(1, row.confidence * 0.9), source: 'time', layer: 'L2' });
  }

  // L3: observations
  const l3Rows = db.prepare(
    `SELECT id, confidence FROM observations WHERE branch = 'main' AND created_at >= ? AND created_at <= ?${domainCondition} ORDER BY confidence DESC LIMIT ?`
  ).all(from, to, ...domainValues, perLayerLimit) as Array<{ id: string; confidence: number }>;
  for (const row of l3Rows) {
    results.push({ memory_id: row.id, score: Math.min(1, row.confidence * 0.9), source: 'time', layer: 'L3' });
  }

  // L1: experiences（按 importance 排序）
  const l1Rows = db.prepare(
    `SELECT id, importance FROM experiences WHERE branch = 'main' AND created_at >= ? AND created_at <= ?${domainCondition} ORDER BY importance DESC LIMIT ?`
  ).all(from, to, ...domainValues, perLayerLimit) as Array<{ id: string; importance: number }>;
  for (const row of l1Rows) {
    results.push({ memory_id: row.id, score: Math.min(1, row.importance * 0.7), source: 'time', layer: 'L1' });
  }

  return results;
}

/**
 * 对近 7 天的候选记忆微弱加权
 */
function boostRecentMemories(
  db: ReturnType<typeof getDb>,
  candidateIds: string[],
): SignalResult[] {
  const results: SignalResult[] = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 检查候选 ID 中哪些是近 7 天的
  const tables: Array<{ table: string; layer: MemoryLayer }> = [
    { table: 'experiences', layer: 'L1' },
    { table: 'world_facts', layer: 'L2' },
    { table: 'observations', layer: 'L3' },
  ];

  for (const { table, layer } of tables) {
    if (candidateIds.length === 0) break;
    const placeholders = candidateIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id FROM "${table}" WHERE id IN (${placeholders}) AND created_at >= ?`
    ).all(...candidateIds, sevenDaysAgo) as Array<{ id: string }>;

    for (const row of rows) {
      results.push({
        memory_id: row.id,
        score: 0.1, // 微弱加权
        source: 'time',
        layer,
      });
    }
  }

  return results;
}
