// ============================================================
// MiniMem — UrlPreprocessor 单元测试
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock url-security 模块（在 import 之前 mock）
const mockValidateUrl = vi.fn();
vi.mock('../../src/core/preprocessor/url-security.js', () => ({
  validateUrl: (...args: unknown[]) => mockValidateUrl(...args),
}));

// Mock getConfig
vi.mock('../../src/config/index.js', () => ({
  getConfig: () => ({}),
}));

import { UrlPreprocessor } from '../../src/core/preprocessor/url-preprocessor.js';

describe('UrlPreprocessor', () => {
  let preprocessor: UrlPreprocessor;

  beforeEach(() => {
    preprocessor = new UrlPreprocessor();
    // 默认 SSRF 校验通过
    mockValidateUrl.mockResolvedValue({ valid: true, url: new URL('https://example.com') });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have correct name', () => {
    expect(preprocessor.name).toBe('UrlPreprocessor');
  });

  it('should throw if url is missing', async () => {
    await expect(
      preprocessor.preprocess({ source: 'test' })
    ).rejects.toThrow('UrlPreprocessor requires a url field');
  });

  it('should throw when SSRF check fails', async () => {
    mockValidateUrl.mockResolvedValue({
      valid: false,
      error: 'Private/internal IP detected: 127.0.0.1',
    });

    await expect(
      preprocessor.preprocess({ url: 'http://127.0.0.1/admin', source: 'test' })
    ).rejects.toThrow('URL security check failed');
  });

  it('should process valid URL with mock fetch', async () => {
    const mockHtml = `
      <html>
        <head><title>Test Article</title></head>
        <body>
          <article>
            <h1>Test Article Title</h1>
            <p>This is a test article with enough content to pass the minimum length check. 
            It contains multiple paragraphs and meaningful text that Readability should be able to extract properly.</p>
            <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
            <p>More content here to ensure the extraction meets the minimum threshold of 50 characters for valid content.</p>
          </article>
        </body>
      </html>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(mockHtml).buffer),
    });

    const result = await preprocessor.preprocess({
      url: 'https://example.com/article',
      source: 'test',
      context: 'testing url preprocessing',
    });

    expect(result.contentType).toBe('url_import');
    expect(result.content).toContain('[来源] https://example.com/article');
    expect(result.metadata.source_url).toBe('https://example.com/article');
    expect(result.metadata.extract_mode).toBe('readability');
    expect(typeof result.metadata.fetched_at).toBe('string');
  });

  it('should handle HTTP errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({}),
    });

    await expect(
      preprocessor.preprocess({ url: 'https://example.com/not-found', source: 'test' })
    ).rejects.toThrow('HTTP 404');
  });

  it('should handle fetch timeout', async () => {
    global.fetch = vi.fn().mockImplementation(() => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      throw error;
    });

    await expect(
      preprocessor.preprocess({ url: 'https://slow-site.com/page', source: 'test' })
    ).rejects.toThrow('timed out');
  });

  it('should reject PDF Content-Type', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    await expect(
      preprocessor.preprocess({ url: 'https://example.com/file.pdf', source: 'test' })
    ).rejects.toThrow('PDF');
  });

  it('should include context in output when provided', async () => {
    const mockHtml = `
      <html>
        <head><title>Article</title></head>
        <body>
          <article>
            <p>Sufficient content here to pass the minimum content length validation check for UrlPreprocessor extraction. Adding more text to be safe and ensure it is long enough.</p>
          </article>
        </body>
      </html>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(mockHtml).buffer),
    });

    const result = await preprocessor.preprocess({
      url: 'https://example.com/article',
      source: 'test',
      context: 'This is a reference document for the project',
    });

    expect(result.content).toContain('[上下文] This is a reference document');
  });

  it('should truncate very long content', async () => {
    const longParagraph = 'x'.repeat(100_000);
    const mockHtml = `
      <html>
        <head><title>Long Article</title></head>
        <body>
          <article>
            <p>${longParagraph}</p>
          </article>
        </body>
      </html>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(mockHtml).buffer),
    });

    const result = await preprocessor.preprocess({
      url: 'https://example.com/long',
      source: 'test',
    });

    expect(result.metadata.truncated).toBe(true);
    expect(result.content).toContain('内容已截断');
  });
});
