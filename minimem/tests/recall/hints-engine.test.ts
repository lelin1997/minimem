/**
 * MiniMem — HintsEngine 单元测试 (T-H10.1)
 *
 * 测试核心引擎的完整流程：
 * - 输入消息 → 输出 hints
 * - max_hints 限制
 * - token_budget 限制
 * - 空结果（无匹配时返回空数组）
 * - 领域过滤
 * - Skip 规则集成
 * - 缓存命中
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetHintsCache } from '../../src/recall/cache.js';

// 统一的 afterEach 清理
afterEach(() => {
  vi.doUnmock('../../src/recall/signals/semantic-signal.js');
  vi.doUnmock('../../src/recall/signals/entity-signal.js');
  vi.doUnmock('../../src/recall/signals/time-signal.js');
  vi.doUnmock('../../src/recall/signals/graph-signal.js');
  vi.doUnmock('../../src/recall/hint-formatter.js');
});

/**
 * 设置标准 mock 并动态 import HintsEngine
 */
async function setupEngine(options?: {
  semanticResults?: any[];
  entityResults?: any[];
  timeResults?: any[];
  graphResults?: any[];
  entities?: string[];
  config?: any;
}) {
  const {
    semanticResults = [],
    entityResults = [],
    timeResults = [],
    graphResults = [],
    entities = ['TypeScript'],
    config,
  } = options ?? {};

  vi.resetModules();
  resetHintsCache();

  vi.doMock('../../src/recall/signals/semantic-signal.js', () => ({
    computeSemanticSignal: vi.fn().mockResolvedValue(semanticResults),
  }));

  vi.doMock('../../src/recall/signals/entity-signal.js', () => ({
    computeEntitySignal: vi.fn().mockReturnValue(entityResults),
    extractEntities: vi.fn().mockReturnValue(entities),
  }));

  vi.doMock('../../src/recall/signals/time-signal.js', () => ({
    computeTimeSignal: vi.fn().mockReturnValue(timeResults),
  }));

  vi.doMock('../../src/recall/signals/graph-signal.js', () => ({
    computeGraphSignal: vi.fn().mockReturnValue(graphResults),
  }));

  vi.doMock('../../src/recall/hint-formatter.js', () => ({
    formatHints: vi.fn().mockImplementation((candidates: any[], maxHints: number) => {
      return candidates.slice(0, maxHints).map((c: any, i: number) => ({
        id: `hint_${i}`,
        memory_id: c.memory_id,
        summary: `Summary for ${c.memory_id}`,
        time_label: '3天前',
        relevance_score: c.final_score,
        recall_query: `query ${c.memory_id}`,
        layer: c.layer,
        tags: [],
      }));
    }),
  }));

  const { HintsEngine } = await import('../../src/recall/hints-engine.js');
  return new HintsEngine(config);
}

describe('HintsEngine', () => {
  // ── 基本流程 ──

  describe('Basic flow', () => {
    it('should generate hints for normal message', async () => {
      const engine = await setupEngine({
        semanticResults: [
          { memory_id: 'mem1', score: 0.8, source: 'semantic', layer: 'L3' },
        ],
        entityResults: [
          { memory_id: 'mem1', score: 0.6, source: 'entity', layer: 'L3' },
        ],
      });

      const response = await engine.generateHints({
        message: '之前关于TypeScript泛型我们讨论了什么',
      });

      expect(response.hints.length).toBeGreaterThan(0);
      expect(response.meta.search_time_ms).toBeGreaterThanOrEqual(0);
      expect(response.meta.total_candidates).toBeGreaterThan(0);
    });

    it('should respect max_hints config', async () => {
      const engine = await setupEngine({
        semanticResults: [
          { memory_id: 'mem1', score: 0.9, source: 'semantic', layer: 'L3' },
          { memory_id: 'mem2', score: 0.8, source: 'semantic', layer: 'L3' },
          { memory_id: 'mem3', score: 0.7, source: 'semantic', layer: 'L3' },
          { memory_id: 'mem4', score: 0.6, source: 'semantic', layer: 'L3' },
        ],
        config: { max_hints: 2 },
      });

      const response = await engine.generateHints({
        message: '之前关于TypeScript泛型我们讨论了什么',
      });

      expect(response.hints.length).toBeLessThanOrEqual(2);
    });

    it('should respect request-level max_hints override', async () => {
      const engine = await setupEngine({
        semanticResults: [
          { memory_id: 'mem1', score: 0.9, source: 'semantic', layer: 'L3' },
          { memory_id: 'mem2', score: 0.8, source: 'semantic', layer: 'L3' },
          { memory_id: 'mem3', score: 0.7, source: 'semantic', layer: 'L3' },
        ],
        config: { max_hints: 5 },
      });

      const response = await engine.generateHints({
        message: '之前关于TypeScript泛型我们讨论了什么',
        max_hints: 1,
      });

      expect(response.hints.length).toBeLessThanOrEqual(1);
    });
  });

  // ── Skip 规则集成 ──

  describe('Skip rules integration', () => {
    it('should skip short messages', async () => {
      const engine = await setupEngine();

      const response = await engine.generateHints({ message: '你好' });
      expect(response.hints).toEqual([]);
      expect(response.meta.total_candidates).toBe(0);
    });

    it('should skip greeting messages', async () => {
      const engine = await setupEngine({ config: { skip_min_length: 1 } });

      const response = await engine.generateHints({ message: 'Hello!' });
      expect(response.hints).toEqual([]);
    });

    it('should skip confirmation messages', async () => {
      const engine = await setupEngine({ config: { skip_min_length: 1 } });

      const response = await engine.generateHints({ message: '好的' });
      expect(response.hints).toEqual([]);
    });
  });

  // ── 空结果 ──

  describe('Empty results', () => {
    it('should return empty when no signals match', async () => {
      const engine = await setupEngine();

      const response = await engine.generateHints({
        message: '这是一条正常的测试消息，但是没有匹配结果',
      });

      expect(response.hints).toEqual([]);
      expect(response.meta.total_candidates).toBe(0);
      expect(response.meta.token_count).toBe(0);
    });

    it('should return empty when all signals below min_relevance', async () => {
      const engine = await setupEngine({
        semanticResults: [
          { memory_id: 'mem1', score: 0.1, source: 'semantic', layer: 'L1' },
        ],
        config: { min_relevance: 0.5 },
      });

      const response = await engine.generateHints({
        message: '这是一条正常的测试消息，相关度很低',
      });

      expect(response.hints).toEqual([]);
    });
  });

  // ── 领域过滤 ──

  describe('Domain filtering', () => {
    it('should pass domain to signal functions', async () => {
      vi.resetModules();
      resetHintsCache();

      const mockSemantic = vi.fn().mockResolvedValue([]);
      vi.doMock('../../src/recall/signals/semantic-signal.js', () => ({
        computeSemanticSignal: mockSemantic,
      }));
      vi.doMock('../../src/recall/signals/entity-signal.js', () => ({
        computeEntitySignal: vi.fn().mockReturnValue([]),
        extractEntities: vi.fn().mockReturnValue([]),
      }));
      vi.doMock('../../src/recall/signals/time-signal.js', () => ({
        computeTimeSignal: vi.fn().mockReturnValue([]),
      }));
      vi.doMock('../../src/recall/signals/graph-signal.js', () => ({
        computeGraphSignal: vi.fn().mockReturnValue([]),
      }));
      vi.doMock('../../src/recall/hint-formatter.js', () => ({
        formatHints: vi.fn().mockReturnValue([]),
      }));

      const { HintsEngine } = await import('../../src/recall/hints-engine.js');
      const engine = new HintsEngine();

      await engine.generateHints({
        message: '关于工作项目的进展如何',
        domain: 'work',
      });

      expect(mockSemantic).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        'work',
      );
    });
  });

  // ── 缓存 ──

  describe('Session cache', () => {
    it('should return cached response for same message', async () => {
      const engine = await setupEngine({
        semanticResults: [
          { memory_id: 'mem1', score: 0.8, source: 'semantic', layer: 'L3' },
        ],
      });

      // First call
      const response1 = await engine.generateHints({
        message: '关于TypeScript泛型我们之前聊了什么',
      });

      // Second call with same message (should hit cache)
      const response2 = await engine.generateHints({
        message: '关于TypeScript泛型我们之前聊了什么',
      });

      expect(response2.hints).toEqual(response1.hints);
    });
  });

  // ── 容错 ──

  describe('Fault tolerance', () => {
    it('should degrade gracefully when semantic signal fails', async () => {
      vi.resetModules();
      resetHintsCache();

      vi.doMock('../../src/recall/signals/semantic-signal.js', () => ({
        computeSemanticSignal: vi.fn().mockRejectedValue(new Error('Embed failed')),
      }));
      vi.doMock('../../src/recall/signals/entity-signal.js', () => ({
        computeEntitySignal: vi.fn().mockReturnValue([
          { memory_id: 'mem1', score: 0.7, source: 'entity', layer: 'L3' },
        ]),
        extractEntities: vi.fn().mockReturnValue(['TypeScript']),
      }));
      vi.doMock('../../src/recall/signals/time-signal.js', () => ({
        computeTimeSignal: vi.fn().mockReturnValue([]),
      }));
      vi.doMock('../../src/recall/signals/graph-signal.js', () => ({
        computeGraphSignal: vi.fn().mockReturnValue([]),
      }));
      vi.doMock('../../src/recall/hint-formatter.js', () => ({
        formatHints: vi.fn().mockImplementation((candidates: any[], maxHints: number) => {
          return candidates.slice(0, maxHints).map((c: any, i: number) => ({
            id: `hint_${i}`,
            memory_id: c.memory_id,
            summary: `Summary for ${c.memory_id}`,
            time_label: '3天前',
            relevance_score: c.final_score,
            recall_query: 'query',
            layer: c.layer,
            tags: [],
          }));
        }),
      }));

      const { HintsEngine } = await import('../../src/recall/hints-engine.js');
      const engine = new HintsEngine();

      const response = await engine.generateHints({
        message: '关于TypeScript泛型我们之前聊了什么',
      });

      expect(response.hints.length).toBeGreaterThan(0);
    });
  });

  // ── Context 增强 ──

  describe('Context enhancement', () => {
    it('should use context_summary in query', async () => {
      vi.resetModules();
      resetHintsCache();

      const mockSemantic = vi.fn().mockResolvedValue([]);
      vi.doMock('../../src/recall/signals/semantic-signal.js', () => ({
        computeSemanticSignal: mockSemantic,
      }));
      vi.doMock('../../src/recall/signals/entity-signal.js', () => ({
        computeEntitySignal: vi.fn().mockReturnValue([]),
        extractEntities: vi.fn().mockReturnValue([]),
      }));
      vi.doMock('../../src/recall/signals/time-signal.js', () => ({
        computeTimeSignal: vi.fn().mockReturnValue([]),
      }));
      vi.doMock('../../src/recall/signals/graph-signal.js', () => ({
        computeGraphSignal: vi.fn().mockReturnValue([]),
      }));
      vi.doMock('../../src/recall/hint-formatter.js', () => ({
        formatHints: vi.fn().mockReturnValue([]),
      }));

      const { HintsEngine } = await import('../../src/recall/hints-engine.js');
      const engine = new HintsEngine();

      await engine.generateHints({
        message: '继续说说刚才那个话题',
        context_summary: '用户在讨论 Kubernetes 部署策略',
      });

      const queryArg = mockSemantic.mock.calls[0]?.[0];
      expect(queryArg).toContain('继续说说刚才那个话题');
      expect(queryArg).toContain('Kubernetes 部署策略');
    });

    it('should use conversation_history in query', async () => {
      vi.resetModules();
      resetHintsCache();

      const mockSemantic = vi.fn().mockResolvedValue([]);
      vi.doMock('../../src/recall/signals/semantic-signal.js', () => ({
        computeSemanticSignal: mockSemantic,
      }));
      vi.doMock('../../src/recall/signals/entity-signal.js', () => ({
        computeEntitySignal: vi.fn().mockReturnValue([]),
        extractEntities: vi.fn().mockReturnValue([]),
      }));
      vi.doMock('../../src/recall/signals/time-signal.js', () => ({
        computeTimeSignal: vi.fn().mockReturnValue([]),
      }));
      vi.doMock('../../src/recall/signals/graph-signal.js', () => ({
        computeGraphSignal: vi.fn().mockReturnValue([]),
      }));
      vi.doMock('../../src/recall/hint-formatter.js', () => ({
        formatHints: vi.fn().mockReturnValue([]),
      }));

      const { HintsEngine } = await import('../../src/recall/hints-engine.js');
      const engine = new HintsEngine();

      await engine.generateHints({
        message: '对就是那个问题，能再详细说说吗',
        conversation_history: ['我们之前讨论过 Docker 容器化', '如何优化镜像大小'],
      });

      const queryArg = mockSemantic.mock.calls[0]?.[0];
      expect(queryArg).toContain('Docker 容器化');
    });
  });
});
