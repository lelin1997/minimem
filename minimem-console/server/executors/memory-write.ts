/**
 * memory-write 执行器
 * 向 MiniMem 写入记忆（基于模板渲染的内容）
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';
import { getConfig } from '../config.js';

export const memoryWriteExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const config = getConfig();
  const cfg = node.config as Record<string, any>;

  // 将输入注入模板数据
  const extendedData = {
    ...templateData,
    input: inputs.in,
    items: Array.isArray(inputs.in) ? inputs.in : undefined,
    text: typeof inputs.in === 'string' ? inputs.in : undefined,
  };

  // 渲染内容模板
  const content = cfg.content_template
    ? renderTemplate(String(cfg.content_template), extendedData)
    : (typeof inputs.in === 'string' ? inputs.in : JSON.stringify(inputs.in));

  if (!content) {
    throw new Error('memory-write 节点没有可写入的内容');
  }

  // 解析标签
  const tagsStr = cfg.tags || '';
  const tags = tagsStr
    ? tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean)
    : [];

  const body = {
    content,
    source: cfg.source || 'minimem-console',
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
