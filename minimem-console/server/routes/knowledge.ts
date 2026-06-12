import { Hono } from 'hono';
import { getConfig } from '../config.js';

export const knowledgeRoutes = new Hono();

function buildHeaders(): Record<string, string> {
  const config = getConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.minimem.api_token) {
    headers['Authorization'] = `Bearer ${config.minimem.api_token}`;
  }
  return headers;
}

function baseUrl(): string {
  return getConfig().minimem.base_url;
}

// GET / — 知识列表（分页 + 搜索 + 标签筛选）
knowledgeRoutes.get('/', async (c) => {
  const url = new URL(c.req.url);
  const params = new URLSearchParams();
  for (const key of ['page', 'page_size', 'search', 'tag', 'domain', 'status']) {
    const val = url.searchParams.get(key);
    if (val) params.set(key, val);
  }
  try {
    const resp = await fetch(`${baseUrl()}/api/v1/knowledge?${params}`, {
      headers: buildHeaders(),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      return c.json(err, resp.status as any);
    }
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch knowledge list', detail: err.message }, 502);
  }
});

// GET /:id — 知识详情
knowledgeRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const resp = await fetch(`${baseUrl()}/api/v1/knowledge/${encodeURIComponent(id)}`, {
      headers: buildHeaders(),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      return c.json(err, resp.status as any);
    }
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch knowledge', detail: err.message }, 502);
  }
});

// DELETE /:id — 删除/归档知识
knowledgeRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const url = new URL(c.req.url);
  const mode = url.searchParams.get('mode') || 'archive'; // archive | delete
  try {
    const resp = await fetch(
      `${baseUrl()}/api/v1/knowledge/${encodeURIComponent(id)}?mode=${mode}`,
      { method: 'DELETE', headers: buildHeaders() }
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      return c.json(err, resp.status as any);
    }
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: 'Failed to delete knowledge', detail: err.message }, 502);
  }
});

// GET /tags — 获取所有已有标签（用于筛选下拉）
knowledgeRoutes.get('/tags/list', async (c) => {
  try {
    const resp = await fetch(`${baseUrl()}/api/v1/knowledge/tags`, {
      headers: buildHeaders(),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      return c.json(err, resp.status as any);
    }
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch tags', detail: err.message }, 502);
  }
});
