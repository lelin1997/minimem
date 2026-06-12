// ============================================================
// MiniMem — Prometheus 指标导出 (REQ-015 / TODO-019)
// ============================================================
// 将核心运行指标序列化为 Prometheus text format，
// 供 `/metrics` 端点暴露给外部监控系统采集。

import { getDb } from '../store/database.js';
import { getVectorStore } from '../store/vectors.js';
import { getLogger } from '../common/logger.js';
import type { TemperatureLevel } from '../common/types.js';

const log = getLogger('observability:metrics');

// ── 指标类型 ──

type MetricType = 'gauge' | 'counter' | 'histogram';

interface MetricDefinition {
  name: string;
  help: string;
  type: MetricType;
}

interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

// ── 指标定义 ──

const METRIC_DEFS: MetricDefinition[] = [
  // 记忆层统计
  { name: 'minimem_memories_total', help: 'Total number of memories by layer', type: 'gauge' },
  { name: 'minimem_knowledge_pages_total', help: 'Total number of knowledge pages', type: 'gauge' },

  // 温度分布
  { name: 'minimem_temperature_distribution', help: 'Memory count by temperature level', type: 'gauge' },

  // 存储指标
  { name: 'minimem_vector_entries_total', help: 'Total entries in vector store', type: 'gauge' },
  { name: 'minimem_graph_edges_total', help: 'Total edges in knowledge graph', type: 'gauge' },
  { name: 'minimem_fts_entries_total', help: 'Total entries in FTS5 index', type: 'gauge' },

  // GC 指标
  { name: 'minimem_gc_deleted_total', help: 'Total memories deleted by GC', type: 'counter' },
  { name: 'minimem_gc_compressed_total', help: 'Total memories compressed by GC', type: 'counter' },
  { name: 'minimem_gc_last_run_timestamp', help: 'Timestamp of last GC run', type: 'gauge' },

  // Dream 指标
  { name: 'minimem_dream_sessions_total', help: 'Total dream sessions executed', type: 'counter' },
  { name: 'minimem_dream_last_run_timestamp', help: 'Timestamp of last dream session', type: 'gauge' },
  { name: 'minimem_dream_last_duration_ms', help: 'Duration of last dream session in ms', type: 'gauge' },
  { name: 'minimem_dream_l1_to_l2_total', help: 'Total L1→L2 compilations across all dreams', type: 'counter' },
  { name: 'minimem_dream_l2_to_l3_total', help: 'Total L2→L3 distillations across all dreams', type: 'counter' },
  { name: 'minimem_dream_l3_to_l4_total', help: 'Total L3→L4 promotions across all dreams', type: 'counter' },

  // Embedding 队列
  { name: 'minimem_embedding_queue_depth', help: 'Pending items in embedding backfill queue', type: 'gauge' },

  // 编译队列
  { name: 'minimem_compile_queue_depth', help: 'Pending items in compile queue', type: 'gauge' },

  // 检索指标（从 access_log 统计）
  { name: 'minimem_search_requests_total', help: 'Total search requests', type: 'counter' },

  // 信念漂移 (TODO-017)
  { name: 'minimem_drift_risk_observations', help: 'Number of observations with drift risk', type: 'gauge' },

  // LLM 缓存
  { name: 'minimem_llm_cache_entries', help: 'Total entries in LLM cache', type: 'gauge' },
  { name: 'minimem_llm_cache_hits_total', help: 'Total LLM cache hits', type: 'counter' },

  // Schema 版本
  { name: 'minimem_schema_version', help: 'Current database schema version', type: 'gauge' },

  // MINIMEM-006: Recall 指标 (T-H07.1 / T-H07.2)
  { name: 'minimem_recall_hints_requests_total', help: 'Total recall hints requests', type: 'counter' },
  { name: 'minimem_recall_auto_requests_total', help: 'Total recall auto requests', type: 'counter' },
  { name: 'minimem_recall_hints_returned_total', help: 'Total hints returned across all requests', type: 'counter' },
  { name: 'minimem_recall_hints_skipped_total', help: 'Total skipped hint requests by reason', type: 'counter' },
  { name: 'minimem_recall_signal_calls_total', help: 'Total signal computations by type', type: 'counter' },
  { name: 'minimem_recall_signal_failures_total', help: 'Total signal failures by type', type: 'counter' },
  { name: 'minimem_recall_signal_avg_duration_ms', help: 'Average signal duration in ms by type', type: 'gauge' },
  { name: 'minimem_recall_cache_hits_total', help: 'Total cache hits by level', type: 'counter' },
  { name: 'minimem_recall_avg_latency_ms', help: 'Average recall hints latency in ms', type: 'gauge' },
  { name: 'minimem_recall_max_latency_ms', help: 'Max recall hints latency in ms', type: 'gauge' },
];

// ── 核心导出函数 ──

/**
 * 收集所有指标并序列化为 Prometheus text format
 *
 * @returns Prometheus exposition format 文本
 */
export async function collectMetrics(): Promise<string> {
  const samples: MetricSample[] = [];

  try {
    const db = getDb();

    // 记忆层统计
    const layerMap: Record<string, string> = {
      L1: 'experiences', L2: 'world_facts', L3: 'observations', L4: 'mental_models',
    };
    for (const [layer, table] of Object.entries(layerMap)) {
      const count = safeCount(db, `SELECT COUNT(*) as count FROM "${table}" WHERE branch = 'main'`);
      samples.push({ name: 'minimem_memories_total', labels: { layer }, value: count });
    }

    // Knowledge Pages
    samples.push({
      name: 'minimem_knowledge_pages_total',
      labels: {},
      value: safeCount(db, "SELECT COUNT(*) as count FROM knowledge_pages WHERE branch = 'main'"),
    });

    // 温度分布
    const tempDist = safePrepare<{ temperature: TemperatureLevel; count: number }>(db, `
      SELECT temperature, COUNT(*) as count FROM memory_temperature GROUP BY temperature
    `);
    const levels: TemperatureLevel[] = ['hot', 'warm', 'cool', 'cold', 'frozen'];
    const tempMap = new Map(tempDist.map(t => [t.temperature, t.count]));
    for (const level of levels) {
      samples.push({
        name: 'minimem_temperature_distribution',
        labels: { level },
        value: tempMap.get(level) ?? 0,
      });
    }

    // 存储指标
    try {
      const vectorStore = getVectorStore();
      samples.push({ name: 'minimem_vector_entries_total', labels: {}, value: vectorStore.size });
    } catch {
      samples.push({ name: 'minimem_vector_entries_total', labels: {}, value: 0 });
    }

    samples.push({
      name: 'minimem_graph_edges_total',
      labels: {},
      value: safeCount(db, 'SELECT COUNT(*) as count FROM memory_links'),
    });

    samples.push({
      name: 'minimem_fts_entries_total',
      labels: {},
      value: safeCount(db, 'SELECT COUNT(*) as count FROM memory_fts'),
    });

    // GC 指标
    const gcStats = safePrepareOne<{ total_deleted: number; total_compressed: number }>(db, `
      SELECT COALESCE(SUM(deleted), 0) as total_deleted, COALESCE(SUM(compressed), 0) as total_compressed FROM gc_log
    `);
    samples.push({ name: 'minimem_gc_deleted_total', labels: {}, value: gcStats?.total_deleted ?? 0 });
    samples.push({ name: 'minimem_gc_compressed_total', labels: {}, value: gcStats?.total_compressed ?? 0 });

    const lastGC = safePrepareOne<{ created_at: string }>(db, 'SELECT created_at FROM gc_log ORDER BY created_at DESC LIMIT 1');
    samples.push({
      name: 'minimem_gc_last_run_timestamp',
      labels: {},
      value: lastGC ? new Date(lastGC.created_at).getTime() / 1000 : 0,
    });

    // Dream 指标
    const dreamCount = safeCount(db, 'SELECT COUNT(DISTINCT session_id) as count FROM dream_logs');
    samples.push({ name: 'minimem_dream_sessions_total', labels: {}, value: dreamCount });

    const lastDream = safePrepareOne<{ created_at: string; duration_ms: number }>(db,
      'SELECT created_at, duration_ms FROM dream_logs WHERE phase = 4 ORDER BY created_at DESC LIMIT 1'
    );
    samples.push({
      name: 'minimem_dream_last_run_timestamp',
      labels: {},
      value: lastDream ? new Date(lastDream.created_at).getTime() / 1000 : 0,
    });
    samples.push({
      name: 'minimem_dream_last_duration_ms',
      labels: {},
      value: lastDream?.duration_ms ?? 0,
    });

    // Dream 编译统计汇总
    const dreamCompileStats = safePrepareOne<{
      total_l1_l2: number; total_l2_l3: number; total_l3_l4: number;
    }>(db, `
      SELECT COALESCE(SUM(l1_to_l2), 0) as total_l1_l2,
             COALESCE(SUM(l2_to_l3), 0) as total_l2_l3,
             COALESCE(SUM(l3_to_l4), 0) as total_l3_l4
      FROM dream_logs WHERE phase = 4
    `);
    samples.push({ name: 'minimem_dream_l1_to_l2_total', labels: {}, value: dreamCompileStats?.total_l1_l2 ?? 0 });
    samples.push({ name: 'minimem_dream_l2_to_l3_total', labels: {}, value: dreamCompileStats?.total_l2_l3 ?? 0 });
    samples.push({ name: 'minimem_dream_l3_to_l4_total', labels: {}, value: dreamCompileStats?.total_l3_l4 ?? 0 });

    // Embedding 队列深度
    samples.push({
      name: 'minimem_embedding_queue_depth',
      labels: {},
      value: safeCount(db, "SELECT COUNT(*) as count FROM compile_queue WHERE source_type = 'embedding_backfill' AND status = 'pending'"),
    });

    // 编译队列深度
    samples.push({
      name: 'minimem_compile_queue_depth',
      labels: {},
      value: safeCount(db, "SELECT COUNT(*) as count FROM compile_queue WHERE status = 'pending'"),
    });

    // 检索请求总数（通过 access_log 统计 search_memory 调用）
    samples.push({
      name: 'minimem_search_requests_total',
      labels: {},
      value: safeCount(db, "SELECT COUNT(*) as count FROM access_log WHERE tool_name = 'search_memory'"),
    });

    // 信念漂移
    samples.push({
      name: 'minimem_drift_risk_observations',
      labels: {},
      value: safeCount(db, "SELECT COUNT(*) as count FROM observations WHERE branch = 'main' AND drift_risk = 1"),
    });

    // LLM 缓存
    samples.push({
      name: 'minimem_llm_cache_entries',
      labels: {},
      value: safeCount(db, 'SELECT COUNT(*) as count FROM llm_cache'),
    });
    const cacheHits = safePrepareOne<{ total_hits: number }>(db,
      'SELECT COALESCE(SUM(hit_count), 0) as total_hits FROM llm_cache'
    );
    samples.push({
      name: 'minimem_llm_cache_hits_total',
      labels: {},
      value: cacheHits?.total_hits ?? 0,
    });

    // Schema 版本
    const schemaRow = safePrepareOne<{ value: string }>(db,
      "SELECT value FROM _meta WHERE key = 'schema_version'"
    );
    samples.push({
      name: 'minimem_schema_version',
      labels: {},
      value: parseInt(schemaRow?.value ?? '0', 10),
    });

    // MINIMEM-006: Recall 指标 (T-H07.1 / T-H07.2)
    try {
      const { getRecallMetrics } = await import('../recall/metrics.js');
      const recall = getRecallMetrics();

      // 请求级指标
      samples.push({ name: 'minimem_recall_hints_requests_total', labels: {}, value: recall.hints_requests_total });
      samples.push({ name: 'minimem_recall_auto_requests_total', labels: {}, value: recall.auto_requests_total });
      samples.push({ name: 'minimem_recall_hints_returned_total', labels: {}, value: recall.hints_returned_sum });

      // 按 status 分标签
      for (const [status, count] of Object.entries(recall.hints_requests_by_status)) {
        if (count > 0) {
          samples.push({ name: 'minimem_recall_hints_requests_total', labels: { status }, value: count });
        }
      }

      // 跳过指标
      for (const [reason, count] of Object.entries(recall.skipped_by_reason)) {
        samples.push({ name: 'minimem_recall_hints_skipped_total', labels: { reason }, value: count });
      }

      // 信号指标
      for (const [signal, count] of Object.entries(recall.signal_calls_total)) {
        if (count > 0) {
          samples.push({ name: 'minimem_recall_signal_calls_total', labels: { signal_type: signal }, value: count });
        }
      }
      for (const [signal, count] of Object.entries(recall.signal_failures_total)) {
        if (count > 0) {
          samples.push({ name: 'minimem_recall_signal_failures_total', labels: { signal_type: signal }, value: count });
        }
      }
      for (const [signal, sumMs] of Object.entries(recall.signal_duration_sum_ms)) {
        const cnt = recall.signal_duration_count[signal] ?? 0;
        if (cnt > 0) {
          samples.push({ name: 'minimem_recall_signal_avg_duration_ms', labels: { signal_type: signal }, value: Math.round(sumMs / cnt) });
        }
      }

      // 缓存指标
      for (const [level, count] of Object.entries(recall.cache_hits_total)) {
        if (count > 0) {
          samples.push({ name: 'minimem_recall_cache_hits_total', labels: { cache_level: level }, value: count });
        }
      }

      // 延迟指标
      if (recall.latency_count > 0) {
        samples.push({ name: 'minimem_recall_avg_latency_ms', labels: {}, value: Math.round(recall.latency_sum_ms / recall.latency_count) });
      }
      samples.push({ name: 'minimem_recall_max_latency_ms', labels: {}, value: recall.latency_max_ms });
    } catch {
      // Recall 模块可能未加载，忽略
    }

  } catch (err) {
    log.error({ err }, 'Failed to collect metrics');
  }

  return formatPrometheus(METRIC_DEFS, samples);
}

// ── Prometheus 格式序列化 ──

function formatPrometheus(defs: MetricDefinition[], samples: MetricSample[]): string {
  const lines: string[] = [];

  // 按指标名分组
  const samplesByName = new Map<string, MetricSample[]>();
  for (const s of samples) {
    if (!samplesByName.has(s.name)) samplesByName.set(s.name, []);
    samplesByName.get(s.name)!.push(s);
  }

  for (const def of defs) {
    const metricSamples = samplesByName.get(def.name);
    if (!metricSamples || metricSamples.length === 0) continue;

    lines.push(`# HELP ${def.name} ${def.help}`);
    lines.push(`# TYPE ${def.name} ${def.type}`);

    for (const s of metricSamples) {
      const labelStr = formatLabels(s.labels);
      lines.push(`${s.name}${labelStr} ${s.value}`);
    }

    lines.push(''); // 空行分隔
  }

  return lines.join('\n');
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const pairs = entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',');
  return `{${pairs}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ── 安全数据库查询辅助 ──

function safeCount(db: ReturnType<typeof getDb>, sql: string): number {
  try {
    return (db.prepare(sql).get() as { count: number }).count;
  } catch {
    return 0;
  }
}

function safePrepare<T>(db: ReturnType<typeof getDb>, sql: string): T[] {
  try {
    return db.prepare(sql).all() as T[];
  } catch {
    return [];
  }
}

function safePrepareOne<T>(db: ReturnType<typeof getDb>, sql: string): T | null {
  try {
    return (db.prepare(sql).get() as T) ?? null;
  } catch {
    return null;
  }
}
