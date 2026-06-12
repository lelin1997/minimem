// ============================================================
// MiniMem — InputRouter 单元测试
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { InputRouter, type Preprocessor, type MultimodalInput, type PreprocessResult } from '../../src/core/preprocessor/index.js';

// ── Mock Preprocessor ──

class MockPreprocessor implements Preprocessor {
  readonly name = 'MockPreprocessor';
  lastInput: MultimodalInput | null = null;

  async preprocess(input: MultimodalInput): Promise<PreprocessResult> {
    this.lastInput = input;
    return {
      content: `Processed: ${input.url ?? input.file_path ?? 'unknown'}`,
      contentType: 'url_import',
      metadata: { mock: true },
    };
  }
}

class MockChunkingPreprocessor implements Preprocessor {
  readonly name = 'MockChunkingPreprocessor';

  async preprocess(input: MultimodalInput): Promise<PreprocessResult[]> {
    return [
      { content: 'Chunk 1', contentType: 'file_import', metadata: { chunk: 0 } },
      { content: 'Chunk 2', contentType: 'file_import', metadata: { chunk: 1 } },
      { content: 'Chunk 3', contentType: 'file_import', metadata: { chunk: 2 } },
    ];
  }
}

describe('InputRouter', () => {
  let router: InputRouter;

  beforeEach(() => {
    router = new InputRouter();
  });

  describe('detectType', () => {
    it('should detect URL input', () => {
      expect(router.detectType({ url: 'https://example.com', source: 'test' })).toBe('url');
    });

    it('should detect image input', () => {
      expect(router.detectType({ image_url: 'https://img.com/photo.jpg', source: 'test' })).toBe('image');
    });

    it('should detect file input', () => {
      expect(router.detectType({ file_path: '/path/to/file.md', source: 'test' })).toBe('file');
    });

    it('should detect text input (default)', () => {
      expect(router.detectType({ content: 'hello world', source: 'test' })).toBe('text');
    });

    it('should detect text for empty input', () => {
      expect(router.detectType({ source: 'test' })).toBe('text');
    });

    it('should prioritize url over content', () => {
      expect(router.detectType({
        content: 'some text',
        url: 'https://example.com',
        source: 'test',
      })).toBe('url');
    });
  });

  describe('route', () => {
    it('should return null for text input (bypass)', async () => {
      const result = await router.route({ content: 'hello world', source: 'test' });
      expect(result).toBeNull();
    });

    it('should route URL input to registered preprocessor', async () => {
      const mockPp = new MockPreprocessor();
      router.register('url', mockPp);

      const result = await router.route({ url: 'https://example.com', source: 'test' });
      expect(result).not.toBeNull();
      expect(result!.length).toBe(1);
      expect(result![0].content).toBe('Processed: https://example.com');
      expect(mockPp.lastInput!.url).toBe('https://example.com');
    });

    it('should throw for unregistered input type', async () => {
      await expect(
        router.route({ url: 'https://example.com', source: 'test' })
      ).rejects.toThrow('No preprocessor registered for input type: url');
    });

    it('should handle multi-result preprocessors (chunking)', async () => {
      const mockPp = new MockChunkingPreprocessor();
      router.register('file', mockPp);

      const result = await router.route({ file_path: '/path/to/file.md', source: 'test' });
      expect(result).not.toBeNull();
      expect(result!.length).toBe(3);
      expect(result![0].content).toBe('Chunk 1');
      expect(result![2].metadata.chunk).toBe(2);
    });
  });

  describe('register', () => {
    it('should register and use preprocessors', async () => {
      const urlPp = new MockPreprocessor();
      router.register('url', urlPp);

      const result = await router.route({ url: 'https://example.com/page', source: 'test' });
      expect(result).not.toBeNull();
      expect(result![0].metadata.mock).toBe(true);
    });

    it('should allow overwriting registered preprocessors', async () => {
      const pp1 = new MockPreprocessor();
      const pp2 = new MockPreprocessor();
      router.register('url', pp1);
      router.register('url', pp2);

      await router.route({ url: 'https://example.com', source: 'test' });
      expect(pp1.lastInput).toBeNull();
      expect(pp2.lastInput).not.toBeNull();
    });
  });
});
