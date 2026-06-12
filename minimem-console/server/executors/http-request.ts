/**
 * http-request 执行器
 * 通用 HTTP 请求节点
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';

export const httpRequestExecutor: NodeExecutor = async (node, _inputs, _ctx, templateData) => {
  const cfg = node.config as Record<string, any>;

  const url = cfg.url ? renderTemplate(String(cfg.url), templateData) : '';
  if (!url) {
    throw new Error('http-request 节点缺少必填参数 url');
  }

  const method = cfg.method || 'GET';

  // 解析 headers
  let headers: Record<string, string> = {};
  if (cfg.headers) {
    try {
      const parsed = typeof cfg.headers === 'string' ? JSON.parse(cfg.headers) : cfg.headers;
      headers = { ...headers, ...parsed };
    } catch {
      // 忽略无效 headers
    }
  }

  // 构建 body（仅 POST/PUT 有 body）
  const fetchOptions: RequestInit = { method, headers };
  if (cfg.body && (method === 'POST' || method === 'PUT')) {
    const body = renderTemplate(String(cfg.body), templateData);
    fetchOptions.body = body;
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const resp = await fetch(url, fetchOptions);
  let data: unknown;
  const contentType = resp.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    data = await resp.json();
  } else {
    data = await resp.text();
  }

  if (!resp.ok) {
    throw new Error(`HTTP ${method} ${url} 失败 (${resp.status}): ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    outputs: { out: data },
  };
};
