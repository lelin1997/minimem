/**
 * loop 执行器
 * 对输入列表的每一项，独立执行一次，并输出每项数据 + 索引元信息
 *
 * 实现策略：
 *   loop 节点将列表拆分为 N 个 item 输出。
 *   引擎在执行时会对 loop 节点做特殊处理（runner 中检测 _loop_items）：
 *   对每一项重新执行下游子图。
 *
 *   当前引擎暂不支持子图展开时，退化为"带元数据的整体传递"：
 *   把 items 数组输出到 item 端口，同时输出 _loop_meta 供模板使用。
 *   下游节点可以用 {{#each}} 遍历，也可以用 {{$loop_count}} 获取总数。
 */

import type { NodeExecutor } from './index.js';

export const loopExecutor: NodeExecutor = async (node, inputs, _ctx, _templateData) => {
  const inputData = inputs.in;
  const cfg = node.config as Record<string, any>;

  // 确保输入是数组
  const items = Array.isArray(inputData)
    ? inputData
    : inputData != null
      ? [inputData]
      : [];

  const maxIterations = Number(cfg.max_iterations || 0);
  const effectiveItems = (maxIterations > 0 && items.length > maxIterations)
    ? items.slice(0, maxIterations)
    : items;

  // 为每一项添加循环元数据
  const enrichedItems = effectiveItems.map((item, index) => ({
    $loop_index: index,
    $loop_count: effectiveItems.length,
    $loop_is_first: index === 0,
    $loop_is_last: index === effectiveItems.length - 1,
    $loop_item: item,
    // 如果 item 本身是对象，展开其字段方便模板直接访问
    ...(item && typeof item === 'object' && !Array.isArray(item) ? item : {}),
  }));

  return {
    outputs: {
      item: enrichedItems,
      _loop_meta: {
        total_items: items.length,
        effective_items: effectiveItems.length,
        truncated: maxIterations > 0 && items.length > maxIterations,
        max_iterations: maxIterations || null,
      },
    },
  };
};
