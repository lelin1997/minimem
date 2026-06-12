/**
 * MiniMem — Hints Cache 单元测试 (T-H10.5)
 *
 * 测试三级缓存系统：
 * - LRU 淘汰
 * - TTL 过期
 * - Session 精确匹配复用
 * - 缓存命中/未命中统计
 * - hashMessage 工具函数
 * - prune / clear
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HintsCache, hashMessage, resetHintsCache } from '../../src/recall/cache.js';
import type { HintResponse } from '../../src/recall/types.js';

describe('HintsCache — Three-level Cache System', () => {
  let cache: HintsCache;

  beforeEach(() => {
    resetHintsCache();
    cache = new HintsCache({
      embedding_ttl: 5,    // 5 seconds for test
      summary_ttl: 10,     // 10 seconds for test
      session_reuse_threshold: 0.9,
      embedding_max_size: 5,
      summary_max_size: 5,
      session_max_size: 3,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── L1: Embedding Cache ──

  describe('L1: Embedding Cache', () => {
    it('should store and retrieve embedding', () => {
      const embedding = [0.1, 0.2, 0.3];
      cache.setEmbedding('hash1', embedding, 'text-embedding-3-small');
      const result = cache.getEmbedding('hash1');
      expect(result).toBeDefined();
      expect(result!.embedding).toEqual(embedding);
      expect(result!.model).toBe('text-embedding-3-small');
    });

    it('should return undefined for missing key', () => {
      const result = cache.getEmbedding('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should expire after TTL', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      cache.setEmbedding('hash1', [0.1], 'model');

      // Advance time beyond TTL (5 seconds)
      vi.spyOn(Date, 'now').mockReturnValue(now + 6000);

      const result = cache.getEmbedding('hash1');
      expect(result).toBeUndefined();
    });

    it('should evict oldest entry when max size exceeded (LRU)', () => {
      // Fill cache to max (5)
      for (let i = 0; i < 5; i++) {
        cache.setEmbedding(`hash${i}`, [i], 'model');
      }

      // Add one more → should evict hash0
      cache.setEmbedding('hash5', [5], 'model');

      expect(cache.getEmbedding('hash0')).toBeUndefined();
      expect(cache.getEmbedding('hash5')).toBeDefined();
    });

    it('should refresh LRU order on access', () => {
      for (let i = 0; i < 5; i++) {
        cache.setEmbedding(`hash${i}`, [i], 'model');
      }

      // Access hash0 → moves to end
      cache.getEmbedding('hash0');

      // Add new entry → should evict hash1 (oldest after hash0 was refreshed)
      cache.setEmbedding('hash5', [5], 'model');

      expect(cache.getEmbedding('hash0')).toBeDefined(); // still alive
      expect(cache.getEmbedding('hash1')).toBeUndefined(); // evicted
    });

    it('should not cache when embedding_ttl = 0 (disabled)', () => {
      const disabledCache = new HintsCache({ embedding_ttl: 0 });
      disabledCache.setEmbedding('hash1', [0.1], 'model');
      expect(disabledCache.getEmbedding('hash1')).toBeUndefined();
    });
  });

  // ── L2: Summary Cache ──

  describe('L2: Summary Cache', () => {
    const mockHint = {
      memory_id: 'mem1',
      summary: '用户喜欢TypeScript',
      time_label: '3天前',
      recall_query: 'TypeScript 偏好',
      layer: 'L3' as const,
      tags: ['coding'],
    };

    it('should store and retrieve summary', () => {
      cache.setSummary('mem1', mockHint);
      const result = cache.getSummary('mem1');
      expect(result).toBeDefined();
      expect(result!.hint.summary).toBe('用户喜欢TypeScript');
    });

    it('should return undefined for missing summary', () => {
      expect(cache.getSummary('nonexistent')).toBeUndefined();
    });

    it('should expire summary after TTL', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      cache.setSummary('mem1', mockHint);

      // Advance beyond summary TTL (10 seconds)
      vi.spyOn(Date, 'now').mockReturnValue(now + 11000);

      expect(cache.getSummary('mem1')).toBeUndefined();
    });

    it('should not cache when summary_ttl = 0', () => {
      const disabledCache = new HintsCache({ summary_ttl: 0 });
      disabledCache.setSummary('mem1', mockHint);
      expect(disabledCache.getSummary('mem1')).toBeUndefined();
    });
  });

  // ── L3: Session Cache ──

  describe('L3: Session Cache', () => {
    const mockResponse: HintResponse = {
      hints: [{
        id: 'hint_1',
        memory_id: 'mem1',
        summary: 'test summary',
        time_label: '刚才',
        relevance_score: 0.9,
        recall_query: 'test query',
        layer: 'L3',
        tags: [],
      }],
      meta: { search_time_ms: 50, total_candidates: 3, token_count: 20 },
    };

    it('should store and retrieve session response (exact match)', () => {
      cache.setSessionResponse('session1', 'msgHash1', mockResponse);
      const result = cache.getSessionResponse('session1', 'msgHash1');
      expect(result).toBeDefined();
      expect(result!.hints).toHaveLength(1);
      expect(result!.hints[0].summary).toBe('test summary');
    });

    it('should return undefined for different session', () => {
      cache.setSessionResponse('session1', 'msgHash1', mockResponse);
      const result = cache.getSessionResponse('session2', 'msgHash1');
      expect(result).toBeUndefined();
    });

    it('should return undefined for different message hash', () => {
      cache.setSessionResponse('session1', 'msgHash1', mockResponse);
      const result = cache.getSessionResponse('session1', 'msgHash2');
      expect(result).toBeUndefined();
    });

    it('should evict oldest session entry when max size exceeded', () => {
      // Max session size = 3
      cache.setSessionResponse('s1', 'h1', mockResponse);
      cache.setSessionResponse('s1', 'h2', mockResponse);
      cache.setSessionResponse('s1', 'h3', mockResponse);

      // Add 4th → should evict first
      cache.setSessionResponse('s1', 'h4', mockResponse);

      expect(cache.getSessionResponse('s1', 'h1')).toBeUndefined();
      expect(cache.getSessionResponse('s1', 'h4')).toBeDefined();
    });
  });

  // ── Statistics ──

  describe('Cache Statistics', () => {
    it('should track hit/miss counts', () => {
      cache.setEmbedding('hash1', [0.1], 'model');

      cache.getEmbedding('hash1'); // hit
      cache.getEmbedding('hash2'); // miss
      cache.getEmbedding('hash1'); // hit

      const stats = cache.getStats();
      expect(stats.embedding.hits).toBe(2);
      expect(stats.embedding.misses).toBe(1);
    });

    it('should track size correctly', () => {
      cache.setEmbedding('h1', [1], 'model');
      cache.setEmbedding('h2', [2], 'model');

      const stats = cache.getStats();
      expect(stats.embedding.size).toBe(2);
    });

    it('should reset stats', () => {
      cache.setEmbedding('h1', [1], 'model');
      cache.getEmbedding('h1');

      cache.resetStats();
      const stats = cache.getStats();
      expect(stats.embedding.hits).toBe(0);
      expect(stats.embedding.misses).toBe(0);
    });
  });

  // ── Prune ──

  describe('Prune', () => {
    it('should remove expired entries', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      cache.setEmbedding('h1', [1], 'model');
      cache.setEmbedding('h2', [2], 'model');

      // Advance past TTL
      vi.spyOn(Date, 'now').mockReturnValue(now + 6000);

      const pruned = cache.prune();
      expect(pruned.embedding).toBe(2);
    });
  });

  // ── Clear ──

  describe('Clear', () => {
    it('should clear all caches', () => {
      cache.setEmbedding('h1', [1], 'model');
      cache.setSummary('mem1', { memory_id: 'mem1', summary: 'x', time_label: 'y', recall_query: 'z', layer: 'L3', tags: [] });
      cache.setSessionResponse('s1', 'h1', { hints: [], meta: { search_time_ms: 0, total_candidates: 0, token_count: 0 } });

      cache.clear();

      expect(cache.getEmbedding('h1')).toBeUndefined();
      expect(cache.getSummary('mem1')).toBeUndefined();
      expect(cache.getSessionResponse('s1', 'h1')).toBeUndefined();
    });
  });
});

// ── hashMessage ──

describe('hashMessage', () => {
  it('should return a string', () => {
    const hash = hashMessage('hello world');
    expect(typeof hash).toBe('string');
  });

  it('should return same hash for same input', () => {
    expect(hashMessage('test message')).toBe(hashMessage('test message'));
  });

  it('should return different hashes for different inputs', () => {
    expect(hashMessage('hello')).not.toBe(hashMessage('world'));
  });

  it('should handle empty string', () => {
    const hash = hashMessage('');
    expect(typeof hash).toBe('string');
    expect(hash).toBe('0');
  });

  it('should handle Chinese characters', () => {
    const hash = hashMessage('你好世界');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('should handle long messages', () => {
    const longMsg = 'a'.repeat(10000);
    const hash = hashMessage(longMsg);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeLessThan(20); // should be compact
  });
});
