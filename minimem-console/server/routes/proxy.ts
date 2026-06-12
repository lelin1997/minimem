import { Hono } from 'hono';
import { getConfig } from '../config.js';

export const proxyRoutes = new Hono();

/**
 * 通用代理：将前端请求透明转发到 MiniMem 引擎
 * GET/POST/PUT/DELETE /proxy/api/v1/* → MiniMem base_url/api/v1/*
 */
proxyRoutes.all('/api/v1/*', async (c) => {
  const config = getConfig();
  const targetPath = c.req.path.replace(/^\/proxy/, '');
  const targetUrl = new URL(targetPath, config.minimem.base_url);

  // 保留查询参数
  const url = new URL(c.req.url);
  targetUrl.search = url.search;

  // 构建转发请求
  const headers = new Headers();
  // 复制原始请求头（过滤 host 和 authorization）
  for (const [key, value] of c.req.raw.headers.entries()) {
    if (key.toLowerCase() !== 'host' && key.toLowerCase() !== 'authorization') {
      headers.set(key, value);
    }
  }

  // 附加认证 Token
  if (config.minimem.api_token) {
    headers.set('Authorization', `Bearer ${config.minimem.api_token}`);
  }

  try {
    const resp = await fetch(targetUrl.toString(), {
      method: c.req.method,
      headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.clone().arrayBuffer(),
    });

    // 透传响应
    const respHeaders = new Headers();
    for (const [key, value] of resp.headers.entries()) {
      if (!['transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
        respHeaders.set(key, value);
      }
    }

    return new Response(resp.body, {
      status: resp.status,
      headers: respHeaders,
    });
  } catch (err: any) {
    return c.json(
      { error: 'Failed to connect to MiniMem', detail: err.message },
      502
    );
  }
});

/**
 * MiniMem API 代理：前端直接请求 /api/v1/* 自动转发到 minimem
 * 这是为了避免前端需要知道 /proxy 前缀
 */
proxyRoutes.all('/v1/*', async (c) => {
  const config = getConfig();
  const targetPath = c.req.path;  // /api/v1/xxx
  const targetUrl = new URL(targetPath, config.minimem.base_url);

  const url = new URL(c.req.url);
  targetUrl.search = url.search;

  const headers = new Headers();
  // 复制原始请求头（过滤 host 和 authorization）
  for (const [key, value] of c.req.raw.headers.entries()) {
    if (key.toLowerCase() !== 'host' && key.toLowerCase() !== 'authorization') {
      headers.set(key, value);
    }
  }

  // 附加认证 Token（使用配置的 JWT）
  if (config.minimem.api_token) {
    headers.set('Authorization', `Bearer ${config.minimem.api_token}`);
  }

  try {
    const resp = await fetch(targetUrl.toString(), {
      method: c.req.method,
      headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.clone().arrayBuffer(),
    });

    const respHeaders = new Headers();
    for (const [key, value] of resp.headers.entries()) {
      if (!['transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
        respHeaders.set(key, value);
      }
    }

    return new Response(resp.body, {
      status: resp.status,
      headers: respHeaders,
    });
  } catch (err: any) {
    return c.json(
      { error: 'Failed to connect to MiniMem', detail: err.message },
      502
    );
  }
});

