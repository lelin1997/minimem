/**
 * output-minimem 执行器
 * 将内容作为记忆写回 MiniMem
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';
import { getConfig } from '../config.js';

export const outputMinimemExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const config = getConfig();
  const cfg = node.config as Record<string, any>;

  const content = inputs.in;
  const contentStr = typeof content === 'string'
    ? content
    : JSON.stringify(content, null, 2);

  if (!contentStr) {
    throw new Error('output-minimem 节点没有接收到输入内容');
  }

  // 解析标签
  const tagsStr = cfg.tags || '';
  const tags = tagsStr
    ? tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean)
    : [];

  const body = {
    content: contentStr,
    source: cfg.source || 'minimem-console',
    content_type: cfg.content_type || undefined,
    importance: cfg.importance != null ? Number(cfg.importance) : undefined,
    tags,
  };

  const url = `${config.minimem.base_url}/api/v1/memory`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`MiniMem 写入记忆失败 (${resp.status}): ${errBody}`);
  }

  const result = await resp.json();

  return {
    outputs: { out: result },
  };
};
