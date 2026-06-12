// ============================================================
// MiniMem — LLM Cache（REQ-016: 降低重复调用开销）
// ============================================================
// 基于 SQLite 的 LLM 响应缓存，按 prompt hash 匹配

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import { createHash } from 'node:crypto';

const log = getLogger('llm:cache');

export interface CacheEntry {
  id: string;
  prompt_hash: string;
  model: string;
  response: string;
  usage_json: string;
  hit_count: number;
  created_at: string;
  expires_at: string;
}

/**
 * LLM 响应缓存
 *
 * 策略：
 * - key = SHA-256(model + messages JSON)
 * - TTL 默认 24h（可配置）
 * - 最多缓存 1000 条，超过后 LRU 淘汰最老的
 * - 只缓存 JSON 模式请求（结构化、确定性高）
 */
export class LLMCache {
  private ttlMs: number;
  private maxEntries: number;
  private enabled: boolean;

  constructor(options?: { ttlMs?: number; maxEntries?: number; enabled?: boolean }) {
    this.ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000; // 默认 24h
    this.maxEntries = options?.maxEntries ?? 1000;
    this.enabled = options?.enabled ?? true;
  }

  /**
   * 计算缓存 key（prompt hash）
   */
  private computeKey(model: string, messages: Array<{ role: string; content: string }>): string {
    const payload = JSON.stringify({ model, messages });
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * 查询缓存
   */
  get(model: string, messages: Array<{ role: string; content: string }>): { response: string; usage: Record<string, number> } | null {
    if (!this.enabled) return null;

    try {
      const db = getDb();
      const hash = this.computeKey(model, messages);
      const timestamp = now();

      const entry = db.prepare(
        `SELECT response, usage_json FROM llm_cache WHERE prompt_hash = ? AND model = ? AND expires_at > ?`
      ).get(hash, model, timestamp) as { response: string; usage_json: string } | undefined;

      if (entry) {
        // 更新 hit_count
        db.prepare(
          `UPDATE llm_cache SET hit_count = hit_count + 1 WHERE prompt_hash = ? AND model = ?`
        ).run(hash, model);

        log.debug({ model, hash: hash.slice(0, 12) }, 'LLM cache hit');
        return {
          response: entry.response,
          usage: JSON.parse(entry.usage_json),
        };
      }

      return null;
    } catch (err) {
      log.warn({ err }, 'LLM cache get failed');
      return null;
    }
  }

  /**
   * 写入缓存
   */
  set(
    model: string,
    messages: Array<{ role: string; content: string }>,
    response: string,
    usage: Record<string, number>,
  ): void {
    if (!this.enabled) return;

    try {
      const db = getDb();
      const hash = this.computeKey(model, messages);
      const timestamp = now();
      const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();

      // Upsert
      db.prepare(`
        INSERT INTO llm_cache (id, prompt_hash, model, response, usage_json, hit_count, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(prompt_hash, model) DO UPDATE SET
          response = excluded.response,
          usage_json = excluded.usage_json,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
      `).run(generateId(), hash, model, response, JSON.stringify(usage), timestamp, expiresAt);

      // 淘汰超限条目
      this.evictIfNeeded(db);

      log.debug({ model, hash: hash.slice(0, 12) }, 'LLM cache set');
    } catch (err) {
      log.warn({ err }, 'LLM cache set failed');
    }
  }

  /**
   * 淘汰过期和超限条目
   */
  private evictIfNeeded(db: ReturnType<typeof getDb>): void {
    try {
      // 清理过期
      db.prepare(`DELETE FROM llm_cache WHERE expires_at <= ?`).run(now());

      // LRU 淘汰
      const count = (db.prepare('SELECT COUNT(*) as count FROM llm_cache').get() as { count: number }).count;
      if (count > this.maxEntries) {
        const excess = count - this.maxEntries;
        db.prepare(`
          DELETE FROM llm_cache WHERE id IN (
            SELECT id FROM llm_cache ORDER BY created_at ASC LIMIT ?
          )
        `).run(excess);
        log.debug({ evicted: excess }, 'LLM cache eviction');
      }
    } catch {
      // 非关键路径
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    try {
      const db = getDb();
      db.prepare('DELETE FROM llm_cache').run();
      log.info('LLM cache cleared');
    } catch (err) {
      log.warn({ err }, 'LLM cache clear failed');
    }
  }

  /**
   * 获取缓存统计
   */
  stats(): { total: number; expired: number } {
    try {
      const db = getDb();
      const total = (db.prepare('SELECT COUNT(*) as count FROM llm_cache').get() as { count: number }).count;
      const expired = (db.prepare('SELECT COUNT(*) as count FROM llm_cache WHERE expires_at <= ?').get(now()) as { count: number }).count;
      return { total, expired };
    } catch {
      return { total: 0, expired: 0 };
    }
  }
}

// ── 单例 ──
let _cache: LLMCache | null = null;

export function getLLMCache(): LLMCache {
  if (!_cache) {
    _cache = new LLMCache();
  }
  return _cache;
}
