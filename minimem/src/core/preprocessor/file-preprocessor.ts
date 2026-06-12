// ============================================================
// MiniMem — File Preprocessor
// ============================================================
// 职责：读取本地文件 → 分块 → 输出标准 PreprocessResult
// 支持：MD/TXT（文本）、PDF（pdf-parse）、DOCX（mammoth）、HTML（Readability）
// 安全：路径穿越检测 + 文件大小限制

import { readFileSync, statSync, existsSync } from 'fs';
import { resolve, extname, basename, isAbsolute, normalize } from 'path';
import { getLogger } from '../../common/logger.js';
import { getConfig } from '../../config/index.js';
import type { Preprocessor, PreprocessResult, MultimodalInput } from './index.js';
import { chunkContent, type ChunkStrategy } from './chunker.js';

const log = getLogger('core:file-preprocessor');

// ── 默认配置 ──
const DEFAULT_MAX_FILE_SIZE_MB = 10;
const DEFAULT_MAX_CHUNK_SIZE = 50_000;     // 50KB per chunk
const DEFAULT_CHUNK_OVERLAP = 200;          // 200 字符 overlap
const DEFAULT_MAX_CHUNKS = 20;              // 最多 20 chunks

// ── 支持的文件类型 ──
const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.pdf', '.docx', '.html', '.htm']);

// ── 需要以 Buffer 方式读取的二进制格式 ──
const BINARY_FORMATS = new Set(['.pdf', '.docx']);

// ── Magic bytes 检测（用于验证文本文件） ──
const BINARY_CHECK_SIZE = 512;

// ── 扫描版 PDF 文本量阈值（每页平均字符数低于此值时警告） ──
const SCANNED_PDF_CHARS_PER_PAGE_THRESHOLD = 50;

export class FilePreprocessor implements Preprocessor {
  readonly name = 'FilePreprocessor';

  async preprocess(input: MultimodalInput): Promise<PreprocessResult[]> {
    const filePath = input.file_path;
    if (!filePath) {
      throw new Error('FilePreprocessor requires a file_path field');
    }

    // 读取配置
    const config = this.getFileConfig();

    // 1. 路径安全检查
    const safePath = this.validatePath(filePath);

    // 2. 文件存在性检查
    if (!existsSync(safePath)) {
      throw new Error(`File not found: ${safePath}`);
    }

    // 3. 文件大小检查
    const stat = statSync(safePath);
    const maxSizeBytes = (config.max_file_size_mb ?? DEFAULT_MAX_FILE_SIZE_MB) * 1024 * 1024;
    if (stat.size > maxSizeBytes) {
      throw new Error(
        `File too large: ${(stat.size / 1024 / 1024).toFixed(2)}MB exceeds limit of ${config.max_file_size_mb ?? DEFAULT_MAX_FILE_SIZE_MB}MB`
      );
    }

    if (stat.size === 0) {
      throw new Error('File is empty');
    }

    // 4. 文件类型检测
    const ext = extname(safePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new Error(
        `Unsupported file type: ${ext}. Supported types: ${[...SUPPORTED_EXTENSIONS].join(', ')}`
      );
    }

    // 5. 按格式分发解析
    let parsedContent: string;
    let parseStrategy: ChunkStrategy;

    if (ext === '.pdf') {
      parsedContent = await this.parsePdf(safePath);
      parseStrategy = 'plaintext'; // PDF 按页/段落分块
    } else if (ext === '.docx') {
      parsedContent = await this.parseDocx(safePath);
      parseStrategy = 'markdown'; // DOCX → Markdown，按标题分块
    } else if (ext === '.html' || ext === '.htm') {
      parsedContent = await this.parseHtml(safePath);
      parseStrategy = 'plaintext'; // HTML 正文按段落分块
    } else {
      // MD/TXT: 直接读取文本
      const rawContent = this.readFileContent(safePath);

      // 二进制内容检测（仅对文本格式检查）
      if (this.isBinaryContent(rawContent)) {
        throw new Error('File appears to be binary, not a text file');
      }

      parsedContent = rawContent;
      parseStrategy = ext === '.md' || ext === '.markdown' ? 'markdown' : 'plaintext';
    }

    // 6. 内容清洗
    const cleanedContent = this.sanitize(parsedContent);

    if (!cleanedContent || cleanedContent.trim().length < 10) {
      throw new Error(`File content too short (${cleanedContent.length} chars)`);
    }

    // 7. 分块
    const maxChunkSize = config.max_chunk_size ?? DEFAULT_MAX_CHUNK_SIZE;
    const overlap = config.chunk_overlap ?? DEFAULT_CHUNK_OVERLAP;
    const maxChunks = config.max_chunks ?? DEFAULT_MAX_CHUNKS;

    const chunks = chunkContent(cleanedContent, {
      strategy: parseStrategy,
      maxChunkSize,
      overlap,
      maxChunks,
    });

    const fileName = basename(safePath);

    log.info({
      file: fileName,
      size: stat.size,
      chunks: chunks.length,
      strategy: parseStrategy,
      format: ext,
    }, 'File preprocessed');

    // 8. 转换为 PreprocessResult 数组
    return chunks.map((chunk, index) => ({
      content: this.formatOutput({
        filePath: safePath,
        fileName,
        content: chunk.content,
        context: input.context,
        chunkIndex: index,
        totalChunks: chunks.length,
        heading: chunk.heading,
      }),
      contentType: 'file_import' as const,
      metadata: {
        source_file: safePath,
        file_name: fileName,
        file_size: stat.size,
        file_ext: ext,
        batch_id: chunk.batchId,
        chunk_index: index,
        total_chunks: chunks.length,
        heading: chunk.heading ?? null,
        content_length: chunk.content.length,
        imported_at: new Date().toISOString(),
      },
    }));
  }

  // ── 路径安全检查 ──

  /**
   * 验证文件路径安全性：
   * 1. 禁止路径穿越（..）
   * 2. 必须是绝对路径或可解析的相对路径
   * 3. 规范化路径后检查
   */
  private validatePath(filePath: string): string {
    // 禁止路径穿越：在规范化前先检查原始输入
    if (filePath.includes('..')) {
      throw new Error('Path traversal detected: ".." is not allowed in file paths');
    }

    // 规范化路径
    const normalizedInput = normalize(filePath);

    // 解析为绝对路径
    const absolutePath = isAbsolute(normalizedInput)
      ? normalizedInput
      : resolve(process.cwd(), normalizedInput);

    // 最终路径再次检查
    const finalPath = normalize(absolutePath);
    if (finalPath.includes('..')) {
      throw new Error('Path traversal detected after normalization');
    }

    return finalPath;
  }

  // ── 文件读取 ──

  /**
   * 读取文件内容，自动检测编码
   */
  private readFileContent(filePath: string): string {
    try {
      // 先尝试 UTF-8
      const content = readFileSync(filePath, 'utf-8');
      return content;
    } catch (err) {
      // 如果 UTF-8 失败，尝试 latin1（兼容二进制）
      try {
        const buffer = readFileSync(filePath);
        return buffer.toString('latin1');
      } catch {
        throw new Error(`Failed to read file: ${(err as Error).message}`);
      }
    }
  }

  // ── 二进制检测 ──

  /**
   * 检测文件内容是否为二进制
   * 检查前 512 字节中是否有非文本字符
   */
  private isBinaryContent(content: string): boolean {
    const checkLen = Math.min(content.length, BINARY_CHECK_SIZE);
    let nullCount = 0;

    for (let i = 0; i < checkLen; i++) {
      const code = content.charCodeAt(i);
      // NULL byte
      if (code === 0) nullCount++;
      // 其他控制字符（排除常见文本控制字符：\t \n \r）
      if (code < 8 || (code > 13 && code < 32 && code !== 27)) {
        nullCount++;
      }
    }

    // 超过 5% 的非文本字符视为二进制
    return nullCount / checkLen > 0.05;
  }

  // ── 内容清洗 ──

  private sanitize(text: string): string {
    return text
      // 统一换行符
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // 控制字符（保留 \t \n）
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      // 连续多个空行 → 双空行
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  // ── 格式化输出 ──

  private formatOutput(data: {
    filePath: string;
    fileName: string;
    content: string;
    context?: string;
    chunkIndex: number;
    totalChunks: number;
    heading?: string;
  }): string {
    const parts: string[] = [];

    parts.push(`[来源] file://${data.filePath}`);
    parts.push(`[文件] ${data.fileName}`);
    if (data.heading) parts.push(`[章节] ${data.heading}`);
    if (data.totalChunks > 1) {
      parts.push(`[分块] ${data.chunkIndex + 1}/${data.totalChunks}`);
    }
    if (data.context) parts.push(`[上下文] ${data.context}`);
    parts.push('');
    parts.push(data.content);

    return parts.join('\n');
  }

  // ── PDF 解析 ──

  /**
   * 解析 PDF 文件，提取文本内容
   * 使用 pdf-parse 库，保留页码信息
   * 检测扫描版 PDF（文本量过少时警告）
   */
  private async parsePdf(filePath: string): Promise<string> {
    try {
      const { PDFParse } = await import('pdf-parse');
      const buffer = readFileSync(filePath);
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const textResult = await parser.getText();

      if (!textResult.text || textResult.text.trim().length === 0) {
        throw new Error('PDF contains no extractable text (may be a scanned/image-only PDF)');
      }

      // 扫描版 PDF 检测
      const totalPages = textResult.total || 1;
      const charsPerPage = textResult.text.length / totalPages;
      if (charsPerPage < SCANNED_PDF_CHARS_PER_PAGE_THRESHOLD) {
        log.warn({
          file: filePath,
          pages: totalPages,
          charsPerPage: Math.round(charsPerPage),
        }, 'PDF may be scanned — very low text content per page');
      }

      log.info({
        file: filePath,
        pages: totalPages,
        textLength: textResult.text.length,
      }, 'PDF parsed');

      return textResult.text;
    } catch (err) {
      if ((err as Error).message.includes('no extractable text') || (err as Error).message.includes('scanned')) {
        throw err;
      }
      throw new Error(`Failed to parse PDF: ${(err as Error).message}`);
    }
  }

  // ── DOCX 解析 ──

  /**
   * 解析 DOCX 文件，转换为 Markdown
   * 使用 mammoth 库，保留标题层级结构
   */
  private async parseDocx(filePath: string): Promise<string> {
    try {
      const mammothModule: any = await import('mammoth');
      // mammoth ESM 导出: { default, convertToHtml, extractRawText, ... }
      // convertToMarkdown 可能在 default 或顶层
      const convertToMarkdown = mammothModule.convertToMarkdown
        ?? mammothModule.default?.convertToMarkdown;

      if (!convertToMarkdown) {
        // fallback: 使用 extractRawText
        const extractRawText = mammothModule.extractRawText ?? mammothModule.default?.extractRawText;
        if (!extractRawText) {
          throw new Error('mammoth library does not export convertToMarkdown or extractRawText');
        }
        const buffer = readFileSync(filePath);
        const result = await extractRawText({ buffer });

        if (!result.value || result.value.trim().length === 0) {
          throw new Error('DOCX contains no extractable text content');
        }

        log.info({
          file: filePath,
          textLength: result.value.length,
          mode: 'rawText',
        }, 'DOCX parsed');

        return result.value;
      }

      const buffer = readFileSync(filePath);
      const result = await convertToMarkdown({ buffer });

      if (result.messages && result.messages.length > 0) {
        for (const msg of result.messages) {
          if (msg.type === 'warning') {
            log.warn({ file: filePath, message: msg.message }, 'DOCX conversion warning');
          }
        }
      }

      if (!result.value || result.value.trim().length === 0) {
        throw new Error('DOCX contains no extractable text content');
      }

      log.info({
        file: filePath,
        textLength: result.value.length,
        warnings: result.messages?.length ?? 0,
      }, 'DOCX parsed');

      return result.value;
    } catch (err) {
      if ((err as Error).message.includes('no extractable text')) {
        throw err;
      }
      throw new Error(`Failed to parse DOCX: ${(err as Error).message}`);
    }
  }

  // ── HTML 文件解析 ──

  /**
   * 解析本地 HTML 文件
   * 复用 UrlPreprocessor 的 Readability 逻辑
   */
  private async parseHtml(filePath: string): Promise<string> {
    try {
      const rawHtml = readFileSync(filePath, 'utf-8');

      if (!rawHtml || rawHtml.trim().length === 0) {
        throw new Error('HTML file is empty');
      }

      // 尝试使用 Readability 提取正文
      try {
        const { JSDOM } = await import('jsdom');
        const { Readability } = await import('@mozilla/readability');

        const dom = new JSDOM(rawHtml, { url: `file://${filePath}` });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (article && article.textContent && article.textContent.trim().length > 50) {
          log.info({
            file: filePath,
            title: article.title,
            textLength: article.textContent.length,
          }, 'HTML parsed with Readability');

          // 如果有标题，添加为 Markdown 标题
          const parts: string[] = [];
          if (article.title) {
            parts.push(`# ${article.title}`);
            parts.push('');
          }
          parts.push(article.textContent);
          return parts.join('\n');
        }
      } catch (readabilityErr) {
        log.warn({ err: readabilityErr, file: filePath }, 'Readability failed, falling back to HTML stripping');
      }

      // Fallback: 简单 HTML 标签剥离
      const stripped = rawHtml
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/ {2,}/g, ' ')
        .trim();

      if (stripped.length < 10) {
        throw new Error('HTML file contains no extractable text content');
      }

      log.info({
        file: filePath,
        textLength: stripped.length,
        mode: 'stripped',
      }, 'HTML parsed with fallback stripping');

      return stripped;
    } catch (err) {
      if ((err as Error).message.includes('no extractable text') ||
          (err as Error).message.includes('is empty')) {
        throw err;
      }
      throw new Error(`Failed to parse HTML: ${(err as Error).message}`);
    }
  }

  // ── 配置读取 ──

  private getFileConfig(): FilePreprocessorConfig {
    try {
      const config = getConfig();
      const perception = (config as unknown as Record<string, unknown>).perception as Record<string, unknown> | undefined;
      const multimodal = perception?.multimodal as Record<string, unknown> | undefined;
      const file = multimodal?.file as Partial<FilePreprocessorConfig> | undefined;
      return {
        max_file_size_mb: file?.max_file_size_mb ?? DEFAULT_MAX_FILE_SIZE_MB,
        max_chunk_size: file?.max_chunk_size ?? DEFAULT_MAX_CHUNK_SIZE,
        chunk_overlap: file?.chunk_overlap ?? DEFAULT_CHUNK_OVERLAP,
        max_chunks: file?.max_chunks ?? DEFAULT_MAX_CHUNKS,
        allowed_extensions: file?.allowed_extensions ?? [...SUPPORTED_EXTENSIONS],
      };
    } catch {
      return {
        max_file_size_mb: DEFAULT_MAX_FILE_SIZE_MB,
        max_chunk_size: DEFAULT_MAX_CHUNK_SIZE,
        chunk_overlap: DEFAULT_CHUNK_OVERLAP,
        max_chunks: DEFAULT_MAX_CHUNKS,
        allowed_extensions: [...SUPPORTED_EXTENSIONS],
      };
    }
  }
}

interface FilePreprocessorConfig {
  max_file_size_mb: number;
  max_chunk_size: number;
  chunk_overlap: number;
  max_chunks: number;
  allowed_extensions: string[];
}
