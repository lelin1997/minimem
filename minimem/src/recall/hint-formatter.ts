// ============================================================
// MiniMem — Hint Formatter (MINIMEM-006 T-H01.7)
// ============================================================
// 将记忆转换为轻量级 Hint：时间标签 + 一句话摘要 + recall_query

import { getLogger } from '../common/logger.js';
import { getDb } from '../store/database.js';
import { generateId, estimateTokens } from '../common/utils.js';
import type { MemoryLayer } from '../common/types.js';
import type { Hint, FusionCandidate } from './types.js';

const log = getLogger('recall:formatter');

/**
 * 将融合后的候选列表格式化为 Hint 列表
 *
 * @param candidates - 融合评分后的候选（按分数降序）
 * @param maxHints - 最大 hint 数
 * @param tokenBudget - token 预算
 * @param summaryMaxChars - 单条摘要最大字符数
 */
export function formatHints(
  candidates: FusionCandidate[],
  maxHints: number = 3,
  tokenBudget: number = 200,
  summaryMaxChars: number = 80,
): Hint[] {
  const hints: Hint[] = [];
  let totalTokens = 0;
  const db = getDb();

  for (const candidate of candidates) {
    if (hints.length >= maxHints) break;
    if (totalTokens >= tokenBudget) break;

    try {
      const hint = buildHint(db, candidate, summaryMaxChars);
      if (!hint) continue;

      // Token 预算检查
      const hintTokens = estimateTokens(hint.summary + hint.recall_query + hint.time_label);
      if (totalTokens + hintTokens > tokenBudget) break;

      totalTokens += hintTokens;
      hints.push(hint);
    } catch (err) {
      log.debug({ memoryId: candidate.memory_id, err }, 'Failed to format hint, skipping');
    }
  }

  return hints;
}

/**
 * 构建单条 Hint
 */
function buildHint(
  db: ReturnType<typeof getDb>,
  candidate: FusionCandidate,
  summaryMaxChars: number,
): Hint | null {
  const { memory_id, layer, final_score } = candidate;

  // 获取记忆内容和元数据
  const memoryData = getMemoryData(db, memory_id, layer);
  if (!memoryData) return null;

  // 生成摘要
  const summary = generateSummary(memoryData, summaryMaxChars);
  if (!summary) return null;

  // 生成时间标签
  const timeLabel = generateTimeLabel(memoryData.created_at);

  // 生成 recall_query
  const recallQuery = generateRecallQuery(memoryData, layer);

  return {
    id: `hint_${generateId().slice(0, 8)}`,
    memory_id,
    summary,
    time_label: timeLabel,
    relevance_score: final_score,
    recall_query: recallQuery,
    layer,
    tags: memoryData.tags ?? [],
  };
}

// ── 记忆数据获取 ──

interface MemoryData {
  content: string;
  summary?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  title?: string;
  tags: string[];
  created_at: string;
}

function getMemoryData(db: ReturnType<typeof getDb>, id: string, layer: MemoryLayer): MemoryData | null {
  try {
    switch (layer) {
      case 'L1': {
        const row = db.prepare(
          'SELECT raw_content, tags, created_at FROM experiences WHERE id = ?'
        ).get(id) as { raw_content: string; tags: string; created_at: string } | undefined;
        if (!row) return null;
        return {
          content: row.raw_content,
          tags: JSON.parse(row.tags || '[]'),
          created_at: row.created_at,
        };
      }
      case 'L2': {
        const row = db.prepare(
          'SELECT subject, predicate, object, created_at FROM world_facts WHERE id = ?'
        ).get(id) as { subject: string; predicate: string; object: string; created_at: string } | undefined;
        if (!row) return null;
        return {
          content: `${row.subject} ${row.predicate} ${row.object}`,
          subject: row.subject,
          predicate: row.predicate,
          object: row.object,
          tags: [],
          created_at: row.created_at,
        };
      }
      case 'L3': {
        const row = db.prepare(
          'SELECT description, tags, created_at FROM observations WHERE id = ?'
        ).get(id) as { description: string; tags: string; created_at: string } | undefined;
        if (!row) return null;
        return {
          content: row.description,
          tags: JSON.parse(row.tags || '[]'),
          created_at: row.created_at,
        };
      }
      case 'L4': {
        const row = db.prepare(
          'SELECT title, content, created_at FROM mental_models WHERE id = ?'
        ).get(id) as { title: string; content: string; created_at: string } | undefined;
        if (!row) return null;
        return {
          content: row.content,
          title: row.title,
          tags: [],
          created_at: row.created_at,
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ── 摘要生成 ──

/**
 * 生成 Hint 摘要（不使用 LLM）
 * 优先级：memory.title > L2 三元组 > L3 description > content 截断
 */
function generateSummary(data: MemoryData, maxChars: number): string {
  let summary: string;

  if (data.title) {
    // L4: 直接用标题
    summary = data.title;
  } else if (data.subject && data.predicate && data.object) {
    // L2: 三元组拼接
    summary = `${data.subject}${data.predicate}${data.object}`;
  } else {
    // L1/L3: 内容截断
    summary = data.content;
  }

  // 截断到 maxChars
  if (summary.length > maxChars) {
    summary = summary.slice(0, maxChars - 3) + '...';
  }

  return summary;
}

// ── 时间标签生成 ──

/**
 * 生成人类可读的时间标签
 * "刚才" / "1 小时前" / "昨天" / "3 天前" / "2 周前" / "1 个月前"
 */
function generateTimeLabel(createdAt: string): string {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMinutes < 5) return '刚才';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 14) return '1 周前';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;
  if (diffDays < 60) return '1 个月前';
  return `${Math.floor(diffDays / 30)} 个月前`;
}

// ── Recall Query 生成 ──

/**
 * 生成 recall_query（供 Agent 深度检索用）
 * 从记忆中提取 top 关键词拼接
 */
function generateRecallQuery(data: MemoryData, layer: MemoryLayer): string {
  const parts: string[] = [];

  // 标签作为关键词
  if (data.tags.length > 0) {
    parts.push(...data.tags.slice(0, 3));
  }

  // L2: 用 subject + object
  if (data.subject && data.object) {
    parts.push(data.subject, data.object);
  }
  // L4: 用 title
  else if (data.title) {
    parts.push(data.title);
  }
  // 其他: 从 content 中提取前几个有意义的词
  else {
    const words = data.content
      .replace(/[，。！？、；：""''【】（）\[\](){},.!?;:'"]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2)
      .slice(0, 5);
    parts.push(...words);
  }

  // 去重 + 拼接
  const unique = [...new Set(parts)].slice(0, 5);
  return unique.join(' ');
}
