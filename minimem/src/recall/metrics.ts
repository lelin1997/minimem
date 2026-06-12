// ============================================================
// MiniMem — Recall Metrics (T-H07.1 / T-H07.2)
// ============================================================
// 进程内 Recall 指标收集器。
// 由 HintsEngine 和 REST API 端点调用 record*() 方法，
// 由 Prometheus collectMetrics() 调用 getRecallMetrics() 汇总。

/**
 * Recall 指标快照
 */
export interface RecallMetricsSnapshot {
  // T-H07.1: 请求级指标
  hints_requests_total: number;
  hints_requests_by_status: Record<string, number>; // {ok, error, skipped}
  auto_requests_total: number;
  auto_requests_by_status: Record<string, number>;
  auto_requests_by_mode: Record<string, number>;  // {hint, full, smart}

  // T-H07.2: 引擎内部指标
  hints_returned_sum: number;        // 总共返回的 hints 数
  hints_returned_count: number;      // 有多少次请求返回了 hints（用于算平均）
  skipped_total: number;
  skipped_by_reason: Record<string, number>;  // {message_too_short, greeting, confirmation, system_command}
  signal_calls_total: Record<string, number>;  // {semantic, entity, time, graph}
  signal_failures_total: Record<string, number>;
  signal_duration_sum_ms: Record<string, number>;
  signal_duration_count: Record<string, number>;
  cache_hits_total: Record<string, number>;  // {session, embedding, summary}
  latency_sum_ms: number;
  latency_count: number;
  latency_max_ms: number;
}

// ── 进程内计数器 ──

let hintsRequestsTotal = 0;
const hintsRequestsByStatus: Record<string, number> = { ok: 0, error: 0, skipped: 0 };
let autoRequestsTotal = 0;
const autoRequestsByStatus: Record<string, number> = { ok: 0, error: 0 };
const autoRequestsByMode: Record<string, number> = { hint: 0, full: 0, smart: 0 };

let hintsReturnedSum = 0;
let hintsReturnedCount = 0;
let skippedTotal = 0;
const skippedByReason: Record<string, number> = {};

const signalCallsTotal: Record<string, number> = { semantic: 0, entity: 0, time: 0, graph: 0 };
const signalFailuresTotal: Record<string, number> = { semantic: 0, entity: 0, time: 0, graph: 0 };
const signalDurationSumMs: Record<string, number> = { semantic: 0, entity: 0, time: 0, graph: 0 };
const signalDurationCount: Record<string, number> = { semantic: 0, entity: 0, time: 0, graph: 0 };

const cacheHitsTotal: Record<string, number> = { session: 0, embedding: 0, summary: 0 };

let latencySumMs = 0;
let latencyCount = 0;
let latencyMaxMs = 0;

// ── 记录方法（由 HintsEngine 和 REST 端点调用）──

/**
 * 记录一次 hints 请求结果
 */
export function recordHintsRequest(status: 'ok' | 'error' | 'skipped', hintsCount: number, latencyMs: number): void {
  hintsRequestsTotal++;
  hintsRequestsByStatus[status] = (hintsRequestsByStatus[status] ?? 0) + 1;

  if (status === 'ok') {
    hintsReturnedSum += hintsCount;
    hintsReturnedCount++;
  }

  latencySumMs += latencyMs;
  latencyCount++;
  if (latencyMs > latencyMaxMs) latencyMaxMs = latencyMs;
}

/**
 * 记录一次 auto 请求
 */
export function recordAutoRequest(status: 'ok' | 'error', mode: string): void {
  autoRequestsTotal++;
  autoRequestsByStatus[status] = (autoRequestsByStatus[status] ?? 0) + 1;
  autoRequestsByMode[mode] = (autoRequestsByMode[mode] ?? 0) + 1;
}

/**
 * 记录跳过
 */
export function recordSkip(reason: string): void {
  skippedTotal++;
  skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
}

/**
 * 记录信号执行结果
 */
export function recordSignal(
  signalType: 'semantic' | 'entity' | 'time' | 'graph',
  success: boolean,
  durationMs: number,
): void {
  signalCallsTotal[signalType]++;
  if (!success) signalFailuresTotal[signalType]++;
  signalDurationSumMs[signalType] += durationMs;
  signalDurationCount[signalType]++;
}

/**
 * 记录缓存命中
 */
export function recordCacheHit(level: 'session' | 'embedding' | 'summary'): void {
  cacheHitsTotal[level] = (cacheHitsTotal[level] ?? 0) + 1;
}

// ── 快照方法（由 Prometheus 收集器调用）──

/**
 * 获取当前所有 Recall 指标的快照
 */
export function getRecallMetrics(): RecallMetricsSnapshot {
  return {
    hints_requests_total: hintsRequestsTotal,
    hints_requests_by_status: { ...hintsRequestsByStatus },
    auto_requests_total: autoRequestsTotal,
    auto_requests_by_status: { ...autoRequestsByStatus },
    auto_requests_by_mode: { ...autoRequestsByMode },
    hints_returned_sum: hintsReturnedSum,
    hints_returned_count: hintsReturnedCount,
    skipped_total: skippedTotal,
    skipped_by_reason: { ...skippedByReason },
    signal_calls_total: { ...signalCallsTotal },
    signal_failures_total: { ...signalFailuresTotal },
    signal_duration_sum_ms: { ...signalDurationSumMs },
    signal_duration_count: { ...signalDurationCount },
    cache_hits_total: { ...cacheHitsTotal },
    latency_sum_ms: latencySumMs,
    latency_count: latencyCount,
    latency_max_ms: latencyMaxMs,
  };
}

/**
 * 重置所有计数器（仅用于测试）
 */
export function resetRecallMetrics(): void {
  hintsRequestsTotal = 0;
  autoRequestsTotal = 0;
  hintsReturnedSum = 0;
  hintsReturnedCount = 0;
  skippedTotal = 0;
  latencySumMs = 0;
  latencyCount = 0;
  latencyMaxMs = 0;

  for (const key of Object.keys(hintsRequestsByStatus)) hintsRequestsByStatus[key] = 0;
  for (const key of Object.keys(autoRequestsByStatus)) autoRequestsByStatus[key] = 0;
  for (const key of Object.keys(autoRequestsByMode)) autoRequestsByMode[key] = 0;
  for (const key of Object.keys(skippedByReason)) delete skippedByReason[key];
  for (const key of Object.keys(signalCallsTotal)) signalCallsTotal[key] = 0;
  for (const key of Object.keys(signalFailuresTotal)) signalFailuresTotal[key] = 0;
  for (const key of Object.keys(signalDurationSumMs)) signalDurationSumMs[key] = 0;
  for (const key of Object.keys(signalDurationCount)) signalDurationCount[key] = 0;
  for (const key of Object.keys(cacheHitsTotal)) cacheHitsTotal[key] = 0;
}
