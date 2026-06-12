/**
 * delay 执行器
 * 延迟节点：等待指定毫秒后再透传数据
 * 可用于限流、节拍控制、避免 API 频率限制等场景
 */

import type { NodeExecutor } from './index.js';

export const delayExecutor: NodeExecutor = async (node, inputs, _ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;
  const delayMs = Number(cfg.delay_ms || 1000);

  // 安全限制：最长延迟 5 分钟
  const safeDelay = Math.min(Math.max(0, delayMs), 300_000);

  const inputData = inputs.in;

  if (safeDelay > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, safeDelay));
  }

  return {
    outputs: {
      out: inputData,
    },
  };
};
