/**
 * rss-fetch 执行器
 * 抓取 RSS/Atom Feed 并解析为结构化文章列表
 * 
 * 配置项：
 *   - url: RSS/Atom 源地址（必填）
 *   - limit: 最多返回几篇文章（默认 10）
 *   - since_hours: 只返回最近 N 小时内的文章（可选）
 *   - include_content: 是否包含文章正文（默认 false，只包含摘要）
 * 
 * 输出：
 *   - out: RssItem[]
 *     { title, link, published, summary, content?, author?, tags[] }
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';

// ── 类型 ──

interface RssItem {
  title: string;
  link: string;
  published: string | null;
  summary: string;
  content?: string;
  author?: string;
  tags: string[];
}

// ── 执行器 ──

export const rssFetchExecutor: NodeExecutor = async (node, _inputs, _ctx, templateData) => {
  const cfg = node.config as Record<string, any>;

  const url = cfg.url ? renderTemplate(String(cfg.url), templateData) : '';
  if (!url) {
    throw new Error('rss-fetch 节点缺少必填参数 url');
  }

  const limit = Number(cfg.limit) || 10;
  const sinceHours = cfg.since_hours ? Number(cfg.since_hours) : null;
  const includeContent = cfg.include_content === true || cfg.include_content === 'true';

  // 抓取 RSS
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'MiniMem-Console/1.0 (RSS Fetcher)',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
  });

  if (!resp.ok) {
    throw new Error(`RSS 抓取失败 (${resp.status}): ${url}`);
  }

  const xml = await resp.text();

  // 解析 feed
  let items = parseFeed(xml);

  // 时间过滤
  if (sinceHours && sinceHours > 0) {
    const cutoff = Date.now() - sinceHours * 3600 * 1000;
    items = items.filter((item) => {
      if (!item.published) return true; // 没有时间的保留
      const pubTime = new Date(item.published).getTime();
      return !isNaN(pubTime) && pubTime >= cutoff;
    });
  }

  // 截断数量
  items = items.slice(0, limit);

  // 是否移除正文
  if (!includeContent) {
    items = items.map(({ content, ...rest }) => rest) as RssItem[];
  }

  return {
    outputs: { out: items },
  };
};

// ── RSS/Atom 解析器（轻量级，不依赖外部库） ──

function parseFeed(xml: string): RssItem[] {
  // 判断是 Atom 还是 RSS
  if (xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"')) {
    return parseAtom(xml);
  }
  return parseRss(xml);
}

/** 解析 RSS 2.0 */
function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];

  for (const block of itemBlocks) {
    items.push({
      title: extractTag(block, 'title'),
      link: extractTag(block, 'link') || extractAttr(block, 'link', 'href'),
      published: extractTag(block, 'pubDate') || extractTag(block, 'dc:date') || null,
      summary: stripHtml(extractCdata(block, 'description') || extractTag(block, 'description')),
      content: stripHtml(extractCdata(block, 'content:encoded') || extractTag(block, 'content:encoded')),
      author: extractTag(block, 'author') || extractTag(block, 'dc:creator') || undefined,
      tags: extractCategories(block),
    });
  }

  return items;
}

/** 解析 Atom */
function parseAtom(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const entryBlocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];

  for (const block of entryBlocks) {
    items.push({
      title: extractTag(block, 'title'),
      link: extractAttr(block, 'link', 'href') || extractTag(block, 'link'),
      published: extractTag(block, 'published') || extractTag(block, 'updated') || null,
      summary: stripHtml(extractTag(block, 'summary') || extractTag(block, 'content')),
      content: stripHtml(extractCdata(block, 'content') || extractTag(block, 'content')),
      author: extractTag(block, 'name') || undefined,
      tags: extractAtomCategories(block),
    });
  }

  return items;
}

// ── XML 解析工具函数 ──

function extractTag(xml: string, tag: string): string {
  // 匹配 <tag>...</tag> 或 <tag ...>...</tag>
  const regex = new RegExp(`<${escapeRegex(tag)}[^>]*>([\\s\\S]*?)<\\/${escapeRegex(tag)}>`, 'i');
  const match = xml.match(regex);
  if (!match) return '';
  return decodeEntities(match[1].trim());
}

function extractCdata(xml: string, tag: string): string {
  const regex = new RegExp(`<${escapeRegex(tag)}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${escapeRegex(tag)}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const regex = new RegExp(`<${escapeRegex(tag)}[^>]*${escapeRegex(attr)}="([^"]*)"`, 'i');
  const match = xml.match(regex);
  return match ? decodeEntities(match[1]) : '';
}

function extractCategories(xml: string): string[] {
  const matches = xml.match(/<category[^>]*>([^<]*)<\/category>/gi) || [];
  return matches.map((m) => {
    const inner = m.match(/>([^<]*)</);
    return inner ? decodeEntities(inner[1].trim()) : '';
  }).filter(Boolean);
}

function extractAtomCategories(xml: string): string[] {
  const matches = xml.match(/<category[^>]*term="([^"]*)"[^>]*\/?>/gi) || [];
  return matches.map((m) => {
    const termMatch = m.match(/term="([^"]*)"/);
    return termMatch ? decodeEntities(termMatch[1]) : '';
  }).filter(Boolean);
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000); // 限制长度
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
