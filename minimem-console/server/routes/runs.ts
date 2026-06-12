/**
 * 运行记录查询路由
 */

import { Hono } from 'hono';
import {
  getRun,
  getNodeRuns,
  getNodeRun,
  getRunOutputs,
  listAllRuns,
  getRecentRuns,
} from '../store/runs.js';
import { getDb } from '../db.js';

export const runRoutes = new Hono();

// 全部运行记录（分页）
runRoutes.get('/', (c) => {
  const page = parseInt(c.req.query('page') || '1', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);
  const result = listAllRuns(page, pageSize);
  return c.json(result);
});

// 最近运行记录（Dashboard 用）
runRoutes.get('/recent', (c) => {
  const limit = parseInt(c.req.query('limit') || '5', 10);
  const runs = getRecentRuns(limit);
  return c.json({ runs });
});

// 按天聚合运行统计（用于 Analytics 图表）
runRoutes.get('/daily-stats', (c) => {
  const days = parseInt(c.req.query('days') || '30', 10);
  const db = getDb();

  // 按天聚合：每天的成功/失败/部分次数、平均耗时
  const rows = db.prepare(`
    SELECT
      date(started_at) as day,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial,
      ROUND(AVG(duration_ms)) as avg_duration_ms
    FROM pipeline_runs
    WHERE started_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(started_at)
    ORDER BY day ASC
  `).all(days) as Array<{
    day: string;
    total: number;
    success: number;
    failed: number;
    partial: number;
    avg_duration_ms: number | null;
  }>;

  // 按 Pipeline 聚合：每个 Pipeline 最近 N 天的运行次数
  const byPipeline = db.prepare(`
    SELECT
      p.name as pipeline_name,
      COUNT(*) as run_count,
      SUM(CASE WHEN r.status = 'success' THEN 1 ELSE 0 END) as success_count
    FROM pipeline_runs r
    LEFT JOIN pipelines p ON r.pipeline_id = p.id
    WHERE r.started_at >= datetime('now', '-' || ? || ' days')
    GROUP BY r.pipeline_id
    ORDER BY run_count DESC
    LIMIT 10
  `).all(days) as Array<{
    pipeline_name: string;
    run_count: number;
    success_count: number;
  }>;

  return c.json({ daily: rows, byPipeline });
});

// 单次运行详情（含节点记录 + 输出）
runRoutes.get('/:id', (c) => {
  const runId = c.req.param('id');
  const run = getRun(runId);
  if (!run) return c.json({ error: '运行记录不存在' }, 404);

  // 查询关联的节点运行记录，并解析 JSON 字段
  const rawNodeRuns = getNodeRuns(runId);
  const node_runs = rawNodeRuns.map((nr) => {
    const parsed: any = { ...nr };
    if (nr.input_snapshot) {
      try { parsed.input_snapshot = JSON.parse(nr.input_snapshot); } catch {}
    }
    if (nr.output_snapshot) {
      try { parsed.output_snapshot = JSON.parse(nr.output_snapshot); } catch {}
    }
    if (nr.llm_usage) {
      try { parsed.llm_usage = JSON.parse(nr.llm_usage); } catch {}
    }
    return parsed;
  });

  // 查询关联的输出
  const rawOutputs = getRunOutputs(runId);
  const outputs = rawOutputs.map((o) => ({
    node_id: o.node_id,
    node_label: o.node_label,
    type: o.output_type,
    preview: o.preview,
    full_content: o.full_content,
    file_path: o.file_path,
  }));

  return c.json({ ...run, node_runs, outputs });
});

// 运行的所有节点记录
runRoutes.get('/:id/nodes', (c) => {
  const nodes = getNodeRuns(c.req.param('id'));
  return c.json({ nodes });
});

// 运行的某个节点详情
runRoutes.get('/:id/nodes/:nodeId', (c) => {
  const nodeRun = getNodeRun(c.req.param('id'), c.req.param('nodeId'));
  if (!nodeRun) return c.json({ error: '节点运行记录不存在' }, 404);

  // 解析 JSON 快照
  const result: any = { ...nodeRun };
  if (nodeRun.input_snapshot) {
    try { result.input_snapshot = JSON.parse(nodeRun.input_snapshot); } catch {}
  }
  if (nodeRun.output_snapshot) {
    try { result.output_snapshot = JSON.parse(nodeRun.output_snapshot); } catch {}
  }
  if (nodeRun.llm_usage) {
    try { result.llm_usage = JSON.parse(nodeRun.llm_usage); } catch {}
  }

  return c.json(result);
});

// 运行的所有输出
runRoutes.get('/:id/outputs', (c) => {
  const outputs = getRunOutputs(c.req.param('id'));
  return c.json({ outputs });
});
