/**
 * dream-trigger 执行器
 * 触发 MiniMem Dream（做梦）
 */

import type { NodeExecutor } from './index.js';
import { getConfig } from '../config.js';

export const dreamTriggerExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const config = getConfig();
  const cfg = node.config as Record<string, any>;

  const mode = cfg.mode || 'daily';
  const phasesStr = cfg.phases || '';
  const phases = phasesStr
    ? phasesStr.split(',').map((p: string) => parseInt(p.trim(), 10)).filter((n: number) => !isNaN(n))
    : undefined;

  const body: Record<string, any> = { mode };
  if (phases && phases.length > 0) {
    body.phases = phases;
  }

  const url = `${config.minimem.base_url}/api/v1/dream/trigger`;
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
    throw new Error(`MiniMem Dream 触发失败 (${resp.status}): ${errBody}`);
  }

  const result = await resp.json();

  return {
    outputs: { out: result },
  };
};
