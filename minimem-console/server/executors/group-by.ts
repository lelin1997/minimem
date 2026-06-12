/**
 * group-by 执行器
 * 按字段分组
 */

import type { NodeExecutor } from './index.js';

export const groupByExecutor: NodeExecutor = async (node, inputs, _ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;
  const field = String(cfg.field || '');
  const inputData = inputs.in;

  if (!field) {
    throw new Error('group-by 节点缺少必填参数 field');
  }

  if (!Array.isArray(inputData)) {
    return { outputs: { out: {} } };
  }

  const groups: Record<string, unknown[]> = {};
  for (const item of inputData) {
    const key = String((item as any)?.[field] ?? 'undefined');
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  return {
    outputs: { out: groups },
  };
};
