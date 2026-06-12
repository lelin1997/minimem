/**
 * Pipeline 运行器 — SSE 事件驱动版本
 * 在每个节点执行前后发出事件，支持实时推送
 * 同时支持 dry-run 模式（output 节点不实际执行副作用）
 */

import { randomUUID } from 'crypto';
import { buildDAG, type PipelineNode, type PipelineEdge, type DAGResult } from './dag.js';
import {
  createRunContext,
  setNodeOutput,
  collectNodeInputs,
  buildTemplateData,
  type RunContext,
  type NodeStatus,
} from './context.js';
import { getExecutor } from '../executors/index.js';
import { getDb } from '../db.js';

// 复用主 runner 的类型
export { type PipelineDefinition } from './runner.js';
import type { PipelineDefinition } from './runner.js';

type EventCallback = (event: string, data: any) => Promise<void>;

// Output 节点类型列表
const OUTPUT_TYPES = new Set([
  'output-file', 'output-minimem', 'output-webhook', 'output-email',
  'output-variable', 'output-console',
]);

// Action 节点类型列表（有副作用）
const ACTION_TYPES = new Set([
  'dream-trigger', 'memory-write', 'memory-forget', 'snapshot-create',
]);

export async function runPipelineWithEvents(
  pipeline: PipelineDefinition,
  trigger: 'manual' | 'cron',
  dryRun: boolean,
  emit: EventCallback,
): Promise<void> {
  const runId = randomUUID();
  const startedAt = new Date();
  const db = getDb();

  // 1. 发送 run_start
  await emit('run_start', {
    runId,
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    dryRun,
    totalNodes: pipeline.nodes.length,
    startedAt: startedAt.toISOString(),
  });

  // 2. 创建数据库记录（dry-run 也记录，标记 trigger_type）
  db.prepare(`
    INSERT INTO pipeline_runs (id, pipeline_id, trigger_type, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).run(runId, pipeline.id, dryRun ? 'dry-run' : trigger, startedAt.toISOString());

  // 3. 构建 DAG
  let dag: DAGResult;
  try {
    dag = buildDAG(pipeline.nodes, pipeline.edges);
  } catch (err: any) {
    const finishedAt = new Date();
    db.prepare(`
      UPDATE pipeline_runs SET status = 'failed', finished_at = ?, duration_ms = ?, error = ? WHERE id = ?
    `).run(finishedAt.toISOString(), finishedAt.getTime() - startedAt.getTime(), err.message, runId);

    await emit('error', { message: `DAG 构建失败: ${err.message}` });
    await emit('run_done', { runId, status: 'failed', durationMs: finishedAt.getTime() - startedAt.getTime() });
    return;
  }

  // 4. 创建运行上下文
  const ctx = createRunContext({
    runId,
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    trigger,
    variables: pipeline.variables || {},
    defaultLlm: pipeline.default_llm || { model: '', temperature: 0.7, max_tokens: 4096 },
  });

  for (const node of pipeline.nodes) {
    ctx.nodeStatus.set(node.id, 'pending');
  }

  // 5. 创建节点记录
  const insertNodeRun = db.prepare(`
    INSERT INTO node_runs (id, run_id, node_id, node_label, node_type, status) VALUES (?, ?, ?, ?, ?, 'pending')
  `);
  const nodeRunIds = new Map<string, string>();
  for (const node of pipeline.nodes) {
    const nodeRunId = randomUUID();
    nodeRunIds.set(node.id, nodeRunId);
    insertNodeRun.run(nodeRunId, runId, node.id, node.label || node.id, node.type);
  }

  // 6. 按拓扑序执行
  let hasFailure = false;
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const layer of dag.layers) {
    const layerPromises = layer.nodeIds.map(async (nodeId) => {
      const node = dag.nodeMap.get(nodeId)!;
      const nodeRunId = nodeRunIds.get(nodeId)!;

      // 检查上游失败
      const inEdges = dag.inEdges.get(nodeId) || [];
      const upstreamFailed = inEdges.some((e) => ctx.nodeStatus.get(e.source_node) === 'failed');

      if (upstreamFailed) {
        ctx.nodeStatus.set(nodeId, 'skipped');
        skipCount++;
        db.prepare(`UPDATE node_runs SET status = 'skipped', error = ? WHERE id = ?`)
          .run('上游节点执行失败', nodeRunId);

        await emit('node_done', {
          nodeId,
          nodeLabel: node.label || nodeId,
          nodeType: node.type,
          status: 'skipped',
          durationMs: 0,
          error: '上游节点执行失败',
        });
        return;
      }

      // 发送 node_start
      await emit('node_start', {
        nodeId,
        nodeLabel: node.label || nodeId,
        nodeType: node.type,
        layer: layer.level,
      });

      const nodeStart = new Date();
      ctx.nodeStatus.set(nodeId, 'running');
      db.prepare(`UPDATE node_runs SET status = 'running', started_at = ? WHERE id = ?`)
        .run(nodeStart.toISOString(), nodeRunId);

      // 收集输入
      const inputs = collectNodeInputs(ctx, node.id, inEdges);
      const templateData = buildTemplateData(ctx, node.id);

      // Dry-run: output 和 action 节点只记录不执行
      const isDryRunSkip = dryRun && (OUTPUT_TYPES.has(node.type) || ACTION_TYPES.has(node.type));

      if (isDryRunSkip) {
        const nodeEnd = new Date();
        const durationMs = nodeEnd.getTime() - nodeStart.getTime();

        // 模拟输出（把输入当输出存）
        setNodeOutput(ctx, node.id, 'out', inputs);
        ctx.nodeStatus.set(nodeId, 'success');

        db.prepare(`
          UPDATE node_runs SET status = 'success', finished_at = ?, duration_ms = ?,
          input_snapshot = ?, output_snapshot = ? WHERE id = ?
        `).run(
          nodeEnd.toISOString(), durationMs,
          safeStringify(inputs),
          safeStringify({ _dry_run: true, _would_execute: node.type, _input: inputs }),
          nodeRunId,
        );

        successCount++;
        await emit('node_done', {
          nodeId,
          nodeLabel: node.label || nodeId,
          nodeType: node.type,
          status: 'success',
          durationMs,
          dryRun: true,
        });
        return;
      }

      // 正常执行（带重试支持）
      const retryCfg = node.config as Record<string, any>;
      const maxRetries = Number(retryCfg.max_retries || 0);
      const retryDelay = Number(retryCfg.delay_ms || 1000);
      const backoffMult = Number(retryCfg.backoff_multiplier || 2);
      const effectiveRetries = (maxRetries > 0 || node.type === 'retry') ? (maxRetries > 0 ? maxRetries : 3) : 0;

      const executor = getExecutor(node.type);
      if (!executor) {
        const error = `节点类型 ${node.type} 没有对应的执行器`;
        ctx.nodeStatus.set(nodeId, 'failed');
        failCount++;
        hasFailure = true;

        db.prepare(`UPDATE node_runs SET status = 'failed', finished_at = ?, error = ?, input_snapshot = ? WHERE id = ?`)
          .run(new Date().toISOString(), error, safeStringify(inputs), nodeRunId);

        await emit('node_done', {
          nodeId, nodeLabel: node.label || nodeId, nodeType: node.type,
          status: 'failed', durationMs: Date.now() - nodeStart.getTime(), error,
        });
        return;
      }

      let lastError = '';
      let retrySuccess = false;
      let currentRetryDelay = retryDelay;

      for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
        if (attempt > 0) {
          console.log(`[Pipeline/SSE] 节点 ${node.label || nodeId} 重试 ${attempt}/${effectiveRetries}，等待 ${currentRetryDelay}ms`);
          await new Promise((r) => setTimeout(r, currentRetryDelay));
          currentRetryDelay = Math.round(currentRetryDelay * backoffMult);
          ctx.nodeStatus.set(nodeId, 'running');

          await emit('node_retry', {
            nodeId, nodeLabel: node.label || nodeId, attempt, maxRetries: effectiveRetries,
          });
        }

        try {
          const result = await executor(node, inputs, ctx, templateData);
          const nodeEnd = new Date();
          const durationMs = nodeEnd.getTime() - nodeStart.getTime();

          for (const [portId, data] of Object.entries(result.outputs)) {
            setNodeOutput(ctx, node.id, portId, data);
          }
          ctx.nodeStatus.set(nodeId, 'success');
          successCount++;
          retrySuccess = true;

          db.prepare(`
            UPDATE node_runs SET status = 'success', finished_at = ?, duration_ms = ?,
            input_snapshot = ?, output_snapshot = ?, llm_usage = ? WHERE id = ?
          `).run(
            nodeEnd.toISOString(), durationMs,
            safeStringify(inputs), safeStringify(result.outputs),
            result.llmUsage ? JSON.stringify(result.llmUsage) : null,
            nodeRunId,
          );

          await emit('node_done', {
            nodeId, nodeLabel: node.label || nodeId, nodeType: node.type,
            status: 'success', durationMs,
            llmUsage: result.llmUsage || null,
            retriesUsed: attempt,
          });
          break;
        } catch (err: any) {
          lastError = err.message || String(err);
          if (attempt === effectiveRetries) {
            // 最后一次重试也失败
            const nodeEnd = new Date();
            ctx.nodeStatus.set(nodeId, 'failed');
            failCount++;
            hasFailure = true;

            db.prepare(`
              UPDATE node_runs SET status = 'failed', finished_at = ?, duration_ms = ?,
              input_snapshot = ?, error = ? WHERE id = ?
            `).run(
              nodeEnd.toISOString(), nodeEnd.getTime() - nodeStart.getTime(),
              safeStringify(inputs), lastError, nodeRunId,
            );

            console.error(`[Pipeline] 节点 ${node.label || node.id} (${node.type}) 执行失败 (${attempt + 1} 次尝试):`, lastError);

            await emit('node_done', {
              nodeId, nodeLabel: node.label || nodeId, nodeType: node.type,
              status: 'failed', durationMs: nodeEnd.getTime() - nodeStart.getTime(),
              error: lastError, retriesUsed: attempt,
            });
          }
        }
      }
    });

    await Promise.all(layerPromises);
  }

  // 7. 最终状态
  const allTotal = pipeline.nodes.length;
  const finalStatus = failCount === 0 ? 'success' : (successCount === 0 ? 'failed' : 'partial');
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  db.prepare(`UPDATE pipeline_runs SET status = ?, finished_at = ?, duration_ms = ? WHERE id = ?`)
    .run(finalStatus, finishedAt.toISOString(), durationMs, runId);

  if (!dryRun) {
    db.prepare(`UPDATE pipelines SET last_run_at = ?, last_run_status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(finishedAt.toISOString(), finalStatus, pipeline.id);
  }

  await emit('run_done', {
    runId,
    status: finalStatus,
    durationMs,
    dryRun,
    totalNodes: allTotal,
    successCount,
    failCount,
    skipCount,
  });
}

function safeStringify(data: unknown): string | null {
  try {
    const str = JSON.stringify(data);
    if (str.length > 100_000) {
      return JSON.stringify({ _truncated: true, _size: str.length, _preview: str.slice(0, 2000) });
    }
    return str;
  } catch {
    return null;
  }
}
