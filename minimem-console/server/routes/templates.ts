/**
 * 模板管理路由
 */

import { Hono } from 'hono';
import { listTemplates, getTemplate } from '../store/templates.js';
import { createPipeline } from '../store/pipelines.js';

export const templateRoutes = new Hono();

// 列出所有模板
templateRoutes.get('/', (c) => {
  const templates = listTemplates();
  return c.json({ templates });
});

// 获取单个模板
templateRoutes.get('/:id', (c) => {
  const template = getTemplate(c.req.param('id'));
  if (!template) return c.json({ error: '模板不存在' }, 404);
  return c.json(template);
});

// 从模板创建 Pipeline
templateRoutes.post('/:id/create', async (c) => {
  const template = getTemplate(c.req.param('id'));
  if (!template) return c.json({ error: '模板不存在' }, 404);

  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    // 允许空 body
  }

  const pipeline = createPipeline({
    name: body.name || `${template.name} (副本)`,
    description: body.description || template.description || undefined,
    tags: template.tags,
    schedule_type: template.schedule_type || undefined,
    schedule_cron: template.schedule_cron || undefined,
    nodes: template.nodes,
    edges: template.edges,
    variables: { ...template.variables, ...(body.variables || {}) },
    default_llm: template.default_llm,
  });

  return c.json(pipeline, 201);
});
