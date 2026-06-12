/**
 * deduplicate 执行器
 * 按字段去重
 */

import type { NodeExecutor } from './index.js';

export const deduplicateExecutor: NodeExecutor = async (node, inputs, _ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;
  const field = String(cfg.field || '');
  const inputData = inputs.in;

  if (!field) {
    throw new Error('deduplicate 节点缺少必填参数 field');
  }

  if (!Array.isArray(inputData)) {
    return { outputs: { out: inputData } };
  }

  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const item of inputData) {
    const key = String((item as any)?.[field] ?? '');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return {
    outputs: { out: result },
  };
};
