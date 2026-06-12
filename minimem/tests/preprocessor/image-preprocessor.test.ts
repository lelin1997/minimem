// ============================================================
// ImagePreprocessor 单元测试
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config
vi.mock('../../src/config/index.js', () => ({
  getConfig: () => ({
    llm: {
      base_url: 'https://api.test.com/v1',
      api_key_env: 'TEST_LLM_KEY',
      timeout_ms: 30000,
      max_input_tokens: 6000,
      models: {
        heavy: 'test-heavy',
        medium: 'test-medium',
        light: 'test-light',
        vision: 'test-vision-model',
      },
      embedding: {
        enabled: false,
        model: 'test-embed',
        dimensions: 1024,
        base_url: '',
        api_key_env: '',
      },
      retry: {
        max_attempts: 3,
        base_delay_ms: 1000,
        max_delay_ms: 10000,
      },
    },
    perception: {
      enabled: true,
      multimodal: {
        image: {
          max_size_mb: 10,
          allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
          max_description_tokens: 2000,
          rate_limit_per_minute: 10,
        },
      },
    },
  }),
}));

// Mock LLM client to avoid full initialization
vi.mock('../../src/llm/client.js', () => ({
  getLLM: () => ({
    isAvailable: true,
  }),
}));

// 保存原始 env
const originalEnv = { ...process.env };

import { ImagePreprocessor, type ImageInputType } from '../../src/core/preprocessor/image-preprocessor.js';
import type { MultimodalInput } from '../../src/core/preprocessor/index.js';

function makeInput(overrides: Partial<MultimodalInput> = {}): MultimodalInput {
  return {
    source: 'test',
    ...overrides,
  };
}

describe('ImagePreprocessor', () => {
  let preprocessor: ImagePreprocessor;

  beforeEach(() => {
    preprocessor = new ImagePreprocessor();
    process.env.TEST_LLM_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('parseImageInput', () => {
    it('should parse JPEG Base64 data URI', () => {
      const base64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAAAAAA==';
      const result = preprocessor.parseImageInput(base64);

      expect(result.type).toBe('base64');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.base64Data).toBe('/9j/4AAQSkZJRgABAQAAAAAAAA==');
      expect(result.estimatedSizeBytes).toBeGreaterThan(0);
    });

    it('should parse PNG Base64 data URI', () => {
      const base64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const result = preprocessor.parseImageInput(base64);

      expect(result.type).toBe('base64');
      expect(result.mimeType).toBe('image/png');
    });

    it('should parse WebP Base64 data URI', () => {
      const base64 = 'data:image/webp;base64,UklGRlYAAABXRUJQVlA4IEoAAADQAQCdASoIAAUAAUAmJYgCdAEO/hQMAAAD++HP/4c//hz/+HP/4c//hzxgKQAA';
      const result = preprocessor.parseImageInput(base64);

      expect(result.type).toBe('base64');
      expect(result.mimeType).toBe('image/webp');
    });

    it('should parse GIF Base64 data URI', () => {
      const base64 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      const result = preprocessor.parseImageInput(base64);

      expect(result.type).toBe('base64');
      expect(result.mimeType).toBe('image/gif');
    });

    it('should parse HTTPS image URL', () => {
      const url = 'https://example.com/images/photo.jpg';
      const result = preprocessor.parseImageInput(url);

      expect(result.type).toBe('url');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.imageUrl).toBe(url);
      expect(result.estimatedSizeBytes).toBe(0); // URL 大小未知
    });

    it('should parse HTTP image URL', () => {
      const url = 'http://example.com/photo.png';
      const result = preprocessor.parseImageInput(url);

      expect(result.type).toBe('url');
      expect(result.mimeType).toBe('image/png');
    });

    it('should infer MIME type from URL extension', () => {
      expect(preprocessor.parseImageInput('https://x.com/a.jpg').mimeType).toBe('image/jpeg');
      expect(preprocessor.parseImageInput('https://x.com/a.jpeg').mimeType).toBe('image/jpeg');
      expect(preprocessor.parseImageInput('https://x.com/a.png').mimeType).toBe('image/png');
      expect(preprocessor.parseImageInput('https://x.com/a.gif').mimeType).toBe('image/gif');
      expect(preprocessor.parseImageInput('https://x.com/a.webp').mimeType).toBe('image/webp');
    });

    it('should default to image/jpeg for URLs without extension', () => {
      const result = preprocessor.parseImageInput('https://example.com/api/image?id=123');
      expect(result.mimeType).toBe('image/jpeg');
    });

    it('should reject non-image input', () => {
      expect(() => preprocessor.parseImageInput('/path/to/file.txt')).toThrow('Invalid image input');
      expect(() => preprocessor.parseImageInput('ftp://example.com/photo.jpg')).toThrow('Invalid image input');
      expect(() => preprocessor.parseImageInput('just some text')).toThrow('Invalid image input');
    });

    it('should reject unsupported Base64 MIME types', () => {
      // data:text/plain 不匹配 BASE64_URI_REGEX
      expect(() => preprocessor.parseImageInput('data:text/plain;base64,aGVsbG8=')).toThrow('Invalid image input');
    });

    it('should estimate Base64 data size correctly', () => {
      // 1000 chars of Base64 ≈ 750 bytes
      const base64Data = 'A'.repeat(1000);
      const uri = `data:image/jpeg;base64,${base64Data}`;
      const result = preprocessor.parseImageInput(uri);

      expect(result.estimatedSizeBytes).toBe(750);
    });
  });

  describe('preprocess', () => {
    it('should throw if image_url is missing', async () => {
      await expect(
        preprocessor.preprocess(makeInput({}))
      ).rejects.toThrow('image_url is required');
    });

    it('should throw for oversized Base64 images', async () => {
      // 创建一个超过 10MB 的 Base64 数据
      const hugeBase64 = 'A'.repeat(15 * 1024 * 1024 * 4 / 3); // ~15MB 原始数据
      const uri = `data:image/jpeg;base64,${hugeBase64}`;

      await expect(
        preprocessor.preprocess(makeInput({ image_url: uri }))
      ).rejects.toThrow('Image too large');
    });

    it('should call Vision API and return formatted result', async () => {
      // Mock fetch
      const mockDescription = '这是一张包含代码编辑器的截图，显示了一段 TypeScript 代码。';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: { content: mockDescription },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      }) as any;

      // 小型 Base64 图片
      const smallBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAAAAAA==';
      const result = await preprocessor.preprocess(makeInput({
        image_url: smallBase64,
        context: '这是编辑器截图',
      }));

      expect(result.content).toContain('[来源] image://');
      expect(result.content).toContain('[类型] 图片描述');
      expect(result.content).toContain('[上下文] 这是编辑器截图');
      expect(result.content).toContain(mockDescription);
      expect(result.contentType).toBe('image_import');
      expect(result.metadata.image_type).toBe('base64');
      expect(result.metadata.mime_type).toBe('image/jpeg');
    });

    it('should handle URL image input', async () => {
      const mockDescription = '一张风景照片，展示了山脉和湖泊。';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: { content: mockDescription },
          }],
          usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
        }),
      }) as any;

      const result = await preprocessor.preprocess(makeInput({
        image_url: 'https://example.com/landscape.png',
      }));

      expect(result.content).toContain('[来源] image://https://example.com/landscape.png');
      expect(result.content).toContain(mockDescription);
      expect(result.contentType).toBe('image_import');
      expect(result.metadata.image_type).toBe('url');
      expect(result.metadata.source_url).toBe('https://example.com/landscape.png');
    });

    it('should throw when Vision API returns empty description', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '' } }],
          usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 },
        }),
      }) as any;

      const smallBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAAAAAA==';
      await expect(
        preprocessor.preprocess(makeInput({ image_url: smallBase64 }))
      ).rejects.toThrow('Vision LLM returned empty description');
    });

    it('should throw when Vision API returns error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid image format'),
      }) as any;

      const smallBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAAAAAA==';
      await expect(
        preprocessor.preprocess(makeInput({ image_url: smallBase64 }))
      ).rejects.toThrow('Vision API error 400');
    });

    it('should throw when API key is not set', async () => {
      delete process.env.TEST_LLM_KEY;

      const smallBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAAAAAA==';
      await expect(
        preprocessor.preprocess(makeInput({ image_url: smallBase64 }))
      ).rejects.toThrow('LLM API key is not set');
    });

    it('should include context in formatted output when provided', async () => {
      const mockDescription = '图片中展示了系统架构图。';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: mockDescription } }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        }),
      }) as any;

      const result = await preprocessor.preprocess(makeInput({
        image_url: 'https://example.com/arch.png',
        context: 'MiniMem 系统架构',
      }));

      expect(result.content).toContain('[上下文] MiniMem 系统架构');
    });

    it('should not include context line when context is not provided', async () => {
      const mockDescription = '一张简单的图片。';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: mockDescription } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
      }) as any;

      const result = await preprocessor.preprocess(makeInput({
        image_url: 'https://example.com/simple.jpg',
      }));

      expect(result.content).not.toContain('[上下文]');
    });

    it('should send correct Vision API request format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'A test image.' } }],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        }),
      });
      global.fetch = mockFetch as any;

      const imageUrl = 'https://example.com/test.jpg';
      await preprocessor.preprocess(makeInput({ image_url: imageUrl }));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      // 验证请求体格式
      expect(body.model).toBe('test-vision-model');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');

      // 验证 user message 包含 image_url content part
      const userContent = body.messages[1].content;
      expect(Array.isArray(userContent)).toBe(true);
      expect(userContent[0].type).toBe('image_url');
      expect(userContent[0].image_url.url).toBe(imageUrl);
      expect(userContent[1].type).toBe('text');
    });

    it('should send Base64 data URI in Vision API request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'A test image.' } }],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        }),
      });
      global.fetch = mockFetch as any;

      const base64Uri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
      await preprocessor.preprocess(makeInput({ image_url: base64Uri }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const userContent = body.messages[1].content;
      expect(userContent[0].image_url.url).toBe(base64Uri);
    });

    it('should handle Vision API response with reasoning_content fallback', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '', reasoning_content: '这是推理模型的描述输出。' } }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        }),
      }) as any;

      const result = await preprocessor.preprocess(makeInput({
        image_url: 'https://example.com/test.jpg',
      }));

      expect(result.content).toContain('这是推理模型的描述输出。');
    });
  });

  describe('name', () => {
    it('should have correct preprocessor name', () => {
      expect(preprocessor.name).toBe('ImagePreprocessor');
    });
  });
});
