/**
 * memory-list 执行器
 * 调用 MiniMem /api/v1/memories 列表 API 获取记忆
 */

import type { NodeExecutor } from './index.js';
import { getConfig } from '../config.js';

export const memoryListExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const config = getConfig();
  const cfg = node.config as Record<string, any>;

  const pageSize = cfg.page_size || 50;
  const layer = cfg.layer || undefined;

  const params = new URLSearchParams({
    page: '1',
    page_size: String(pageSize),
  });
  if (layer) params.set('layer', layer);

  const url = `${config.minimem.base_url}/api/v1/memories?${params.toString()}`;
  const headers: Record<string, string> = {};
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`MiniMem 浏览记忆失败 (${resp.status}): ${body}`);
  }

  const data = await resp.json() as any;
  const memories = data.memories || [];

  return {
    outputs: { out: memories },
  };
};
