/**
 * filter 执行器
 * 按条件表达式过滤列表数据
 * 支持表达式如: importance > 0.7, layer == "L1", source.includes("chat")
 */

import type { NodeExecutor, ExecutorResult } from './index.js';

export const filterExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;
  const condition = String(cfg.condition || '');

  if (!condition) {
    throw new Error('filter 节点缺少必填参数 condition');
  }

  const inputData = inputs.in;

  // 如果输入不是数组，尝试包装
  const items = Array.isArray(inputData)
    ? inputData
    : inputData != null
      ? [inputData]
      : [];

  // 构建过滤函数
  const filterFn = buildFilterFunction(condition);
  const filtered = items.filter((item) => {
    try {
      return filterFn(item);
    } catch {
      return false; // 条件求值失败的项被过滤掉
    }
  });

  return {
    outputs: { out: filtered },
  };
};

/**
 * 将条件表达式编译为过滤函数
 * 支持格式：
 *   - field > value
 *   - field == "string"
 *   - field != value
 *   - field.includes("substr")
 *   - field >= value && other_field < value
 */
function buildFilterFunction(condition: string): (item: any) => boolean {
  // 安全检查：不允许有害的操作
  const forbidden = ['require', 'import', 'eval', 'Function', 'process', 'global', '__proto__', 'constructor'];
  for (const word of forbidden) {
    if (condition.includes(word)) {
      throw new Error(`条件表达式中包含不允许的关键词: ${word}`);
    }
  }

  // 使用 Function 构造器，在沙箱化的上下文中执行
  try {
    const fn = new Function('item', `
      with (item) {
        try {
          return Boolean(${condition});
        } catch(e) {
          return false;
        }
      }
    `);
    return fn as (item: any) => boolean;
  } catch (err: any) {
    throw new Error(`条件表达式编译失败: ${condition} — ${err.message}`);
  }
}
