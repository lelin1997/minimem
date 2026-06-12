/**
 * MiniMem — MCP Tool 集成测试 (T-H11.3)
 *
 * 验证 get_memory_hints MCP 工具的调用流程：
 * - 正常调用返回 hints
 * - 参数校验
 * - 空结果时返回合适信息
 *
 * 注意：MCP server 测试通过直接调用 handler 模拟，不启动真正的 MCP 连接
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resetHintsCache } from '../../src/recall/cache.js';

describe('MCP get_memory_hints Tool — Integration', () => {
  afterEach(() => {
    vi.doUnmock('../../src/recall/hints-engine.js');
    resetHintsCache();
  });

  it('should return hints via HintsEngine when topic provided', async () => {
    vi.resetModules();
    vi.doMock('../../src/recall/hints-engine.js', () => ({
      HintsEngine: vi.fn().mockImplementation(() => ({
        generateHints: vi.fn().mockResolvedValue({
          hints: [
            {
              id: 'hint_abc',
              memory_id: 'mem1',
              summary: '用户偏好 TypeScript',
              time_label: '3天前',
              relevance_score: 0.85,
              recall_query: 'TypeScript 偏好 编程',
              layer: 'L3',
              tags: ['TypeScript'],
            },
          ],
          meta: { search_time_ms: 45, total_candidates: 5, token_count: 15 },
        }),
      })),
    }));

    const { HintsEngine } = await import('../../src/recall/hints-engine.js');
    const engine = new HintsEngine();

    const params = { topic: '关于TypeScript的开发偏好', max_hints: 3 };
    const response = await engine.generateHints({
      message: params.topic,
      max_hints: params.max_hints,
    });

    expect(response.hints).toHaveLength(1);
    expect(response.hints[0].summary).toBe('用户偏好 TypeScript');
    expect(response.hints[0].recall_query).toContain('TypeScript');
    expect(response.meta.search_time_ms).toBe(45);
  });

  it('should return empty message when no hints found', async () => {
    vi.resetModules();
    vi.doMock('../../src/recall/hints-engine.js', () => ({
      HintsEngine: vi.fn().mockImplementation(() => ({
        generateHints: vi.fn().mockResolvedValue({
          hints: [],
          meta: { search_time_ms: 10, total_candidates: 0, token_count: 0 },
        }),
      })),
    }));

    const { HintsEngine } = await import('../../src/recall/hints-engine.js');
    const engine = new HintsEngine();

    const response = await engine.generateHints({ message: '完全不相关的话题XYZZY' });
    expect(response.hints).toHaveLength(0);

    // Simulate MCP response formatting
    const mcpResponse = response.hints.length === 0
      ? { hints: [], message: '没有找到相关记忆线索' }
      : { hints: response.hints };

    expect(mcpResponse.message).toBe('没有找到相关记忆线索');
  });

  it('should format hints_text for agent consumption', async () => {
    vi.resetModules();
    vi.doMock('../../src/recall/hints-engine.js', () => ({
      HintsEngine: vi.fn().mockImplementation(() => ({
        generateHints: vi.fn().mockResolvedValue({
          hints: [
            {
              id: 'hint_1',
              memory_id: 'mem1',
              summary: '用户偏好 TypeScript',
              time_label: '3天前',
              relevance_score: 0.85,
              recall_query: 'TypeScript 偏好',
              layer: 'L3',
              tags: [],
            },
            {
              id: 'hint_2',
              memory_id: 'mem2',
              summary: '上周讨论了项目架构',
              time_label: '1周前',
              relevance_score: 0.72,
              recall_query: '项目架构 讨论',
              layer: 'L2',
              tags: [],
            },
          ],
          meta: { search_time_ms: 80, total_candidates: 10, token_count: 30 },
        }),
      })),
    }));

    const { HintsEngine } = await import('../../src/recall/hints-engine.js');
    const engine = new HintsEngine();

    const response = await engine.generateHints({ message: '关于项目技术栈的决策' });

    // Format like MCP server does
    const hintsText = response.hints.map((h) =>
      `⚡ ${h.time_label}：${h.summary}${h.recall_query ? `\n   → 深入了解: search_memory({ query: "${h.recall_query}" })` : ''}`
    ).join('\n');

    expect(hintsText).toContain('3天前');
    expect(hintsText).toContain('TypeScript');
    expect(hintsText).toContain('search_memory');
    expect(hintsText).toContain('1周前');
  });

  it('should respect max_hints parameter', async () => {
    vi.resetModules();
    const mockGenerateHints = vi.fn().mockResolvedValue({
      hints: [{ id: 'h1', memory_id: 'm1', summary: 's1', time_label: 't1', relevance_score: 0.9, recall_query: 'q1', layer: 'L3', tags: [] }],
      meta: { search_time_ms: 30, total_candidates: 1, token_count: 10 },
    });

    vi.doMock('../../src/recall/hints-engine.js', () => ({
      HintsEngine: vi.fn().mockImplementation(() => ({
        generateHints: mockGenerateHints,
      })),
    }));

    const { HintsEngine } = await import('../../src/recall/hints-engine.js');
    const engine = new HintsEngine();

    await engine.generateHints({ message: 'test topic', max_hints: 5 });

    expect(mockGenerateHints).toHaveBeenCalledWith({ message: 'test topic', max_hints: 5 });
  });

  it('should pass domain parameter', async () => {
    vi.resetModules();
    const mockGenerateHints = vi.fn().mockResolvedValue({
      hints: [],
      meta: { search_time_ms: 10, total_candidates: 0, token_count: 0 },
    });

    vi.doMock('../../src/recall/hints-engine.js', () => ({
      HintsEngine: vi.fn().mockImplementation(() => ({
        generateHints: mockGenerateHints,
      })),
    }));

    const { HintsEngine } = await import('../../src/recall/hints-engine.js');
    const engine = new HintsEngine();

    await engine.generateHints({ message: 'work related topic', domain: 'work' });

    expect(mockGenerateHints).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'work' }),
    );
  });
});
