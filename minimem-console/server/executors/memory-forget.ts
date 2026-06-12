/**
 * memory-forget 执行器
 * 遗忘指定主题的记忆
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';
import { getConfig } from '../config.js';

export const memoryForgetExecutor: NodeExecutor = async (node, _inputs, _ctx, templateData) => {
  const config = getConfig();
  const cfg = node.config as Record<string, any>;

  const topic = cfg.topic
    ? renderTemplate(String(cfg.topic), templateData)
    : '';

  if (!topic) {
    throw new Error('memory-forget 节点缺少必填参数 topic');
  }

  const dryRun = cfg.dry_run !== 'false'; // 默认为 dry_run 模式

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const resp = await fetch(`${config.minimem.base_url}/api/v1/memory/forget`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ topic, dry_run: dryRun }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`遗忘主题 "${topic}" 失败 (${resp.status}): ${errBody}`);
  }

  const result = await resp.json();

  return {
    outputs: { out: result },
  };
};
