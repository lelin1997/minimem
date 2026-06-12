// ============================================================
// MiniMem — 速率限制器
// ============================================================
// 全局 60 写/分钟，单客户端 20 写/分钟

import { getLogger } from '../common/logger.js';
import { RateLimitError } from '../common/errors.js';
import type { Context, Next } from 'hono';

const log = getLogger('gateway:rate-limiter');

interface RateWindow {
  count: number;
  resetAt: number; // Unix timestamp (ms)
}

// ── 速率窗口存储 ──

const globalWriteWindow: RateWindow = { count: 0, resetAt: Date.now() + 60_000 };
const clientWindows: Map<string, { read: RateWindow; write: RateWindow }> = new Map();

// ── 配置 ──

const GLOBAL_WRITE_LIMIT = 60; // 60 writes/min
const DEFAULT_CLIENT_WRITE_LIMIT = 20; // 20 writes/min/client
const DEFAULT_CLIENT_READ_LIMIT = 60; // 60 reads/min/client
const WINDOW_MS = 60_000; // 1 minute

/**
 * Hono 中间件：速率限制
 */
export function rateLimiterMiddleware() {
  return async (c: Context, next: Next) => {
    const client = c.get('client') as { id: string; writes_per_minute?: number; reads_per_minute?: number } | undefined;
    const clientId = client?.id ?? 'anonymous';
    const isWrite = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.req.method);

    const now = Date.now();

    // 全局写入限制
    if (isWrite) {
      if (now >= globalWriteWindow.resetAt) {
        globalWriteWindow.count = 0;
        globalWriteWindow.resetAt = now + WINDOW_MS;
      }
      globalWriteWindow.count++;

      if (globalWriteWindow.count > GLOBAL_WRITE_LIMIT) {
        log.warn({ clientId, globalCount: globalWriteWindow.count }, 'Global write rate limit exceeded');
        throw new RateLimitError(GLOBAL_WRITE_LIMIT, 'minute (global)');
      }
    }

    // 客户端限制
    let windows = clientWindows.get(clientId);
    if (!windows) {
      windows = {
        read: { count: 0, resetAt: now + WINDOW_MS },
        write: { count: 0, resetAt: now + WINDOW_MS },
      };
      clientWindows.set(clientId, windows);
    }

    if (isWrite) {
      if (now >= windows.write.resetAt) {
        windows.write.count = 0;
        windows.write.resetAt = now + WINDOW_MS;
      }
      windows.write.count++;

      const limit = client?.writes_per_minute ?? DEFAULT_CLIENT_WRITE_LIMIT;
      if (windows.write.count > limit) {
        log.warn({ clientId, count: windows.write.count, limit }, 'Client write rate limit exceeded');
        throw new RateLimitError(limit, 'minute (per client write)');
      }
    } else {
      if (now >= windows.read.resetAt) {
        windows.read.count = 0;
        windows.read.resetAt = now + WINDOW_MS;
      }
      windows.read.count++;

      const limit = client?.reads_per_minute ?? DEFAULT_CLIENT_READ_LIMIT;
      if (windows.read.count > limit) {
        log.warn({ clientId, count: windows.read.count, limit }, 'Client read rate limit exceeded');
        throw new RateLimitError(limit, 'minute (per client read)');
      }
    }

    // 设置 Rate-Limit 头
    if (isWrite) {
      const remaining = Math.max(0, (client?.writes_per_minute ?? DEFAULT_CLIENT_WRITE_LIMIT) - windows.write.count);
      c.header('X-RateLimit-Limit', String(client?.writes_per_minute ?? DEFAULT_CLIENT_WRITE_LIMIT));
      c.header('X-RateLimit-Remaining', String(remaining));
      c.header('X-RateLimit-Reset', String(Math.ceil(windows.write.resetAt / 1000)));
    }

    await next();
  };
}

/**
 * 清理过期的客户端窗口（定期调用）
 */
export function cleanupRateWindows(): void {
  const now = Date.now();
  const cutoff = now - WINDOW_MS * 5; // 5 分钟前的窗口

  for (const [clientId, windows] of clientWindows) {
    if (windows.read.resetAt < cutoff && windows.write.resetAt < cutoff) {
      clientWindows.delete(clientId);
    }
  }

  // 清理 recall 窗口
  for (const [clientId, windows] of recallWindows) {
    if (windows.hints.resetAt < cutoff && windows.auto.resetAt < cutoff) {
      recallWindows.delete(clientId);
    }
  }
}

// ── Recall 端点专属限流（T-H03.3）──

const RECALL_HINTS_LIMIT = 60; // 60 req/min per client
const RECALL_AUTO_LIMIT = 30;  // 30 req/min per client

const recallWindows: Map<string, { hints: RateWindow; auto: RateWindow }> = new Map();

/**
 * Recall 端点专属限流中间件
 *
 * hints 端点: 60 req/min per client
 * auto 端点:  30 req/min per client
 */
export function recallRateLimiterMiddleware() {
  return async (c: Context, next: Next) => {
    const client = c.get('client') as { id: string } | undefined;
    const clientId = client?.id ?? 'anonymous';
    const path = c.req.path;
    const currentTime = Date.now();

    // 判断是 hints 还是 auto 端点
    const isHints = path.includes('/recall/hints');
    const isAuto = path.includes('/recall/auto');
    if (!isHints && !isAuto) {
      await next();
      return;
    }

    // 获取或创建客户端窗口
    let windows = recallWindows.get(clientId);
    if (!windows) {
      windows = {
        hints: { count: 0, resetAt: currentTime + WINDOW_MS },
        auto: { count: 0, resetAt: currentTime + WINDOW_MS },
      };
      recallWindows.set(clientId, windows);
    }

    if (isHints) {
      if (currentTime >= windows.hints.resetAt) {
        windows.hints.count = 0;
        windows.hints.resetAt = currentTime + WINDOW_MS;
      }
      windows.hints.count++;

      if (windows.hints.count > RECALL_HINTS_LIMIT) {
        log.warn({ clientId, count: windows.hints.count, limit: RECALL_HINTS_LIMIT }, 'Recall hints rate limit exceeded');
        c.header('Retry-After', String(Math.ceil((windows.hints.resetAt - currentTime) / 1000)));
        throw new RateLimitError(RECALL_HINTS_LIMIT, 'minute (recall hints)');
      }

      // 设置 Rate-Limit 响应头
      const remaining = Math.max(0, RECALL_HINTS_LIMIT - windows.hints.count);
      c.header('X-RateLimit-Limit', String(RECALL_HINTS_LIMIT));
      c.header('X-RateLimit-Remaining', String(remaining));
      c.header('X-RateLimit-Reset', String(Math.ceil(windows.hints.resetAt / 1000)));
    }

    if (isAuto) {
      if (currentTime >= windows.auto.resetAt) {
        windows.auto.count = 0;
        windows.auto.resetAt = currentTime + WINDOW_MS;
      }
      windows.auto.count++;

      if (windows.auto.count > RECALL_AUTO_LIMIT) {
        log.warn({ clientId, count: windows.auto.count, limit: RECALL_AUTO_LIMIT }, 'Recall auto rate limit exceeded');
        c.header('Retry-After', String(Math.ceil((windows.auto.resetAt - currentTime) / 1000)));
        throw new RateLimitError(RECALL_AUTO_LIMIT, 'minute (recall auto)');
      }

      // 设置 Rate-Limit 响应头
      const remaining = Math.max(0, RECALL_AUTO_LIMIT - windows.auto.count);
      c.header('X-RateLimit-Limit', String(RECALL_AUTO_LIMIT));
      c.header('X-RateLimit-Remaining', String(remaining));
      c.header('X-RateLimit-Reset', String(Math.ceil(windows.auto.resetAt / 1000)));
    }

    await next();
  };
}

/**
 * 获取当前速率状态（用于监控）
 */
export function getRateLimitStats(): {
  global_writes: number;
  active_clients: number;
  recall_active_clients: number;
} {
  return {
    global_writes: globalWriteWindow.count,
    active_clients: clientWindows.size,
    recall_active_clients: recallWindows.size,
  };
}
