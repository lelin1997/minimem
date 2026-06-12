/**
 * owner-profile 执行器
 * 获取 Owner Profile 用户画像
 */

import type { NodeExecutor } from './index.js';
import { getConfig } from '../config.js';

export const ownerProfileExecutor: NodeExecutor = async (_node, _inputs, _ctx, _templateData) => {
  const config = getConfig();
  const headers: Record<string, string> = {};
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const resp = await fetch(`${config.minimem.base_url}/api/v1/owner/profile`, { headers });

  if (!resp.ok) {
    throw new Error(`获取 Owner Profile 失败 (${resp.status})`);
  }

  const profile = await resp.json();

  return {
    outputs: { out: profile },
  };
};
