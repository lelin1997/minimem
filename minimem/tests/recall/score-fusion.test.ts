/**
 * MiniMem — Score Fusion 单元测试 (T-H10.4)
 *
 * 测试 fuseScores() 的多路信号融合：
 * - 权重配置正确应用
 * - 归一化正确（非参与信号不占权重）
 * - 去重逻辑（同 memory_id 同源取最高分）
 * - 层级加权
 * - 边界值（所有信号都为 0 / 都为 1）
 * - 空输入
 */

import { describe, it, expect } from 'vitest';
import { fuseScores, type FusionWeights } from '../../src/recall/score-fusion.js';
import type { SignalResult } from '../../src/recall/types.js';

const DEFAULT_WEIGHTS: FusionWeights = {
  semantic_weight: 0.50,
  entity_weight: 0.25,
  time_weight: 0.15,
  graph_weight: 0.10,
};

describe('fuseScores — Score Fusion', () => {
  // ── 空输入 ──

  describe('Empty input', () => {
    it('should return empty array for empty signals', () => {
      const result = fuseScores([], DEFAULT_WEIGHTS, 0.3);
      expect(result).toEqual([]);
    });
  });

  // ── 单路信号 ──

  describe('Single signal source', () => {
    it('should normalize single semantic signal correctly', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.8, source: 'semantic', layer: 'L3' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      expect(result.length).toBe(1);
      // semantic weight = 0.5, total weight = 0.5
      // normalized: 0.8 * 0.5 / 0.5 = 0.8
      // L3 boost: 0.8 * 1.2 = 0.96
      expect(result[0].final_score).toBeCloseTo(0.96, 2);
      expect(result[0].memory_id).toBe('mem1');
      expect(result[0].layer).toBe('L3');
    });

    it('should normalize single entity signal correctly', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem2', score: 0.6, source: 'entity', layer: 'L2' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      expect(result.length).toBe(1);
      // entity weight = 0.25, total weight = 0.25
      // normalized: 0.6 * 0.25 / 0.25 = 0.6
      // L2 boost: 0.6 * 1.0 = 0.6
      expect(result[0].final_score).toBeCloseTo(0.6, 2);
    });
  });

  // ── 多路信号融合 ──

  describe('Multi-signal fusion', () => {
    it('should fuse semantic + entity for same memory_id', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.8, source: 'semantic', layer: 'L3' },
        { memory_id: 'mem1', score: 0.6, source: 'entity', layer: 'L3' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      expect(result.length).toBe(1);
      // semantic: 0.8 * 0.5 = 0.4
      // entity: 0.6 * 0.25 = 0.15
      // total weight: 0.5 + 0.25 = 0.75
      // fused: (0.4 + 0.15) / 0.75 = 0.7333...
      // L3 boost: 0.7333 * 1.2 = 0.88
      expect(result[0].final_score).toBeCloseTo(0.88, 2);
    });

    it('should fuse all four signals', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.9, source: 'semantic', layer: 'L2' },
        { memory_id: 'mem1', score: 0.7, source: 'entity', layer: 'L2' },
        { memory_id: 'mem1', score: 0.5, source: 'time', layer: 'L2' },
        { memory_id: 'mem1', score: 0.4, source: 'graph', layer: 'L2' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      expect(result.length).toBe(1);
      // total weight = 0.5 + 0.25 + 0.15 + 0.10 = 1.0
      // fused = 0.9*0.5 + 0.7*0.25 + 0.5*0.15 + 0.4*0.10 = 0.45 + 0.175 + 0.075 + 0.04 = 0.74
      // L2 boost: 0.74 * 1.0 = 0.74
      expect(result[0].final_score).toBeCloseTo(0.74, 2);
    });

    it('should handle different memory_ids correctly', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.9, source: 'semantic', layer: 'L3' },
        { memory_id: 'mem2', score: 0.7, source: 'entity', layer: 'L2' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      expect(result.length).toBe(2);
      // mem1: semantic only, 0.9 * 0.5 / 0.5 = 0.9, L3 boost = 0.9 * 1.2 = 1.0 (capped at 1)
      // mem2: entity only, 0.7 * 0.25 / 0.25 = 0.7, L2 boost = 0.7 * 1.0 = 0.7
      expect(result[0].memory_id).toBe('mem1');
      expect(result[0].final_score).toBe(1); // capped
      expect(result[1].memory_id).toBe('mem2');
      expect(result[1].final_score).toBeCloseTo(0.7, 2);
    });
  });

  // ── 去重逻辑 ──

  describe('Deduplication', () => {
    it('should keep highest score for same memory_id + same source', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.5, source: 'semantic', layer: 'L3' },
        { memory_id: 'mem1', score: 0.8, source: 'semantic', layer: 'L3' }, // 更高分
        { memory_id: 'mem1', score: 0.3, source: 'semantic', layer: 'L3' }, // 更低分
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      expect(result.length).toBe(1);
      // should use 0.8 (highest)
      // 0.8 * 0.5 / 0.5 = 0.8, L3: 0.8 * 1.2 = 0.96
      expect(result[0].final_score).toBeCloseTo(0.96, 2);
    });
  });

  // ── 层级加权 ──

  describe('Layer boost', () => {
    it('L4 should get 1.1x boost', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.5, source: 'semantic', layer: 'L4' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      // 0.5 * 1.1 = 0.55
      expect(result[0].final_score).toBeCloseTo(0.55, 2);
    });

    it('L3 should get 1.2x boost', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.5, source: 'semantic', layer: 'L3' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      // 0.5 * 1.2 = 0.6
      expect(result[0].final_score).toBeCloseTo(0.6, 2);
    });

    it('L2 should get 1.0x boost (no change)', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.5, source: 'semantic', layer: 'L2' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      // 0.5 * 1.0 = 0.5
      expect(result[0].final_score).toBeCloseTo(0.5, 2);
    });

    it('L1 should get 0.6x boost (penalty)', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.8, source: 'semantic', layer: 'L1' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      // 0.8 * 0.6 = 0.48
      expect(result[0].final_score).toBeCloseTo(0.48, 2);
    });
  });

  // ── minScore 过滤 ──

  describe('minScore threshold', () => {
    it('should filter candidates below minScore', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.9, source: 'semantic', layer: 'L3' },
        { memory_id: 'mem2', score: 0.2, source: 'entity', layer: 'L1' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      // mem1: 0.9 * 1.2 = 1.0 (cap) → pass
      // mem2: 0.2 * 0.6 = 0.12 → filtered (< 0.3)
      expect(result.length).toBe(1);
      expect(result[0].memory_id).toBe('mem1');
    });

    it('should return all if minScore = 0', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.1, source: 'time', layer: 'L1' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0);
      // 0.1 * 0.6 = 0.06 → >= 0
      expect(result.length).toBe(1);
    });
  });

  // ── 排序 ──

  describe('Sorting', () => {
    it('should sort by final_score descending', () => {
      const signals: SignalResult[] = [
        { memory_id: 'low', score: 0.4, source: 'semantic', layer: 'L2' },
        { memory_id: 'high', score: 0.9, source: 'semantic', layer: 'L3' },
        { memory_id: 'mid', score: 0.6, source: 'semantic', layer: 'L2' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      expect(result[0].memory_id).toBe('high');
      expect(result[1].memory_id).toBe('mid');
      expect(result[2].memory_id).toBe('low');
    });
  });

  // ── 边界值 ──

  describe('Boundary values', () => {
    it('should handle all signals with score = 0', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0, source: 'semantic', layer: 'L3' },
        { memory_id: 'mem1', score: 0, source: 'entity', layer: 'L3' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      // 0 * anything = 0, < 0.3 → filtered
      expect(result.length).toBe(0);
    });

    it('should handle all signals with score = 1', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 1.0, source: 'semantic', layer: 'L3' },
        { memory_id: 'mem1', score: 1.0, source: 'entity', layer: 'L3' },
        { memory_id: 'mem1', score: 1.0, source: 'time', layer: 'L3' },
        { memory_id: 'mem1', score: 1.0, source: 'graph', layer: 'L3' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      // total = 1.0 * (all weights sum to 1.0) = 1.0
      // L3 boost: 1.0 * 1.2 = 1.2 → capped at 1.0
      expect(result[0].final_score).toBe(1);
    });

    it('should cap final_score at 1.0', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 1.0, source: 'semantic', layer: 'L3' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      // 1.0 * 1.2 = 1.2 → Math.min(1, 1.2) = 1.0
      expect(result[0].final_score).toBe(1);
    });
  });

  // ── 自定义权重 ──

  describe('Custom weights', () => {
    it('should apply custom weights correctly', () => {
      const customWeights: FusionWeights = {
        semantic_weight: 0.10,
        entity_weight: 0.60,
        time_weight: 0.20,
        graph_weight: 0.10,
      };
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.9, source: 'semantic', layer: 'L2' },
        { memory_id: 'mem1', score: 0.5, source: 'entity', layer: 'L2' },
      ];
      const result = fuseScores(signals, customWeights, 0.3);
      // semantic: 0.9 * 0.10 = 0.09
      // entity: 0.5 * 0.60 = 0.30
      // total weight: 0.10 + 0.60 = 0.70
      // fused: (0.09 + 0.30) / 0.70 = 0.5571...
      // L2 boost: 0.5571 * 1.0 = 0.5571
      expect(result[0].final_score).toBeCloseTo(0.557, 2);
    });
  });

  // ── signals 字段 ──

  describe('FusionCandidate signals field', () => {
    it('should preserve signal source scores in candidate', () => {
      const signals: SignalResult[] = [
        { memory_id: 'mem1', score: 0.8, source: 'semantic', layer: 'L3' },
        { memory_id: 'mem1', score: 0.6, source: 'entity', layer: 'L3' },
      ];
      const result = fuseScores(signals, DEFAULT_WEIGHTS, 0.3);
      expect(result[0].signals).toEqual({ semantic: 0.8, entity: 0.6 });
    });
  });
});
