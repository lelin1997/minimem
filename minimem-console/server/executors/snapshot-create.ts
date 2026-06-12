/**
 * snapshot-create 执行器
 * 创建 MiniMem 快照
 * 注意：MiniMem 引擎可能未实现 /admin/snapshot 端点
 */

import type { NodeExecutor } from './index.js';
import { getConfig } from '../config.js';

export const snapshotCreateExecutor: NodeExecutor = async (_node, _inputs, _ctx, _templateData) => {
  const config = getConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }

  const resp = await fetch(`${config.minimem.base_url}/api/v1/admin/snapshot`, {
    method: 'POST',
    headers,
  });

  if (resp.status === 404) {
    // 引擎未实现该端点，返回降级信息
    return {
      outputs: { out: { skipped: true, reason: 'MiniMem 引擎未实现 /admin/snapshot 端点' } },
    };
  }

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`创建快照失败 (${resp.status}): ${errBody}`);
  }

  const result = await resp.json();

  return {
    outputs: { out: result },
  };
};
