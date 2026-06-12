/**
 * output-webhook 执行器
 * 发送 HTTP Webhook 通知
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';

export const outputWebhookExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;

  const url = String(cfg.url || '');
  if (!url) {
    throw new Error('output-webhook 节点缺少必填参数 url');
  }

  const method = cfg.method || 'POST';
  const content = inputs.in;

  // 解析 headers
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.headers) {
    try {
      const parsed = typeof cfg.headers === 'string' ? JSON.parse(cfg.headers) : cfg.headers;
      headers = { ...headers, ...parsed };
    } catch {
      // 忽略无效 headers
    }
  }

  // 构建 body
  let body: string;
  if (cfg.body_template) {
    const extendedData = {
      ...templateData,
      input: content,
      text: typeof content === 'string' ? content : undefined,
    };
    body = renderTemplate(String(cfg.body_template), extendedData);
  } else {
    body = typeof content === 'string' ? content : JSON.stringify(content);
  }

  const resp = await fetch(url, {
    method,
    headers,
    body,
  });

  return {
    outputs: {
      out: {
        status: resp.status,
        statusText: resp.statusText,
        ok: resp.ok,
      },
    },
  };
};
