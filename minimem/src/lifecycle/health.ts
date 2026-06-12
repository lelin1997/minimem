// ============================================================
// MiniMem — 健康监控
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { getVectorStore } from '../store/vectors.js';
import type { TemperatureLevel } from '../common/types.js';

const log = getLogger('lifecycle:health');

export interface HealthReport {
  status: 'healthy' | 'warning' | 'critical';
  layers: {
    L1: number;
    L2: number;
    L3: number;
    L4: number;
    knowledge_pages: number;
  };
  temperature_distribution: Record<TemperatureLevel, number>;
  storage: {
    total_memories: number;
    vector_count: number;
    graph_edges: number;
    fts_entries: number;
  };
  gc: {
    last_run: string | null;
    total_deleted: number;
    total_compressed: number;
  };
  dream: {
    last_dream: string | null;
    total_sessions: number;
  };
  alerts: HealthAlert[];
  checked_at: string;
}

export interface HealthAlert {
  level: 'info' | 'warning' | 'critical';
  message: string;
  metric: string;
  value: number;
  threshold: number;
}

/**
 * 全面健康检查
 */
export function checkHealth(): HealthReport {
  const db = getDb();
  const alerts: HealthAlert[] = [];

  // 1. 各层记忆数
  const layers = {
    L1: countTable(db, 'experiences'),
    L2: countTable(db, 'world_facts'),
    L3: countTable(db, 'observations'),
    L4: countTable(db, 'mental_models'),
    knowledge_pages: countTable(db, 'knowledge_pages'),
  };

  // 2. 温度分布
  const tempDist = db.prepare(`
    SELECT temperature, COUNT(*) as count
    FROM memory_temperature
    GROUP BY temperature
  `).all() as Array<{ temperature: TemperatureLevel; count: number }>;

  const temperature_distribution: Record<TemperatureLevel, number> = {
    hot: 0, warm: 0, cool: 0, cold: 0, frozen: 0,
  };
  for (const row of tempDist) {
    temperature_distribution[row.temperature] = row.count;
  }

  // 3. 存储统计
  const vectorStore = getVectorStore();
  const graphEdges = countTable(db, 'memory_links');
  const ftsEntries = (db.prepare('SELECT COUNT(*) as count FROM memory_fts').get() as { count: number }).count;

  const storage = {
    total_memories: layers.L1 + layers.L2 + layers.L3 + layers.L4,
    vector_count: vectorStore.size,
    graph_edges: graphEdges,
    fts_entries: ftsEntries,
  };

  // 4. GC 统计
  const lastGC = db.prepare(
    'SELECT created_at FROM gc_log ORDER BY created_at DESC LIMIT 1'
  ).get() as { created_at: string } | undefined;

  const gcStats = db.prepare(`
    SELECT COALESCE(SUM(deleted), 0) as total_deleted,
           COALESCE(SUM(compressed), 0) as total_compressed
    FROM gc_log
  `).get() as { total_deleted: number; total_compressed: number };

  // 5. Dream 统计
  const lastDream = db.prepare(
    'SELECT created_at FROM dream_logs WHERE phase = 4 ORDER BY created_at DESC LIMIT 1'
  ).get() as { created_at: string } | undefined;

  const dreamCount = (db.prepare(
    'SELECT COUNT(DISTINCT session_id) as count FROM dream_logs'
  ).get() as { count: number }).count;

  // 6. 告警检测
  // frozen 过多告警
  if (temperature_distribution.frozen > storage.total_memories * 0.5) {
    alerts.push({
      level: 'warning',
      message: '超过 50% 的记忆处于 frozen 状态，建议执行深度 GC',
      metric: 'frozen_ratio',
      value: temperature_distribution.frozen,
      threshold: storage.total_memories * 0.5,
    });
  }

  // 向量索引与记忆数量不匹配
  if (storage.vector_count < storage.total_memories * 0.5 && storage.total_memories > 10) {
    alerts.push({
      level: 'warning',
      message: '向量索引覆盖率偏低，可能影响语义检索',
      metric: 'vector_coverage',
      value: storage.vector_count,
      threshold: storage.total_memories * 0.5,
    });
  }

  // 长时间未做梦
  if (lastDream) {
    const hoursSinceDream = (Date.now() - new Date(lastDream.created_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceDream > 72) {
      alerts.push({
        level: 'info',
        message: `已超过 ${Math.round(hoursSinceDream)} 小时未做梦`,
        metric: 'hours_since_dream',
        value: hoursSinceDream,
        threshold: 72,
      });
    }
  }

  // L1 积压过多未处理
  const unprocessedL1 = (db.prepare(`
    SELECT COUNT(*) as count FROM experiences
    WHERE branch = 'main' AND id NOT IN (
      SELECT DISTINCT json_each.value
      FROM world_facts, json_each(evidence_experience_ids)
    )
  `).get() as { count: number }).count;

  if (unprocessedL1 > 100) {
    alerts.push({
      level: 'warning',
      message: `有 ${unprocessedL1} 条 L1 经历尚未被加工`,
      metric: 'unprocessed_l1',
      value: unprocessedL1,
      threshold: 100,
    });
  }

  const status: HealthReport['status'] = alerts.some(a => a.level === 'critical')
    ? 'critical'
    : alerts.some(a => a.level === 'warning')
      ? 'warning'
      : 'healthy';

  const report: HealthReport = {
    status,
    layers,
    temperature_distribution,
    storage,
    gc: {
      last_run: lastGC?.created_at ?? null,
      total_deleted: gcStats.total_deleted,
      total_compressed: gcStats.total_compressed,
    },
    dream: {
      last_dream: lastDream?.created_at ?? null,
      total_sessions: dreamCount,
    },
    alerts,
    checked_at: new Date().toISOString(),
  };

  log.info({ status, alerts: alerts.length }, 'Health check completed');
  return report;
}

function countTable(db: ReturnType<typeof getDb>, table: string): number {
  return (db.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get() as { count: number }).count;
}
