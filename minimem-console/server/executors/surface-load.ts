/**
 * surface-load 执行器
 * 加载 MiniMem Surface Files
 */

import type { NodeExecutor } from './index.js';
import { getConfig } from '../config.js';

export const surfaceLoadExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const config = getConfig();
  const cfg = node.config as Record<string, any>;

  const agentType = cfg.agent_type || '';
  const params = agentType ? `?agent_type=${agentType}` : '';

  const url = `${config.minimem.base_url}/api/v1/surface${params}`;
  const headers: Record<string, string> = {};
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`MiniMem Surface 加载失败 (${resp.status}): ${body}`);
  }

  const data = await resp.json() as any;

  return {
    outputs: { out: data.surfaces || data },
  };
};
