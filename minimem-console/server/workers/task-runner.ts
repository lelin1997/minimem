/**
 * 后台任务执行器
 * 从任务队列中取出 pending 任务并执行
 */

import {
  getActiveTasks,
  markTaskRunning,
  markTaskSuccess,
  markTaskFailed,
  updateTaskProgress,
  type TaskDTO,
} from '../store/tasks.js';
import { getConfig } from '../config.js';
import { getPipeline } from '../store/pipelines.js';
import { runPipeline, type PipelineDefinition } from '../engine/runner.js';

// ── 执行器注册表 ──

type TaskHandler = (task: TaskDTO) => Promise<Record<string, unknown>>;

const handlers: Record<string, TaskHandler> = {
  'dream-trigger': handleDreamTrigger,
  'inspiration-trigger': handleInspirationTrigger,
  'pipeline-run': handlePipelineRun,
};

// ── 轮询处理 ──

let polling = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;

export function startTaskRunner(): void {
  if (pollInterval) return;

  console.log('[TaskRunner] 启动后台任务执行器');
  pollInterval = setInterval(processPendingTasks, 2000); // 每 2 秒检查一次
  // 启动时立即执行一次
  processPendingTasks();
}

export function stopTaskRunner(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  console.log('[TaskRunner] 后台任务执行器已停止');
}

async function processPendingTasks(): Promise<void> {
  if (polling) return; // 防止重叠执行
  polling = true;

  try {
    const tasks = getActiveTasks();

    for (const task of tasks) {
      if (task.status === 'pending') {
        await executeTask(task);
      }
    }
  } catch (err: any) {
    console.error('[TaskRunner] 处理任务时出错:', err.message);
  } finally {
    polling = false;
  }
}

async function executeTask(task: TaskDTO): Promise<void> {
  const handler = handlers[task.type];
  if (!handler) {
    markTaskFailed(task.id, `未知任务类型: ${task.type}`);
    return;
  }

  markTaskRunning(task.id);
  console.log(`[TaskRunner] 开始执行: ${task.label} (${task.type})`);

  try {
    const result = await handler(task);
    markTaskSuccess(task.id, result);
    console.log(`[TaskRunner] 任务完成: ${task.label}`);
  } catch (err: any) {
    markTaskFailed(task.id, err.message || String(err));
    console.error(`[TaskRunner] 任务失败: ${task.label} -`, err.message);
  }
}

// ── 具体处理器 ──

/** 触发 Dream */
async function handleDreamTrigger(task: TaskDTO): Promise<Record<string, unknown>> {
  const config = getConfig();
  const params = task.params as { mode?: string; phases?: number[] };

  updateTaskProgress(task.id, 10);
  console.log(`[TaskRunner] Dream 触发: POST ${config.minimem.base_url}/api/v1/dream/trigger`, { mode: params.mode || 'daily', phases: params.phases });

  const resp = await fetch(`${config.minimem.base_url}/api/v1/dream/trigger`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      mode: params.mode || 'daily',
      phases: params.phases,
    }),
  });

  updateTaskProgress(task.id, 80);

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    console.error(`[TaskRunner] Dream 触发返回错误: HTTP ${resp.status}`, err);
    throw new Error((err as any).error || `HTTP ${resp.status}`);
  }

  const result = await resp.json() as Record<string, unknown>;
  updateTaskProgress(task.id, 100);

  console.log(`[TaskRunner] Dream 引擎返回:`, JSON.stringify(result, null, 2));

  return result;
}

/** 触发灵感引擎 */
async function handleInspirationTrigger(task: TaskDTO): Promise<Record<string, unknown>> {
  const config = getConfig();

  updateTaskProgress(task.id, 10);
  console.log(`[TaskRunner] 灵感引擎触发: POST ${config.minimem.base_url}/api/v1/dream/trigger { mode: 'daily', phases: [3.5] }`);

  const resp = await fetch(`${config.minimem.base_url}/api/v1/dream/trigger`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({ mode: 'daily', phases: [3.5] }),
  });

  updateTaskProgress(task.id, 80);

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    console.error(`[TaskRunner] 灵感引擎返回错误: HTTP ${resp.status}`, err);
    throw new Error((err as any).error || `HTTP ${resp.status}`);
  }

  const result = await resp.json() as Record<string, unknown>;
  updateTaskProgress(task.id, 100);

  // 详细日志
  console.log(`[TaskRunner] 灵感引擎返回:`, JSON.stringify(result, null, 2));

  return result;
}

/** 运行 Pipeline */
async function handlePipelineRun(task: TaskDTO): Promise<Record<string, unknown>> {
  const params = task.params as { pipeline_id: string };

  if (!params.pipeline_id) {
    throw new Error('缺少 pipeline_id 参数');
  }

  updateTaskProgress(task.id, 5);

  const pipeline = getPipeline(params.pipeline_id);
  if (!pipeline) {
    throw new Error(`Pipeline ${params.pipeline_id} 不存在`);
  }

  updateTaskProgress(task.id, 10);

  const definition: PipelineDefinition = {
    id: pipeline.id,
    name: pipeline.name,
    nodes: pipeline.nodes,
    edges: pipeline.edges,
    variables: pipeline.variables,
    default_llm: pipeline.default_llm as any,
  };

  const result = await runPipeline(definition, 'manual');

  updateTaskProgress(task.id, 100);

  return {
    run_id: result.runId,
    status: result.status,
    duration_ms: result.durationMs,
    node_count: result.nodeResults.length,
  };
}

// ── 工具 ──

function buildHeaders(config: ReturnType<typeof getConfig>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }
  return headers;
}
