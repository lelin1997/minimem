import { Hono } from 'hono';
import { getConfig } from '../config.js';

export const inspirationRoutes = new Hono();

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

// GET / — 灵感列表
inspirationRoutes.get('/', async (c) => {
  const url = new URL(c.req.url);
  const params = new URLSearchParams();
  for (const key of ['status', 'domain', 'limit', 'offset']) {
    const val = url.searchParams.get(key);
    if (val) params.set(key, val);
  }
  try {
    const resp = await fetch(`${baseUrl()}/api/v1/inspirations?${params}`, { headers: buildHeaders() });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      return c.json(err, resp.status as any);
    }
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch inspirations', detail: err.message }, 502);
  }
});

// GET /:id — 灵感详情
inspirationRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const resp = await fetch(`${baseUrl()}/api/v1/inspiration/${encodeURIComponent(id)}`, { headers: buildHeaders() });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      return c.json(err, resp.status as any);
    }
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch inspiration', detail: err.message }, 502);
  }
});

// POST /:id/rate — 评分
inspirationRoutes.post('/:id/rate', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  try {
    const resp = await fetch(`${baseUrl()}/api/v1/inspiration/${encodeURIComponent(id)}/rate`, {
      method: 'POST', headers: buildHeaders(), body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      return c.json(err, resp.status as any);
    }
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: 'Failed to rate inspiration', detail: err.message }, 502);
  }
});

// POST /:id/act — 标记已行动
inspirationRoutes.post('/:id/act', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  try {
    const resp = await fetch(`${baseUrl()}/api/v1/inspiration/${encodeURIComponent(id)}/act`, {
      method: 'POST', headers: buildHeaders(), body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      return c.json(err, resp.status as any);
    }
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: 'Failed to act on inspiration', detail: err.message }, 502);
  }
});

// DELETE /:id — Dismiss
inspirationRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const url = new URL(c.req.url);
  const params = new URLSearchParams();
  for (const key of ['mode', 'reason']) {
    const val = url.searchParams.get(key);
    if (val) params.set(key, val);
  }
  try {
    const resp = await fetch(`${baseUrl()}/api/v1/inspiration/${encodeURIComponent(id)}?${params}`, {
      method: 'DELETE', headers: buildHeaders(),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      return c.json(err, resp.status as any);
    }
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: 'Failed to dismiss inspiration', detail: err.message }, 502);
  }
});

// POST /dismiss — 批量 Dismiss
inspirationRoutes.post('/dismiss', async (c) => {
  const body = await c.req.json();
  try {
    const resp = await fetch(`${baseUrl()}/api/v1/inspirations/dismiss`, {
      method: 'POST', headers: buildHeaders(), body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      return c.json(err, resp.status as any);
    }
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: 'Failed to batch dismiss', detail: err.message }, 502);
  }
});

// POST /trigger — 触发灵感引擎
inspirationRoutes.post('/trigger', async (c) => {
  try {
    const resp = await fetch(`${baseUrl()}/api/v1/dream/trigger`, {
      method: 'POST', headers: buildHeaders(),
      body: JSON.stringify({ mode: 'daily', phases: [3.5] }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      return c.json(err, resp.status as any);
    }
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: 'Failed to trigger inspiration engine', detail: err.message }, 502);
  }
});
