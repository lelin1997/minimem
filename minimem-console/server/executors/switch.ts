/**
 * switch 执行器
 * 多路条件分支：根据表达式结果匹配 case，将数据路由到对应端口
 * 输出端口：case_0, case_1, ..., default
 */

import type { NodeExecutor } from './index.js';

export const switchExecutor: NodeExecutor = async (node, inputs, _ctx, templateData) => {
  const cfg = node.config as Record<string, any>;
  const expression = String(cfg.expression || '');
  const cases = (cfg.cases as Array<{ value: string; port: string }>) || [];

  if (!expression) {
    throw new Error('switch 节点缺少必填参数 expression');
  }

  const inputData = inputs.in;

  // 安全检查
  const forbidden = ['require', 'import', 'eval', 'Function', 'process', 'global', '__proto__', 'constructor'];
  for (const word of forbidden) {
    if (expression.includes(word)) {
      throw new Error(`表达式中包含不允许的关键词: ${word}`);
    }
  }

  // 计算表达式的值
  let value: unknown;
  try {
    const evalContext: Record<string, unknown> = {
      ...templateData,
      input: inputData,
    };
    if (inputData && typeof inputData === 'object' && !Array.isArray(inputData)) {
      Object.assign(evalContext, inputData);
    }

    const fn = new Function('ctx', `
      with (ctx) {
        try {
          return (${expression});
        } catch(e) {
          return undefined;
        }
      }
    `);
    value = fn(evalContext);
  } catch (err: any) {
    throw new Error(`switch 表达式求值失败: ${expression} — ${err.message}`);
  }

  // 匹配 case
  const outputs: Record<string, unknown> = {};
  let matched = false;
  const valueStr = String(value);

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const port = c.port || `case_${i}`;
    if (String(c.value) === valueStr) {
      outputs[port] = inputData;
      matched = true;
    } else {
      outputs[port] = undefined;
    }
  }

  // 默认端口
  outputs['default'] = matched ? undefined : inputData;

  return { outputs };
};
