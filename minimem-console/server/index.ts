import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { loadConfig } from './config.js';
import { getDb } from './db.js';
import { proxyRoutes } from './routes/proxy.js';
import { authRoutes } from './routes/auth.js';
import { pipelineRoutes } from './routes/pipeline.js';
import { runRoutes } from './routes/runs.js';
import { templateRoutes } from './routes/templates.js';
import { nodeTypeRoutes } from './routes/node-types.js';
import { reportRoutes } from './routes/reports.js';
import { dreamRoutes } from './routes/dream-files.js';
import { sseRoutes } from './routes/pipeline-sse.js';
import { customNodeRoutes } from './routes/custom-nodes.js';
import { inspirationRoutes } from './routes/inspirations.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { taskRoutes } from './routes/tasks.js';
import { initBuiltinTemplates } from './templates/daily-review.js';
import { initScheduler, getSchedulerStatus } from './scheduler/index.js';
import { initTasksTable } from './store/tasks.js';
import { startTaskRunner } from './workers/task-runner.js';

// ── 加载配置 & 初始化数据库 ──
const config = loadConfig();
getDb();

// ── 初始化内置模板 & 后台任务表 ──
initBuiltinTemplates();
initTasksTable();

// ── 创建 Hono 应用 ──
const app = new Hono();

// ── 中间件 ──
app.use('*', logger());
app.use('*', cors());

// ── 路由注册 ──
app.route('/proxy', proxyRoutes);
app.route('/api/auth', authRoutes);
app.route('/api', proxyRoutes);
app.route('/api/pipelines', pipelineRoutes);
app.route('/api/pipelines', sseRoutes);        // SSE 流式运行 + dry-run
app.route('/api/runs', runRoutes);
app.route('/api/templates', templateRoutes);
app.route('/api/node-types', nodeTypeRoutes);
app.route('/api/reports', reportRoutes);
app.route('/api/dreams', dreamRoutes);
app.route('/api/custom-nodes', customNodeRoutes);
app.route('/api/inspirations', inspirationRoutes);
app.route('/api/knowledge', knowledgeRoutes);
app.route('/api/tasks', taskRoutes);

// ── 健康检查 ──
app.get('/api/health', (c) => {
  const scheduler = getSchedulerStatus();
  return c.json({
    status: 'ok',
    version: '0.1.0',
    scheduler: {
      taskCount: scheduler.taskCount,
    },
  });
});

// ── 调度器状态 ──
app.get('/api/scheduler/status', (c) => {
  return c.json(getSchedulerStatus());
});

// ── 启动服务器 ──
const port = config.server.port;
const host = config.server.host;

console.log(`
┌─────────────────────────────────────────┐
│         MiniMem Console v0.1.0          │
├─────────────────────────────────────────┤
│  Server:   http://${host}:${port}       │
│  MiniMem:  ${config.minimem.base_url}        │
│  LLM:      ${config.llm.model}                   │
└─────────────────────────────────────────┘
`);

serve({
  fetch: app.fetch,
  port,
  hostname: host,
});

// ── 启动调度器 & 后台任务执行器 ──
initScheduler();
startTaskRunner();

export default app;
