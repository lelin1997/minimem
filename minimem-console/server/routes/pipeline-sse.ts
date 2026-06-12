/**
 * SSE 流式运行 — 后端路由
 * 支持实时推送 Pipeline 运行进度（节点状态变化）
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getPipeline } from '../store/pipelines.js';
import { runPipelineWithEvents, type PipelineDefinition } from '../engine/runner-sse.js';

export const sseRoutes = new Hono();

/**
 * SSE 流式运行
 * POST /api/pipelines/:id/run-stream
 *
 * 返回 text/event-stream，依次推送：
 *   event: run_start    data: { runId, pipelineId }
 *   event: node_start   data: { nodeId, nodeLabel, nodeType }
 *   event: node_done    data: { nodeId, status, durationMs, llmUsage? }
 *   event: run_done     data: { runId, status, durationMs }
 *   event: error        data: { message }
 */
sseRoutes.post('/:id/run-stream', async (c) => {
  const pipeline = getPipeline(c.req.param('id'));
  if (!pipeline) return c.json({ error: 'Pipeline 不存在' }, 404);

  // 读取 dry_run 参数
  let dryRun = false;
  try {
    const body = await c.req.json();
    dryRun = !!body?.dry_run;
  } catch {}

  const definition: PipelineDefinition = {
    id: pipeline.id,
    name: pipeline.name,
    nodes: pipeline.nodes,
    edges: pipeline.edges,
    variables: pipeline.variables,
    default_llm: pipeline.default_llm as any,
  };

  return streamSSE(c, async (stream) => {
    try {
      await runPipelineWithEvents(
        definition,
        'manual',
        dryRun,
        async (event, data) => {
          await stream.writeSSE({ event, data: JSON.stringify(data) });
        },
      );
    } catch (err: any) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: err.message }),
      });
    }
  });
});

/**
 * Dry-run（非流式，同步返回）
 * POST /api/pipelines/:id/dry-run
 */
sseRoutes.post('/:id/dry-run', async (c) => {
  const pipeline = getPipeline(c.req.param('id'));
  if (!pipeline) return c.json({ error: 'Pipeline 不存在' }, 404);

  const definition: PipelineDefinition = {
    id: pipeline.id,
    name: pipeline.name,
    nodes: pipeline.nodes,
    edges: pipeline.edges,
    variables: pipeline.variables,
    default_llm: pipeline.default_llm as any,
  };

  try {
    const events: Array<{ event: string; data: any }> = [];
    await runPipelineWithEvents(
      definition,
      'manual',
      true,
      async (event, data) => {
        events.push({ event, data });
      },
    );

    return c.json({
      dry_run: true,
      events,
    });
  } catch (err: any) {
    return c.json({ error: `Dry-run 失败: ${err.message}` }, 500);
  }
});
