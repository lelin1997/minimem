/**
 * previous-run 执行器
 * 引用本 Pipeline 上次运行的某节点输出
 */

import type { NodeExecutor } from './index.js';
import { listRunsByPipeline, getNodeRun } from '../store/runs.js';

export const previousRunExecutor: NodeExecutor = async (node, _inputs, ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;
  const targetNodeId = String(cfg.node_id || '');

  if (!targetNodeId) {
    throw new Error('previous-run 节点缺少必填参数 node_id');
  }

  // 获取当前 Pipeline 最近的运行记录
  const { runs } = listRunsByPipeline(ctx.pipelineId, 1, 5);

  // 跳过当前运行，找到上一次运行
  const previousRun = runs.find(r => r.id !== ctx.runId);

  if (!previousRun) {
    // 没有上次运行，返回 null
    return { outputs: { out: null } };
  }

  // 获取目标节点的运行输出
  const nodeRun = getNodeRun(previousRun.id, targetNodeId);
  if (!nodeRun) {
    return { outputs: { out: null } };
  }

  // 解析输出 JSON
  let outputData: unknown = null;
  if (nodeRun.output_snapshot) {
    try {
      const outputs = JSON.parse(nodeRun.output_snapshot);
      outputData = outputs.out ?? outputs;
    } catch {
      outputData = nodeRun.output_snapshot;
    }
  }

  return {
    outputs: { out: outputData },
  };
};
