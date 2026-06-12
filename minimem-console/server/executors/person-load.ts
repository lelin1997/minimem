/**
 * person-load 执行器
 * 加载一个或所有人设
 */

import type { NodeExecutor } from './index.js';
import { getConfig } from '../config.js';

export const personLoadExecutor: NodeExecutor = async (node, _inputs, _ctx, _templateData) => {
  const config = getConfig();
  const cfg = node.config as Record<string, any>;
  const headers: Record<string, string> = {};
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const name = cfg.name ? String(cfg.name).trim() : '';

  if (name) {
    // 加载单个人设
    const resp = await fetch(
      `${config.minimem.base_url}/api/v1/owner/person/${encodeURIComponent(name)}`,
      { headers }
    );
    if (!resp.ok) {
      throw new Error(`加载人设 "${name}" 失败 (${resp.status})`);
    }
    const person = await resp.json();
    return { outputs: { out: person } };
  } else {
    // 加载所有人设
    const resp = await fetch(`${config.minimem.base_url}/api/v1/persons`, { headers });
    if (!resp.ok) {
      throw new Error(`加载人设列表失败 (${resp.status})`);
    }
    const data: any = await resp.json();
    return { outputs: { out: data.persons || data } };
  }
};
