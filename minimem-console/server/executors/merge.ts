/**
 * merge 执行器
 * 合并多个输入，支持 concat / zip / object 三种模式
 */

import type { NodeExecutor, ExecutorResult } from './index.js';

export const mergeExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;
  const mode = cfg.mode || 'concat';

  const inA = inputs.in_a;
  const inB = inputs.in_b;

  let result: unknown;

  switch (mode) {
    case 'concat': {
      // 拼接两个数组
      const arrA = Array.isArray(inA) ? inA : inA != null ? [inA] : [];
      const arrB = Array.isArray(inB) ? inB : inB != null ? [inB] : [];
      result = [...arrA, ...arrB];
      break;
    }

    case 'zip': {
      // 按索引配对
      const arrA = Array.isArray(inA) ? inA : inA != null ? [inA] : [];
      const arrB = Array.isArray(inB) ? inB : inB != null ? [inB] : [];
      const maxLen = Math.max(arrA.length, arrB.length);
      result = [];
      for (let i = 0; i < maxLen; i++) {
        (result as any[]).push({
          a: arrA[i] ?? null,
          b: arrB[i] ?? null,
        });
      }
      break;
    }

    case 'object': {
      // 合并为一个对象
      result = { a: inA, b: inB };
      break;
    }

    default:
      throw new Error(`merge 节点不支持的合并模式: ${mode}`);
  }

  return {
    outputs: { out: result },
  };
};
