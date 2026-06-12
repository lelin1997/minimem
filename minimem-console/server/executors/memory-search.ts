/**
 * memory-search 执行器
 * 调用 MiniMem 搜索 API 获取记忆
 */

import type { NodeExecutor, ExecutorResult } from './index.js';
import { renderTemplate } from '../engine/template.js';
import { getConfig } from '../config.js';

export const memorySearchExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const config = getConfig();
  const cfg = node.config as Record<string, any>;

  // 渲染模板字段
  const query = renderTemplate(String(cfg.query || ''), templateData);
  const topK = cfg.top_k || 20;
  const timeFrom = cfg.time_from ? renderTemplate(String(cfg.time_from), templateData) : undefined;
  const timeTo = cfg.time_to ? renderTemplate(String(cfg.time_to), templateData) : undefined;
  const domain = cfg.domain ? renderTemplate(String(cfg.domain), templateData) : undefined;
  const layer = cfg.layer || undefined;
  const source = cfg.source ? renderTemplate(String(cfg.source), templateData) : undefined;

  if (!query) {
    throw new Error('memory-search 节点缺少必填参数 query');
  }

  // 构建查询参数
  const params = new URLSearchParams({ query, top_k: String(topK) });
  if (timeFrom) params.set('time_from', timeFrom);
  if (timeTo) params.set('time_to', timeTo);
  if (domain) params.set('domain', domain);
  if (layer) params.set('layer', layer);
  if (source) params.set('source', source);

  // 调用 MiniMem API
  const url = `${config.minimem.base_url}/api/v1/memory/search?${params.toString()}`;
  const headers: Record<string, string> = {};
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`MiniMem 搜索失败 (${resp.status}): ${body}`);
  }

  const data = await resp.json() as any;
  const memories = data.results || data.memories || data || [];

  return {
    outputs: { out: memories },
  };
};
