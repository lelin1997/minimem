/**
 * 报告查询路由
 */

import { Hono } from 'hono';
import { getDb } from '../db.js';
import { getOutput } from '../store/runs.js';

export const reportRoutes = new Hono();

// 列出所有报告（pipeline_outputs 中 output_type = 'console'）
reportRoutes.get('/', (c) => {
  const db = getDb();
  const page = parseInt(c.req.query('page') || '1', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);

  const total = (db.prepare(
    "SELECT COUNT(*) as count FROM pipeline_outputs WHERE output_type = 'console'"
  ).get() as any).count;

  const reports = db.prepare(`
    SELECT o.id, o.run_id, o.node_id, o.node_label, o.preview, o.created_at,
           r.pipeline_id, p.name as pipeline_name
    FROM pipeline_outputs o
    LEFT JOIN pipeline_runs r ON o.run_id = r.id
    LEFT JOIN pipelines p ON r.pipeline_id = p.id
    WHERE o.output_type = 'console'
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, (page - 1) * pageSize);

  return c.json({ reports, total });
});

// 获取单个报告详情（完整内容）
reportRoutes.get('/:id', (c) => {
  const output = getOutput(c.req.param('id'));
  if (!output) return c.json({ error: '报告不存在' }, 404);
  return c.json(output);
});
