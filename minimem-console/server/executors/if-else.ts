/**
 * if-else 执行器
 * 条件分支：根据表达式结果决定数据走 true 或 false 输出端口
 */

import type { NodeExecutor } from './index.js';

export const ifElseExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;
  const condition = String(cfg.condition || '');

  if (!condition) {
    throw new Error('if-else 节点缺少必填参数 condition');
  }

  const inputData = inputs.in;

  // 安全检查
  const forbidden = ['require', 'import', 'eval', 'Function', 'process', 'global', '__proto__', 'constructor'];
  for (const word of forbidden) {
    if (condition.includes(word)) {
      throw new Error(`条件表达式中包含不允许的关键词: ${word}`);
    }
  }

  // 构建求值上下文
  let result: boolean;
  try {
    const evalContext: Record<string, unknown> = {
      ...templateData,
      input: inputData,
      items: Array.isArray(inputData) ? inputData : undefined,
      text: typeof inputData === 'string' ? inputData : undefined,
      length: Array.isArray(inputData) ? inputData.length : 0,
    };

    // 如果输入是对象，解构到上下文中
    if (inputData && typeof inputData === 'object' && !Array.isArray(inputData)) {
      Object.assign(evalContext, inputData);
    }

    const fn = new Function('ctx', `
      with (ctx) {
        try {
          return Boolean(${condition});
        } catch(e) {
          return false;
        }
      }
    `);
    result = fn(evalContext);
  } catch (err: any) {
    throw new Error(`if-else 条件表达式求值失败: ${condition} — ${err.message}`);
  }

  return {
    outputs: {
      true: result ? inputData : undefined,
      false: result ? undefined : inputData,
    },
  };
};
