/**
 * sort 执行器
 * 按字段排序
 */

import type { NodeExecutor, ExecutorResult } from './index.js';

export const sortExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;
  const field = String(cfg.field || '');
  const order = cfg.order || 'desc';

  if (!field) {
    throw new Error('sort 节点缺少必填参数 field');
  }

  const inputData = inputs.in;
  const items = Array.isArray(inputData) ? [...inputData] : [];

  items.sort((a: any, b: any) => {
    const va = a?.[field];
    const vb = b?.[field];

    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;

    let cmp: number;
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb;
    } else {
      cmp = String(va).localeCompare(String(vb));
    }

    return order === 'asc' ? cmp : -cmp;
  });

  return {
    outputs: { out: items },
  };
};
