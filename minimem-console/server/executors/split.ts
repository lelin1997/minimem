/**
 * split 执行器
 * 将列表拆成单项逐个发出（与 loop 类似）
 */

import type { NodeExecutor } from './index.js';

export const splitExecutor: NodeExecutor = async (_node, inputs, _ctx, _templateData) => {
  const inputData = inputs.in;

  // 如果不是数组，包装成单元素数组
  const items = Array.isArray(inputData) ? inputData : [inputData];

  return {
    outputs: { out: items },
  };
};
