/**
 * MiniMem — Signals 单元测试 (T-H10.2)
 *
 * 测试各信号源：
 * - 语义信号：mock embedding + vector search
 * - 实体信号：mock NER + DB 查询
 * - 时间信号：时间表达式解析
 * - 图信号：mock 知识图谱查询
 * - extractEntities 工具函数
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── extractEntities（纯函数，无需真实外部依赖） ──

describe('extractEntities', () => {
  let extractEntities: (message: string) => string[];

  beforeEach(async () => {
    vi.resetModules();
    // mock 依赖以避免副作用
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({ prepare: () => ({ all: () => [] }) }),
    }));
    vi.doMock('../../src/store/indexes.js', () => ({
      lookupByPrefix: () => [],
    }));
    const mod = await import('../../src/recall/signals/entity-signal.js');
    extractEntities = mod.extractEntities;
  });

  afterEach(() => {
    vi.doUnmock('../../src/store/database.js');
    vi.doUnmock('../../src/store/indexes.js');
  });

  it('should extract space-separated Chinese entities', () => {
    const entities = extractEntities('张三 腾讯 TypeScript');
    expect(entities).toContain('张三');
    expect(entities).toContain('腾讯');
    expect(entities).toContain('TypeScript');
  });

  it('should extract Chinese entities separated by punctuation', () => {
    const entities = extractEntities('张三，腾讯，TypeScript项目');
    expect(entities).toContain('张三');
    expect(entities).toContain('腾讯');
    expect(entities).toContain('TypeScript项目');
  });

  it('should not split continuous Chinese text without delimiters', () => {
    const entities = extractEntities('张三在腾讯做TypeScript项目');
    // 整个字符串作为一个 token（因为没有空格和识别到的标点分隔）
    expect(entities.length).toBe(1);
  });

  it('should extract English entities', () => {
    const entities = extractEntities('The Docker container runs PostgreSQL database');
    expect(entities).toContain('Docker');
    expect(entities).toContain('container');
    expect(entities).toContain('runs');
    expect(entities).toContain('PostgreSQL');
    expect(entities).toContain('database');
  });

  it('should filter out Chinese stop words (space-separated)', () => {
    // 只测试空格分隔的情况，因为 extractEntities 不做中文分词
    const entities = extractEntities('我 想 看看 项目');
    expect(entities).not.toContain('我');
    expect(entities).not.toContain('想');
    expect(entities).toContain('看看');
    expect(entities).toContain('项目');
  });

  it('should filter out English stop words', () => {
    const entities = extractEntities('I want to help you with the authentication module');
    expect(entities).not.toContain('I');
    expect(entities).not.toContain('want');
    expect(entities).not.toContain('to');
    expect(entities).not.toContain('the');
    expect(entities).toContain('authentication');
    expect(entities).toContain('module');
  });

  it('should filter tokens shorter than minimum length', () => {
    const entities = extractEntities('A B ab 好 OK hello');
    expect(entities).not.toContain('A');
    expect(entities).not.toContain('B');
    expect(entities).not.toContain('ab');
    expect(entities).not.toContain('好');
    expect(entities).toContain('hello');
  });

  it('should deduplicate entities (case-insensitive)', () => {
    const entities = extractEntities('Docker docker DOCKER');
    const dockerCount = entities.filter(e => e.toLowerCase() === 'docker').length;
    expect(dockerCount).toBe(1);
  });

  it('should limit to max 10 entities', () => {
    const msg = 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn';
    const entities = extractEntities(msg);
    expect(entities.length).toBeLessThanOrEqual(10);
  });

  it('should return empty for empty message', () => {
    expect(extractEntities('')).toEqual([]);
  });

  it('should handle parentheses as separators', () => {
    const entities = extractEntities('TypeScript（泛型）React（Hooks）');
    expect(entities).toContain('TypeScript');
    expect(entities).toContain('泛型');
    expect(entities).toContain('React');
    expect(entities).toContain('Hooks');
  });

  it('should handle square brackets as separators', () => {
    const entities = extractEntities('React[Hooks]');
    expect(entities).toContain('React');
    expect(entities).toContain('Hooks');
  });
});

// ── computeSemanticSignal ──

describe('computeSemanticSignal', () => {
  afterEach(() => {
    vi.doUnmock('../../src/llm/client.js');
    vi.doUnmock('../../src/store/vectors.js');
  });

  it('should return empty when embedding is not available', async () => {
    vi.resetModules();
    vi.doMock('../../src/llm/client.js', () => ({
      getLLM: () => ({ isEmbeddingAvailable: false }),
    }));
    vi.doMock('../../src/store/vectors.js', () => ({
      getVectorStore: () => ({}),
    }));

    const { computeSemanticSignal } = await import('../../src/recall/signals/semantic-signal.js');
    const result = await computeSemanticSignal('test message');
    expect(result).toEqual([]);
  });

  it('should return signal results from vector search', async () => {
    vi.resetModules();
    const mockSearch = vi.fn().mockResolvedValue([
      { memoryId: 'mem1', similarity: 0.85, memoryType: 'L3' },
      { memoryId: 'mem2', similarity: 0.72, memoryType: 'L2' },
    ]);

    vi.doMock('../../src/llm/client.js', () => ({
      getLLM: () => ({
        isEmbeddingAvailable: true,
        embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
      }),
    }));
    vi.doMock('../../src/store/vectors.js', () => ({
      getVectorStore: () => ({
        search: mockSearch,
      }),
    }));

    const { computeSemanticSignal } = await import('../../src/recall/signals/semantic-signal.js');
    const result = await computeSemanticSignal('test message', 10, 0.3);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      memory_id: 'mem1',
      score: 0.85,
      source: 'semantic',
      layer: 'L3',
    });
    expect(result[1]).toEqual({
      memory_id: 'mem2',
      score: 0.72,
      source: 'semantic',
      layer: 'L2',
    });
  });

  it('should return empty on embed error (graceful degradation)', async () => {
    vi.resetModules();
    vi.doMock('../../src/llm/client.js', () => ({
      getLLM: () => ({
        isEmbeddingAvailable: true,
        embed: vi.fn().mockRejectedValue(new Error('API timeout')),
      }),
    }));
    vi.doMock('../../src/store/vectors.js', () => ({
      getVectorStore: () => ({}),
    }));

    const { computeSemanticSignal } = await import('../../src/recall/signals/semantic-signal.js');
    const result = await computeSemanticSignal('test message');
    expect(result).toEqual([]);
  });

  it('should pass domain to vector store search', async () => {
    vi.resetModules();
    const mockSearch = vi.fn().mockResolvedValue([]);

    vi.doMock('../../src/llm/client.js', () => ({
      getLLM: () => ({
        isEmbeddingAvailable: true,
        embed: vi.fn().mockResolvedValue({ embedding: [0.1] }),
      }),
    }));
    vi.doMock('../../src/store/vectors.js', () => ({
      getVectorStore: () => ({
        search: mockSearch,
      }),
    }));

    const { computeSemanticSignal } = await import('../../src/recall/signals/semantic-signal.js');
    await computeSemanticSignal('test', 10, 0.3, 'work');

    expect(mockSearch).toHaveBeenCalledWith(
      expect.any(Array),
      10,
      0.3,
      'work',
    );
  });
});

// ── computeEntitySignal ──

describe('computeEntitySignal', () => {
  afterEach(() => {
    vi.doUnmock('../../src/store/indexes.js');
    vi.doUnmock('../../src/store/database.js');
  });

  it('should find entities via condition_index (lookupByPrefix)', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/indexes.js', () => ({
      lookupByPrefix: vi.fn((prefix: string) => {
        if (prefix.includes('张三')) {
          return [{ condition_key: prefix, memory_type: 'L3', memory_id: 'mem_zs' }];
        }
        return [];
      }),
    }));
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({
        prepare: () => ({ all: () => [] }),
      }),
    }));

    const { computeEntitySignal } = await import('../../src/recall/signals/entity-signal.js');
    const result = computeEntitySignal('张三 最近 项目进展 如何');

    const zs = result.find(r => r.memory_id === 'mem_zs');
    expect(zs).toBeDefined();
    expect(zs!.score).toBe(0.8);
    expect(zs!.source).toBe('entity');
  });

  it('should find entities in world_facts via LIKE', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/indexes.js', () => ({
      lookupByPrefix: () => [],
    }));
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({
        prepare: (sql: string) => ({
          all: (..._args: any[]) => {
            if (sql.includes('world_facts')) {
              return [{ id: 'fact_1' }];
            }
            return [];
          },
        }),
      }),
    }));

    const { computeEntitySignal } = await import('../../src/recall/signals/entity-signal.js');
    const result = computeEntitySignal('TypeScript 泛型 使用方法');

    const fact = result.find(r => r.memory_id === 'fact_1');
    expect(fact).toBeDefined();
    expect(fact!.score).toBe(0.6);
    expect(fact!.layer).toBe('L2');
  });

  it('should return empty for empty message', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/indexes.js', () => ({ lookupByPrefix: () => [] }));
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({ prepare: () => ({ all: () => [] }) }),
    }));

    const { computeEntitySignal } = await import('../../src/recall/signals/entity-signal.js');
    const result = computeEntitySignal('');
    expect(result).toEqual([]);
  });

  it('should sort by score descending and limit to topK', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/indexes.js', () => ({
      lookupByPrefix: () => [],
    }));
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({
        prepare: (sql: string) => ({
          all: () => {
            if (sql.includes('world_facts')) {
              return Array.from({ length: 20 }, (_, i) => ({ id: `fact_${i}` }));
            }
            return [];
          },
        }),
      }),
    }));

    const { computeEntitySignal } = await import('../../src/recall/signals/entity-signal.js');
    const result = computeEntitySignal('some entity keyword here test', 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

// ── computeTimeSignal (时间表达式解析) ──

describe('computeTimeSignal — Time Expression Parsing', () => {
  afterEach(() => {
    vi.doUnmock('../../src/store/database.js');
  });

  it('should parse "昨天" and query DB', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({
        prepare: () => ({ all: () => [{ id: 'mem_yesterday', confidence: 0.9 }] }),
      }),
    }));

    const { computeTimeSignal } = await import('../../src/recall/signals/time-signal.js');
    const result = computeTimeSignal('昨天讨论了什么');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe('time');
  });

  it('should parse "上周" and query DB', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({
        prepare: () => ({ all: () => [{ id: 'mem_lastweek', confidence: 0.8 }] }),
      }),
    }));

    const { computeTimeSignal } = await import('../../src/recall/signals/time-signal.js');
    const result = computeTimeSignal('上周的会议纪要');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should parse "N天前"', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({
        prepare: () => ({ all: () => [{ id: 'mem_3d', confidence: 0.7 }] }),
      }),
    }));

    const { computeTimeSignal } = await import('../../src/recall/signals/time-signal.js');
    const result = computeTimeSignal('3天前我说了什么');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should parse "最近"', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({
        prepare: () => ({ all: () => [{ id: 'mem_recent', confidence: 0.6 }] }),
      }),
    }));

    const { computeTimeSignal } = await import('../../src/recall/signals/time-signal.js');
    const result = computeTimeSignal('最近有什么新进展');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should parse "yesterday" (English)', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({
        prepare: () => ({ all: () => [{ id: 'mem_en_yesterday', confidence: 0.8 }] }),
      }),
    }));

    const { computeTimeSignal } = await import('../../src/recall/signals/time-signal.js');
    const result = computeTimeSignal('what did we discuss yesterday');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should parse "N weeks ago"', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({
        prepare: () => ({ all: () => [{ id: 'mem_2w', confidence: 0.7 }] }),
      }),
    }));

    const { computeTimeSignal } = await import('../../src/recall/signals/time-signal.js');
    const result = computeTimeSignal('2周前的决定');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should return empty for message without time expression (no candidates)', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({
        prepare: () => ({ all: () => [] }),
      }),
    }));

    const { computeTimeSignal } = await import('../../src/recall/signals/time-signal.js');
    const result = computeTimeSignal('TypeScript 泛型怎么用');
    expect(result).toEqual([]);
  });

  it('should boost recent memories when candidateIds provided', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/database.js', () => ({
      getDb: () => ({
        prepare: () => ({ all: () => [{ id: 'mem_recent' }] }),
      }),
    }));

    const { computeTimeSignal } = await import('../../src/recall/signals/time-signal.js');
    const result = computeTimeSignal('TypeScript 泛型', ['mem_recent', 'mem_old']);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].score).toBe(0.1);
  });
});

// ── computeGraphSignal ──

describe('computeGraphSignal', () => {
  afterEach(() => {
    vi.doUnmock('../../src/store/indexes.js');
    vi.doUnmock('../../src/store/graph.js');
  });

  it('should return empty for empty entities', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/indexes.js', () => ({ lookupByPrefix: () => [] }));
    vi.doMock('../../src/store/graph.js', () => ({ traverseGraph: () => [] }));

    const { computeGraphSignal } = await import('../../src/recall/signals/graph-signal.js');
    const result = computeGraphSignal([]);
    expect(result).toEqual([]);
  });

  it('should find 1-hop linked memories', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/indexes.js', () => ({
      lookupByPrefix: vi.fn((prefix: string) => {
        if (prefix === 'person:张三') {
          return [{ condition_key: 'person:张三', memory_type: 'L3', memory_id: 'mem_zs' }];
        }
        return [];
      }),
    }));
    vi.doMock('../../src/store/graph.js', () => ({
      traverseGraph: vi.fn((startId: string) => {
        if (startId === 'mem_zs') {
          return [{ target_id: 'mem_linked', weight: 0.8, target_type: 'L2' }];
        }
        return [];
      }),
    }));

    const { computeGraphSignal } = await import('../../src/recall/signals/graph-signal.js');
    const result = computeGraphSignal(['张三']);

    const linked = result.find(r => r.memory_id === 'mem_linked');
    expect(linked).toBeDefined();
    expect(linked!.score).toBeCloseTo(0.56, 2); // 0.8 * 0.7
    expect(linked!.source).toBe('graph');
    expect(linked!.layer).toBe('L2');
  });

  it('should exclude source nodes from results', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/indexes.js', () => ({
      lookupByPrefix: vi.fn((prefix: string) => {
        if (prefix === 'person:Alice') {
          return [{ condition_key: 'person:Alice', memory_type: 'L3', memory_id: 'mem_source' }];
        }
        return [];
      }),
    }));
    vi.doMock('../../src/store/graph.js', () => ({
      traverseGraph: vi.fn(() => [
        { target_id: 'mem_source', weight: 1.0, target_type: 'L3' },
        { target_id: 'mem_linked', weight: 0.6, target_type: 'L2' },
      ]),
    }));

    const { computeGraphSignal } = await import('../../src/recall/signals/graph-signal.js');
    const result = computeGraphSignal(['Alice']);

    expect(result.find(r => r.memory_id === 'mem_source')).toBeUndefined();
    expect(result.find(r => r.memory_id === 'mem_linked')).toBeDefined();
  });

  it('should respect topK limit', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/indexes.js', () => ({
      lookupByPrefix: vi.fn((prefix: string) => {
        if (prefix === 'topic:X') {
          return [{ condition_key: 'topic:X', memory_type: 'L3', memory_id: 'src' }];
        }
        return [];
      }),
    }));
    vi.doMock('../../src/store/graph.js', () => ({
      traverseGraph: vi.fn(() =>
        Array.from({ length: 20 }, (_, i) => ({
          target_id: `mem_${i}`,
          weight: 0.5,
          target_type: 'L2',
        })),
      ),
    }));

    const { computeGraphSignal } = await import('../../src/recall/signals/graph-signal.js');
    const result = computeGraphSignal(['X'], 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('should sort results by score descending', async () => {
    vi.resetModules();
    vi.doMock('../../src/store/indexes.js', () => ({
      lookupByPrefix: vi.fn((prefix: string) => {
        if (prefix === 'topic:Rust') {
          return [{ condition_key: 'topic:Rust', memory_type: 'L3', memory_id: 'src' }];
        }
        return [];
      }),
    }));
    vi.doMock('../../src/store/graph.js', () => ({
      traverseGraph: vi.fn(() => [
        { target_id: 'low', weight: 0.3, target_type: 'L1' },
        { target_id: 'high', weight: 0.9, target_type: 'L3' },
        { target_id: 'mid', weight: 0.6, target_type: 'L2' },
      ]),
    }));

    const { computeGraphSignal } = await import('../../src/recall/signals/graph-signal.js');
    const result = computeGraphSignal(['Rust']);

    expect(result[0].memory_id).toBe('high');
    expect(result[1].memory_id).toBe('mid');
    expect(result[2].memory_id).toBe('low');
  });
});
