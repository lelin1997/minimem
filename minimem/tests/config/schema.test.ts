/**
 * MiniMem — 配置 Schema 校验测试
 */
import { describe, it, expect } from 'vitest';
import { validateConfig } from '../../src/config/schema.js';
import { DEFAULT_CONFIG } from '../../src/config/index.js';

describe('Config Schema Validation', () => {
  it('默认配置应通过校验', () => {
    const result = validateConfig(DEFAULT_CONFIG);
    expect(result.valid).toBe(true);
  });

  it('完全空对象应失败', () => {
    const result = validateConfig({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('null 应失败', () => {
    const result = validateConfig(null);
    expect(result.valid).toBe(false);
  });

  // ── server 节 ──

  describe('server', () => {
    it('port 超范围应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.server.port = 99999;
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some(e => e.path.includes('port'))).toBe(true);
      }
    });

    it('port 为负数应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.server.port = -1;
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('mode 无效值应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
      (config as any).server.mode = 'invalid';
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some(e => e.path.includes('mode'))).toBe(true);
      }
    });
  });

  // ── llm 节 ──

  describe('llm', () => {
    it('base_url 非 URL 应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.llm.base_url = 'not-a-url';
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some(e => e.path.includes('base_url'))).toBe(true);
      }
    });

    it('timeout_ms 过小应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.llm.timeout_ms = 100; // < 1000
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('timeout_ms 过大应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.llm.timeout_ms = 999_999; // > 120000
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('max_input_tokens 合法范围应通过', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.llm.max_input_tokens = 8000;
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('retry.max_attempts = 0 应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.llm.retry.max_attempts = 0;
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('models 为空字符串应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.llm.models.heavy = '';
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('embedding.dimensions 为负数应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.llm.embedding.dimensions = -1;
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('cost_limit.daily 为负数应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.llm.cost_limit.daily = -5;
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  // ── ingest 节 ──

  describe('ingest', () => {
    it('pii_detection 无效值应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
      (config as any).ingest.pii_detection = 'invalid';
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  // ── storage 节 ──

  describe('storage', () => {
    it('vector.provider 无效值应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
      (config as any).storage.vector.provider = 'unknown-provider';
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('log.max_files 为 0 应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.storage.log.max_files = 0;
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  // ── gc 节 ──

  describe('gc', () => {
    it('storage_quotas.hot = 0 应失败', () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.gc.storage_quotas.hot = 0;
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  // ── 多错误报告 ──

  it('应同时报告多个校验错误', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.server.port = -1;
    config.llm.timeout_ms = 0;
    config.llm.models.heavy = '';
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});
