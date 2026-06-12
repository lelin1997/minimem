/**
 * health-check 执行器
 * 获取 MiniMem 健康状态和统计数据
 */

import type { NodeExecutor } from './index.js';
import { getConfig } from '../config.js';

export const healthCheckExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const config = getConfig();
  const headers: Record<string, string> = {};
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  // 并行请求 health 和 stats
  const [healthResp, statsResp] = await Promise.all([
    fetch(`${config.minimem.base_url}/api/v1/health`, { headers }),
    fetch(`${config.minimem.base_url}/api/v1/admin/stats`, { headers }),
  ]);

  const health = healthResp.ok ? await healthResp.json() : { status: 'unknown' };
  const stats = statsResp.ok ? await statsResp.json() : {};

  return {
    outputs: {
      out: {
        health,
        stats,
      },
    },
  };
};
