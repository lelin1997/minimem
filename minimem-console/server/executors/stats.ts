/**
 * stats 执行器
 * 获取各层记忆数量统计
 */

import type { NodeExecutor } from './index.js';
import { getConfig } from '../config.js';

export const statsExecutor: NodeExecutor = async (_node, _inputs, _ctx, _templateData) => {
  const config = getConfig();
  const headers: Record<string, string> = {};
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const resp = await fetch(`${config.minimem.base_url}/api/v1/admin/stats`, { headers });

  if (!resp.ok) {
    throw new Error(`获取统计数据失败 (${resp.status})`);
  }

  const stats = await resp.json();

  return {
    outputs: { out: stats },
  };
};
