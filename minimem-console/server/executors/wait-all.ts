/**
 * wait-all 执行器
 * 汇聚节点：等待所有输入端口都收到数据后，将它们合并输出
 * 引擎的拓扑排序 + 同层并行已经保证了上游全部执行完才会到此节点
 * 此执行器负责将多个输入合并为一个对象或数组
 */

import type { NodeExecutor } from './index.js';

export const waitAllExecutor: NodeExecutor = async (node, inputs, _ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;
  const mode = String(cfg.merge_mode || 'object'); // object | array | first

  const inputKeys = Object.keys(inputs).filter((k) => inputs[k] !== undefined);

  if (inputKeys.length === 0) {
    return { outputs: { out: null } };
  }

  let merged: unknown;

  switch (mode) {
    case 'array': {
      // 将所有输入值放入数组
      merged = inputKeys.map((k) => inputs[k]);
      break;
    }
    case 'first': {
      // 取第一个有值的输入
      merged = inputs[inputKeys[0]];
      break;
    }
    case 'object':
    default: {
      // 合并为对象：{ portId: data, ... }
      const obj: Record<string, unknown> = {};
      for (const k of inputKeys) {
        obj[k] = inputs[k];
      }
      merged = obj;
      break;
    }
  }

  return { outputs: { out: merged } };
};
