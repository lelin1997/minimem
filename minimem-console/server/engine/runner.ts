/**
 * Pipeline 运行器
 * 按拓扑层级逐层执行节点，同层并行
 * 支持错误隔离 — 单节点失败不影响其他分支
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
import { getExecutor, hasExecutor } from '../executors/index.js';
import { getDb } from '../db.js';

// ── 类型 ──

export interface PipelineDefinition {
  id: string;
  name: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  variables: Record<string, string>;
  default_llm: {
    model: string;
    temperature: number;
    max_tokens: number;
  };
}

export interface RunResult {
  runId: string;
  status: 'success' | 'partial' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  nodeResults: NodeRunResult[];
  error?: string;
}

export interface NodeRunResult {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  status: NodeStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  inputSnapshot: unknown;
  outputSnapshot: unknown;
  error?: string;
  llmUsage?: {
    prompt_tokens: number;
    completion_tokens: number;
    model: string;
  };
}

// ── 运行 Pipeline ──

export async function runPipeline(
  pipeline: PipelineDefinition,
  trigger: 'manual' | 'cron' = 'manual'
): Promise<RunResult> {
  const runId = randomUUID();
  const startedAt = new Date();
  const db = getDb();

  // 1. 在数据库创建运行记录
  db.prepare(`
    INSERT INTO pipeline_runs (id, pipeline_id, trigger_type, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).run(runId, pipeline.id, trigger, startedAt.toISOString());

  // 2. 构建 DAG
  let dag: DAGResult;
  try {
    dag = buildDAG(pipeline.nodes, pipeline.edges);
  } catch (err: any) {
    const finishedAt = new Date();
    db.prepare(`
      UPDATE pipeline_runs
      SET status = 'failed', finished_at = ?, duration_ms = ?, error = ?
      WHERE id = ?
    `).run(finishedAt.toISOString(), finishedAt.getTime() - startedAt.getTime(), err.message, runId);

    return {
      runId,
      status: 'failed',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      nodeResults: [],
      error: err.message,
    };
  }

  // 3. 创建运行上下文
  const ctx = createRunContext({
    runId,
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    trigger,
    variables: pipeline.variables || {},
    defaultLlm: pipeline.default_llm || { model: '', temperature: 0.7, max_tokens: 4096 },
  });

  // 4. 初始化所有节点状态
  for (const node of pipeline.nodes) {
    ctx.nodeStatus.set(node.id, 'pending');
  }

  // 5. 创建节点运行记录
  const insertNodeRun = db.prepare(`
    INSERT INTO node_runs (id, run_id, node_id, node_label, node_type, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `);

  const nodeRunIds = new Map<string, string>();
  for (const node of pipeline.nodes) {
    const nodeRunId = randomUUID();
    nodeRunIds.set(node.id, nodeRunId);
    insertNodeRun.run(nodeRunId, runId, node.id, node.label || node.id, node.type);
  }

  // 6. 按拓扑层级逐层执行
  const nodeResults: NodeRunResult[] = [];
  let hasFailure = false;

  for (const layer of dag.layers) {
    // 同层节点并行执行
    const layerPromises = layer.nodeIds.map(async (nodeId) => {
      const node = dag.nodeMap.get(nodeId)!;
      const nodeRunId = nodeRunIds.get(nodeId)!;

      // 检查上游是否有失败的（如果上游失败，跳过此节点）
      const inEdges = dag.inEdges.get(nodeId) || [];
      const upstreamFailed = inEdges.some(
        (e) => ctx.nodeStatus.get(e.source_node) === 'failed'
      );

      if (upstreamFailed) {
        ctx.nodeStatus.set(nodeId, 'skipped');
        const result: NodeRunResult = {
          nodeId,
          nodeLabel: node.label || nodeId,
          nodeType: node.type,
          status: 'skipped',
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          inputSnapshot: null,
          outputSnapshot: null,
          error: '上游节点执行失败',
        };

        db.prepare(`
          UPDATE node_runs SET status = 'skipped', error = ? WHERE id = ?
        `).run('上游节点执行失败', nodeRunId);

        return result;
      }

      // 执行节点（带引擎级重试支持）
      return executeNodeWithRetry(node, nodeRunId, ctx, dag, db);
    });

    const layerResults = await Promise.all(layerPromises);

    for (const result of layerResults) {
      nodeResults.push(result);
      if (result.status === 'failed') {
        hasFailure = true;
      }
    }
  }

  // 7. 计算最终状态
  const allSuccess = nodeResults.every((r) => r.status === 'success');
  const allFailed = nodeResults.every((r) => r.status === 'failed' || r.status === 'skipped');
  const finalStatus = allSuccess ? 'success' : allFailed ? 'failed' : 'partial';

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  // 8. 更新运行记录
  db.prepare(`
    UPDATE pipeline_runs
    SET status = ?, finished_at = ?, duration_ms = ?
    WHERE id = ?
  `).run(finalStatus, finishedAt.toISOString(), durationMs, runId);

  // 9. 更新 Pipeline 的 last_run 状态
  db.prepare(`
    UPDATE pipelines
    SET last_run_at = ?, last_run_status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(finishedAt.toISOString(), finalStatus, pipeline.id);

  return {
    runId,
    status: finalStatus,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    nodeResults,
  };
}

// ── 执行单个节点（带引擎级重试） ──

async function executeNodeWithRetry(
  node: PipelineNode,
  nodeRunId: string,
  ctx: RunContext,
  dag: DAGResult,
  db: ReturnType<typeof getDb>
): Promise<NodeRunResult> {
  // 检查节点是否有 retry 配置
  const cfg = node.config as Record<string, any>;
  const maxRetries = Number(cfg.max_retries || 0);
  const delayMs = Number(cfg.delay_ms || 1000);
  const backoffMultiplier = Number(cfg.backoff_multiplier || 2);

  // 如果没有配置重试（或不是 retry 类型节点），直接执行
  if (maxRetries <= 0 && node.type !== 'retry') {
    return executeNode(node, nodeRunId, ctx, dag, db);
  }

  let lastResult: NodeRunResult | null = null;
  let currentDelay = delayMs;
  const effectiveMaxRetries = maxRetries > 0 ? maxRetries : 3;

  for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
    if (attempt > 0) {
      console.log(
        `[Pipeline] 节点 ${node.label || node.id} (${node.type}) 重试 ${attempt}/${effectiveMaxRetries}，等待 ${currentDelay}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, currentDelay));
      currentDelay = Math.round(currentDelay * backoffMultiplier);

      // 重置节点状态
      ctx.nodeStatus.set(node.id, 'pending');
    }

    lastResult = await executeNode(node, nodeRunId, ctx, dag, db);

    if (lastResult.status === 'success') {
      if (attempt > 0) {
        console.log(
          `[Pipeline] 节点 ${node.label || node.id} 在第 ${attempt} 次重试后成功`
        );
      }
      return lastResult;
    }
  }

  // 所有重试都失败了
  return lastResult!;
}

// ── 执行单个节点 ──

async function executeNode(
  node: PipelineNode,
  nodeRunId: string,
  ctx: RunContext,
  dag: DAGResult,
  db: ReturnType<typeof getDb>
): Promise<NodeRunResult> {
  const nodeStart = new Date();
  ctx.nodeStatus.set(node.id, 'running');

  // 更新状态为 running
  db.prepare(`
    UPDATE node_runs SET status = 'running', started_at = ? WHERE id = ?
  `).run(nodeStart.toISOString(), nodeRunId);

  // 收集输入
  const inEdges = dag.inEdges.get(node.id) || [];
  const inputs = collectNodeInputs(ctx, node.id, inEdges);

  // 构建模板数据
  const templateData = buildTemplateData(ctx, node.id);

  // 获取执行器
  const executor = getExecutor(node.type);
  if (!executor) {
    const error = `节点类型 ${node.type} 没有对应的执行器`;
    ctx.nodeStatus.set(node.id, 'failed');

    db.prepare(`
      UPDATE node_runs SET status = 'failed', finished_at = ?, error = ?, input_snapshot = ? WHERE id = ?
    `).run(new Date().toISOString(), error, safeStringify(inputs), nodeRunId);

    return {
      nodeId: node.id,
      nodeLabel: node.label || node.id,
      nodeType: node.type,
      status: 'failed',
      startedAt: nodeStart.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - nodeStart.getTime(),
      inputSnapshot: inputs,
      outputSnapshot: null,
      error,
    };
  }

  try {
    // 执行
    const result = await executor(node, inputs, ctx, templateData);
    const nodeEnd = new Date();

    // 保存输出到上下文
    for (const [portId, data] of Object.entries(result.outputs)) {
      setNodeOutput(ctx, node.id, portId, data);
    }

    ctx.nodeStatus.set(node.id, 'success');

    // 更新数据库
    db.prepare(`
      UPDATE node_runs
      SET status = 'success', finished_at = ?, duration_ms = ?,
          input_snapshot = ?, output_snapshot = ?, llm_usage = ?
      WHERE id = ?
    `).run(
      nodeEnd.toISOString(),
      nodeEnd.getTime() - nodeStart.getTime(),
      safeStringify(inputs),
      safeStringify(result.outputs),
      result.llmUsage ? JSON.stringify(result.llmUsage) : null,
      nodeRunId
    );

    return {
      nodeId: node.id,
      nodeLabel: node.label || node.id,
      nodeType: node.type,
      status: 'success',
      startedAt: nodeStart.toISOString(),
      finishedAt: nodeEnd.toISOString(),
      durationMs: nodeEnd.getTime() - nodeStart.getTime(),
      inputSnapshot: inputs,
      outputSnapshot: result.outputs,
      llmUsage: result.llmUsage,
    };
  } catch (err: any) {
    const nodeEnd = new Date();
    const errorMsg = err.message || String(err);

    ctx.nodeStatus.set(node.id, 'failed');

    db.prepare(`
      UPDATE node_runs
      SET status = 'failed', finished_at = ?, duration_ms = ?,
          input_snapshot = ?, error = ?
      WHERE id = ?
    `).run(
      nodeEnd.toISOString(),
      nodeEnd.getTime() - nodeStart.getTime(),
      safeStringify(inputs),
      errorMsg,
      nodeRunId
    );

    console.error(`[Pipeline] 节点 ${node.label || node.id} (${node.type}) 执行失败:`, errorMsg);

    return {
      nodeId: node.id,
      nodeLabel: node.label || node.id,
      nodeType: node.type,
      status: 'failed',
      startedAt: nodeStart.toISOString(),
      finishedAt: nodeEnd.toISOString(),
      durationMs: nodeEnd.getTime() - nodeStart.getTime(),
      inputSnapshot: inputs,
      outputSnapshot: null,
      error: errorMsg,
    };
  }
}

// ── 工具函数 ──

function safeStringify(data: unknown): string | null {
  try {
    const str = JSON.stringify(data);
    // 限制快照大小（最大 100KB）
    if (str.length > 100_000) {
      return JSON.stringify({ _truncated: true, _size: str.length, _preview: str.slice(0, 2000) });
    }
    return str;
  } catch {
    return null;
  }
}
