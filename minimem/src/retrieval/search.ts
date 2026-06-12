// ============================================================
// MiniMem — 检索引擎（Retrieval Engine）
// ============================================================
// 四路并行检索 + MemSifter 查询规划 + 条件索引 + 重排序

import { getLogger } from '../common/logger.js';
import { getDb } from '../store/database.js';
import { getVectorStore } from '../store/vectors.js';
import { searchFts, lookupByCondition, lookupByPrefix } from '../store/indexes.js';
import { traverseGraph } from '../store/graph.js';
import { getActiveMentalModels } from '../store/mental-models.js';
import { searchKnowledgePages } from '../store/knowledge-pages/page-store.js';
import { getLLM } from '../llm/client.js';
import { queryPlannerPrompt, rerankPrompt } from '../llm/prompts.js';
import { enqueueCompile } from '../store/knowledge-pages/compile-queue.js';
import { promoteMemory } from '../lifecycle/promotion.js';
import type { MemoryLayer } from '../common/types.js';

const log = getLogger('retrieval');

// ── 类型定义 ──

export interface SearchQuery {
  query: string;
  layers?: MemoryLayer[];
  top_k?: number;
  time_from?: string;
  time_to?: string;
  source?: string;
  include_context?: boolean;
  readonly?: boolean; // R-022: readonly 用户标记，跳过查询回写
  domain?: string;    // MINIMEM-001: 领域过滤
}

export interface SearchResult {
  id: string;
  layer: MemoryLayer;
  content: string;
  score: number; // 综合分数 0-1
  source_strategy: string;
  metadata: Record<string, unknown>;
}

export interface SearchResponse {
  results: SearchResult[];
  query_plan: QueryPlan;
  total_candidates: number;
  direct_answer?: string;
}

interface QueryPlan {
  intent: string;
  strategies: string[];
  condition_keys: string[];
  time_range: { from: string | null; to: string | null };
  entities: string[];
  direct_answer?: string;
}

// ── 层级优先权重 ──
const LAYER_WEIGHTS: Record<MemoryLayer, number> = {
  L4: 1.0,
  L3: 0.85,
  L2: 0.7,
  L1: 0.5,
};

// Issue-12: raw_recall 意图关键词（中英文）
const RAW_RECALL_KEYWORDS = [
  '原话', '原始', '原文', '怎么说的', '说了什么', '说过什么',
  '当时', '具体说', '完整内容', '聊天记录', '对话记录',
  'verbatim', 'exact words', 'original', 'raw recall', 'what did',
];

/**
 * Issue-12: 检测是否为 raw_recall 意图
 * 当用户明确要求原始记录时，L1 权重应提升到 1.0
 */
function isRawRecallIntent(query: string, planIntent: string): boolean {
  const lowerQuery = query.toLowerCase();
  const lowerIntent = planIntent.toLowerCase();
  return RAW_RECALL_KEYWORDS.some(kw => lowerQuery.includes(kw) || lowerIntent.includes(kw));
}

/**
 * Issue-12: 获取动态层级权重
 * raw_recall 意图时 L1 提升到 1.0
 */
function getLayerWeights(query: string, planIntent: string): Record<MemoryLayer, number> {
  if (isRawRecallIntent(query, planIntent)) {
    return { L4: 0.7, L3: 0.7, L2: 0.8, L1: 1.0 };
  }
  return LAYER_WEIGHTS;
}

/**
 * 主检索入口
 */
export async function searchMemory(query: SearchQuery): Promise<SearchResponse> {
  const topK = query.top_k ?? 10;
  log.info({ query: query.query, topK }, 'Search started');

  // 1. 查询规划 (MemSifter)
  const plan = await planQuery(query.query);

  // 2. 如果 L4 可直接回答
  if (plan.direct_answer) {
    return {
      results: [],
      query_plan: plan,
      total_candidates: 0,
      direct_answer: plan.direct_answer,
    };
  }

  // 3. 执行四路并行检索
  const [semanticResults, ftsResults, graphResults, temporalResults, conditionResults, pageResults] = await Promise.all([
    plan.strategies.includes('semantic_search') ? semanticSearch(query.query, topK * 2, query.domain) : [],
    plan.strategies.includes('keyword_search') ? keywordSearch(query.query, topK * 2, query.domain) : [],
    plan.strategies.includes('graph_traverse') ? graphSearch(plan.entities, topK * 2) : [],
    plan.strategies.includes('temporal_search') ? temporalSearch(query.time_from, query.time_to, topK * 2, query.domain) : [],
    plan.condition_keys.length > 0 ? conditionSearch(plan.condition_keys) : [],
    plan.strategies.includes('knowledge_page') ? knowledgePageSearch(query.query, topK) : [],
  ]);

  // 4. 结果融合
  const allResults: SearchResult[] = [
    ...semanticResults,
    ...ftsResults,
    ...graphResults,
    ...temporalResults,
    ...conditionResults,
    ...pageResults,
  ];

  // REQ-006: LIKE fallback 兜底 — 所有检索路径返回 0 结果时降级
  if (allResults.length === 0 && query.query.trim()) {
    const likeResults = sqlLikeFallback(query.query, topK, query.domain);
    allResults.push(...likeResults);
  }

  // 5. 去重
  const dedupedMap = new Map<string, SearchResult>();
  for (const result of allResults) {
    const existing = dedupedMap.get(result.id);
    if (!existing || result.score > existing.score) {
      dedupedMap.set(result.id, result);
    }
  }

  // 6. 层级加权 + 排序（Issue-12: 支持 raw_recall 动态权重）
  const weights = getLayerWeights(query.query, plan.intent);
  let ranked = Array.from(dedupedMap.values())
    .map(r => ({
      ...r,
      score: r.score * (weights[r.layer] ?? 0.5),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // 7. LLM 重排序 (#50) — 内部会调用 enrichResults
  ranked = await llmRerank(query.query, ranked);

  // 确保最终结果已完成内容补全（llmRerank 内部已调用 enrichResults，
  // 但若结果 ≤3 条或 LLM 不可用会跳过。此处兜底，有 content 守卫不会重复查库）
  enrichResults(ranked);

  // 8. 唤醒已压缩的记忆 — 异步触发，不阻塞返回
  promoteCompressedResults(ranked);

  // 9. 查询回写 (#49) — 跨域洞察写入 compile_queue（R-022: readonly 用户跳过）
  if (!query.readonly) {
    writebackQueryInsights(query.query, ranked, plan);
  }

  log.info({
    total: allResults.length,
    deduped: dedupedMap.size,
    returned: ranked.length,
  }, 'Search complete');

  return {
    results: ranked,
    query_plan: plan,
    total_candidates: allResults.length,
  };
}

// ── 查询规划器 ──

async function planQuery(query: string): Promise<QueryPlan> {
  const llm = getLLM();

  // 获取 L4 心智模型摘要
  const models = getActiveMentalModels();
  const modelSummaries = models.slice(0, 5).map(m => `[${m.model_type}] ${m.title}: ${m.content.slice(0, 100)}`);

  if (!llm.isAvailable) {
    // REQ-006: LLM 不可用时降级 — 去掉 semantic_search（也依赖 embedding LLM）
    return {
      intent: query,
      strategies: ['keyword_search', 'temporal_search', 'knowledge_page'],
      condition_keys: [],
      time_range: { from: null, to: null },
      entities: [],
    };
  }

  try {
    const result = await llm.chatJson<{
      intent: string;
      strategies: string[];
      condition_keys: string[];
      time_range: { from: string | null; to: string | null };
      entities: string[];
      direct_answer: string | null;
    }>({
      messages: queryPlannerPrompt(query, modelSummaries),
      tier: 'light',
      temperature: 0.2,
      fallback: {
        intent: query,
        strategies: ['semantic_search', 'keyword_search'],
        condition_keys: [],
        time_range: { from: null, to: null },
        entities: [],
        direct_answer: null,
      },
    });

    return {
      intent: result.intent,
      strategies: result.strategies ?? ['semantic_search', 'keyword_search'],
      condition_keys: result.condition_keys ?? [],
      time_range: result.time_range ?? { from: null, to: null },
      entities: result.entities ?? [],
      direct_answer: result.direct_answer ?? undefined,
    } as QueryPlan;
  } catch {
    // REQ-006: LLM 失败时同样降级到不依赖 LLM 的路径
    return {
      intent: query,
      strategies: ['keyword_search', 'temporal_search', 'knowledge_page'],
      condition_keys: [],
      time_range: { from: null, to: null },
      entities: [],
    };
  }
}

// ── 四路检索实现 ──

async function semanticSearch(query: string, limit: number, domain?: string): Promise<SearchResult[]> {
  const llm = getLLM();
  if (!llm.isEmbeddingAvailable) return [];

  try {
    const embResult = await llm.embed(query);
    const vectorStore = getVectorStore();
    const hits = await vectorStore.search(embResult.embedding, limit, 0.3, domain);

    return hits.map(hit => ({
      id: hit.memoryId,
      layer: hit.memoryType as MemoryLayer,
      content: '', // 需要后续从数据库补全
      score: hit.similarity,
      source_strategy: 'semantic',
      metadata: {},
    }));
  } catch {
    log.warn('Semantic search failed');
    return [];
  }
}

function keywordSearch(query: string, limit: number, domain?: string): SearchResult[] {
  try {
    let hits = searchFts(query, limit);
    if (hits.length === 0) return [];

    // MINIMEM-001: domain 过滤 — 通过 memory_id JOIN 主表过滤
    if (domain) {
      const db = getDb();
      const filteredHits = hits.filter(hit => {
        const tableMap: Record<string, string> = { L1: 'experiences', L2: 'world_facts', L3: 'observations', L4: 'mental_models' };
        const table = tableMap[hit.memory_type];
        if (!table) return false;
        const row = db.prepare(`SELECT 1 FROM "${table}" WHERE id = ? AND domain = ?`).get(hit.memory_id, domain);
        return !!row;
      });
      hits = filteredHits;
    }

    if (hits.length === 0) return [];

    // BM25 rank 动态归一化：基于结果集最大 |rank| 值
    const maxRank = Math.max(...hits.map(h => Math.abs(h.rank)));
    const normalize = maxRank > 0
      ? (rank: number) => Math.min(1, Math.abs(rank) / maxRank)
      : () => 0.5;

    return hits.map(hit => ({
      id: hit.memory_id,
      layer: hit.memory_type as MemoryLayer,
      content: '',
      score: normalize(hit.rank),
      source_strategy: 'keyword',
      metadata: {},
    }));
  } catch {
    log.warn('Keyword search failed');
    return [];
  }
}

function graphSearch(entities: string[], limit: number): SearchResult[] {
  if (entities.length === 0) return [];

  // 所有支持的条件键前缀类型
  const ENTITY_PREFIXES = ['person', 'topic', 'project', 'technology', 'organization', 'place', 'event'];

  try {
    const results: SearchResult[] = [];
    const seenIds = new Set<string>();

    for (const entity of entities) {
      // 尝试所有前缀类型查找实体对应的记忆
      for (const prefix of ENTITY_PREFIXES) {
        const memories = lookupByPrefix(`${prefix}:${entity}`);
        for (const mem of memories) {
          if (results.length >= limit) break;
          // 图遍历
          const links = traverseGraph(mem.memory_id, 2, limit);
          for (const link of links) {
            if (results.length >= limit) break;
            // 去重：同一目标节点只保留最高权重
            if (!seenIds.has(link.target_id)) {
              seenIds.add(link.target_id);
              results.push({
                id: link.target_id,
                layer: link.target_type as MemoryLayer,
                content: '',
                score: link.weight * 0.8,
                source_strategy: 'graph',
                metadata: { link_type: link.link_type },
              });
            }
          }
        }
        if (results.length >= limit) break;
      }
    }

    return results.slice(0, limit);
  } catch {
    log.warn('Graph search failed');
    return [];
  }
}

function temporalSearch(from?: string, to?: string, limit: number = 20, domain?: string): SearchResult[] {
  if (!from && !to) return [];

  const db = getDb();
  const conditions: string[] = ["branch = 'main'"];
  const values: unknown[] = [];

  if (from) { conditions.push('created_at >= ?'); values.push(from); }
  if (to) { conditions.push('created_at <= ?'); values.push(to); }
  if (domain) { conditions.push('domain = ?'); values.push(domain); }

  const where = conditions.join(' AND ');
  const results: SearchResult[] = [];
  const perLayerLimit = Math.ceil(limit / 4);

  try {
    // L1: experiences
    const l1Rows = db.prepare(
      `SELECT id, importance FROM experiences WHERE ${where} ORDER BY importance DESC LIMIT ?`
    ).all(...values, perLayerLimit) as Array<{ id: string; importance: number }>;
    for (const row of l1Rows) {
      results.push({ id: row.id, layer: 'L1', content: '', score: row.importance, source_strategy: 'temporal', metadata: {} });
    }

    // L2: world_facts
    const l2Rows = db.prepare(
      `SELECT id, confidence FROM world_facts WHERE ${where} ORDER BY confidence DESC LIMIT ?`
    ).all(...values, perLayerLimit) as Array<{ id: string; confidence: number }>;
    for (const row of l2Rows) {
      results.push({ id: row.id, layer: 'L2', content: '', score: row.confidence, source_strategy: 'temporal', metadata: {} });
    }

    // L3: observations
    const l3Rows = db.prepare(
      `SELECT id, confidence FROM observations WHERE ${where} ORDER BY confidence DESC LIMIT ?`
    ).all(...values, perLayerLimit) as Array<{ id: string; confidence: number }>;
    for (const row of l3Rows) {
      results.push({ id: row.id, layer: 'L3', content: '', score: row.confidence, source_strategy: 'temporal', metadata: {} });
    }

    // L4: mental_models
    const l4Rows = db.prepare(
      `SELECT id, priority FROM mental_models WHERE ${where.replace("branch = 'main'", 'is_active = 1')} ORDER BY priority DESC LIMIT ?`
    ).all(...values, perLayerLimit) as Array<{ id: string; priority: number }>;
    for (const row of l4Rows) {
      results.push({ id: row.id, layer: 'L4', content: '', score: Math.min(1, row.priority / 10), source_strategy: 'temporal', metadata: {} });
    }

    // 按 score 降序排序，取 limit 条
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  } catch {
    return [];
  }
}

function conditionSearch(keys: string[]): SearchResult[] {
  const results: SearchResult[] = [];

  for (const key of keys) {
    const hits = lookupByCondition(key);
    for (const hit of hits) {
      results.push({
        id: hit.memory_id,
        layer: hit.memory_type,
        content: '',
        score: 0.9, // 条件索引精确匹配，高分
        source_strategy: 'condition',
        metadata: { condition_key: key },
      });
    }
  }

  return results;
}

function knowledgePageSearch(query: string, limit: number): SearchResult[] {
  try {
    const pages = searchKnowledgePages(query, limit);
    return pages.map(page => ({
      id: page.id,
      layer: 'L3' as MemoryLayer,
      content: page.content,
      score: page.confidence * 0.95, // 知识页面高分
      source_strategy: 'knowledge_page',
      metadata: { slug: page.slug, title: page.title, page_type: page.page_type },
    }));
  } catch {
    return [];
  }
}

/**
 * 填充结果内容（从数据库补全）
 */
export function enrichResults(results: SearchResult[]): SearchResult[] {
  const db = getDb();

  for (const result of results) {
    if (result.content) continue; // 已有内容

    try {
      let row: Record<string, unknown> | undefined;

      switch (result.layer) {
        case 'L1':
          row = db.prepare('SELECT raw_content FROM experiences WHERE id = ?').get(result.id) as Record<string, unknown> | undefined;
          if (row) result.content = row.raw_content as string;
          break;
        case 'L2':
          row = db.prepare('SELECT subject, predicate, object FROM world_facts WHERE id = ?').get(result.id) as Record<string, unknown> | undefined;
          if (row) result.content = `${row.subject} ${row.predicate} ${row.object}`;
          break;
        case 'L3':
          row = db.prepare('SELECT description FROM observations WHERE id = ?').get(result.id) as Record<string, unknown> | undefined;
          if (row) result.content = row.description as string;
          break;
        case 'L4':
          row = db.prepare('SELECT title, content FROM mental_models WHERE id = ?').get(result.id) as Record<string, unknown> | undefined;
          if (row) result.content = `[${row.title}] ${row.content}`;
          break;
      }
    } catch {
      // 忽略单条获取错误
    }
  }

  return results;
}

// ── LLM 重排序 (#50) ──

async function llmRerank(query: string, results: SearchResult[]): Promise<SearchResult[]> {
  if (results.length <= 3) return results; // 太少不必重排

  const llm = getLLM();
  if (!llm.isAvailable) return results;

  // 先补全内容
  const enriched = enrichResults(results);

  try {
    const items = enriched.map((r, i) => ({
      index: i,
      layer: r.layer,
      content: r.content.slice(0, 200),
      score: r.score,
    }));

    const reranked = await llm.chatJson<{
      ranked_indices: number[];
    }>({
      messages: rerankPrompt(query, items),
      tier: 'light',
      temperature: 0.1,
      fallback: { ranked_indices: items.map((_: unknown, i: number) => i) },
    });

    // 按 LLM 返回的顺序重新排列
    const reorderedResults: SearchResult[] = [];
    const seen = new Set<number>();

    for (const idx of reranked.ranked_indices) {
      if (idx >= 0 && idx < enriched.length && !seen.has(idx)) {
        seen.add(idx);
        const positionBoost = 1.0 - (reorderedResults.length * 0.05);
        reorderedResults.push({
          ...enriched[idx],
          score: enriched[idx].score * Math.max(0.5, positionBoost),
        });
      }
    }

    // 补回未被 LLM 排过的
    for (let i = 0; i < enriched.length; i++) {
      if (!seen.has(i)) reorderedResults.push(enriched[i]);
    }

    log.debug({ query, rerankedCount: reorderedResults.length }, 'LLM rerank done');
    return reorderedResults;
  } catch {
    log.warn('LLM reranking failed, returning original order');
    return enriched;
  }
}

// ── 唤醒已压缩记忆 ──

/**
 * 检查检索结果中是否有已压缩的记忆，异步触发唤醒
 * 不阻塞主检索流程，fire-and-forget
 */
function promoteCompressedResults(results: SearchResult[]): void {
  const db = getDb();

  for (const result of results) {
    try {
      const temp = db.prepare(
        'SELECT compression_level FROM memory_temperature WHERE memory_id = ? AND memory_type = ?'
      ).get(result.id, result.layer) as { compression_level: number } | undefined;

      if (temp && temp.compression_level > 0) {
        // fire-and-forget：不 await，不阻塞返回
        promoteMemory(result.id, result.layer).catch(err => {
          log.warn({ memoryId: result.id, err }, 'Promotion failed for retrieved memory');
        });
      }
    } catch {
      // 忽略单条检查错误
    }
  }
}

// ── 查询回写 (#49) ──

// 查询回写频率控制：5 分钟内相同查询不重复写入
const _recentWritebacks = new Map<string, number>(); // queryHash → timestamp
const WRITEBACK_COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟

// ── REQ-006: SQL LIKE 兜底搜索 ──

/**
 * 所有检索路径失败时的最终降级：遍历 L1-L4 用 SQL LIKE 模糊匹配
 * score 统一设为 0.3，source_strategy 标记为 'like_fallback'
 */
function sqlLikeFallback(query: string, limit: number, domain?: string): SearchResult[] {
  const db = getDb();
  const results: SearchResult[] = [];
  const likePattern = `%${query}%`;
  const perLayerLimit = Math.ceil(limit / 4);

  const domainCondition = domain ? " AND domain = ?" : '';
  const domainValues = domain ? [domain] : [];

  try {
    // L1
    const l1 = db.prepare(
      `SELECT id FROM experiences WHERE branch = 'main' AND raw_content LIKE ?${domainCondition} LIMIT ?`
    ).all(likePattern, ...domainValues, perLayerLimit) as Array<{ id: string }>;
    for (const r of l1) {
      results.push({ id: r.id, layer: 'L1', content: '', score: 0.3, source_strategy: 'like_fallback', metadata: {} });
    }

    // L2
    const l2 = db.prepare(
      `SELECT id FROM world_facts WHERE branch = 'main' AND (subject LIKE ? OR predicate LIKE ? OR object LIKE ?)${domainCondition} LIMIT ?`
    ).all(likePattern, likePattern, likePattern, ...domainValues, perLayerLimit) as Array<{ id: string }>;
    for (const r of l2) {
      results.push({ id: r.id, layer: 'L2', content: '', score: 0.3, source_strategy: 'like_fallback', metadata: {} });
    }

    // L3
    const l3 = db.prepare(
      `SELECT id FROM observations WHERE branch = 'main' AND description LIKE ?${domainCondition} LIMIT ?`
    ).all(likePattern, ...domainValues, perLayerLimit) as Array<{ id: string }>;
    for (const r of l3) {
      results.push({ id: r.id, layer: 'L3', content: '', score: 0.3, source_strategy: 'like_fallback', metadata: {} });
    }

    // L4
    const l4 = db.prepare(
      `SELECT id FROM mental_models WHERE is_active = 1 AND (title LIKE ? OR content LIKE ?)${domainCondition} LIMIT ?`
    ).all(likePattern, likePattern, ...domainValues, perLayerLimit) as Array<{ id: string }>;
    for (const r of l4) {
      results.push({ id: r.id, layer: 'L4', content: '', score: 0.3, source_strategy: 'like_fallback', metadata: {} });
    }
  } catch {
    log.warn('SQL LIKE fallback search failed');
  }

  return results.slice(0, limit);
}

function writebackQueryInsights(query: string, results: SearchResult[], _plan: QueryPlan): void {
  if (results.length < 2) return;

  // 检测跨域（不同 source_strategy 的结果在 Top-5 中共存）
  const topResults = results.slice(0, 5);
  const strategies = new Set(topResults.map(r => r.source_strategy));
  const layers = new Set(topResults.map(r => r.layer));

  // 跨策略 + 跨层级 → 有洞察价值
  if (strategies.size >= 2 && layers.size >= 2) {
    // 频率控制：基于查询文本去重
    const queryKey = query.toLowerCase().trim();
    const lastWriteback = _recentWritebacks.get(queryKey);
    const now = Date.now();
    if (lastWriteback && now - lastWriteback < WRITEBACK_COOLDOWN_MS) {
      log.debug({ query }, 'Query writeback skipped (cooldown)');
      return;
    }

    const insight = `查询 "${query}" 发现跨域关联：` +
      topResults.map(r => `[${r.layer}/${r.source_strategy}] ${r.content.slice(0, 80)}`).join(' | ');

    try {
      enqueueCompile('query_insight', insight, undefined, 3);
      _recentWritebacks.set(queryKey, now);
      log.debug({ query }, 'Query insight written to compile_queue');

      // 定期清理过期条目，防止内存泄漏
      if (_recentWritebacks.size > 200) {
        for (const [key, ts] of _recentWritebacks) {
          if (now - ts > WRITEBACK_COOLDOWN_MS) _recentWritebacks.delete(key);
        }
      }
    } catch {
      log.warn('Failed to write query insight');
    }
  }
}
