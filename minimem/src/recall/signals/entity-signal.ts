// ============================================================
// MiniMem — Entity Signal (MINIMEM-006 T-H01.3)
// ============================================================
// 实体匹配信号：提取用户消息中的关键词/实体，在 condition_index 中匹配

import { getLogger } from '../../common/logger.js';
import { getDb } from '../../store/database.js';
import { lookupByPrefix } from '../../store/indexes.js';
import type { MemoryLayer } from '../../common/types.js';
import type { SignalResult } from '../types.js';

const log = getLogger('recall:signal:entity');

/** 条件索引支持的前缀类型 */
const ENTITY_PREFIXES = ['person', 'topic', 'project', 'technology', 'organization', 'place', 'event'];

/**
 * 实体信号：从用户消息中提取关键实体，在 condition_index + world_facts 中查找匹配
 *
 * 不使用 LLM NER（延迟优先），采用轻量级规则提取：
 * 1. 在 condition_index 中用 prefix 查询
 * 2. 在 world_facts 中匹配 subject/object
 * 3. 在 observations 中匹配 description
 *
 * @param message - 用户消息
 * @param topK - 返回的最大候选数
 * @returns 按命中分数降序排列的候选列表
 */
export function computeEntitySignal(message: string, topK: number = 10): SignalResult[] {
  const results: SignalResult[] = [];
  const seenIds = new Set<string>();

  try {
    // 提取实体（简单分词 + 过滤停用词）
    const entities = extractEntities(message);
    if (entities.length === 0) return [];

    // 1. 条件索引查找
    for (const entity of entities) {
      for (const prefix of ENTITY_PREFIXES) {
        const hits = lookupByPrefix(`${prefix}:${entity}`);
        for (const hit of hits) {
          if (seenIds.has(hit.memory_id)) continue;
          seenIds.add(hit.memory_id);
          results.push({
            memory_id: hit.memory_id,
            score: 0.8, // 精确匹配给高分
            source: 'entity',
            layer: hit.memory_type as MemoryLayer,
          });
        }
      }
    }

    // 2. world_facts subject/object 模糊匹配
    const db = getDb();
    for (const entity of entities) {
      if (results.length >= topK * 2) break;
      const likePattern = `%${entity}%`;
      const factRows = db.prepare(
        `SELECT id FROM world_facts WHERE branch = 'main' AND (subject LIKE ? OR object LIKE ?) LIMIT ?`
      ).all(likePattern, likePattern, 5) as Array<{ id: string }>;

      for (const row of factRows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        results.push({
          memory_id: row.id,
          score: 0.6,
          source: 'entity',
          layer: 'L2',
        });
      }
    }

    // 3. observations description 模糊匹配
    for (const entity of entities) {
      if (results.length >= topK * 2) break;
      const likePattern = `%${entity}%`;
      const obsRows = db.prepare(
        `SELECT id FROM observations WHERE branch = 'main' AND description LIKE ? LIMIT ?`
      ).all(likePattern, 5) as Array<{ id: string }>;

      for (const row of obsRows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        results.push({
          memory_id: row.id,
          score: 0.5,
          source: 'entity',
          layer: 'L3',
        });
      }
    }
  } catch (err) {
    log.warn({ err }, 'Entity signal computation failed');
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ── 轻量级实体提取（exported for reuse by graph-signal） ──

/** 中文停用词 */
const STOP_WORDS_ZH = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '么', '那', '里', '吧', '把', '让', '能', '什么',
  '帮', '帮我', '请', '想', '可以', '怎么', '怎样', '如何', '为什么', '吗', '呢',
  '啊', '哦', '嗯', '这个', '那个', '之前', '之后', '关于', '对于', '已经',
]);

/** 英文停用词 */
const STOP_WORDS_EN = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'about',
  'it', 'its', 'this', 'that', 'these', 'those', 'my', 'your', 'his',
  'her', 'our', 'their', 'i', 'me', 'we', 'you', 'he', 'she', 'they',
  'and', 'or', 'but', 'if', 'then', 'so', 'not', 'no', 'how', 'what',
  'when', 'where', 'which', 'who', 'why', 'help', 'please', 'want',
]);

/**
 * 从消息中提取可能的实体/关键词
 * 规则：分词 → 过滤停用词 → 过滤太短的词 → 返回
 */
export function extractEntities(message: string): string[] {
  // 按标点和空格分词
  const tokens = message
    .replace(/[，。！？、；：""''【】（）《》\[\](){},.!?;:'"<>]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const entities: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const lower = token.toLowerCase();

    // 过滤停用词
    if (STOP_WORDS_ZH.has(token) || STOP_WORDS_EN.has(lower)) continue;

    // 过滤太短的词（中文 1 字，英文 2 字母）
    const isChinese = /[\u4e00-\u9fff]/.test(token);
    if (isChinese && token.length < 2) continue;
    if (!isChinese && token.length < 3) continue;

    if (seen.has(lower)) continue;
    seen.add(lower);
    entities.push(token);
  }

  return entities.slice(0, 10); // 最多 10 个实体
}
