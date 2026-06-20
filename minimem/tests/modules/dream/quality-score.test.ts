// ============================================================
// MiniMem — Dream Quality Score 单元测试 (TODO-031)
// ============================================================

import { describe, it, expect } from 'vitest';
import { calculateDreamQuality, extractQualityFactors } from '../../../src/modules/dream/quality-score.js';

describe('Dream Quality Score (TODO-031)', () => {
  describe('calculateDreamQuality', () => {
    it('should return score in 0-1 range', () => {
      const result = calculateDreamQuality({
        newConnections: 5,
        insights: 3,
        conflicts: 0,
        llmSelfScore: 0.7,
        processedMemories: 20,
      });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('should mark score < 0.3 as low quality', () => {
      const result = calculateDreamQuality({
        newConnections: 0,
        insights: 0,
        conflicts: 5,
        llmSelfScore: 0.1,
        processedMemories: 20,
      });
      expect(result.score).toBeLessThan(0.3);
      expect(result.isLowQuality).toBe(true);
    });

    it('should reward high connectivity and insights', () => {
      const high = calculateDreamQuality({
        newConnections: 10,
        insights: 5,
        conflicts: 0,
        llmSelfScore: 0.9,
        processedMemories: 20,
      });
      const low = calculateDreamQuality({
        newConnections: 1,
        insights: 0,
        conflicts: 0,
        llmSelfScore: 0.3,
        processedMemories: 20,
      });
      expect(high.score).toBeGreaterThan(low.score);
    });

    it('should penalize conflicts', () => {
      const noConflicts = calculateDreamQuality({
        newConnections: 5,
        insights: 3,
        conflicts: 0,
        llmSelfScore: 0.5,
        processedMemories: 20,
      });
      const withConflicts = calculateDreamQuality({
        newConnections: 5,
        insights: 3,
        conflicts: 10,
        llmSelfScore: 0.5,
        processedMemories: 20,
      });
      expect(noConflicts.score).toBeGreaterThan(withConflicts.score);
    });

    it('should include explanation string', () => {
      const result = calculateDreamQuality({
        newConnections: 5,
        insights: 3,
        conflicts: 1,
        llmSelfScore: 0.7,
        processedMemories: 20,
      });
      expect(result.explanation).toContain('score=');
      expect(result.explanation).toContain('conn=');
      expect(result.explanation).toContain('prod=');
    });

    it('should handle zero processed memories gracefully', () => {
      const result = calculateDreamQuality({
        newConnections: 0,
        insights: 0,
        conflicts: 0,
        llmSelfScore: 0.5,
        processedMemories: 0,
      });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('should clamp llmSelfScore to 0-1', () => {
      const result = calculateDreamQuality({
        newConnections: 0,
        insights: 0,
        conflicts: 0,
        llmSelfScore: 1.5, // 超范围
        processedMemories: 10,
      });
      // 应该 clamp 到 1.0，score = 0.3 (llm 30%)
      expect(result.score).toBeCloseTo(0.3, 1);
    });

    it('should include factors in result', () => {
      const factors = {
        newConnections: 5,
        insights: 3,
        conflicts: 1,
        llmSelfScore: 0.7,
        processedMemories: 20,
      };
      const result = calculateDreamQuality(factors);
      expect(result.factors).toEqual(factors);
    });
  });

  describe('extractQualityFactors', () => {
    it('should extract from dream report structure', () => {
      const report = {
        consolidation: {
          l1_to_l2_extracted: 5,
          l2_to_l3_induced: 3,
          l3_to_l4_proposed: 1,
        },
        pages: {
          created: 2,
          updated: 4,
        },
        dream: {
          narrative_summary: 'test summary',
        },
      };
      const factors = extractQualityFactors(report);
      expect(factors.processedMemories).toBe(9); // 5+3+1
      expect(factors.insights).toBe(2); // pages.created
      expect(factors.llmSelfScore).toBe(0.5); // 默认
    });

    it('should allow override via options', () => {
      const report = { consolidation: {}, pages: {}, dream: {} };
      const factors = extractQualityFactors(report, {
        newConnections: 10,
        insights: 5,
        conflicts: 2,
        llmSelfScore: 0.8,
        processedMemories: 50,
      });
      expect(factors.newConnections).toBe(10);
      expect(factors.insights).toBe(5);
      expect(factors.conflicts).toBe(2);
      expect(factors.llmSelfScore).toBe(0.8);
      expect(factors.processedMemories).toBe(50);
    });
  });
});
