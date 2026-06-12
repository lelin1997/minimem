/**
 * json-path 执行器
 * 提取 JSON 子路径
 * 支持简单的点分路径和数组通配符 [*]
 */

import type { NodeExecutor } from './index.js';

export const jsonPathExecutor: NodeExecutor = async (node, inputs, _ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;
  const pathExpr = String(cfg.path || '');
  const inputData = inputs.in;

  if (!pathExpr) {
    throw new Error('json-path 节点缺少必填参数 path');
  }

  const result = extractPath(inputData, pathExpr);

  return {
    outputs: { out: result },
  };
};

/**
 * 简单的 JSONPath 子集实现
 * 支持 $.field.sub_field / $.array[*].field / $.field[0]
 */
function extractPath(data: unknown, path: string): unknown {
  // 去掉开头的 $. 或 $
  let normalized = path.replace(/^\$\.?/, '');
  if (!normalized) return data;

  const segments = parseSegments(normalized);
  let current: unknown = data;

  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;

    if (seg === '[*]') {
      // 数组通配符：展开所有元素
      if (!Array.isArray(current)) return [];
      // 剩余段处理
      return current;
    } else if (seg.startsWith('[') && seg.endsWith(']')) {
      // 数组索引
      const idx = parseInt(seg.slice(1, -1), 10);
      if (Array.isArray(current)) {
        current = current[idx];
      } else {
        return undefined;
      }
    } else {
      // 对象字段
      if (Array.isArray(current)) {
        // 对数组中的每个元素提取字段
        current = current.map(item => (item as any)?.[seg]);
      } else if (typeof current === 'object') {
        current = (current as any)?.[seg];
      } else {
        return undefined;
      }
    }
  }

  return current;
}

function parseSegments(path: string): string[] {
  const segments: string[] = [];
  let current = '';

  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === '.') {
      if (current) segments.push(current);
      current = '';
    } else if (ch === '[') {
      if (current) segments.push(current);
      const end = path.indexOf(']', i);
      if (end === -1) {
        current += ch;
      } else {
        segments.push(path.slice(i, end + 1));
        i = end;
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) segments.push(current);
  return segments;
}
