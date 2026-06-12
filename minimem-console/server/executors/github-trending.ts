/**
 * github-trending 执行器
 * 抓取 GitHub Trending 仓库列表
 * 
 * 配置项：
 *   - language: 编程语言过滤（可选，如 typescript, python, rust）
 *   - since: 时间范围 (daily / weekly / monthly)
 *   - limit: 最大返回数量（默认 10）
 * 
 * 输出：
 *   - out: TrendingRepo[]
 *     { name, fullName, url, description, language, stars, forks, starsToday }
 */

import type { NodeExecutor } from './index.js';

interface TrendingRepo {
  name: string;
  fullName: string;
  url: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  starsToday: number;
}

export const githubTrendingExecutor: NodeExecutor = async (node, _inputs, _ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;

  const language = cfg.language || '';
  const since = cfg.since || 'daily';
  const limit = Number(cfg.limit) || 10;

  // 抓取 GitHub Trending 页面
  let url = 'https://github.com/trending';
  if (language) {
    url += `/${encodeURIComponent(language.toLowerCase())}`;
  }
  url += `?since=${since}`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'MiniMem-Console/1.0 (GitHub Trending)',
      'Accept': 'text/html',
    },
  });

  if (!resp.ok) {
    throw new Error(`GitHub Trending 抓取失败 (${resp.status})`);
  }

  const html = await resp.text();
  const repos = parseTrendingPage(html, limit);

  return {
    outputs: { out: repos },
  };
};

function parseTrendingPage(html: string, limit: number): TrendingRepo[] {
  const repos: TrendingRepo[] = [];

  // GitHub Trending 的每个仓库在 <article class="Box-row"> 中
  const articleBlocks = html.match(/<article[^>]*class="[^"]*Box-row[^"]*"[\s\S]*?<\/article>/gi) || [];

  for (const block of articleBlocks) {
    if (repos.length >= limit) break;

    // 提取仓库名 (h2 > a)
    const nameMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!nameMatch) continue;

    const href = nameMatch[1].trim();
    const fullName = href.replace(/^\//, '').trim();
    const name = fullName.split('/').pop() || fullName;

    // 提取描述
    const descMatch = block.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const description = descMatch ? stripHtml(descMatch[1]) : '';

    // 提取语言
    const langMatch = block.match(/<span[^>]*itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/i);
    const language = langMatch ? stripHtml(langMatch[1]) : '';

    // 提取 stars 和 forks
    const starMatch = block.match(/href="[^"]*\/stargazers"[^>]*>([\s\S]*?)<\/a>/i);
    const stars = starMatch ? parseNumber(stripHtml(starMatch[1])) : 0;

    const forkMatch = block.match(/href="[^"]*\/forks"[^>]*>([\s\S]*?)<\/a>/i);
    const forks = forkMatch ? parseNumber(stripHtml(forkMatch[1])) : 0;

    // 提取今日 stars
    const todayMatch = block.match(/(\d[\d,]*)\s*stars?\s*today/i);
    const starsToday = todayMatch ? parseNumber(todayMatch[1]) : 0;

    repos.push({
      name,
      fullName,
      url: `https://github.com${href}`,
      description,
      language,
      stars,
      forks,
      starsToday,
    });
  }

  return repos;
}

function parseNumber(str: string): number {
  return parseInt(str.replace(/[,\s]/g, ''), 10) || 0;
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
