// ============================================================
// MiniMem — Score Fusion (MINIMEM-006 T-H01.6)
// ============================================================
// 多路信号加权融合 + 归一化 + 去重 + 层级加权

import { getLogger } from '../common/logger.js';
import type { MemoryLayer } from '../common/types.js';
import type { SignalResult, FusionCandidate, SignalSource } from './types.js';

const log = getLogger('recall:fusion');

/** 层级加权系数 */
const LAYER_BOOST: Record<MemoryLayer, number> = {
  L4: 1.1,  // 心智模型，最稳定
  L3: 1.2,  // 观察/偏好，最有 hint 价值
  L2: 1.0,  // 事实，正常
  L1: 0.6,  // 原始经历，降权（不适合做 hint）
};

export interface FusionWeights {
  semantic_weight: number;
  entity_weight: number;
  time_weight: number;
  graph_weight: number;
}

const DEFAULT_WEIGHTS: FusionWeights = {
  semantic_weight: 0.50,
  entity_weight: 0.25,
  time_weight: 0.15,
  graph_weight: 0.10,
};

/**
 * 多路信号融合
 *
 * 1. 归一化每路信号的分数到 [0, 1]
 * 2. 按配置权重加权求和
 * 3. 同一 memory_id 的多路信号融合为单条（取各信号最高分）
 * 4. 层级加权
 * 5. 按最终分数降序排列
 */
export function fuseScores(
  signals: SignalResult[],
  weights: FusionWeights = DEFAULT_WEIGHTS,
  minScore: number = 0.3,
): FusionCandidate[] {
  if (signals.length === 0) return [];

  // Step 1: 按 memory_id 聚合各信号
  const candidateMap = new Map<string, {
    memory_id: string;
    layer: MemoryLayer;
    signals: Partial<Record<SignalSource, number>>;
  }>();

  for (const signal of signals) {
    const existing = candidateMap.get(signal.memory_id);
    if (existing) {
      // 同一信号源取最高分
      const currentScore = existing.signals[signal.source] ?? 0;
      if (signal.score > currentScore) {
        existing.signals[signal.source] = signal.score;
      }
    } else {
      candidateMap.set(signal.memory_id, {
        memory_id: signal.memory_id,
        layer: signal.layer,
        signals: { [signal.source]: signal.score },
      });
    }
  }

  // Step 2: 归一化 + 加权融合 + 层级加权
  const weightMap: Record<SignalSource, number> = {
    semantic: weights.semantic_weight,
    entity: weights.entity_weight,
    time: weights.time_weight,
    graph: weights.graph_weight,
  };

  const results: FusionCandidate[] = [];

  for (const candidate of candidateMap.values()) {
    // 加权融合
    let fusedScore = 0;
    let totalWeight = 0;

    for (const [source, score] of Object.entries(candidate.signals) as Array<[SignalSource, number]>) {
      const weight = weightMap[source] ?? 0;
      fusedScore += score * weight;
      totalWeight += weight;
    }

    // 归一化：确保非参与的信号不占权重
    if (totalWeight > 0 && totalWeight < 1) {
      fusedScore = fusedScore / totalWeight;
    }

    // 层级加权
    const layerBoost = LAYER_BOOST[candidate.layer] ?? 1.0;
    const finalScore = Math.min(1, fusedScore * layerBoost);

    if (finalScore >= minScore) {
      results.push({
        memory_id: candidate.memory_id,
        layer: candidate.layer,
        signals: candidate.signals,
        final_score: finalScore,
      });
    }
  }

  // Step 3: 按最终分数降序排列
  results.sort((a, b) => b.final_score - a.final_score);

  log.debug({ inputSignals: signals.length, candidates: candidateMap.size, passed: results.length }, 'Score fusion complete');

  return results;
}
