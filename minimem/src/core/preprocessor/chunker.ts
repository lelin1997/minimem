// ============================================================
// MiniMem — Content Chunker
// ============================================================
// 职责：将大文本智能分块，支持 Markdown 和纯文本两种策略
// 保证每块不超过 maxChunkSize，块间可选 overlap

import { generateId } from '../../common/utils.js';

// ── 类型 ──

export type ChunkStrategy = 'markdown' | 'plaintext';

export interface ChunkOptions {
  /** 分块策略 */
  strategy: ChunkStrategy;
  /** 单块最大字符数 */
  maxChunkSize: number;
  /** 块间重叠字符数 */
  overlap: number;
  /** 最大块数（防止 L1 爆炸） */
  maxChunks: number;
}

export interface ChunkResult {
  /** 块内容 */
  content: string;
  /** 块索引 */
  index: number;
  /** 批次 ID（同一文件的所有块共享） */
  batchId: string;
  /** 章节标题（仅 Markdown 策略） */
  heading?: string;
}

// ── 主入口 ──

/**
 * 将内容按指定策略分块
 *
 * 策略优先级：
 * 1. Markdown: 按 ## 标题分割，每个标题段独立成块
 * 2. Plaintext: 按双换行（段落）分割
 * 3. 保底: 超过 maxChunkSize 时硬切 + overlap
 */
export function chunkContent(
  content: string,
  options: ChunkOptions,
): ChunkResult[] {
  const { strategy, maxChunkSize, overlap, maxChunks } = options;
  const batchId = generateId();

  // 如果内容小于一个 chunk，直接返回单块
  if (content.length <= maxChunkSize) {
    return [{
      content,
      index: 0,
      batchId,
      heading: strategy === 'markdown' ? extractFirstHeading(content) : undefined,
    }];
  }

  // 按策略分块
  let rawChunks: Array<{ content: string; heading?: string }>;

  if (strategy === 'markdown') {
    rawChunks = chunkByMarkdownHeadings(content);
  } else {
    rawChunks = chunkByParagraphs(content);
  }

  // 后处理：确保每块不超过 maxChunkSize，合并过小的块
  const processed = postProcess(rawChunks, maxChunkSize, overlap);

  // 限制最大块数
  const limited = processed.slice(0, maxChunks);

  return limited.map((chunk, index) => ({
    content: chunk.content,
    index,
    batchId,
    heading: chunk.heading,
  }));
}

// ── Markdown 分块：按标题分割 ──

/**
 * 按 Markdown 标题（## 及以上）分割
 * 每个标题段独立成块，保留标题作为 heading
 */
function chunkByMarkdownHeadings(
  content: string,
): Array<{ content: string; heading?: string }> {
  // 匹配 Markdown 标题行（# 到 ######）
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const chunks: Array<{ content: string; heading?: string }> = [];

  let lastIndex = 0;
  let lastHeading: string | undefined;
  const matches = [...content.matchAll(headingRegex)];

  if (matches.length === 0) {
    // 没有标题，fallback 到段落分割
    return chunkByParagraphs(content);
  }

  for (const match of matches) {
    const matchIndex = match.index!;

    // 当前标题之前的内容归入上一个块
    if (matchIndex > lastIndex) {
      const sectionContent = content.slice(lastIndex, matchIndex).trim();
      if (sectionContent.length > 0) {
        chunks.push({
          content: sectionContent,
          heading: lastHeading,
        });
      }
    }

    lastIndex = matchIndex;
    lastHeading = match[2].trim(); // 标题文本
  }

  // 最后一段
  if (lastIndex < content.length) {
    const sectionContent = content.slice(lastIndex).trim();
    if (sectionContent.length > 0) {
      chunks.push({
        content: sectionContent,
        heading: lastHeading,
      });
    }
  }

  return chunks;
}

// ── 纯文本分块：按段落分割 ──

/**
 * 按双换行（段落边界）分割
 */
function chunkByParagraphs(
  content: string,
): Array<{ content: string; heading?: string }> {
  const paragraphs = content.split(/\n{2,}/);
  const chunks: Array<{ content: string; heading?: string }> = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length > 0) {
      chunks.push({ content: trimmed });
    }
  }

  return chunks;
}

// ── 后处理：合并小块 + 拆分大块 + overlap ──

function postProcess(
  rawChunks: Array<{ content: string; heading?: string }>,
  maxChunkSize: number,
  overlap: number,
): Array<{ content: string; heading?: string }> {
  const result: Array<{ content: string; heading?: string }> = [];

  // 第一遍：拆分超大块
  const splitChunks: Array<{ content: string; heading?: string }> = [];
  for (const chunk of rawChunks) {
    if (chunk.content.length <= maxChunkSize) {
      splitChunks.push(chunk);
    } else {
      // 硬切 + overlap
      const parts = hardSplit(chunk.content, maxChunkSize, overlap);
      parts.forEach((part, i) => {
        splitChunks.push({
          content: part,
          heading: i === 0 ? chunk.heading : chunk.heading ? `${chunk.heading} (续)` : undefined,
        });
      });
    }
  }

  // 第二遍：合并过小的连续块（小于 maxChunkSize 的 20%）
  const minChunkSize = Math.floor(maxChunkSize * 0.2);
  let buffer: { content: string; heading?: string } | null = null;

  for (const chunk of splitChunks) {
    if (!buffer) {
      buffer = { ...chunk };
      continue;
    }

    // 如果当前 buffer + 新块还在限制内，合并
    const combined = buffer.content + '\n\n' + chunk.content;
    if (combined.length <= maxChunkSize) {
      buffer.content = combined;
      // 保留第一个 heading
      if (!buffer.heading && chunk.heading) {
        buffer.heading = chunk.heading;
      }
    } else {
      // buffer 已满，推入结果
      if (buffer.content.length >= minChunkSize || result.length === 0) {
        result.push(buffer);
      } else if (result.length > 0) {
        // 太小了，追加到上一个块（如果不超限）
        const last = result[result.length - 1];
        const appended = last.content + '\n\n' + buffer.content;
        if (appended.length <= maxChunkSize) {
          last.content = appended;
        } else {
          result.push(buffer);
        }
      }
      buffer = { ...chunk };
    }
  }

  // 清空 buffer
  if (buffer) {
    if (buffer.content.length >= minChunkSize || result.length === 0) {
      result.push(buffer);
    } else if (result.length > 0) {
      const last = result[result.length - 1];
      const appended = last.content + '\n\n' + buffer.content;
      if (appended.length <= maxChunkSize) {
        last.content = appended;
      } else {
        result.push(buffer);
      }
    }
  }

  return result;
}

// ── 硬切（保底策略） ──

/**
 * 按 maxChunkSize 硬切，带 overlap
 * 尽量在换行符处切割
 */
function hardSplit(content: string, maxSize: number, overlap: number): string[] {
  const parts: string[] = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + maxSize, content.length);

    // 尝试在换行符处切割（在最后 20% 区域寻找）
    if (end < content.length) {
      const searchStart = Math.floor(end - maxSize * 0.2);
      const lastNewline = content.lastIndexOf('\n', end);
      if (lastNewline > searchStart) {
        end = lastNewline + 1;
      }
    }

    parts.push(content.slice(start, end).trim());

    // 下一段起始位置（带 overlap）
    start = Math.max(start + 1, end - overlap);
  }

  return parts.filter(p => p.length > 0);
}

// ── 工具函数 ──

/**
 * 提取第一个 Markdown 标题
 */
function extractFirstHeading(content: string): string | undefined {
  const match = content.match(/^#{1,6}\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}
