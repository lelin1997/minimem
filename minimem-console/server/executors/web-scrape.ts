/**
 * web-scrape 执行器
 * 抓取网页并提取正文内容（类似 Readability）
 * 
 * 配置项：
 *   - url: 网页地址（必填，支持模板）
 *   - extract_mode: 提取模式 (readability / raw / selector)
 *   - selector: CSS 选择器（extract_mode=selector 时使用）
 *   - max_length: 最大字符数（默认 5000）
 * 
 * 输出：
 *   - out: { title, url, content, excerpt, byline, length }
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';

export const webScrapeExecutor: NodeExecutor = async (node, _inputs, _ctx, templateData) => {
  const cfg = node.config as Record<string, any>;

  const url = cfg.url ? renderTemplate(String(cfg.url), templateData) : '';
  if (!url) {
    throw new Error('web-scrape 节点缺少必填参数 url');
  }

  const extractMode = cfg.extract_mode || 'readability';
  const maxLength = Number(cfg.max_length) || 5000;
  const selector = cfg.selector || '';

  // 抓取网页
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'MiniMem-Console/1.0 (Web Scraper)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!resp.ok) {
    throw new Error(`网页抓取失败 (${resp.status}): ${url}`);
  }

  const html = await resp.text();

  let title = '';
  let content = '';
  let excerpt = '';
  let byline = '';

  // 提取标题
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

  if (extractMode === 'selector' && selector) {
    // 简单 CSS 选择器提取（支持 tag、.class、#id）
    content = extractBySelector(html, selector);
  } else if (extractMode === 'raw') {
    // 去标签后全文
    content = stripHtml(html);
  } else {
    // readability 模式：提取主要内容区
    const extracted = extractReadability(html);
    content = extracted.content;
    excerpt = extracted.excerpt;
    byline = extracted.byline;
  }

  // 截断
  if (content.length > maxLength) {
    content = content.slice(0, maxLength) + '…';
  }

  return {
    outputs: {
      out: {
        title,
        url,
        content,
        excerpt: excerpt || content.slice(0, 200),
        byline,
        length: content.length,
      },
    },
  };
};

// ── 内容提取 ──

function extractReadability(html: string): { content: string; excerpt: string; byline: string } {
  // 移除 script/style/nav/header/footer
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // 尝试提取 article 标签
  const articleMatch = cleaned.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
  let mainContent = articleMatch ? articleMatch[1] : '';

  // 如果没有 article，尝试 main
  if (!mainContent) {
    const mainMatch = cleaned.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);
    mainContent = mainMatch ? mainMatch[1] : '';
  }

  // 如果仍然没有，用 body 中最长的文本块
  if (!mainContent) {
    const bodyMatch = cleaned.match(/<body[\s\S]*?>([\s\S]*?)<\/body>/i);
    mainContent = bodyMatch ? bodyMatch[1] : cleaned;
  }

  const content = stripHtml(mainContent);

  // 尝试提取作者
  let byline = '';
  const authorMeta = html.match(/<meta[^>]*name="author"[^>]*content="([^"]*)"[^>]*>/i);
  if (authorMeta) byline = authorMeta[1];

  // 提取描述作为 excerpt
  let excerpt = '';
  const descMeta = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
  if (descMeta) excerpt = descMeta[1];

  return { content, excerpt, byline };
}

function extractBySelector(html: string, selector: string): string {
  // 简单的 tag/class/id 提取
  let regex: RegExp;

  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    regex = new RegExp(`<[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/`, 'i');
  } else if (selector.startsWith('.')) {
    const cls = selector.slice(1);
    regex = new RegExp(`<[^>]*class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)<\\/`, 'i');
  } else {
    regex = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)<\\/${selector}>`, 'gi');
  }

  const match = html.match(regex);
  if (!match) return '';

  return stripHtml(match[0]);
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
