// ============================================================
// MiniMem — 链路追踪（memory_traces 写入）
// ============================================================

import { getDb } from '../store/database.js';
import { generateId, now } from './utils.js';
import { getLogger } from './logger.js';

const log = getLogger('tracing');

/**
 * 追踪上下文
 */
export interface TraceContext {
  trace_id: string;
  spans: TraceSpan[];
}

export interface TraceSpan {
  id: string;
  span_name: string;
  phase: string;
  memory_id: string;
  memory_type: string;
  result: 'success' | 'failure' | 'skip';
  metadata: Record<string, unknown>;
  started_at: number;
  ended_at?: number;
}

/**
 * 创建新追踪
 */
export function createTrace(): TraceContext {
  return {
    trace_id: generateId(),
    spans: [],
  };
}

/**
 * 开始一个 Span
 */
export function startSpan(
  trace: TraceContext,
  spanName: string,
  phase: string,
  memoryId: string,
  memoryType: string,
): TraceSpan {
  const span: TraceSpan = {
    id: generateId(),
    span_name: spanName,
    phase,
    memory_id: memoryId,
    memory_type: memoryType,
    result: 'success',
    metadata: {},
    started_at: Date.now(),
  };
  trace.spans.push(span);
  return span;
}

/**
 * 结束 Span
 */
export function endSpan(
  span: TraceSpan,
  result: 'success' | 'failure' | 'skip' = 'success',
  metadata?: Record<string, unknown>,
): void {
  span.ended_at = Date.now();
  span.result = result;
  if (metadata) span.metadata = { ...span.metadata, ...metadata };
}

/**
 * 将追踪写入数据库
 */
export function flushTrace(trace: TraceContext): void {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO memory_traces (id, trace_id, memory_id, memory_type, span_name, phase, result, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const timestamp = now();
    db.transaction(() => {
      for (const span of trace.spans) {
        stmt.run(
          span.id,
          trace.trace_id,
          span.memory_id,
          span.memory_type,
          span.span_name,
          span.phase,
          span.result,
          JSON.stringify({
            ...span.metadata,
            duration_ms: span.ended_at ? span.ended_at - span.started_at : undefined,
          }),
          timestamp,
        );
      }
    })();

    log.debug({ traceId: trace.trace_id, spans: trace.spans.length }, 'Trace flushed');
  } catch (err) {
    log.warn({ err }, 'Failed to flush trace');
  }
}

/**
 * 查询某条记忆的追踪历史
 */
export function getMemoryTraces(memoryId: string, memoryType?: string): Array<{
  trace_id: string;
  span_name: string;
  phase: string;
  result: string;
  metadata: Record<string, unknown>;
  created_at: string;
}> {
  const db = getDb();

  let sql = 'SELECT * FROM memory_traces WHERE memory_id = ?';
  const params: unknown[] = [memoryId];

  if (memoryType) {
    sql += ' AND memory_type = ?';
    params.push(memoryType);
  }

  sql += ' ORDER BY created_at DESC LIMIT 100';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    trace_id: r.trace_id as string,
    span_name: r.span_name as string,
    phase: r.phase as string,
    result: r.result as string,
    metadata: JSON.parse((r.metadata as string) || '{}'),
    created_at: r.created_at as string,
  }));
}

/**
 * 清理过期追踪数据
 */
export function cleanupTraces(retentionDays: number = 30): number {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const result = db.prepare(
    'DELETE FROM memory_traces WHERE created_at < ?'
  ).run(cutoff.toISOString());

  if (result.changes > 0) {
    log.info({ deleted: result.changes, retentionDays }, 'Traces cleaned up');
  }

  return result.changes;
}
