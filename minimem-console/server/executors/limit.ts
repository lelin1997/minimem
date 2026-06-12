/**
 * limit 执行器
 * 截取数组前 N 条
 */

import type { NodeExecutor } from './index.js';

export const limitExecutor: NodeExecutor = async (node, inputs, _ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;
  const count = Number(cfg.count) || 10;
  const inputData = inputs.in;

  if (!Array.isArray(inputData)) {
    return { outputs: { out: inputData } };
  }

  return {
    outputs: { out: inputData.slice(0, count) },
  };
};
