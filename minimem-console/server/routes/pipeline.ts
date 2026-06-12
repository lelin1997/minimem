/**
 * Pipeline CRUD + 运行 路由
 */

import { Hono } from 'hono';
import {
  listPipelines,
  getPipeline,
  createPipeline,
  updatePipeline,
  deletePipeline,
  togglePipeline,
} from '../store/pipelines.js';
import { listRunsByPipeline } from '../store/runs.js';
import { runPipeline, type PipelineDefinition } from '../engine/runner.js';

export const pipelineRoutes = new Hono();

// 列表
pipelineRoutes.get('/', (c) => {
  const pipelines = listPipelines();
  return c.json({ pipelines });
});

// 详情
pipelineRoutes.get('/:id', (c) => {
  const pipeline = getPipeline(c.req.param('id'));
  if (!pipeline) return c.json({ error: 'Pipeline 不存在' }, 404);
  return c.json(pipeline);
});

// 创建
pipelineRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();

    if (!body.name) {
      return c.json({ error: '缺少必填字段: name' }, 400);
    }

    const pipeline = createPipeline(body);
    return c.json(pipeline, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 更新
pipelineRoutes.put('/:id', async (c) => {
  try {
    const body = await c.req.json();
    const pipeline = updatePipeline(c.req.param('id'), body);

    if (!pipeline) return c.json({ error: 'Pipeline 不存在' }, 404);

    return c.json(pipeline);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 删除
pipelineRoutes.delete('/:id', (c) => {
  const success = deletePipeline(c.req.param('id'));
  if (!success) return c.json({ error: 'Pipeline 不存在' }, 404);
  return c.json({ success: true });
});

// 手动触发运行
pipelineRoutes.post('/:id/run', async (c) => {
  const pipeline = getPipeline(c.req.param('id'));
  if (!pipeline) return c.json({ error: 'Pipeline 不存在' }, 404);

  try {
    const definition: PipelineDefinition = {
      id: pipeline.id,
      name: pipeline.name,
      nodes: pipeline.nodes,
      edges: pipeline.edges,
      variables: pipeline.variables,
      default_llm: pipeline.default_llm as any,
    };

    const result = await runPipeline(definition, 'manual');
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: `运行失败: ${err.message}` }, 500);
  }
});

// 启停切换
pipelineRoutes.post('/:id/toggle', (c) => {
  const pipeline = togglePipeline(c.req.param('id'));
  if (!pipeline) return c.json({ error: 'Pipeline 不存在' }, 404);
  return c.json(pipeline);
});

// 获取 Pipeline 的运行记录
pipelineRoutes.get('/:id/runs', (c) => {
  const page = parseInt(c.req.query('page') || '1', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);
  const result = listRunsByPipeline(c.req.param('id'), page, pageSize);
  return c.json(result);
});

// 导出 Pipeline（JSON）
pipelineRoutes.get('/:id/export', (c) => {
  const pipeline = getPipeline(c.req.param('id'));
  if (!pipeline) return c.json({ error: 'Pipeline 不存在' }, 404);

  // 导出时移除运行状态信息
  const exportData = {
    name: pipeline.name,
    description: pipeline.description,
    tags: pipeline.tags,
    schedule_type: pipeline.schedule_type,
    schedule_cron: pipeline.schedule_cron,
    nodes: pipeline.nodes,
    edges: pipeline.edges,
    variables: pipeline.variables,
    default_llm: pipeline.default_llm,
  };

  return c.json(exportData);
});

// 导入 Pipeline（从 JSON）
pipelineRoutes.post('/import', async (c) => {
  try {
    const body = await c.req.json();

    if (!body.name) {
      return c.json({ error: '导入数据缺少 name 字段' }, 400);
    }

    const pipeline = createPipeline({
      name: body.name,
      description: body.description,
      tags: body.tags,
      schedule_type: body.schedule_type,
      schedule_cron: body.schedule_cron,
      nodes: body.nodes,
      edges: body.edges,
      variables: body.variables,
      default_llm: body.default_llm,
    });

    return c.json(pipeline, 201);
  } catch (err: any) {
    return c.json({ error: `导入失败: ${err.message}` }, 400);
  }
});
