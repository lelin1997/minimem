/**
 * inspiration-load 执行器
 * 加载灵感列表 — 通过 MiniMem 引擎灵感 REST API
 */

import type { NodeExecutor } from './index.js';
import { getConfig } from '../config.js';

export const inspirationLoadExecutor: NodeExecutor = async (node, _inputs, _ctx, _templateData) => {
  const config = getConfig();
  const cfg = node.config as Record<string, any>;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const params = new URLSearchParams();
  params.set('limit', '50');
  if (cfg.status) params.set('status', String(cfg.status));
  if (cfg.domain) params.set('domain', String(cfg.domain));

  const resp = await fetch(
    `${config.minimem.base_url}/api/v1/inspirations?${params}`,
    { headers }
  );

  if (!resp.ok) {
    throw new Error(`加载灵感列表失败 (${resp.status})`);
  }

  const data: any = await resp.json();

  return {
    outputs: { out: data.inspirations || data },
  };
};
