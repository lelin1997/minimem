/**
 * 后台任务 API 路由
 * 提供任务提交、状态查询、列表查看、取消、重试、删除
 */

import { Hono } from 'hono';
import {
  createTask,
  getTask,
  listTasks,
  getActiveTasks,
  cleanupOldTasks,
  cancelTask,
  deleteTask,
  retryTask,
  type TaskType,
} from '../store/tasks.js';

export const taskRoutes = new Hono();

// POST / — 创建后台任务
taskRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { type, label, params } = body;

  if (!type || !label) {
    return c.json({ error: '缺少必填字段: type, label' }, 400);
  }

  const validTypes: TaskType[] = ['dream-trigger', 'inspiration-trigger', 'pipeline-run'];
  if (!validTypes.includes(type)) {
    return c.json({ error: `无效的任务类型: ${type}` }, 400);
  }

  const task = createTask({ type, label, params: params || {} });
  return c.json(task, 201);
});

// GET / — 任务列表
taskRoutes.get('/', (c) => {
  const status = c.req.query('status') as any;
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const tasks = listTasks({ status: status || undefined, limit });
  return c.json({ tasks });
});

// GET /active — 活跃任务（轮询用）
taskRoutes.get('/active', (c) => {
  const tasks = getActiveTasks();
  return c.json({ tasks });
});

// POST /cleanup — 清理旧任务
taskRoutes.post('/cleanup', (c) => {
  const deleted = cleanupOldTasks(7);
  return c.json({ deleted });
});

// POST /:id/cancel — 取消/终止任务（必须在 /:id 之前定义）
taskRoutes.post('/:id/cancel', (c) => {
  const task = cancelTask(c.req.param('id'));
  if (!task) return c.json({ error: '任务不存在或无法取消' }, 404);
  return c.json(task);
});

// POST /:id/retry — 重试失败任务（必须在 /:id 之前定义）
taskRoutes.post('/:id/retry', (c) => {
  const newTask = retryTask(c.req.param('id'));
  if (!newTask) return c.json({ error: '任务不存在或非失败状态' }, 400);
  return c.json(newTask, 201);
});

// DELETE /:id — 删除任务（必须在 GET /:id 之前定义，避免被误匹配）
taskRoutes.delete('/:id', (c) => {
  const success = deleteTask(c.req.param('id'));
  if (!success) return c.json({ error: '任务不存在' }, 404);
  return c.json({ success: true });
});

// GET /:id — 单个任务详情（放在最后，避免拦截其他路由）
taskRoutes.get('/:id', (c) => {
  const task = getTask(c.req.param('id'));
  if (!task) return c.json({ error: '任务不存在' }, 404);
  return c.json(task);
});
