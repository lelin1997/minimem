/**
 * Cron 调度器
 * 基于 node-cron 的定时任务管理
 * 启动时从数据库读取所有 enabled + cron 类型的 Pipeline，注册定时任务
 */

import cron from 'node-cron';
import { listPipelines, getPipeline } from '../store/pipelines.js';
import { runPipeline, type PipelineDefinition } from '../engine/runner.js';

// ── 调度器状态 ──

const scheduledTasks = new Map<string, cron.ScheduledTask>();

// ── 初始化 ──

export function initScheduler(): void {
  console.log('[Scheduler] 正在初始化调度器...');

  const pipelines = listPipelines();
  let count = 0;

  for (const pipeline of pipelines) {
    if (pipeline.enabled && pipeline.schedule_type === 'cron' && pipeline.schedule_cron) {
      registerTask(pipeline.id, pipeline.schedule_cron, pipeline.name);
      count++;
    }
  }

  console.log(`[Scheduler] 已注册 ${count} 个定时任务`);
}

// ── 注册任务 ──

export function registerTask(pipelineId: string, cronExpr: string, name?: string): boolean {
  // 先移除已有的同名任务
  unregisterTask(pipelineId);

  // 验证 cron 表达式
  if (!cron.validate(cronExpr)) {
    console.error(`[Scheduler] 无效的 Cron 表达式: ${cronExpr} (Pipeline: ${name || pipelineId})`);
    return false;
  }

  const task = cron.schedule(cronExpr, async () => {
    console.log(`[Scheduler] 触发定时任务: ${name || pipelineId}`);

    try {
      const pipeline = getPipeline(pipelineId);
      if (!pipeline) {
        console.error(`[Scheduler] Pipeline ${pipelineId} 不存在，跳过执行`);
        return;
      }

      if (!pipeline.enabled) {
        console.log(`[Scheduler] Pipeline ${name || pipelineId} 已禁用，跳过执行`);
        return;
      }

      const definition: PipelineDefinition = {
        id: pipeline.id,
        name: pipeline.name,
        nodes: pipeline.nodes,
        edges: pipeline.edges,
        variables: pipeline.variables,
        default_llm: pipeline.default_llm as any,
      };

      const result = await runPipeline(definition, 'cron');
      console.log(
        `[Scheduler] 任务 ${name || pipelineId} 执行完成: ${result.status} (${result.durationMs}ms)`
      );
    } catch (err: any) {
      console.error(`[Scheduler] 任务 ${name || pipelineId} 执行异常:`, err.message);
    }
  });

  scheduledTasks.set(pipelineId, task);
  console.log(`[Scheduler] 已注册: ${name || pipelineId} (${cronExpr})`);
  return true;
}

// ── 移除任务 ──

export function unregisterTask(pipelineId: string): void {
  const existing = scheduledTasks.get(pipelineId);
  if (existing) {
    existing.stop();
    scheduledTasks.delete(pipelineId);
  }
}

// ── 更新任务 ──

export function updateTask(pipelineId: string, cronExpr: string | null, enabled: boolean, name?: string): void {
  if (!enabled || !cronExpr) {
    unregisterTask(pipelineId);
    return;
  }

  registerTask(pipelineId, cronExpr, name);
}

// ── 状态查询 ──

export function getSchedulerStatus(): {
  taskCount: number;
  tasks: { pipelineId: string; running: boolean }[];
} {
  const tasks = Array.from(scheduledTasks.entries()).map(([id, task]) => ({
    pipelineId: id,
    running: true,
  }));

  return {
    taskCount: tasks.length,
    tasks,
  };
}

// ── 停止所有 ──

export function stopAllTasks(): void {
  for (const [id, task] of scheduledTasks.entries()) {
    task.stop();
  }
  scheduledTasks.clear();
  console.log('[Scheduler] 所有任务已停止');
}
