/**
 * MiniMem — 工具函数测试
 */
import { describe, it, expect } from 'vitest';
import {
  generateId,
  generateShortId,
  now,
  safeJsonParse,
  truncate,
  estimateTokens,
  slugify,
  processBatch,
  hashContent,
  sleep,
} from '../../src/common/utils.js';

describe('generateId', () => {
  it('应该生成 21 字符的唯一 ID', () => {
    const id = generateId();
    expect(id).toHaveLength(21);
    expect(typeof id).toBe('string');
  });

  it('每次生成的 ID 应该不同', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateShortId', () => {
  it('应该生成 10 字符的短 ID', () => {
    const id = generateShortId();
    expect(id).toHaveLength(10);
  });
});

describe('now', () => {
  it('应该返回 ISO 8601 格式的时间字符串', () => {
    const time = now();
    expect(new Date(time).toISOString()).toBe(time);
  });
});

describe('safeJsonParse', () => {
  it('应该正确解析有效 JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
    expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3]);
    expect(safeJsonParse('"hello"', '')).toBe('hello');
  });

  it('解析失败时应该返回 fallback', () => {
    expect(safeJsonParse('invalid json', 'default')).toBe('default');
    expect(safeJsonParse('{broken', [])).toEqual([]);
    expect(safeJsonParse('', null)).toBeNull();
  });
});

describe('truncate', () => {
  it('短字符串不截断', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('长字符串截断并加省略号', () => {
    const result = truncate('this is a long string', 10);
    expect(result).toBe('this is...');
    expect(result).toHaveLength(10);
  });

  it('刚好长度不截断', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });
});

describe('estimateTokens', () => {
  it('英文文本估算 ~4 字符/token', () => {
    const tokens = estimateTokens('hello world');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it('中文文本估算 ~2 字符/token', () => {
    const tokens = estimateTokens('你好世界');
    expect(tokens).toBeGreaterThan(0);
  });

  it('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('混合文本合理估算', () => {
    const tokens = estimateTokens('Hello 你好 World 世界');
    expect(tokens).toBeGreaterThan(2);
    expect(tokens).toBeLessThan(20);
  });
});

describe('slugify', () => {
  it('基本英文 slug 化', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('保留中文', () => {
    expect(slugify('你好世界')).toBe('你好世界');
  });

  it('处理特殊字符', () => {
    expect(slugify('  Hello, World! 123  ')).toBe('hello-world-123');
  });

  it('处理多个空格和连字符', () => {
    expect(slugify('a   b---c')).toBe('a-b-c');
  });

  it('中英文混合', () => {
    expect(slugify('Alice 的项目')).toBe('alice-的项目');
  });
});

describe('processBatch', () => {
  it('应该按批次处理', async () => {
    const items = [1, 2, 3, 4, 5];
    const batches: number[][] = [];
    const result = await processBatch(items, 2, async (batch) => {
      batches.push(batch);
      return batch.map(x => x * 10);
    });
    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(batches).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('空数组返回空', async () => {
    const result = await processBatch([], 5, async (batch) => batch);
    expect(result).toEqual([]);
  });
});

describe('hashContent', () => {
  it('应该返回 SHA-256 哈希', async () => {
    const hash = await hashContent('test content');
    expect(hash).toHaveLength(64); // SHA-256 = 64 hex chars
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('相同内容产生相同哈希', async () => {
    const h1 = await hashContent('same content');
    const h2 = await hashContent('same content');
    expect(h1).toBe(h2);
  });

  it('不同内容产生不同哈希', async () => {
    const h1 = await hashContent('content A');
    const h2 = await hashContent('content B');
    expect(h1).not.toBe(h2);
  });
});

describe('sleep', () => {
  it('应该延迟指定时间', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // 允许误差
  });
});
