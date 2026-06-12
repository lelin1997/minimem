/**
 * web-search 执行器
 * 网络搜索节点，获取搜索结果
 * 
 * 配置项：
 *   - query: 搜索关键词（必填，支持模板）
 *   - max_results: 最大结果数（默认 5）
 *   - search_engine: 搜索引擎 (duckduckgo)
 * 
 * 输出：
 *   - out: SearchResult[]
 *     { title, url, snippet }
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export const webSearchExecutor: NodeExecutor = async (node, _inputs, _ctx, templateData) => {
  const cfg = node.config as Record<string, any>;

  const query = cfg.query ? renderTemplate(String(cfg.query), templateData) : '';
  if (!query) {
    throw new Error('web-search 节点缺少必填参数 query');
  }

  const maxResults = Number(cfg.max_results) || 5;

  // 使用 DuckDuckGo HTML 搜索（无需 API key）
  const results = await searchDuckDuckGo(query, maxResults);

  return {
    outputs: { out: results },
  };
};

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'MiniMem-Console/1.0 (Search)',
      'Accept': 'text/html',
    },
  });

  if (!resp.ok) {
    throw new Error(`搜索请求失败 (${resp.status})`);
  }

  const html = await resp.text();
  const results: SearchResult[] = [];

  // 解析 DuckDuckGo HTML 结果
  const resultBlocks = html.match(/<div class="result[^"]*results_links[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) || [];

  for (const block of resultBlocks) {
    if (results.length >= maxResults) break;

    // 提取标题和链接
    const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    let resultUrl = linkMatch[1];
    const title = stripHtml(linkMatch[2]);

    // DuckDuckGo 的 URL 可能需要解码
    if (resultUrl.includes('uddg=')) {
      const uddgMatch = resultUrl.match(/uddg=([^&]*)/);
      if (uddgMatch) {
        resultUrl = decodeURIComponent(uddgMatch[1]);
      }
    }

    // 提取摘要
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';

    if (title && resultUrl) {
      results.push({ title, url: resultUrl, snippet });
    }
  }

  return results;
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
