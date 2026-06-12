// ============================================================
// MiniMem — Chunker 单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { chunkContent } from '../../src/core/preprocessor/chunker.js';

describe('chunkContent', () => {
  // ── Markdown 分块 ──

  describe('Markdown strategy', () => {
    it('should return single chunk for short content', () => {
      const content = '# Title\n\nSome short content.';
      const chunks = chunkContent(content, {
        strategy: 'markdown',
        maxChunkSize: 50_000,
        overlap: 200,
        maxChunks: 20,
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(content);
      expect(chunks[0].index).toBe(0);
      expect(chunks[0].batchId).toBeDefined();
      expect(chunks[0].heading).toBe('Title');
    });

    it('should split by ## headings', () => {
      const content = [
        '# Main Title',
        '',
        'Introduction paragraph.',
        '',
        '## Section One',
        '',
        'Content of section one.',
        '',
        '## Section Two',
        '',
        'Content of section two.',
        '',
        '## Section Three',
        '',
        'Content of section three.',
      ].join('\n');

      const chunks = chunkContent(content, {
        strategy: 'markdown',
        maxChunkSize: 100, // 小 chunk 大小迫使分块
        overlap: 0,
        maxChunks: 20,
      });

      expect(chunks.length).toBeGreaterThan(1);
      // 所有 chunk 应共享同一 batchId
      const batchIds = new Set(chunks.map(c => c.batchId));
      expect(batchIds.size).toBe(1);
    });

    it('should preserve heading info', () => {
      const content = [
        '## Getting Started',
        '',
        'Install the package.',
        '',
        '## Configuration',
        '',
        'Configure your settings.',
      ].join('\n');

      const chunks = chunkContent(content, {
        strategy: 'markdown',
        maxChunkSize: 50, // 小 chunk 大小迫使分块
        overlap: 0,
        maxChunks: 20,
      });

      // 至少有一个 chunk 包含 heading
      const hasHeading = chunks.some(c => c.heading !== undefined);
      expect(hasHeading).toBe(true);
    });

    it('should fallback to paragraph splitting when no headings', () => {
      const content = [
        'First paragraph with some text.',
        '',
        'Second paragraph with more text.',
        '',
        'Third paragraph with even more text.',
      ].join('\n');

      const chunks = chunkContent(content, {
        strategy: 'markdown',
        maxChunkSize: 40,
        overlap: 0,
        maxChunks: 20,
      });

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should handle deeply nested headings', () => {
      const content = [
        '# H1',
        '## H2',
        '### H3',
        'Some content under H3.',
        '#### H4',
        'Content under H4.',
        '## Another H2',
        'Content under another H2.',
      ].join('\n');

      const chunks = chunkContent(content, {
        strategy: 'markdown',
        maxChunkSize: 50,
        overlap: 0,
        maxChunks: 20,
      });

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  // ── 纯文本分块 ──

  describe('Plaintext strategy', () => {
    it('should split by double newlines (paragraphs)', () => {
      const content = [
        'First paragraph.',
        '',
        'Second paragraph.',
        '',
        'Third paragraph.',
      ].join('\n');

      const chunks = chunkContent(content, {
        strategy: 'plaintext',
        maxChunkSize: 30,
        overlap: 0,
        maxChunks: 20,
      });

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should return single chunk for short text', () => {
      const content = 'Just a short text.';
      const chunks = chunkContent(content, {
        strategy: 'plaintext',
        maxChunkSize: 50_000,
        overlap: 200,
        maxChunks: 20,
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(content);
    });
  });

  // ── 边界情况 ──

  describe('Edge cases', () => {
    it('should respect maxChunks limit', () => {
      // 生成很多段落
      const paragraphs = Array.from({ length: 50 }, (_, i) =>
        `Paragraph ${i}: ${'A'.repeat(100)}`
      );
      const content = paragraphs.join('\n\n');

      const chunks = chunkContent(content, {
        strategy: 'plaintext',
        maxChunkSize: 200,
        overlap: 0,
        maxChunks: 5,
      });

      expect(chunks.length).toBeLessThanOrEqual(5);
    });

    it('should handle very large chunks with hard split', () => {
      // 单个无换行的超长文本
      const content = 'A'.repeat(10_000);

      const chunks = chunkContent(content, {
        strategy: 'plaintext',
        maxChunkSize: 3000,
        overlap: 100,
        maxChunks: 20,
      });

      expect(chunks.length).toBeGreaterThan(1);
      // 每个 chunk 不应超过 maxChunkSize
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(3000);
      }
    });

    it('should handle overlap between chunks', () => {
      const content = 'A'.repeat(6000);

      const chunks = chunkContent(content, {
        strategy: 'plaintext',
        maxChunkSize: 3000,
        overlap: 500,
        maxChunks: 20,
      });

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should merge tiny chunks', () => {
      const content = [
        'A',   // tiny
        '',
        'B',   // tiny
        '',
        'C',   // tiny
        '',
        'D',   // tiny
      ].join('\n');

      const chunks = chunkContent(content, {
        strategy: 'plaintext',
        maxChunkSize: 50_000,
        overlap: 0,
        maxChunks: 20,
      });

      // Tiny chunks should be merged into one
      expect(chunks).toHaveLength(1);
    });

    it('should have consistent batchId across all chunks', () => {
      const content = Array.from({ length: 10 }, (_, i) =>
        `## Section ${i}\n\nContent for section ${i}.`
      ).join('\n\n');

      const chunks = chunkContent(content, {
        strategy: 'markdown',
        maxChunkSize: 50,
        overlap: 0,
        maxChunks: 20,
      });

      const batchIds = new Set(chunks.map(c => c.batchId));
      expect(batchIds.size).toBe(1);
    });

    it('should assign sequential indices', () => {
      const content = Array.from({ length: 5 }, (_, i) =>
        `Paragraph ${i}: ${'X'.repeat(200)}`
      ).join('\n\n');

      const chunks = chunkContent(content, {
        strategy: 'plaintext',
        maxChunkSize: 300,
        overlap: 0,
        maxChunks: 20,
      });

      chunks.forEach((chunk, i) => {
        expect(chunk.index).toBe(i);
      });
    });
  });
});
