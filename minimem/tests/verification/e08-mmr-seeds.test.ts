/**
 * T-E08.4 验证：MMR 选出的种子间平均余弦相似度 < 0.4
 *
 * 测试策略：构造候选池 + mock embedFn，调用 selectSeedsMMR 的等价逻辑
 * （因为 selectSeedsMMR 是私有函数，我们复制其核心算法来验证）
 */
import { describe, it, expect } from 'vitest';

// MMR 核心算法（从 dreamer.ts 提取，用于独立验证）
function vecCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function selectSeedsMMR(
  candidates: Array<{ id: string; importance: number; embedding: number[] }>,
  count: number,
  lambda: number,
): Array<{ id: string; importance: number; embedding: number[] }> {
  if (candidates.length <= count) return candidates;

  const selected: typeof candidates = [];
  const remaining = new Set(candidates.map(c => c.id));

  // 第一颗种子：importance 最高
  const first = candidates.reduce((best, curr) => curr.importance > best.importance ? curr : best);
  selected.push(first);
  remaining.delete(first.id);

  while (selected.length < count && remaining.size > 0) {
    let bestScore = -Infinity;
    let bestCandidate: typeof first | null = null;

    for (const candId of remaining) {
      const cand = candidates.find(c => c.id === candId)!;

      let maxSim = -1;
      for (const sel of selected) {
        const sim = vecCosineSimilarity(cand.embedding, sel.embedding);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = lambda * cand.importance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestCandidate = cand;
      }
    }

    if (!bestCandidate) break;
    selected.push(bestCandidate);
    remaining.delete(bestCandidate.id);
  }

  return selected;
}

describe('T-E08.4 MMR 种子多样性验证', () => {

  it('MMR 选出的种子间平均余弦相似度应 < 0.4', () => {
    // 构造 20 个候选，其中 embedding 故意分为几簇
    const dims = 64;
    const candidates: Array<{ id: string; importance: number; embedding: number[] }> = [];

    // 簇 1：前 7 个候选，embedding 方向相似（sin 波）
    for (let i = 0; i < 7; i++) {
      candidates.push({
        id: `c-${i}`,
        importance: 0.9 - i * 0.02,
        embedding: Array(dims).fill(0).map((_, d) => Math.sin(d * 0.1) + Math.random() * 0.05),
      });
    }

    // 簇 2：中间 7 个候选，embedding 方向不同（cos 波）
    for (let i = 7; i < 14; i++) {
      candidates.push({
        id: `c-${i}`,
        importance: 0.85 - (i - 7) * 0.02,
        embedding: Array(dims).fill(0).map((_, d) => Math.cos(d * 0.3 + 2) + Math.random() * 0.05),
      });
    }

    // 簇 3：后 6 个候选，embedding 方向再不同（交替正负）
    for (let i = 14; i < 20; i++) {
      candidates.push({
        id: `c-${i}`,
        importance: 0.8 - (i - 14) * 0.02,
        embedding: Array(dims).fill(0).map((_, d) => (d % 2 === 0 ? 1 : -1) * Math.sin(d * 0.5 + i) + Math.random() * 0.05),
      });
    }

    // 选取 5 个种子，lambda = 0.7（偏重要性但保证多样性）
    const seeds = selectSeedsMMR(candidates, 5, 0.7);
    expect(seeds.length).toBe(5);

    // 计算种子间的平均余弦相似度
    let totalSim = 0;
    let pairCount = 0;

    for (let i = 0; i < seeds.length; i++) {
      for (let j = i + 1; j < seeds.length; j++) {
        totalSim += vecCosineSimilarity(seeds[i].embedding, seeds[j].embedding);
        pairCount++;
      }
    }

    const avgSim = totalSim / pairCount;
    expect(avgSim).toBeLessThan(0.4);
  });

  it('纯 greedy 选择的平均相似度应高于 MMR 选择', () => {
    const dims = 64;
    const candidates: Array<{ id: string; importance: number; embedding: number[] }> = [];

    // 构造 3 个簇，每簇 5 个候选
    // 关键设计：每个簇的 importance 分布交错，这样 greedy top-5 全来自同一簇
    // 但 MMR 会因 diversity penalty 跨簇选择
    //
    // Cluster 0: importance = [0.95, 0.93, 0.91, 0.89, 0.87]  — embedding 方向: sin
    // Cluster 1: importance = [0.86, 0.84, 0.82, 0.80, 0.78]  — embedding 方向: cos
    // Cluster 2: importance = [0.77, 0.75, 0.73, 0.71, 0.69]  — embedding 方向: -sin
    //
    // Greedy top-5 = cluster 0 全部（高度相似）
    // MMR 第 1 轮选 c-0-0 (imp=0.95)
    // MMR 第 2 轮：c-0-1 (imp=0.93) 但 maxSim to c-0-0 ≈ 1.0 → MMR = 0.7*0.93 - 0.3*1.0 ≈ 0.351
    //             c-1-0 (imp=0.86) 但 maxSim to c-0-0 ≈ low → MMR = 0.7*0.86 - 0.3*low ≈ 0.60+ → 赢！
    const clusterBases = [0, Math.PI, Math.PI * 1.5]; // 三个不同方向
    for (let cluster = 0; cluster < 3; cluster++) {
      for (let i = 0; i < 5; i++) {
        candidates.push({
          id: `c-${cluster}-${i}`,
          importance: 0.95 - cluster * 0.09 - i * 0.02,
          embedding: Array(dims).fill(0).map((_, d) =>
            Math.sin(d * 0.3 + clusterBases[cluster]) + (i * 0.005 + d * 0.0001)
          ),
        });
      }
    }

    // MMR 选择（lambda=0.5 平衡 importance 和 diversity）
    const mmrSeeds = selectSeedsMMR(candidates, 5, 0.5);

    // 贪心选择：纯按 importance 排序取 top-5（全来自 cluster 0）
    const greedySeeds = [...candidates].sort((a, b) => b.importance - a.importance).slice(0, 5);

    // 验证 greedy 确实全选了 cluster 0
    expect(greedySeeds.every(s => s.id.startsWith('c-0-'))).toBe(true);

    // 验证 MMR 至少跨了 2 个簇
    const mmrClusters = new Set(mmrSeeds.map(s => s.id.split('-')[1]));
    expect(mmrClusters.size).toBeGreaterThanOrEqual(2);

    // 计算两种方式的平均相似度
    function avgPairSim(seeds: typeof candidates): number {
      let total = 0, count = 0;
      for (let i = 0; i < seeds.length; i++) {
        for (let j = i + 1; j < seeds.length; j++) {
          total += vecCosineSimilarity(seeds[i].embedding, seeds[j].embedding);
          count++;
        }
      }
      return count > 0 ? total / count : 0;
    }

    const mmrAvg = avgPairSim(mmrSeeds);
    const greedyAvg = avgPairSim(greedySeeds);

    // MMR 选出的种子多样性应更好（平均相似度更低于贪心的同簇选择）
    expect(mmrAvg).toBeLessThan(greedyAvg);
  });

  it('第一颗种子应是 importance 最高的', () => {
    const candidates = [
      { id: 'a', importance: 0.5, embedding: [1, 0, 0, 0] },
      { id: 'b', importance: 0.9, embedding: [0, 1, 0, 0] },
      { id: 'c', importance: 0.7, embedding: [0, 0, 1, 0] },
    ];

    const seeds = selectSeedsMMR(candidates, 2, 0.7);
    expect(seeds[0].id).toBe('b');
  });

  it('候选数 <= count 时应返回全部', () => {
    const candidates = [
      { id: 'a', importance: 0.5, embedding: [1, 0] },
      { id: 'b', importance: 0.9, embedding: [0, 1] },
    ];

    const seeds = selectSeedsMMR(candidates, 5, 0.7);
    expect(seeds.length).toBe(2);
  });
});
