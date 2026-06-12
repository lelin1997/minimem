/**
 * temperature 执行器
 * 获取记忆温度分布
 */

import type { NodeExecutor } from './index.js';
import { getConfig } from '../config.js';

export const temperatureExecutor: NodeExecutor = async (_node, _inputs, _ctx, _templateData) => {
  const config = getConfig();
  const headers: Record<string, string> = {};
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const resp = await fetch(`${config.minimem.base_url}/api/v1/admin/temperature`, { headers });

  if (!resp.ok) {
    throw new Error(`获取温度分布失败 (${resp.status})`);
  }

  const temperature = await resp.json();

  return {
    outputs: { out: temperature },
  };
};
