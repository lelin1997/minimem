// ============================================================
// MiniMem — URL Preprocessor
// ============================================================
// 职责：抓取 URL 内容 → Readability 正文提取 → 清洗 → 截断 → 输出标准 PreprocessResult
// 安全：每次请求前经过 url-security SSRF 防护

import { getLogger } from '../../common/logger.js';
import { getConfig } from '../../config/index.js';
import { validateUrl } from './url-security.js';
import type { Preprocessor, PreprocessResult, MultimodalInput } from './index.js';

const log = getLogger('core:url-preprocessor');

// ── 默认配置 ──
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_LENGTH = 50_000; // 50KB 最大输出
const DEFAULT_USER_AGENT = 'MiniMem/0.2.0 (Knowledge Import Bot)';
const DEFAULT_MAX_REDIRECTS = 5;

export class UrlPreprocessor implements Preprocessor {
  readonly name = 'UrlPreprocessor';

  async preprocess(input: MultimodalInput): Promise<PreprocessResult> {
    const url = input.url;
    if (!url) {
      throw new Error('UrlPreprocessor requires a url field');
    }

    // 读取配置
    const config = this.getUrlConfig();

    // 1. SSRF 安全校验
    const validation = await validateUrl(url, {
      blocked_domains: config.blocked_domains,
      dns_resolve_check: config.dns_resolve_check,
    });

    if (!validation.valid) {
      throw new Error(`URL security check failed: ${validation.error}`);
    }

    // 2. 抓取 URL 内容
    const fetchResult = await this.fetchUrl(url, config);

    // 3. 检测 Content-Type
    const contentType = fetchResult.contentType.toLowerCase();

    // PDF → 提示用户使用文件导入
    if (contentType.includes('application/pdf')) {
      throw new Error('URL points to a PDF file. Please use file_path import for PDF support (Phase 4).');
    }

    // 非 HTML/文本类型 → 警告
    if (!contentType.includes('text/') && !contentType.includes('application/json') && !contentType.includes('application/xml')) {
      log.warn({ url, contentType }, 'Unexpected Content-Type, attempting text extraction anyway');
    }

    // 4. 编码处理（已在 fetchUrl 中通过 TextDecoder 处理）

    // 5. 正文提取
    const extractMode = input.extract_mode ?? 'readability';
    const extracted = await this.extractContent(fetchResult.body, url, extractMode);

    // 6. 清洗
    const sanitized = this.sanitize(extracted.content);

    // 7. 空内容检测
    if (!sanitized || sanitized.trim().length < 50) {
      log.warn({ url }, 'Extracted content is too short, may be a JS-rendered page');
      throw new Error(`URL content extraction yielded insufficient content (${sanitized.length} chars). The page may require JavaScript rendering.`);
    }

    // 8. 截断
    const maxLen = config.max_output_length ?? DEFAULT_MAX_OUTPUT_LENGTH;
    const truncated = this.truncate(sanitized, maxLen);

    // 9. 格式化输出
    const formattedContent = this.formatOutput({
      url,
      title: extracted.title,
      excerpt: extracted.excerpt,
      content: truncated,
      context: input.context,
    });

    return {
      content: formattedContent,
      contentType: 'url_import',
      metadata: {
        source_url: url,
        title: extracted.title,
        excerpt: extracted.excerpt,
        content_length: sanitized.length,
        truncated: sanitized.length > maxLen,
        extract_mode: extractMode,
        fetched_at: new Date().toISOString(),
      },
    };
  }

  /**
   * HTTP 请求 + timeout + 重定向跟随 + Content-Type 检测
   */
  private async fetchUrl(
    url: string,
    config: UrlPreprocessorConfig,
  ): Promise<{ body: string; contentType: string; statusCode: number }> {
    const timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const userAgent = config.user_agent ?? DEFAULT_USER_AGENT;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html, application/xhtml+xml, application/xml;q=0.9, text/plain;q=0.8, */*;q=0.5',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'identity', // 不用 gzip — Node fetch 自行处理
        },
        signal: controller.signal,
        redirect: 'follow', // 自动跟随重定向
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for URL: ${url}`);
      }

      // 读取响应体
      const buffer = await response.arrayBuffer();

      // 编码检测：优先 Content-Type header 中的 charset，否则 UTF-8
      const responseContentType = response.headers.get('content-type') ?? 'text/html';
      const charset = this.detectCharset(responseContentType) ?? 'utf-8';

      let body: string;
      try {
        body = new TextDecoder(charset).decode(buffer);
      } catch {
        // charset 不支持，fallback 到 UTF-8
        body = new TextDecoder('utf-8').decode(buffer);
      }

      return {
        body,
        contentType: responseContentType,
        statusCode: response.status,
      };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`URL fetch timed out after ${timeoutMs}ms: ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 基于 @mozilla/readability + jsdom 的正文提取
   */
  private async extractContent(
    html: string,
    url: string,
    mode: 'readability' | 'full' | 'summary',
  ): Promise<{ title: string; excerpt: string; content: string }> {
    if (mode === 'full') {
      // full 模式：只做基础 HTML 标签清理
      const stripped = this.stripHtmlTags(html);
      return {
        title: this.extractTitleFromHtml(html),
        excerpt: stripped.slice(0, 200),
        content: stripped,
      };
    }

    // readability / summary 模式
    try {
      const { JSDOM } = await import('jsdom');
      const { Readability } = await import('@mozilla/readability');

      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article || !article.textContent) {
        log.warn({ url }, 'Readability failed to parse, falling back to full mode');
        const stripped = this.stripHtmlTags(html);
        return {
          title: this.extractTitleFromHtml(html),
          excerpt: stripped.slice(0, 200),
          content: stripped,
        };
      }

      let content = article.textContent;

      // summary 模式：只取前 2000 字符
      if (mode === 'summary') {
        content = content.slice(0, 2000);
      }

      return {
        title: article.title || this.extractTitleFromHtml(html),
        excerpt: article.excerpt || content.slice(0, 200),
        content,
      };
    } catch (err) {
      log.warn({ err, url }, 'Readability extraction failed, falling back to HTML stripping');
      const stripped = this.stripHtmlTags(html);
      return {
        title: this.extractTitleFromHtml(html),
        excerpt: stripped.slice(0, 200),
        content: stripped,
      };
    }
  }

  /**
   * 清洗：去除 HTML 残留、多余空白、导航文本
   */
  private sanitize(text: string): string {
    return text
      // HTML 实体
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&[a-zA-Z]+;/g, '') // 其他 HTML 实体
      // 残留的 HTML 标签
      .replace(/<[^>]+>/g, '')
      // 控制字符
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      // 连续多个空格 → 单空格
      .replace(/ {2,}/g, ' ')
      // 连续多个空行 → 双空行
      .replace(/\n{3,}/g, '\n\n')
      // Tab → 空格
      .replace(/\t/g, ' ')
      .trim();
  }

  /**
   * 智能截断：超过最大长度时保留开头 + 尾部摘要
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;

    // 保留 80% 给开头，20% 给结尾
    const headLen = Math.floor(maxLength * 0.8);
    const tailLen = maxLength - headLen - 50; // 50 字符给分隔符

    const head = text.slice(0, headLen);
    const tail = text.slice(-tailLen);

    return `${head}\n\n[... 内容已截断，原文 ${text.length} 字符 ...]\n\n${tail}`;
  }

  /**
   * 格式化最终输出
   */
  private formatOutput(data: {
    url: string;
    title: string;
    excerpt: string;
    content: string;
    context?: string;
  }): string {
    const parts: string[] = [];

    parts.push(`[来源] ${data.url}`);
    if (data.title) parts.push(`[标题] ${data.title}`);
    if (data.excerpt) parts.push(`[摘要] ${data.excerpt}`);
    if (data.context) parts.push(`[上下文] ${data.context}`);
    parts.push('');
    parts.push(data.content);

    return parts.join('\n');
  }

  // ── 工具方法 ──

  /**
   * 从 Content-Type header 中提取 charset
   */
  private detectCharset(contentType: string): string | null {
    const match = contentType.match(/charset=([^\s;]+)/i);
    if (match) {
      const charset = match[1].toLowerCase().replace(/['"]/g, '');
      // 常见别名映射
      const aliasMap: Record<string, string> = {
        'gb2312': 'gbk',
        'gb18030': 'gbk',
      };
      return aliasMap[charset] ?? charset;
    }
    return null;
  }

  /**
   * 简单 HTML 标签剥离
   */
  private stripHtmlTags(html: string): string {
    return html
      // 移除 script/style 标签及内容
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      // 移除 HTML 注释
      .replace(/<!--[\s\S]*?-->/g, '')
      // 移除所有标签
      .replace(/<[^>]+>/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  /**
   * 从 HTML 中提取 title
   */
  private extractTitleFromHtml(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? match[1].trim() : '';
  }

  /**
   * 读取 URL 预处理器配置
   */
  private getUrlConfig(): UrlPreprocessorConfig {
    try {
      const config = getConfig();
      const multimodal = (config as unknown as Record<string, unknown>).perception as Record<string, unknown> | undefined;
      const urlConfig = multimodal?.multimodal as Record<string, unknown> | undefined;
      const url = urlConfig?.url as Partial<UrlPreprocessorConfig> | undefined;
      return {
        timeout_ms: url?.timeout_ms ?? DEFAULT_TIMEOUT_MS,
        max_output_length: url?.max_output_length ?? DEFAULT_MAX_OUTPUT_LENGTH,
        user_agent: url?.user_agent ?? DEFAULT_USER_AGENT,
        max_redirects: url?.max_redirects ?? DEFAULT_MAX_REDIRECTS,
        blocked_domains: url?.blocked_domains ?? [],
        dns_resolve_check: url?.dns_resolve_check ?? true,
      };
    } catch {
      // 配置未加载时使用默认值
      return {
        timeout_ms: DEFAULT_TIMEOUT_MS,
        max_output_length: DEFAULT_MAX_OUTPUT_LENGTH,
        user_agent: DEFAULT_USER_AGENT,
        max_redirects: DEFAULT_MAX_REDIRECTS,
        blocked_domains: [],
        dns_resolve_check: true,
      };
    }
  }
}

interface UrlPreprocessorConfig {
  timeout_ms: number;
  max_output_length: number;
  user_agent: string;
  max_redirects: number;
  blocked_domains: string[];
  dns_resolve_check: boolean;
}
