/**
 * MiniMem — 错误类测试
 */
import { describe, it, expect } from 'vitest';
import {
  MiniMemError,
  NotFoundError,
  DuplicateError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  LLMError,
  StorageError,
  DreamError,
} from '../../src/common/errors.js';

describe('MiniMemError', () => {
  it('应该包含正确属性', () => {
    const err = new MiniMemError('test message', 'TEST_CODE', 500, { key: 'value' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MiniMemError);
    expect(err.message).toBe('test message');
    expect(err.code).toBe('TEST_CODE');
    expect(err.statusCode).toBe(500);
    expect(err.details).toEqual({ key: 'value' });
    expect(err.name).toBe('MiniMemError');
  });

  it('默认 statusCode 为 500', () => {
    const err = new MiniMemError('test', 'CODE');
    expect(err.statusCode).toBe(500);
  });
});

describe('NotFoundError', () => {
  it('应该设置 404 和 NOT_FOUND', () => {
    const err = new NotFoundError('Experience', 'abc123');
    expect(err.message).toContain('Experience');
    expect(err.message).toContain('abc123');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('NotFoundError');
  });
});

describe('DuplicateError', () => {
  it('应该设置 409 和 DUPLICATE', () => {
    const err = new DuplicateError('Page', 'slug-1');
    expect(err.code).toBe('DUPLICATE');
    expect(err.statusCode).toBe(409);
  });
});

describe('ValidationError', () => {
  it('应该设置 400', () => {
    const err = new ValidationError('content too long', { maxLen: 100 });
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ maxLen: 100 });
  });
});

describe('AuthenticationError', () => {
  it('应该设置 401', () => {
    const err = new AuthenticationError();
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Authentication required');
  });
});

describe('AuthorizationError', () => {
  it('应该设置 403', () => {
    const err = new AuthorizationError();
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Insufficient permissions');
  });
});

describe('RateLimitError', () => {
  it('应该设置 429', () => {
    const err = new RateLimitError(60, '1 minute');
    expect(err.statusCode).toBe(429);
    expect(err.message).toContain('60');
    expect(err.message).toContain('1 minute');
  });
});

describe('LLMError', () => {
  it('应该设置 502', () => {
    const err = new LLMError('timeout', 'qwen-plus');
    expect(err.statusCode).toBe(502);
    expect(err.details).toEqual({ provider: 'qwen-plus' });
  });
});

describe('StorageError', () => {
  it('应该设置 500', () => {
    const err = new StorageError('disk full', 'write');
    expect(err.statusCode).toBe(500);
    expect(err.details).toEqual({ operation: 'write' });
  });
});

describe('DreamError', () => {
  it('应该设置 500 和阶段信息', () => {
    const err = new DreamError('phase 2 failed', 2);
    expect(err.statusCode).toBe(500);
    expect(err.details).toEqual({ phase: 2 });
  });
});
