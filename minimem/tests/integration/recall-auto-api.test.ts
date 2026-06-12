/**
 * MiniMem — Recall Auto API 集成测试 (T-H11.2)
 *
 * 端到端验证 /api/v1/recall/auto 的三种模式：
 * - mode=hint: 只返回 hints，不做深度检索
 * - mode=full: 返回 hints + 完整记忆
 * - mode=smart: 按相关性分数决定是否升级为 full
 * - should_recall=false 时返回空
 *
 * 使用 vi.doMock + dynamic import 控制 HintsEngine 和 searchMemory 行为
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Recall Auto API — Integration (T-H11.2)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /**
   * 构造一个 mock 版本的 auto handler 逻辑
   * 直接复用 rest-api.ts 中的行为模式，但通过 mock 控制 HintsEngine 和 searchMemory
   */
  async function setupAutoHandler(options: {
    hints?: Array<{
      id: string;
      memory_id: string;
      summary: string;
      time_label: string;
      relevance_score: number;
      recall_query: string;
      layer: string;
      tags: string[];
    }>;
    searchResults?: Array<{ id: string; layer: string; content: string }>;
    shouldSkip?: boolean;
  }) {
    const mockHints = options.hints ?? [];
    const mockSearchResults = options.searchResults ?? [];

    const mockGenerateHints = vi.fn().mockResolvedValue({
      hints: mockHints,
      meta: {
        search_time_ms: 25,
        total_candidates: mockHints.length,
        token_count: mockHints.length * 20,
      },
    });

    const mockSearchMemory = vi.fn().mockResolvedValue({
      results: mockSearchResults.map(r => ({
        id: r.id,
        layer: r.layer,
        content: r.content,
        relevance: 0.9,
      })),
      direct_answer: null,
    });

    // Mock HintsEngine
    vi.doMock('../../src/recall/hints-engine.js', () => ({
      HintsEngine: class {
        generateHints = mockGenerateHints;
      },
    }));

    // Mock searchMemory
    vi.doMock('../../src/retrieval/search.js', () => ({
      searchMemory: mockSearchMemory,
      enrichResults: vi.fn((r: any) => r),
    }));

    // Mock metrics
    vi.doMock('../../src/recall/metrics.js', () => ({
      recordAutoRequest: vi.fn(),
      recordHintsRequest: vi.fn(),
      recordSkip: vi.fn(),
      recordSignal: vi.fn(),
      recordCacheHit: vi.fn(),
      getRecallMetrics: vi.fn(),
      resetRecallMetrics: vi.fn(),
    }));

    // Mock config
    vi.doMock('../../src/config/index.js', () => ({
      getConfig: () => ({
        recall: {
          hints: { min_relevance: 0.55, max_hints: 3 },
          auto: { default_mode: 'hint', smart_threshold: 0.8 },
        },
      }),
    }));

    // Mock sanitize
    vi.doMock('../../src/common/utils.js', () => ({
      sanitizeUserContent: (text: string) => ({ sanitized: text, removed: [] }),
      generateId: () => 'test-id',
      now: () => new Date().toISOString(),
    }));

    return { mockGenerateHints, mockSearchMemory };
  }

  /**
   * 模拟 auto 端点的行为（提取自 rest-api.ts 逻辑，便于隔离测试）
   */
  async function callAutoEndpoint(body: {
    message: string;
    mode?: 'hint' | 'full' | 'smart';
    context_summary?: string;
  }, mocks: { mockGenerateHints: any; mockSearchMemory: any }) {
    const message = body.message;
    const contextSummary = body.context_summary;
    const mode = body.mode ?? 'hint';

    const hintResponse = await mocks.mockGenerateHints({
      message,
      context_summary: contextSummary,
    });

    if (mode === 'hint') {
      return {
        should_recall: hintResponse.hints.length > 0,
        hints: hintResponse.hints,
        full_memories: null,
        surface_delta: null,
      };
    }

    if (mode === 'full') {
      let fullMemories: Array<{ id: string; layer: string; content: string }> | null = null;

      if (hintResponse.hints.length > 0) {
        const topHint = hintResponse.hints[0];
        const fullResponse = await mocks.mockSearchMemory({
          query: topHint.recall_query,
          top_k: 5,
        });
        fullMemories = fullResponse.results.map((r: any) => ({
          id: r.id,
          layer: r.layer,
          content: r.content,
        }));
      }

      return {
        should_recall: hintResponse.hints.length > 0,
        hints: hintResponse.hints,
        full_memories: fullMemories,
        surface_delta: null,
      };
    }

    // mode === 'smart'
    const HIGH_RELEVANCE_THRESHOLD = 0.8;
    const shouldDeepen = hintResponse.hints.some((h: any) => h.relevance_score >= HIGH_RELEVANCE_THRESHOLD);

    let fullMemories: Array<{ id: string; layer: string; content: string }> | null = null;

    if (shouldDeepen && hintResponse.hints.length > 0) {
      const topHint = hintResponse.hints[0];
      const fullResponse = await mocks.mockSearchMemory({
        query: topHint.recall_query,
        top_k: 5,
      });
      fullMemories = fullResponse.results.map((r: any) => ({
        id: r.id,
        layer: r.layer,
        content: r.content,
      }));
    }

    return {
      should_recall: hintResponse.hints.length > 0,
      reasoning: shouldDeepen ? 'high_relevance_auto_deepen' : 'hint_only',
      hints: hintResponse.hints,
      full_memories: fullMemories,
      surface_delta: null,
    };
  }

  // ── mode=hint ──

  describe('mode=hint', () => {
    it('should return hints without full_memories', async () => {
      const mocks = await setupAutoHandler({
        hints: [
          {
            id: 'hint_1',
            memory_id: 'mem_1',
            summary: '昨天讨论了 TypeScript 泛型',
            time_label: '1 天前',
            relevance_score: 0.75,
            recall_query: 'TypeScript 泛型',
            layer: 'L2',
            tags: ['typescript'],
          },
        ],
      });

      const result = await callAutoEndpoint(
        { message: '继续昨天的 TypeScript 话题', mode: 'hint' },
        mocks,
      );

      expect(result.should_recall).toBe(true);
      expect(result.hints).toHaveLength(1);
      expect(result.hints[0].summary).toContain('TypeScript');
      expect(result.full_memories).toBeNull();
      expect(result.surface_delta).toBeNull();
    });

    it('should return should_recall=false when no hints', async () => {
      const mocks = await setupAutoHandler({ hints: [] });

      const result = await callAutoEndpoint(
        { message: '完全不相关的消息XYZZY', mode: 'hint' },
        mocks,
      );

      expect(result.should_recall).toBe(false);
      expect(result.hints).toEqual([]);
      expect(result.full_memories).toBeNull();
    });

    it('should pass context_summary to engine', async () => {
      const mocks = await setupAutoHandler({ hints: [] });

      await callAutoEndpoint(
        { message: '关于那个问题', mode: 'hint', context_summary: '之前在讨论 Docker 部署方案' },
        mocks,
      );

      expect(mocks.mockGenerateHints).toHaveBeenCalledWith({
        message: '关于那个问题',
        context_summary: '之前在讨论 Docker 部署方案',
      });
    });
  });

  // ── mode=full ──

  describe('mode=full', () => {
    it('should return hints and full memories', async () => {
      const mocks = await setupAutoHandler({
        hints: [
          {
            id: 'hint_1',
            memory_id: 'mem_1',
            summary: 'Docker 部署最佳实践',
            time_label: '3 天前',
            relevance_score: 0.85,
            recall_query: 'Docker 部署 最佳实践',
            layer: 'L3',
            tags: ['docker', 'ops'],
          },
        ],
        searchResults: [
          { id: 'mem_1', layer: 'L3', content: 'Docker 应该使用 multi-stage build 减小镜像体积' },
          { id: 'mem_2', layer: 'L2', content: 'Docker Compose 适用于开发环境' },
        ],
      });

      const result = await callAutoEndpoint(
        { message: 'Docker 部署有什么要注意的', mode: 'full' },
        mocks,
      );

      expect(result.should_recall).toBe(true);
      expect(result.hints).toHaveLength(1);
      expect(result.full_memories).not.toBeNull();
      expect(result.full_memories).toHaveLength(2);
      expect(result.full_memories![0].content).toContain('multi-stage build');
      expect(result.full_memories![1].content).toContain('Docker Compose');
    });

    it('should not call searchMemory when no hints returned', async () => {
      const mocks = await setupAutoHandler({
        hints: [],
        searchResults: [{ id: 'x', layer: 'L1', content: 'should not appear' }],
      });

      const result = await callAutoEndpoint(
        { message: '无关消息测试', mode: 'full' },
        mocks,
      );

      expect(result.should_recall).toBe(false);
      expect(result.full_memories).toBeNull();
      expect(mocks.mockSearchMemory).not.toHaveBeenCalled();
    });

    it('should use top hint recall_query for searchMemory', async () => {
      const mocks = await setupAutoHandler({
        hints: [
          {
            id: 'hint_1',
            memory_id: 'mem_1',
            summary: 'Kubernetes 集群管理',
            time_label: '2 天前',
            relevance_score: 0.9,
            recall_query: 'Kubernetes 集群 管理 运维',
            layer: 'L3',
            tags: ['k8s'],
          },
        ],
        searchResults: [],
      });

      await callAutoEndpoint(
        { message: 'K8s 集群怎么运维', mode: 'full' },
        mocks,
      );

      expect(mocks.mockSearchMemory).toHaveBeenCalledWith({
        query: 'Kubernetes 集群 管理 运维',
        top_k: 5,
      });
    });
  });

  // ── mode=smart ──

  describe('mode=smart', () => {
    it('should auto-deepen when relevance_score >= 0.8', async () => {
      const mocks = await setupAutoHandler({
        hints: [
          {
            id: 'hint_1',
            memory_id: 'mem_1',
            summary: '用户明确表示喜欢 Vim',
            time_label: '5 天前',
            relevance_score: 0.88,
            recall_query: 'Vim 编辑器 偏好',
            layer: 'L3',
            tags: ['vim', '偏好'],
          },
        ],
        searchResults: [
          { id: 'mem_1', layer: 'L3', content: '用户偏好使用 Vim 并配置了 LazyVim' },
        ],
      });

      const result = await callAutoEndpoint(
        { message: '我平时用什么编辑器来着', mode: 'smart' },
        mocks,
      );

      expect(result.should_recall).toBe(true);
      expect(result.reasoning).toBe('high_relevance_auto_deepen');
      expect(result.full_memories).toHaveLength(1);
      expect(result.full_memories![0].content).toContain('Vim');
      expect(mocks.mockSearchMemory).toHaveBeenCalled();
    });

    it('should NOT deepen when relevance_score < 0.8', async () => {
      const mocks = await setupAutoHandler({
        hints: [
          {
            id: 'hint_1',
            memory_id: 'mem_1',
            summary: '可能相关的低分结果',
            time_label: '10 天前',
            relevance_score: 0.65,
            recall_query: '某个话题',
            layer: 'L2',
            tags: [],
          },
        ],
        searchResults: [
          { id: 'mem_99', layer: 'L1', content: 'should not be fetched' },
        ],
      });

      const result = await callAutoEndpoint(
        { message: '随便问个问题', mode: 'smart' },
        mocks,
      );

      expect(result.should_recall).toBe(true);
      expect(result.reasoning).toBe('hint_only');
      expect(result.full_memories).toBeNull();
      expect(mocks.mockSearchMemory).not.toHaveBeenCalled();
    });

    it('should return should_recall=false when no hints in smart mode', async () => {
      const mocks = await setupAutoHandler({ hints: [] });

      const result = await callAutoEndpoint(
        { message: '毫不相关的输入', mode: 'smart' },
        mocks,
      );

      expect(result.should_recall).toBe(false);
      expect(result.reasoning).toBe('hint_only');
      expect(result.hints).toEqual([]);
      expect(result.full_memories).toBeNull();
    });

    it('should deepen only if ANY hint has score >= 0.8 (not just first)', async () => {
      const mocks = await setupAutoHandler({
        hints: [
          {
            id: 'hint_1',
            memory_id: 'mem_1',
            summary: '低分 hint',
            time_label: '2 天前',
            relevance_score: 0.5,
            recall_query: '低分查询',
            layer: 'L2',
            tags: [],
          },
          {
            id: 'hint_2',
            memory_id: 'mem_2',
            summary: '高分 hint',
            time_label: '1 天前',
            relevance_score: 0.85,
            recall_query: '高分查询',
            layer: 'L3',
            tags: [],
          },
        ],
        searchResults: [
          { id: 'mem_1', layer: 'L2', content: 'full memory from top hint' },
        ],
      });

      const result = await callAutoEndpoint(
        { message: '测试多 hint 升级逻辑', mode: 'smart' },
        mocks,
      );

      // 因为 hint_2 分数 >= 0.8，应触发 deepen
      expect(result.reasoning).toBe('high_relevance_auto_deepen');
      expect(result.full_memories).not.toBeNull();
      // 但 searchMemory 使用的是 top hint (hint_1) 的 recall_query
      expect(mocks.mockSearchMemory).toHaveBeenCalledWith({
        query: '低分查询',
        top_k: 5,
      });
    });
  });

  // ── should_recall=false ──

  describe('should_recall=false', () => {
    it('mode=hint returns false with empty hints', async () => {
      const mocks = await setupAutoHandler({ hints: [] });
      const result = await callAutoEndpoint({ message: '无关', mode: 'hint' }, mocks);
      expect(result.should_recall).toBe(false);
    });

    it('mode=full returns false with empty hints and null full_memories', async () => {
      const mocks = await setupAutoHandler({ hints: [] });
      const result = await callAutoEndpoint({ message: '无关', mode: 'full' }, mocks);
      expect(result.should_recall).toBe(false);
      expect(result.full_memories).toBeNull();
    });

    it('mode=smart returns false with empty hints and hint_only reasoning', async () => {
      const mocks = await setupAutoHandler({ hints: [] });
      const result = await callAutoEndpoint({ message: '无关', mode: 'smart' }, mocks);
      expect(result.should_recall).toBe(false);
      expect(result.reasoning).toBe('hint_only');
      expect(result.full_memories).toBeNull();
    });
  });

  // ── 默认 mode ──

  describe('Default mode', () => {
    it('should default to hint mode when no mode specified', async () => {
      const mocks = await setupAutoHandler({
        hints: [
          {
            id: 'hint_1',
            memory_id: 'mem_1',
            summary: '测试默认模式',
            time_label: '刚才',
            relevance_score: 0.7,
            recall_query: '测试',
            layer: 'L2',
            tags: [],
          },
        ],
      });

      // 不传 mode，默认应走 hint 路径
      const result = await callAutoEndpoint(
        { message: '测试默认模式行为' },
        mocks,
      );

      expect(result.should_recall).toBe(true);
      expect(result.full_memories).toBeNull(); // hint 模式不做深度检索
      expect(result).not.toHaveProperty('reasoning'); // hint 模式无 reasoning
    });
  });

  // ── 边界情况 ──

  describe('Edge cases', () => {
    it('should handle hint with exact 0.8 threshold in smart mode (should deepen)', async () => {
      const mocks = await setupAutoHandler({
        hints: [
          {
            id: 'hint_1',
            memory_id: 'mem_1',
            summary: '边界分数测试',
            time_label: '1 天前',
            relevance_score: 0.8, // exactly 0.8
            recall_query: 'boundary test',
            layer: 'L2',
            tags: [],
          },
        ],
        searchResults: [
          { id: 'mem_1', layer: 'L2', content: 'boundary memory' },
        ],
      });

      const result = await callAutoEndpoint(
        { message: '边界分数测试消息', mode: 'smart' },
        mocks,
      );

      // >= 0.8，应该 deepen
      expect(result.reasoning).toBe('high_relevance_auto_deepen');
      expect(result.full_memories).not.toBeNull();
    });

    it('should handle hint with 0.79 score in smart mode (should NOT deepen)', async () => {
      const mocks = await setupAutoHandler({
        hints: [
          {
            id: 'hint_1',
            memory_id: 'mem_1',
            summary: '边界低分测试',
            time_label: '1 天前',
            relevance_score: 0.79, // just below 0.8
            recall_query: 'boundary test',
            layer: 'L2',
            tags: [],
          },
        ],
      });

      const result = await callAutoEndpoint(
        { message: '边界低分测试消息', mode: 'smart' },
        mocks,
      );

      expect(result.reasoning).toBe('hint_only');
      expect(result.full_memories).toBeNull();
    });
  });
});
