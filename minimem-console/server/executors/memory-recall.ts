/**
 * memory-recall 执行器
 * 调用 MiniMem 实体召回 API
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';
import { getConfig } from '../config.js';

export const memoryRecallExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const config = getConfig();
  const cfg = node.config as Record<string, any>;

  const entity = cfg.entity
    ? renderTemplate(String(cfg.entity), templateData)
    : '';

  if (!entity) {
    throw new Error('memory-recall 节点缺少必填参数 entity');
  }

  const url = `${config.minimem.base_url}/api/v1/memory/recall/${encodeURIComponent(entity)}`;
  const headers: Record<string, string> = {};
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`MiniMem 实体召回失败 (${resp.status}): ${body}`);
  }

  const data = await resp.json() as any;
  const memories = data.memories || data.results || [];

  return {
    outputs: { out: memories },
  };
};
