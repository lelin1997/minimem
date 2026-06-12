/**
 * parallel 执行器
 * 并行分发：将输入数据同时发送到多个输出端口
 * 用于将同一份数据并行送入不同下游分支
 * 输出端口：out_0, out_1, out_2, ...（数量由配置的 branches 决定）
 */

import type { NodeExecutor } from './index.js';

export const parallelExecutor: NodeExecutor = async (node, inputs, _ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;
  const branches = Number(cfg.branches || 2);

  if (branches < 2 || branches > 10) {
    throw new Error('parallel 节点的 branches 必须在 2~10 之间');
  }

  const inputData = inputs.in;

  // 将同一份数据发送到每个输出端口
  const outputs: Record<string, unknown> = {};
  for (let i = 0; i < branches; i++) {
    outputs[`out_${i}`] = inputData;
  }

  return { outputs };
};
