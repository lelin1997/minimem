/**
 * javascript 执行器
 * 自定义 JavaScript 表达式处理
 */

import type { NodeExecutor } from './index.js';

export const javascriptExecutor: NodeExecutor = async (node, inputs, _ctx, templateData) => {
  const cfg = node.config as Record<string, any>;
  const code = String(cfg.code || '');

  if (!code) {
    throw new Error('javascript 节点缺少必填参数 code');
  }

  // 安全检查
  const forbidden = ['require', 'import', 'eval', 'Function', 'process', 'global', '__proto__', 'constructor', 'fs', 'child_process'];
  for (const word of forbidden) {
    if (code.includes(word)) {
      throw new Error(`代码中包含不允许的关键词: ${word}`);
    }
  }

  const inputData = inputs.in;

  try {
    const fn = new Function('input', 'items', 'text', 'ctx', `
      'use strict';
      const items_local = Array.isArray(input) ? input : undefined;
      const text_local = typeof input === 'string' ? input : undefined;
      ${code}
    `);

    const result = fn(
      inputData,
      Array.isArray(inputData) ? inputData : undefined,
      typeof inputData === 'string' ? inputData : undefined,
      templateData
    );

    return {
      outputs: { out: result },
    };
  } catch (err: any) {
    throw new Error(`JavaScript 执行失败: ${err.message}`);
  }
};
