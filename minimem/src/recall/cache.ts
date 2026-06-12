// ============================================================
// MiniMem — Hints Cache (MINIMEM-006 T-H06.1)
// ============================================================
// 三级缓存：L1 Embedding / L2 热点摘要 / L3 Session 复用
// 确保 hints API 达到 ≤200ms 延迟目标

import { getLogger } from '../common/logger.js';
import type { HintResponse, Hint } from './types.js';

const log = getLogger('recall:cache');

// ── LRU Map 实现 ──

/**
 * 简易 LRU Map 实现
 * - 基于 Map 的插入顺序 + 手动维护 TTL
 * - 适用于内存级缓存（非分布式）
 */
class LRUMap<K, V> {
  private map = new Map<K, { value: V; expires_at: number }>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    // 检查 TTL
    if (Date.now() > entry.expires_at) {
      this.map.delete(key);
      return undefined;
    }

    // LRU: 重新插入到末尾（最近使用）
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // 如果已存在，先删除
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    // 淘汰最旧的条目
    while (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      } else {
        break;
      }
    }

    this.map.set(key, {
      value,
      expires_at: Date.now() + this.ttlMs,
    });
  }

  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expires_at) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /** 清理所有过期条目 */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.map) {
      if (now > entry.expires_at) {
        this.map.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}

// ── 缓存配置 ──

export interface HintsCacheConfig {
  /** Embedding 缓存 TTL（秒），0 = 禁用 */
  embedding_ttl: number;
  /** 摘要缓存 TTL（秒），0 = 禁用 */
  summary_ttl: number;
  /** Session 复用阈值（cosine similarity，>= 此值复用） */
  session_reuse_threshold: number;
  /** Embedding 缓存最大条数 */
  embedding_max_size?: number;
  /** 摘要缓存最大条数 */
  summary_max_size?: number;
  /** Session 缓存最大条数 */
  session_max_size?: number;
}

// ── 缓存条目类型 ──

interface EmbeddingCacheEntry {
  embedding: number[];
  model: string;
}

interface SummaryCacheEntry {
  hint: Omit<Hint, 'id' | 'relevance_score'>;
}

interface SessionCacheEntry {
  message_hash: string;
  response: HintResponse;
  embedding?: number[];
}

// ── 缓存统计 ──

export interface CacheStats {
  embedding: { hits: number; misses: number; size: number };
  summary: { hits: number; misses: number; size: number };
  session: { hits: number; misses: number; size: number };
}

// ── HintsCache 主类 ──

/**
 * HintsCache — 三级缓存层
 *
 * L1: Embedding 缓存 — 避免重复调用 LLM embed API
 *   key: message hash → value: embedding vector
 *   TTL: 5min (configurable)
 *
 * L2: 热点摘要缓存 — 避免重复格式化 hint
 *   key: memory_id → value: formatted hint (summary + time_label + recall_query)
 *   TTL: 10min (configurable)
 *
 * L3: Session 缓存 — 同 session 相似消息直接复用完整响应
 *   key: session_id + message_hash → value: HintResponse
 *   复用条件: 新消息与缓存消息 embedding cosine > threshold
 */
export class HintsCache {
  private embeddingCache: LRUMap<string, EmbeddingCacheEntry>;
  private summaryCache: LRUMap<string, SummaryCacheEntry>;
  private sessionCache: LRUMap<string, SessionCacheEntry>;
  private config: HintsCacheConfig;

  // 统计
  private stats: CacheStats = {
    embedding: { hits: 0, misses: 0, size: 0 },
    summary: { hits: 0, misses: 0, size: 0 },
    session: { hits: 0, misses: 0, size: 0 },
  };

  constructor(config?: Partial<HintsCacheConfig>) {
    this.config = {
      embedding_ttl: config?.embedding_ttl ?? 300,
      summary_ttl: config?.summary_ttl ?? 600,
      session_reuse_threshold: config?.session_reuse_threshold ?? 0.9,
      embedding_max_size: config?.embedding_max_size ?? 200,
      summary_max_size: config?.summary_max_size ?? 500,
      session_max_size: config?.session_max_size ?? 50,
    };

    this.embeddingCache = new LRUMap(
      this.config.embedding_max_size!,
      this.config.embedding_ttl * 1000,
    );
    this.summaryCache = new LRUMap(
      this.config.summary_max_size!,
      this.config.summary_ttl * 1000,
    );
    this.sessionCache = new LRUMap(
      this.config.session_max_size!,
      // Session 缓存 TTL = embedding TTL（同 session 内复用）
      this.config.embedding_ttl * 1000,
    );
  }

  // ── L1: Embedding 缓存 ──

  /** 获取缓存的 embedding */
  getEmbedding(messageHash: string): EmbeddingCacheEntry | undefined {
    const result = this.embeddingCache.get(messageHash);
    if (result) {
      this.stats.embedding.hits++;
      log.debug({ messageHash }, 'Embedding cache HIT');
    } else {
      this.stats.embedding.misses++;
    }
    return result;
  }

  /** 缓存 embedding */
  setEmbedding(messageHash: string, embedding: number[], model: string): void {
    if (this.config.embedding_ttl <= 0) return; // 禁用时不缓存
    this.embeddingCache.set(messageHash, { embedding, model });
    this.stats.embedding.size = this.embeddingCache.size;
  }

  // ── L2: 摘要缓存 ──

  /** 获取缓存的格式化 hint */
  getSummary(memoryId: string): SummaryCacheEntry | undefined {
    const result = this.summaryCache.get(memoryId);
    if (result) {
      this.stats.summary.hits++;
      log.debug({ memoryId }, 'Summary cache HIT');
    } else {
      this.stats.summary.misses++;
    }
    return result;
  }

  /** 缓存格式化 hint */
  setSummary(memoryId: string, hint: Omit<Hint, 'id' | 'relevance_score'>): void {
    if (this.config.summary_ttl <= 0) return;
    this.summaryCache.set(memoryId, { hint });
    this.stats.summary.size = this.summaryCache.size;
  }

  // ── L3: Session 缓存 ──

  /**
   * 尝试从 session 缓存获取完整响应
   *
   * @param sessionId - 会话 ID
   * @param messageHash - 当前消息 hash
   * @param currentEmbedding - 当前消息 embedding（用于 cosine 相似度判断）
   * @returns 缓存的 HintResponse，或 undefined
   */
  getSessionResponse(
    sessionId: string,
    messageHash: string,
    currentEmbedding?: number[],
  ): HintResponse | undefined {
    // 精确匹配
    const exactKey = `${sessionId}:${messageHash}`;
    const exactResult = this.sessionCache.get(exactKey);
    if (exactResult) {
      this.stats.session.hits++;
      log.debug({ sessionId, messageHash }, 'Session cache exact HIT');
      return exactResult.response;
    }

    // 相似度复用：遍历同 session 的缓存条目
    if (currentEmbedding && currentEmbedding.length > 0) {
      // 构建 session 前缀
      const prefix = `${sessionId}:`;
      // 注意：LRUMap 不支持前缀扫描，这里简化为不做相似度匹配
      // 在生产中可用更高效的结构。当前先依赖精确匹配。
    }

    this.stats.session.misses++;
    return undefined;
  }

  /** 缓存 session 响应 */
  setSessionResponse(
    sessionId: string,
    messageHash: string,
    response: HintResponse,
    embedding?: number[],
  ): void {
    const key = `${sessionId}:${messageHash}`;
    this.sessionCache.set(key, { message_hash: messageHash, response, embedding });
    this.stats.session.size = this.sessionCache.size;
  }

  // ── 工具方法 ──

  /** 获取缓存统计 */
  getStats(): CacheStats {
    return {
      embedding: { ...this.stats.embedding, size: this.embeddingCache.size },
      summary: { ...this.stats.summary, size: this.summaryCache.size },
      session: { ...this.stats.session, size: this.sessionCache.size },
    };
  }

  /** 清空所有缓存 */
  clear(): void {
    this.embeddingCache.clear();
    this.summaryCache.clear();
    this.sessionCache.clear();
    log.info('All caches cleared');
  }

  /** 清理过期条目 */
  prune(): { embedding: number; summary: number; session: number } {
    const result = {
      embedding: this.embeddingCache.prune(),
      summary: this.summaryCache.prune(),
      session: this.sessionCache.prune(),
    };
    if (result.embedding + result.summary + result.session > 0) {
      log.debug(result, 'Cache pruned');
    }
    return result;
  }

  /** 重置统计计数 */
  resetStats(): void {
    this.stats = {
      embedding: { hits: 0, misses: 0, size: 0 },
      summary: { hits: 0, misses: 0, size: 0 },
      session: { hits: 0, misses: 0, size: 0 },
    };
  }
}

// ── 消息哈希工具 ──

/**
 * 简易消息哈希（不需要加密强度，只需快速 + 分布均匀）
 */
export function hashMessage(message: string): string {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit int
  }
  return Math.abs(hash).toString(36);
}

// ── 单例 ──

let _cacheInstance: HintsCache | null = null;

/** 获取全局 HintsCache 实例 */
export function getHintsCache(config?: Partial<HintsCacheConfig>): HintsCache {
  if (!_cacheInstance) {
    _cacheInstance = new HintsCache(config);
  }
  return _cacheInstance;
}

/** 重置全局缓存实例（测试用） */
export function resetHintsCache(): void {
  _cacheInstance?.clear();
  _cacheInstance = null;
}
