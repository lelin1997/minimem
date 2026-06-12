/**
 * MiniMem — LLM Client 单元测试
 *
 * 测试策略：mock fetch + mock getConfig，验证 LLMClient 的：
 * - guardInputLength（输入截断）
 * - fetchWithRetry（超时 + 指数退避重试）
 * - isRetryableStatus（状态码判断）
 * - metrics（可观测性指标）
 * - chat / chatJson / embed 的正确调用
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock getConfig 在 import 之前
vi.mock('../../src/config/index.js', () => ({
  getConfig: () => ({
    llm: {
      provider: 'openai-compatible',
      base_url: 'https://api.test.com/v1',
      api_key_env: 'TEST_API_KEY',
      models: { heavy: 'model-heavy', medium: 'model-medium', light: 'model-light' },
      embedding: {
        enabled: true,
        model: 'text-embedding-test',
        dimensions: 128,
        base_url: '',
        api_key_env: '',
      },
      timeout_ms: 5_000,
      max_input_tokens: 100,
      retry: {
        max_attempts: 3,
        base_delay_ms: 10, // 测试中用极短延迟
        max_delay_ms: 50,
      },
      cost_limit: { daily: 10, monthly: 200 },
      batch: { batch_size: 10, max_wait_ms: 300_000 },
      cache: { enabled: true, semantic_threshold: 0.95, ttl_hours: 24 },
    },
  }),
}));

// Mock logger
vi.mock('../../src/common/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Set API key before importing
process.env.TEST_API_KEY = 'test-key-123';

import { LLMClient } from '../../src/llm/client.js';
import { LLMError } from '../../src/common/errors.js';

// ── 测试工具 ──

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function makeChatResponse(content = 'test response', tokens = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) {
  return {
    choices: [{ message: { content } }],
    model: 'model-medium',
    usage: tokens,
  };
}

function makeEmbeddingResponse(dims = 128) {
  return {
    data: [{ embedding: Array(dims).fill(0.1) }],
    model: 'text-embedding-test',
    usage: { prompt_tokens: 5, total_tokens: 5 },
  };
}

describe('LLMClient', () => {
  let client: LLMClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new LLMClient();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ═══════════════ 基本功能 ═══════════════

  describe('isAvailable', () => {
    it('有 API key 时应返回 true', () => {
      expect(client.isAvailable).toBe(true);
    });
  });

  describe('isEmbeddingAvailable', () => {
    it('embedding 启用且有 key 时应返回 true', () => {
      expect(client.isEmbeddingAvailable).toBe(true);
    });
  });

  // ═══════════════ chat ═══════════════

  describe('chat', () => {
    it('应正确发送 chat 请求并返回结果', async () => {
      const mockResponse = makeChatResponse('Hello!');
      globalThis.fetch = mockFetchResponse(mockResponse);

      const result = await client.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        tier: 'medium',
      });

      expect(result.content).toBe('Hello!');
      expect(result.model).toBe('model-medium');
      expect(result.usage.total_tokens).toBe(15);
    });

    it('应使用指定的 model tier', async () => {
      globalThis.fetch = mockFetchResponse(makeChatResponse());

      await client.chat({
        messages: [{ role: 'user', content: 'test' }],
        tier: 'heavy',
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe('model-heavy');
    });

    it('应发送 response_format 参数', async () => {
      globalThis.fetch = mockFetchResponse(makeChatResponse('{"key":"value"}'));

      await client.chat({
        messages: [{ role: 'user', content: 'test' }],
        response_format: { type: 'json_object' },
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });
  });

  // ═══════════════ chatJson ═══════════════

  describe('chatJson', () => {
    it('应解析 JSON 返回结果', async () => {
      globalThis.fetch = mockFetchResponse(makeChatResponse('{"name":"Alice","age":30}'));

      const result = await client.chatJson<{ name: string; age: number }>({
        messages: [{ role: 'user', content: 'test' }],
        fallback: { name: '', age: 0 },
      });

      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('JSON 解析失败应返回 fallback', async () => {
      globalThis.fetch = mockFetchResponse(makeChatResponse('not valid json'));

      const fallback = { name: 'default', age: 0 };
      const result = await client.chatJson<{ name: string; age: number }>({
        messages: [{ role: 'user', content: 'test' }],
        fallback,
      });

      expect(result).toEqual(fallback);
    });

    it('请求失败应返回 fallback', async () => {
      globalThis.fetch = mockFetchResponse({ error: 'bad request' }, 400);

      const fallback = { value: 42 };
      const result = await client.chatJson<{ value: number }>({
        messages: [{ role: 'user', content: 'test' }],
        fallback,
      });

      expect(result).toEqual(fallback);
    });
  });

  // ═══════════════ embed ═══════════════

  describe('embed', () => {
    it('应返回 embedding 向量', async () => {
      globalThis.fetch = mockFetchResponse(makeEmbeddingResponse(128));

      const result = await client.embed('test text');
      expect(result.embedding).toHaveLength(128);
      expect(result.model).toBe('text-embedding-test');
    });

    it('超长文本应被截断后发送', async () => {
      globalThis.fetch = mockFetchResponse(makeEmbeddingResponse());

      // 生成超过 maxInputTokens/2 = 50 tokens 的文本（50 * 4 = 200+ 字符）
      const longText = 'a'.repeat(1000);
      await client.embed(longText);

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      // 截断后的文本应该比原文短
      expect(body.input.length).toBeLessThan(longText.length);
    });
  });

  // ═══════════════ guardInputLength ═══════════════

  describe('guardInputLength (通过 chat 间接测试)', () => {
    it('system 消息不应被截断', async () => {
      const longSystem = 'x'.repeat(10_000);
      globalThis.fetch = mockFetchResponse(makeChatResponse());

      await client.chat({
        messages: [
          { role: 'system', content: longSystem },
          { role: 'user', content: 'hi' },
        ],
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      // system 消息应保留完整
      expect(body.messages[0].content).toBe(longSystem);
    });

    it('超长 user 消息应被截断', async () => {
      const longUser = 'a'.repeat(10_000);
      globalThis.fetch = mockFetchResponse(makeChatResponse());

      await client.chat({
        messages: [{ role: 'user', content: longUser }],
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.messages[0].content.length).toBeLessThan(longUser.length);
      expect(body.messages[0].content).toContain('内容已截断');
    });

    it('短消息不应被截断', async () => {
      globalThis.fetch = mockFetchResponse(makeChatResponse());

      await client.chat({
        messages: [{ role: 'user', content: 'short message' }],
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.messages[0].content).toBe('short message');
    });
  });

  // ═══════════════ fetchWithRetry ═══════════════

  describe('fetchWithRetry (通过 chat 间接测试)', () => {
    it('429 应触发重试然后成功', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            text: () => Promise.resolve('Rate limited'),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeChatResponse('retry success')),
        });
      });

      const result = await client.chat({
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(callCount).toBe(2);
      expect(result.content).toBe('retry success');
    });

    it('500 应触发重试然后成功', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Internal Server Error'),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeChatResponse()),
        });
      });

      const result = await client.chat({
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(callCount).toBe(2);
    });

    it('400 不应重试，直接抛 LLMError', async () => {
      globalThis.fetch = mockFetchResponse({ error: 'bad' }, 400);

      await expect(client.chat({
        messages: [{ role: 'user', content: 'test' }],
      })).rejects.toThrow(LLMError);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('所有重试都失败应抛出最终错误', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server Error'),
      });

      await expect(client.chat({
        messages: [{ role: 'user', content: 'test' }],
      })).rejects.toThrow(LLMError);

      // 3 次尝试（1 初始 + 2 重试）
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it('网络错误应触发重试', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeChatResponse('recovered')),
        });
      });

      const result = await client.chat({
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(callCount).toBe(3);
      expect(result.content).toBe('recovered');
    });
  });

  // ═══════════════ metrics ═══════════════

  describe('metrics', () => {
    it('初始指标应全为 0', () => {
      const m = client.metrics;
      expect(m.totalRequests).toBe(0);
      expect(m.totalErrors).toBe(0);
      expect(m.totalRetries).toBe(0);
      expect(m.totalPromptTokens).toBe(0);
      expect(m.totalCompletionTokens).toBe(0);
    });

    it('chat 调用后应更新指标', async () => {
      globalThis.fetch = mockFetchResponse(makeChatResponse('hi', { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }));

      await client.chat({
        messages: [{ role: 'user', content: 'test' }],
        tier: 'light',
      });

      const m = client.metrics;
      expect(m.totalRequests).toBe(1);
      expect(m.requestsByTier.light).toBe(1);
      expect(m.requestsByType.chat).toBe(1);
      expect(m.totalPromptTokens).toBe(20);
      expect(m.totalCompletionTokens).toBe(10);
      expect(m.totalLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('chatJson 应同时计 chat 和 chatJson', async () => {
      globalThis.fetch = mockFetchResponse(makeChatResponse('{"a":1}'));

      await client.chatJson({
        messages: [{ role: 'user', content: 'test' }],
        fallback: {},
      });

      const m = client.metrics;
      expect(m.requestsByType.chatJson).toBe(1);
      expect(m.requestsByType.chat).toBe(1);
    });

    it('embed 应更新 embedding 指标', async () => {
      globalThis.fetch = mockFetchResponse(makeEmbeddingResponse());

      await client.embed('test text');

      const m = client.metrics;
      expect(m.totalRequests).toBe(1);
      expect(m.requestsByType.embed).toBe(1);
      expect(m.totalEmbeddingTokens).toBe(5);
    });

    it('错误应增加 totalErrors', async () => {
      globalThis.fetch = mockFetchResponse({ error: 'bad' }, 400);

      try {
        await client.chat({ messages: [{ role: 'user', content: 'test' }] });
      } catch { /* expected */ }

      expect(client.metrics.totalErrors).toBe(1);
    });

    it('重试应增加 totalRetries', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            text: () => Promise.resolve('rate limited'),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeChatResponse()),
        });
      });

      await client.chat({ messages: [{ role: 'user', content: 'test' }] });
      expect(client.metrics.totalRetries).toBe(1);
    });

    it('resetMetrics 应重置所有指标', async () => {
      globalThis.fetch = mockFetchResponse(makeChatResponse());
      await client.chat({ messages: [{ role: 'user', content: 'test' }] });

      expect(client.metrics.totalRequests).toBeGreaterThan(0);

      client.resetMetrics();

      const m = client.metrics;
      expect(m.totalRequests).toBe(0);
      expect(m.totalErrors).toBe(0);
      expect(m.totalRetries).toBe(0);
      expect(m.totalPromptTokens).toBe(0);
      expect(m.requestsByTier.heavy).toBe(0);
      expect(m.requestsByType.chat).toBe(0);
    });
  });

  // ═══════════════ embedBatch ═══════════════

  describe('embedBatch', () => {
    it('应逐个调用 embed', async () => {
      globalThis.fetch = mockFetchResponse(makeEmbeddingResponse());

      const results = await client.embedBatch(['text1', 'text2', 'text3']);

      expect(results).toHaveLength(3);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });
  });
});
