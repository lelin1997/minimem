// ============================================================
// MiniMem — HNSW 索引测试 (MINIMEM-003 / TODO-E01.2 + E01.3)
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { HNSWIndex } from '../../src/store/hnsw-index.js';

// ── 工具函数 ──

/** 生成随机单位向量 */
function randomVector(dim: number): Float32Array {
  const v = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() * 2 - 1;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

/** 暴力扫描余弦搜索（ground truth） */
function bruteForceSearch(
  query: Float32Array,
  vectors: Map<string, Float32Array>,
  topK: number,
): Array<{ id: string; similarity: number }> {
  const results: Array<{ id: string; similarity: number }> = [];

  const qNorm = Math.sqrt(query.reduce((s, v) => s + v * v, 0));
  if (qNorm === 0) return [];

  for (const [id, vec] of vectors) {
    const vNorm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (vNorm === 0) continue;

    let dot = 0;
    for (let i = 0; i < query.length; i++) dot += query[i] * vec[i];
    const sim = dot / (qNorm * vNorm);
    results.push({ id, similarity: sim });
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}

// ── 测试用例 ──

describe('HNSWIndex', () => {
  const DIM = 128; // 测试用较低维度加速

  describe('基本操作', () => {
    let index: HNSWIndex;

    beforeEach(() => {
      index = new HNSWIndex({ dimensions: DIM, M: 16, efConstruction: 200, efSearch: 50 });
    });

    it('空索引搜索返回空', () => {
      const results = index.search(randomVector(DIM), 10);
      expect(results).toEqual([]);
    });

    it('插入单个向量后可搜索到', () => {
      const v = randomVector(DIM);
      index.insert('a', v);
      expect(index.size).toBe(1);

      const results = index.search(v, 1);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('a');
      expect(results[0].distance).toBeLessThan(0.01); // 几乎完全匹配
    });

    it('插入多个向量后搜索正确', () => {
      const vectors = new Map<string, Float32Array>();
      for (let i = 0; i < 100; i++) {
        const v = randomVector(DIM);
        vectors.set(`v${i}`, v);
        index.insert(`v${i}`, v);
      }
      expect(index.size).toBe(100);

      // 搜索第一个向量
      const query = vectors.get('v0')!;
      const results = index.search(query, 5);
      expect(results.length).toBe(5);
      expect(results[0].id).toBe('v0');
      expect(results[0].distance).toBeLessThan(0.01);
    });

    it('删除后搜索不到', () => {
      index.insert('a', randomVector(DIM));
      index.insert('b', randomVector(DIM));
      expect(index.size).toBe(2);

      index.remove('a');
      expect(index.size).toBe(1);
      expect(index.has('a')).toBe(false);
      expect(index.has('b')).toBe(true);

      // 搜索结果不包含已删除的
      const results = index.search(randomVector(DIM), 10);
      const ids = results.map(r => r.id);
      expect(ids).not.toContain('a');
    });

    it('重复插入相同 ID 会覆盖', () => {
      const v1 = randomVector(DIM);
      const v2 = randomVector(DIM);
      index.insert('a', v1);
      index.insert('a', v2);
      expect(index.size).toBe(1);

      // 搜索 v2 应该找到 a
      const results = index.search(v2, 1);
      expect(results[0].id).toBe('a');
      expect(results[0].distance).toBeLessThan(0.01);
    });

    it('compact 真正删除节点', () => {
      for (let i = 0; i < 50; i++) {
        index.insert(`v${i}`, randomVector(DIM));
      }
      expect(index.size).toBe(50);

      // 删除一半
      for (let i = 0; i < 25; i++) {
        index.remove(`v${i}`);
      }
      expect(index.size).toBe(25);
      expect(index.totalNodes).toBe(50); // 惰性删除，节点仍在

      const compacted = index.compact();
      expect(compacted).toBe(25);
      expect(index.totalNodes).toBe(25);
      expect(index.size).toBe(25);
    });

    it('维度不匹配时抛出错误', () => {
      const wrongDim = new Float32Array(DIM + 1);
      expect(() => index.insert('a', wrongDim)).toThrow('dimension mismatch');
    });

    it('零维度抛出错误', () => {
      expect(() => new HNSWIndex({ dimensions: 0 })).toThrow('dimensions must be positive');
    });

    it('getStats 返回正确统计', () => {
      for (let i = 0; i < 20; i++) {
        index.insert(`v${i}`, randomVector(DIM));
      }
      index.remove('v0');

      const stats = index.getStats();
      expect(stats.activeNodes).toBe(19);
      expect(stats.deletedNodes).toBe(1);
      expect(stats.totalNodes).toBe(20);
      expect(stats.dimensions).toBe(DIM);
    });
  });

  describe('序列化/反序列化', () => {
    it('序列化后反序列化保持一致', () => {
      const index = new HNSWIndex({ dimensions: DIM, M: 16, efConstruction: 100, efSearch: 30 });

      const vectors = new Map<string, Float32Array>();
      for (let i = 0; i < 200; i++) {
        const v = randomVector(DIM);
        vectors.set(`v${i}`, v);
        index.insert(`v${i}`, v);
      }

      // 删除一些
      index.remove('v0');
      index.remove('v5');

      // 序列化
      const buf = index.serialize();
      expect(buf.length).toBeGreaterThan(0);

      // 反序列化
      const restored = HNSWIndex.deserialize(buf);
      expect(restored.size).toBe(index.size);
      expect(restored.totalNodes).toBe(index.totalNodes);
      expect(restored.dimensions).toBe(DIM);

      // 搜索结果一致
      const query = vectors.get('v10')!;
      const origResults = index.search(query, 5);
      const restoredResults = restored.search(query, 5);

      expect(restoredResults.length).toBe(origResults.length);
      for (let i = 0; i < origResults.length; i++) {
        expect(restoredResults[i].id).toBe(origResults[i].id);
        expect(restoredResults[i].distance).toBeCloseTo(origResults[i].distance, 5);
      }
    });

    it('空索引序列化/反序列化', () => {
      const index = new HNSWIndex({ dimensions: DIM });
      const buf = index.serialize();
      const restored = HNSWIndex.deserialize(buf);
      expect(restored.size).toBe(0);
      expect(restored.dimensions).toBe(DIM);
    });
  });

  describe('召回率测试 (T-E01.2)', () => {
    it('500 向量 Top-10 召回率 > 95%', () => {
      const dim = 64;
      const count = 500;
      const numQueries = 20;
      const topK = 10;

      const index = new HNSWIndex({ dimensions: dim, M: 16, efConstruction: 200, efSearch: 100 });
      const vectors = new Map<string, Float32Array>();

      for (let i = 0; i < count; i++) {
        const v = randomVector(dim);
        vectors.set(`v${i}`, v);
        index.insert(`v${i}`, v);
      }

      let totalRecall = 0;
      for (let q = 0; q < numQueries; q++) {
        const query = randomVector(dim);
        const groundTruth = bruteForceSearch(query, vectors, topK);
        const truthIds = new Set(groundTruth.map(r => r.id));
        const hnswResults = index.search(query, topK);
        const hnswIds = new Set(hnswResults.map(r => r.id));
        let hits = 0;
        for (const id of hnswIds) {
          if (truthIds.has(id)) hits++;
        }
        totalRecall += hits / topK;
      }

      const avgRecall = totalRecall / numQueries;
      console.log(`  Average recall@${topK}: ${(avgRecall * 100).toFixed(1)}%`);
      expect(avgRecall).toBeGreaterThan(0.95);
    });
  });

  describe('性能基准测试 (T-E01.2)', () => {
    it('2000 向量搜索延迟 < 5ms', { timeout: 30000 }, () => {
      const dim = 64;
      const count = 2000;
      const numQueries = 50;
      const topK = 10;

      const index = new HNSWIndex({ dimensions: dim, M: 16, efConstruction: 200, efSearch: 50 });

      const buildStart = Date.now();
      for (let i = 0; i < count; i++) {
        index.insert(`v${i}`, randomVector(dim));
      }
      const buildTime = Date.now() - buildStart;
      console.log(`  Build time for ${count} vectors: ${buildTime}ms`);

      const queries = Array.from({ length: numQueries }, () => randomVector(dim));
      const searchStart = Date.now();
      for (const q of queries) {
        index.search(q, topK);
      }
      const searchTime = Date.now() - searchStart;
      const avgSearchTime = searchTime / numQueries;

      console.log(`  Average search time: ${avgSearchTime.toFixed(2)}ms`);
      expect(avgSearchTime).toBeLessThan(5);
    });
  });
});
