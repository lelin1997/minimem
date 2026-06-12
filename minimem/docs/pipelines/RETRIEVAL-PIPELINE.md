# MiniMem 检索管道（Retrieval Pipeline）深度解析

> 本文档基于 `src/retrieval/search.ts`（464行）逐行分析，覆盖从 Gateway 入口到最终结果返回的完整读取路径。

---

## 目录

1. [架构总览](#1-架构总览)
2. [入口点（Gateway 层）](#2-入口点gateway-层)
3. [核心类型定义](#3-核心类型定义)
4. [查询规划器（MemSifter）](#4-查询规划器memsifter)
5. [六路并行检索](#5-六路并行检索)
6. [结果融合与排序](#6-结果融合与排序)
7. [LLM 重排序](#7-llm-重排序)
8. [结果内容补全（enrichResults）](#8-结果内容补全enrichresults)
9. [查询回写（Query Writeback）](#9-查询回写query-writeback)
10. [Store 层检索函数汇总](#10-store-层检索函数汇总)
11. [LLM Prompt 模板](#11-llm-prompt-模板)
12. [完整时序图](#12-完整时序图)
13. [数据流总结表](#13-数据流总结表)
14. [降级策略](#14-降级策略)
15. [已知问题与优化方向](#15-已知问题与优化方向)

---

## 1. 架构总览

```
┌─────────────────── Gateway 层 ────────────────────┐
│  MCP: search_memory / recall_about                 │
│  MCP: get_relevant_context                         │
│  REST: GET /api/v1/memory/search                   │
│  REST: GET /api/v1/memory/recall/:entity           │
└───────────────────┬───────────────────────────────┘
                    │
                    ▼
┌────────── Retrieval Engine (search.ts) ───────────┐
│  searchMemory()                                    │
│    1. planQuery()           ← LLM 查询规划         │
│    2. 直接回答短路           ← L4 心智模型          │
│    3. 六路并行检索           ← Promise.all          │
│    4. 结果融合 + 去重                               │
│    5. 层级加权排序                                  │
│    6. LLM 重排序                                    │
│    7. 查询回写 → compile_queue                      │
│  enrichResults()            ← 内容补全              │
└──┬─────┬─────┬─────┬─────┬─────┬──────────────────┘
   │     │     │     │     │     │
┌──┴──┐┌─┴──┐┌─┴──┐┌─┴──┐┌─┴──┐┌┴───────────┐
│向量 ││FTS5││图谱 ││时间 ││条件 ││知识页面     │
│余弦 ││BM25││BFS  ││SQL  ││O(1)││FTS5→LIKE   │
└─────┘└────┘└────┘└────┘└────┘└─────────────┘
   │     │     │     │     │     │
┌──┴─────┴─────┴─────┴─────┴─────┴──────────────┐
│              SQLite DB + 内存向量               │
│  experiences │ world_facts │ observations       │
│  mental_models │ knowledge_pages               │
│  condition_index │ memory_fts │ memory_links   │
└────────────────────────────────────────────────┘
```

---

## 2. 入口点（Gateway 层）

### 2.1 MCP Server（3 个检索工具）

**文件**: `src/gateway/mcp-server.ts`

| 工具名 | 定义行号 | 处理行号 | 参数 | 描述 |
|--------|---------|---------|------|------|
| `search_memory` | L100-L113 | L474-L491 | `query`, `top_k`, `layers`, `time_from`, `time_to` | 六路混合搜索 |
| `recall_about` | L115-L125 | L493-L503 | `entity`, `top_k` | 实体召回 |
| `get_relevant_context` | L127-L137 | L505-L526 | `current_topic`, `agent_type` | Surface Files + 深层检索 |

**`search_memory` 处理逻辑**（L474-L491）:

```typescript
case 'search_memory': {
  const response = await searchMemory({
    query: params.query,
    top_k: params.top_k,
    layers: params.layers,
    time_from: params.time_from,
    time_to: params.time_to,
  });
  const enriched = enrichResults(response.results);
  // 返回 { results, direct_answer, total }
}
```

**`recall_about` 处理逻辑**（L493-L503）:

```typescript
case 'recall_about': {
  // 将实体名包装为自然语言查询
  const response = await searchMemory({
    query: `关于 ${params.entity} 的所有信息`,
    top_k: params.top_k ?? 10,
  });
  const enriched = enrichResults(response.results);
}
```

> ⚠️ `recall_about` 并非独立检索实现，而是对 `searchMemory` 的包装——将实体名构造为自然语言查询。

**`get_relevant_context` 处理逻辑**（L505-L526）:

```typescript
case 'get_relevant_context': {
  const agentType = params.agent_type ?? 'general';
  // 1. 加载 Surface Files（按 Agent 类型选择文件子集）
  const surfaceFiles = loadSurfacesForAgent(agentType);
  // 2. 深层检索
  const response = await searchMemory({ query: params.current_topic, top_k: 5 });
  const enriched = enrichResults(response.results);
  // 返回 { surface_files, deep_results, direct_answer }
}
```

Surface Files 按 Agent 类型的选择映射（L883-L889）：

| Agent 类型 | 加载的文件 |
|-----------|-----------|
| `codebuddy` | me.md, work.md, agent.md, context.md |
| `openclaw` | me.md, soul.md, social.md, context.md |
| `general` | 全部 8 个文件 |

### 2.2 REST API（2 个检索端点）

**文件**: `src/gateway/rest-api.ts`

| 路由 | 行号 | 方法 | 描述 |
|------|------|------|------|
| `/api/v1/memory/search` | L87-L97 | GET | 参数 `query`, `top_k` |
| `/api/v1/memory/recall/:entity` | L99-L107 | GET | 路径参数 `entity` |

REST API 的处理逻辑与 MCP 完全一致：`searchMemory()` → `enrichResults()`。

---

## 3. 核心类型定义

**文件**: `src/retrieval/search.ts` L22-L56

### SearchQuery（输入）

```typescript
interface SearchQuery {
  query: string;                // 自然语言查询
  layers?: MemoryLayer[];       // 限定层级（L1/L2/L3/L4）
  top_k?: number;               // 返回条数，默认 10
  time_from?: string;           // 时间起点 (ISO 8601)
  time_to?: string;             // 时间终点 (ISO 8601)
  source?: string;              // 来源筛选
  include_context?: boolean;    // 是否包含上下文
  readonly?: boolean;           // R-022: readonly 用户跳过查询回写
}
```

### SearchResult（单条结果）

```typescript
interface SearchResult {
  id: string;                   // 记忆 ID
  layer: MemoryLayer;           // 所属层级
  content: string;              // 内容（初始为空，enrichResults 后填充）
  score: number;                // 综合分数 0-1
  source_strategy: string;      // 来源策略（semantic/keyword/graph/temporal/condition/knowledge_page）
  metadata: Record<string, unknown>;
}
```

### SearchResponse（完整响应）

```typescript
interface SearchResponse {
  results: SearchResult[];      // 排序后的结果列表
  query_plan: QueryPlan;        // 查询计划（可观测性）
  total_candidates: number;     // 候选总数（去重前）
  direct_answer?: string;       // L4 直接回答（如有）
}
```

### QueryPlan（查询计划）

```typescript
interface QueryPlan {
  intent: string;               // 查询意图描述
  strategies: string[];         // 选中的检索策略
  condition_keys: string[];     // 条件索引键
  time_range: {                 // 时间范围
    from: string | null;
    to: string | null;
  };
  entities: string[];           // 涉及的实体
  direct_answer?: string;       // L4 直接回答
}
```

### 层级权重常量（L59-L64）

```typescript
const LAYER_WEIGHTS: Record<MemoryLayer, number> = {
  L4: 1.0,    // 心智模型 — 最高权重
  L3: 0.85,   // 观察/知识页面
  L2: 0.7,    // 事实
  L1: 0.5,    // 原始经历 — 最低权重
};
```

---

## 4. 查询规划器（MemSifter）

**函数**: `planQuery()` — `search.ts` L147-L203

查询规划是整个检索管道的"大脑"，决定使用哪些检索策略。

### 4.1 流程

```
用户查询
    │
    ├── 1. 获取 L4 心智模型摘要（前 5 个）
    │     getActiveMentalModels() → 格式化为 "[model_type] title: content前100字"
    │
    ├── 2. LLM 不可用？
    │     ├── YES → 返回默认规则策略 ['semantic_search', 'keyword_search']
    │     └── NO  → 继续 LLM 规划
    │
    └── 3. LLM 查询规划
          llm.chatJson(queryPlannerPrompt, tier='light', temperature=0.2)
          → 输出 QueryPlan { intent, strategies, condition_keys, time_range, entities, direct_answer }
```

### 4.2 L4 心智模型的作用（L150-L152）

```typescript
const models = getActiveMentalModels();
const modelSummaries = models.slice(0, 5).map(m =>
  `[${m.model_type}] ${m.title}: ${m.content.slice(0, 100)}`
);
```

L4 心智模型摘要会作为 LLM 的输入上下文，让规划器判断：
- 是否可以直接用 L4 回答（`mental_model_direct` 策略 → `direct_answer`）
- 查询涉及的领域，帮助选择最佳检索策略

### 4.3 LLM 规划调用（L165-L185）

```typescript
const result = await llm.chatJson<{...}>({
  messages: queryPlannerPrompt(query, modelSummaries),
  tier: 'light',           // 使用轻量模型（速度优先）
  temperature: 0.2,        // 低温度，输出稳定
  fallback: {              // LLM 失败时的默认值
    intent: query,
    strategies: ['semantic_search', 'keyword_search'],
    condition_keys: [],
    time_range: { from: null, to: null },
    entities: [],
    direct_answer: null,
  },
});
```

### 4.4 可用的 7 种检索策略

| 策略 | 标识符 | 适用场景 |
|------|--------|---------|
| L4 直接回答 | `mental_model_direct` | L4 已有答案时，跳过检索 |
| 知识页面 | `knowledge_page` | 查找结构化知识 |
| 语义检索 | `semantic_search` | 模糊/概念性查询 |
| 关键词检索 | `keyword_search` | 精确关键词匹配 |
| 图遍历 | `graph_traverse` | 实体关联查询 |
| 时间检索 | `temporal_search` | 时间范围查询 |
| 条件索引 | `condition_lookup` | O(1) 精确查找 |

### 4.5 规则降级（LLM 不可用时）

```typescript
if (!llm.isAvailable) {
  return {
    intent: query,
    strategies: ['semantic_search', 'keyword_search'],  // 默认双路
    condition_keys: [],
    time_range: { from: null, to: null },
    entities: [],
  };
}
```

---

## 5. 六路并行检索

**位置**: `search.ts` L86-L94

```typescript
const [semanticResults, ftsResults, graphResults, temporalResults, conditionResults, pageResults] =
  await Promise.all([
    plan.strategies.includes('semantic_search')  ? semanticSearch(query.query, topK * 2)           : [],
    plan.strategies.includes('keyword_search')   ? keywordSearch(query.query, topK * 2)            : [],
    plan.strategies.includes('graph_traverse')   ? graphSearch(plan.entities, topK * 2)            : [],
    plan.strategies.includes('temporal_search')  ? temporalSearch(query.time_from, query.time_to, topK * 2) : [],
    plan.condition_keys.length > 0               ? conditionSearch(plan.condition_keys)             : [],
    plan.strategies.includes('knowledge_page')   ? knowledgePageSearch(query.query, topK)          : [],
  ]);
```

> 使用 `Promise.all` **真正并行**执行六路检索。

### 5.1 Route 1: 语义检索（`semanticSearch`）

**位置**: L208-L228  
**依赖**: `llm.embed()` → `vectorStore.search()`

```typescript
async function semanticSearch(query: string, limit: number): Promise<SearchResult[]> {
  const llm = getLLM();
  if (!llm.isAvailable) return [];  // LLM 不可用则跳过

  const embResult = await llm.embed(query);       // 查询文本 → 向量
  const vectorStore = getVectorStore();
  const hits = vectorStore.search(
    embResult.embedding,
    limit,
    0.3,   // minSimilarity 阈值
  );

  return hits.map(hit => ({
    id: hit.memoryId,
    layer: hit.memoryType as MemoryLayer,
    content: '',        // 占位，后续 enrichResults 补全
    score: hit.similarity,
    source_strategy: 'semantic',
    metadata: {},
  }));
}
```

**向量检索详情**（`vectors.ts` L115-L143）：
- 暴力扫描所有向量，利用**预计算的 L2 范数**加速余弦相似度计算
- 零向量自动跳过
- 结果按相似度降序排序，取 topK

### 5.2 Route 2: 关键词检索（`keywordSearch`）

**位置**: L231-L245  
**依赖**: `searchFts()` — SQLite FTS5

```typescript
function keywordSearch(query: string, limit: number): SearchResult[] {
  const hits = searchFts(query, limit);
  return hits.map(hit => ({
    id: hit.memory_id,
    layer: hit.memory_type as MemoryLayer,
    content: '',
    score: Math.min(1, Math.abs(hit.rank) / 10),  // BM25 rank → 0-1 归一化
    source_strategy: 'keyword',
    metadata: {},
  }));
}
```

**FTS5 搜索详情**（`indexes.ts` L82-L95）：

```sql
SELECT memory_id, memory_type, rank
FROM memory_fts
WHERE memory_fts MATCH ?
ORDER BY rank
LIMIT ?
```

使用 SQLite FTS5 的 BM25 算法进行全文排序。`memory_fts` 虚拟表包含 `memory_id`, `memory_type`, `content`, `tags`, `condition_keys` 五个字段。

### 5.3 Route 3: 图遍历（`graphSearch`）

**位置**: L248-L278  
**依赖**: `lookupByPrefix()` → `traverseGraph()`

```typescript
function graphSearch(entities: string[], limit: number): SearchResult[] {
  if (entities.length === 0) return [];

  for (const entity of entities) {
    // 1. 通过条件索引找到实体对应的记忆
    const memories = lookupByPrefix(`person:${entity}`);

    for (const mem of memories) {
      // 2. 从该记忆节点出发，BFS 遍历知识图谱
      const links = traverseGraph(mem.memory_id, 2, limit);

      for (const link of links) {
        results.push({
          id: link.target_id,
          layer: link.target_type as MemoryLayer,
          score: link.weight * 0.8,    // 边权重 × 衰减系数
          source_strategy: 'graph',
          metadata: { link_type: link.link_type },
        });
      }
    }
  }
}
```

**图遍历详情**（`graph.ts` L48-L76）：

```typescript
export function traverseGraph(startId: string, maxHops: number = 2, maxResults: number = 50): MemoryLink[] {
  const visited = new Set<string>([startId]);
  let frontier = [startId];

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      // 双向边查询
      const links = db.prepare(
        'SELECT * FROM memory_links WHERE source_id = ? OR target_id = ?'
      ).all(nodeId, nodeId);

      for (const link of links) {
        if (results.length >= maxResults) return results;
        results.push(link);
        // 防环：visited Set
        const neighbor = link.source_id === nodeId ? link.target_id : link.source_id;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
  }
}
```

- **算法**: BFS（广度优先搜索）
- **跳数**: 默认 2 跳
- **防环**: `visited` Set
- **双向**: `source_id = ? OR target_id = ?`

### 5.4 Route 4: 时间检索（`temporalSearch`）

**位置**: L280-L308  
**依赖**: 直接 SQL 查询 `experiences` 表

```typescript
function temporalSearch(from?: string, to?: string, limit: number = 20): SearchResult[] {
  if (!from && !to) return [];

  const db = getDb();
  const conditions: string[] = ["branch = 'main'"];
  if (from) { conditions.push('created_at >= ?'); }
  if (to)   { conditions.push('created_at <= ?'); }

  const rows = db.prepare(
    `SELECT id, importance FROM experiences WHERE ${where} ORDER BY importance DESC LIMIT ?`
  ).all(...values, limit);

  return rows.map(row => ({
    id: row.id,
    layer: 'L1' as MemoryLayer,    // 只查 L1
    score: row.importance,
    source_strategy: 'temporal',
  }));
}
```

> ⚠️ 时间检索**只搜索 L1**（experiences 表），不覆盖 L2/L3/L4。

### 5.5 Route 5: 条件索引检索（`conditionSearch`）

**位置**: L311-L328  
**依赖**: `lookupByCondition()` — O(1) 精确匹配

```typescript
function conditionSearch(keys: string[]): SearchResult[] {
  for (const key of keys) {
    const hits = lookupByCondition(key);
    for (const hit of hits) {
      results.push({
        id: hit.memory_id,
        layer: hit.memory_type,
        score: 0.9,           // 精确匹配 → 高分
        source_strategy: 'condition',
        metadata: { condition_key: key },
      });
    }
  }
}
```

**条件索引 SQL**（`indexes.ts` L41-L46）：

```sql
SELECT memory_type, memory_id FROM condition_index WHERE condition_key = ?
```

条件索引键的格式示例：`person:alice`, `topic:typescript`, `project:minimem`

### 5.6 Route 6: 知识页面检索（`knowledgePageSearch`）

**位置**: L331-L345  
**依赖**: `searchKnowledgePages()` — FTS5 → LIKE 降级

```typescript
function knowledgePageSearch(query: string, limit: number): SearchResult[] {
  const pages = searchKnowledgePages(query, limit);
  return pages.map(page => ({
    id: page.id,
    layer: 'L3' as MemoryLayer,
    content: page.content,          // 知识页面直接带内容
    score: page.confidence * 0.95,  // 高分
    source_strategy: 'knowledge_page',
    metadata: { slug: page.slug, title: page.title, page_type: page.page_type },
  }));
}
```

**知识页面搜索详情**（`page-store.ts` L130-L164）：

```
1. 优先: FTS5 搜索
   SELECT DISTINCT kp.* FROM knowledge_pages kp
   WHERE kp.id IN (
     SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ? AND memory_type IN ('L3', 'L4')
   )

2. 降级: LIKE 搜索（FTS 无结果或失败时）
   SELECT * FROM knowledge_pages
   WHERE title LIKE ? OR content LIKE ? OR slug LIKE ?
   ORDER BY confidence DESC
```

### 5.7 六路检索 topK 策略

| 路由 | 请求的 topK | 说明 |
|------|-------------|------|
| 语义检索 | `topK * 2` (20) | 多取一些，留给后续融合 |
| 关键词检索 | `topK * 2` (20) | 同上 |
| 图遍历 | `topK * 2` (20) | 同上 |
| 时间检索 | `topK * 2` (20) | 同上 |
| 条件索引 | 不限 | 精确匹配，数量通常不多 |
| 知识页面 | `topK` (10) | 知识页面本身信息密度高 |

---

## 6. 结果融合与排序

### 6.1 合并（L96-L104）

```typescript
const allResults: SearchResult[] = [
  ...semanticResults,
  ...ftsResults,
  ...graphResults,
  ...temporalResults,
  ...conditionResults,
  ...pageResults,
];
```

六路结果扁平化合并为一个数组。

### 6.2 去重（L106-L113）

```typescript
const dedupedMap = new Map<string, SearchResult>();
for (const result of allResults) {
  const existing = dedupedMap.get(result.id);
  if (!existing || result.score > existing.score) {
    dedupedMap.set(result.id, result);  // 同 ID 保留最高分
  }
}
```

使用 `Map<id, SearchResult>` 去重，**同一条记忆被多路命中时保留最高分**。

### 6.3 层级加权 + 排序（L115-L122）

```typescript
let ranked = Array.from(dedupedMap.values())
  .map(r => ({
    ...r,
    score: r.score * (LAYER_WEIGHTS[r.layer] ?? 0.5),
  }))
  .sort((a, b) => b.score - a.score)
  .slice(0, topK);
```

**层级加权公式**: `final_score = raw_score × layer_weight`

| 层级 | 权重 | 含义 |
|------|------|------|
| L4（心智模型） | × 1.0 | 最高抽象层，信息密度最高 |
| L3（观察/知识页面） | × 0.85 | 提炼过的洞察 |
| L2（事实） | × 0.7 | 结构化三元组 |
| L1（原始经历） | × 0.5 | 原始记忆，噪音最多 |

排序后截取 `topK` 条进入重排序阶段。

---

## 7. LLM 重排序

**函数**: `llmRerank()` — `search.ts` L387-L439

### 7.1 触发条件

```typescript
if (results.length <= 3) return results;  // 太少不必重排
const llm = getLLM();
if (!llm.isAvailable) return results;     // LLM 不可用直接跳过
```

### 7.2 流程

```
1. 先调用 enrichResults() 补全内容
   └── 确保每条结果都有 content 字段

2. 构造重排序输入
   items = enriched.map(r => ({
     index: i,
     layer: r.layer,
     content: r.content.slice(0, 200),  // 截取前 200 字
     score: r.score,
   }))

3. 调用 LLM
   llm.chatJson(rerankPrompt(query, items))
   tier = 'light', temperature = 0.1
   → 输出: { ranked_indices: [2, 0, 1, 3, ...] }

4. 按 LLM 顺序重排 + positionBoost 衰减
   for idx in ranked_indices:
     positionBoost = 1.0 - (position * 0.05)   // 每位衰减 5%
     positionBoost = max(0.5, positionBoost)     // 最低 0.5
     score = original_score × positionBoost

5. 补回未被 LLM 排过的结果（附加到末尾）
```

### 7.3 代码实现（L396-L438）

```typescript
const reranked = await llm.chatJson<{ ranked_indices: number[] }>({
  messages: rerankPrompt(query, items),
  tier: 'light',
  temperature: 0.1,        // 极低温度，输出确定性
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
```

### 7.4 失败降级

```typescript
catch {
  log.warn('LLM reranking failed, returning original order');
  return enriched;  // 回退到层级加权排序的原始顺序
}
```

---

## 8. 结果内容补全（enrichResults）

**函数**: `enrichResults()` — `search.ts` L350-L383

检索过程中，六路检索只返回 `id` + `layer` + `score`，**不携带实际内容**（`content = ''`）。`enrichResults()` 负责从数据库回填内容。

```typescript
export function enrichResults(results: SearchResult[]): SearchResult[] {
  const db = getDb();

  for (const result of results) {
    if (result.content) continue;  // 已有内容（知识页面路由已填充）

    switch (result.layer) {
      case 'L1':
        // SELECT raw_content FROM experiences WHERE id = ?
        result.content = row.raw_content;
        break;
      case 'L2':
        // SELECT subject, predicate, object FROM world_facts WHERE id = ?
        result.content = `${row.subject} ${row.predicate} ${row.object}`;
        break;
      case 'L3':
        // SELECT description FROM observations WHERE id = ?
        result.content = row.description;
        break;
      case 'L4':
        // SELECT title, content FROM mental_models WHERE id = ?
        result.content = `[${row.title}] ${row.content}`;
        break;
    }
  }
}
```

**每层填充逻辑**：

| 层级 | 表 | 字段 | 格式 |
|------|-----|------|------|
| L1 | `experiences` | `raw_content` | 原文 |
| L2 | `world_facts` | `subject`, `predicate`, `object` | 三元组拼接 `"Alice 使用 TypeScript"` |
| L3 | `observations` | `description` | 观察描述 |
| L4 | `mental_models` | `title`, `content` | `"[标题] 内容"` |

> 注意：`enrichResults()` 被调用了两次 —— LLM 重排序前（L394）和 Gateway 层返回前（L483/L91）。但由于有 `if (result.content) continue` 守卫，第二次调用实际是空操作。

---

## 9. 查询回写（Query Writeback）

**函数**: `writebackQueryInsights()` — `search.ts` L443-L463

这是检索管道的"反馈闭环"机制 —— 检索过程中发现的跨域关联会被写回 `compile_queue`，供后续 Dream 引擎处理。

### 9.1 触发条件

```typescript
function writebackQueryInsights(query: string, results: SearchResult[], _plan: QueryPlan): void {
  if (results.length < 2) return;  // 结果太少，无法判断

  const topResults = results.slice(0, 5);
  const strategies = new Set(topResults.map(r => r.source_strategy));
  const layers = new Set(topResults.map(r => r.layer));

  // 必须同时满足：跨策略 ≥ 2 且 跨层级 ≥ 2
  if (strategies.size >= 2 && layers.size >= 2) {
    // 生成洞察...
  }
}
```

**触发逻辑**：
- Top-5 结果中，来自 **≥ 2 种不同检索策略**（如同时有 semantic + keyword）
- 且来自 **≥ 2 个不同层级**（如同时有 L1 + L3）
- 说明查询揭示了跨域关联，有知识编译价值

### 9.2 洞察生成

```typescript
const insight = `查询 "${query}" 发现跨域关联：` +
  topResults.map(r => `[${r.layer}/${r.source_strategy}] ${r.content.slice(0, 80)}`).join(' | ');

enqueueCompile('query_insight', insight, undefined, 3);  // priority=3
```

### 9.3 R-022: readonly 用户保护

```typescript
// search.ts L127-L130
if (!query.readonly) {
  writebackQueryInsights(query.query, ranked, plan);
}
```

`readonly` 权限的用户执行搜索时，**不触发查询回写**（因为回写是写操作）。

---

## 10. Store 层检索函数汇总

### 向量存储（`src/store/vectors.ts`）

| 函数 | 行号 | 复杂度 | 用途 |
|------|------|--------|------|
| `search(queryVector, topK, minSimilarity)` | L115 | O(n) | 余弦相似度暴力检索 |
| `randomWalk(queryVector, count, minSim, maxSim)` | L149 | O(n) | Dream Phase 3 用 |

### 条件索引 + FTS（`src/store/indexes.ts`）

| 函数 | 行号 | 复杂度 | 用途 |
|------|------|--------|------|
| `lookupByCondition(key)` | L41 | O(1) | 精确条件匹配 |
| `lookupByPrefix(prefix)` | L51 | O(k) | 前缀模糊匹配（LIKE） |
| `searchFts(query, limit)` | L82 | O(log n) | FTS5 BM25 全文搜索 |

### 知识图谱（`src/store/graph.ts`）

| 函数 | 行号 | 复杂度 | 用途 |
|------|------|--------|------|
| `traverseGraph(startId, maxHops, maxResults)` | L48 | O(V+E) | BFS N-跳遍历 |

### L1-L4 存储

| 模块 | 检索相关函数 | 用途 |
|------|-------------|------|
| `experiences.ts` | `getExperienceById(id)` | enrichResults L1 |
| `experiences.ts` | `listExperiences(params)` | 分页浏览 |
| `world-facts.ts` | `findFactsBySubject(subject)` | 按主题查事实 |
| `world-facts.ts` | `searchFacts(query, limit)` | LIKE 模糊搜索事实 |
| `observations.ts` | `getObservationById(id)` | enrichResults L3 |
| `observations.ts` | `findObservationsByType(type)` | 按类型查询观察 |
| `mental-models.ts` | `getActiveMentalModels()` | 查询规划时获取 L4 摘要 |
| `mental-models.ts` | `getMentalModelById(id)` | enrichResults L4 |
| `mental-models.ts` | `findMentalModelsByScope(scope)` | 按作用域查询 |

### 知识页面（`src/store/knowledge-pages/`）

| 函数 | 文件 | 用途 |
|------|------|------|
| `searchKnowledgePages(query, limit)` | `page-store.ts` L130 | FTS5 → LIKE 降级搜索 |
| `enqueueCompile(sourceType, content, targetPage, priority)` | `compile-queue.ts` L12 | 查询回写入队 |

---

## 11. LLM Prompt 模板

**文件**: `src/llm/prompts.ts`

### 11.1 queryPlannerPrompt（L187-L221）

```
System: "你是查询规划器。分析用户查询意图，决定最佳检索策略。"

可用检索路径：
1. mental_model_direct: L4 心智模型可直接回答
2. knowledge_page: 通过知识页面检索
3. semantic_search: 语义向量检索
4. keyword_search: FTS5 关键词检索
5. graph_traverse: 知识图谱遍历
6. temporal_search: 时间范围检索
7. condition_lookup: 条件索引 O(1) 查找

输出 JSON: { intent, strategies[], condition_keys[], time_range, entities[], direct_answer }

User: "查询：{query}" + L4 心智模型摘要
```

### 11.2 rerankPrompt（L226-L251）

```
System: "你是搜索结果重排序器。根据查询意图对检索结果重新排序。"

规则：
1. 最相关的结果排在前面
2. 综合考虑语义相关性、时效性、信息质量
3. 高层级记忆（L4>L3>L2>L1）在相关性相同时优先

输出 JSON: { ranked_indices: [2, 0, 1, 3, ...] }

User: "查询：{query}" + 候选结果列表（index, layer, content前200字, score）
```

---

## 12. 完整时序图

```
Agent/用户
  │
  ├── MCP: search_memory("Alice 最近在做什么")
  │   └── mcp-server.ts L474
  │
  └── REST: GET /memory/search?query=...&top_k=10
      └── rest-api.ts L87
          │
          ▼
    searchMemory(query)                            ← search.ts L69
          │
          ├── [Step 1] planQuery(query)            ← L147
          │    ├── getActiveMentalModels()         ← mental-models.ts L60
          │    │   → SQL: SELECT * FROM mental_models WHERE is_active=1 ORDER BY priority DESC
          │    │
          │    └── llm.chatJson(queryPlannerPrompt)
          │        model: light, temperature: 0.2
          │        → QueryPlan { strategies: ['semantic_search', 'graph_traverse'], entities: ['Alice'], ... }
          │
          ├── [Step 2] direct_answer 短路检查      ← L77
          │    └── plan.direct_answer 存在 → 直接返回，跳过所有检索
          │
          ├── [Step 3] Promise.all — 六路并行       ← L87-L94
          │    │
          │    ├── Route 1: semanticSearch          ← L208
          │    │    ├── llm.embed("Alice 最近在做什么")    (≈50ms)
          │    │    └── vectorStore.search(vec, 20, 0.3)   (内存 O(n) 扫描)
          │    │
          │    ├── Route 2: keywordSearch           ← L231
          │    │    └── searchFts("Alice 最近在做什么", 20) (SQLite FTS5 BM25)
          │    │
          │    ├── Route 3: graphSearch             ← L248
          │    │    ├── lookupByPrefix("person:Alice")     (SQL LIKE)
          │    │    └── traverseGraph(memId, 2, 20)        (BFS 2-hop)
          │    │
          │    ├── Route 4: temporalSearch          ← L280 (本例无时间范围，跳过)
          │    │
          │    ├── Route 5: conditionSearch         ← L311 (本例无条件键，跳过)
          │    │
          │    └── Route 6: knowledgePageSearch     ← L331
          │         └── searchKnowledgePages(query, 10)    (FTS5 → LIKE)
          │
          ├── [Step 4] 结果融合                    ← L97-L104
          │    └── 6 路结果扁平合并 → allResults[]
          │
          ├── [Step 5] 去重                        ← L107-L113
          │    └── Map<id, SearchResult> 保留最高分
          │
          ├── [Step 6] 层级加权 + 排序             ← L116-L122
          │    ├── score × LAYER_WEIGHTS[layer]
          │    └── sort(DESC).slice(0, topK)
          │
          ├── [Step 7] LLM 重排序                  ← L125, L387-L439
          │    ├── enrichResults() — 补全内容       ← L350
          │    ├── llm.chatJson(rerankPrompt)
          │    │   model: light, temperature: 0.1
          │    │   → { ranked_indices: [2, 0, 4, 1, 3, ...] }
          │    └── positionBoost 衰减重排
          │
          ├── [Step 8] 查询回写                    ← L128-L130, L443-L463
          │    ├── 检测跨域洞察 (≥2 策略 + ≥2 层级)
          │    ├── readonly 用户 → 跳过 (R-022)
          │    └── enqueueCompile('query_insight', insight, priority=3)
          │
          └── 返回 SearchResponse
                │
                ▼ (Gateway 层)
          enrichResults(results)                    ← L350
          │  ├── L1 → experiences.raw_content
          │  ├── L2 → world_facts.subject + predicate + object
          │  ├── L3 → observations.description
          │  └── L4 → mental_models.[title] + content
          │
          └── JSON → Agent / HTTP Client
```

---

## 13. 数据流总结表

### LLM 调用清单

| 步骤 | 调用 | 模型层级 | 温度 | 用途 |
|------|------|---------|------|------|
| 查询规划 | `llm.chatJson(queryPlannerPrompt)` | light | 0.2 | 分析意图，选择策略 |
| 语义检索 | `llm.embed(query)` | — | — | 查询文本 → 向量 |
| LLM 重排序 | `llm.chatJson(rerankPrompt)` | light | 0.1 | 结果精排 |

> 每次搜索最多 **3 次 LLM 调用**（规划 + embed + 重排序）。LLM 不可用时降级为 0 次。

### 数据库查询清单

| 步骤 | SQL | 表 |
|------|-----|-----|
| L4 摘要 | `SELECT * FROM mental_models WHERE is_active=1` | mental_models |
| FTS5 搜索 | `SELECT FROM memory_fts WHERE MATCH ?` | memory_fts (FTS5 虚拟表) |
| 条件索引 | `SELECT FROM condition_index WHERE condition_key = ?` | condition_index |
| 前缀查找 | `SELECT FROM condition_index WHERE condition_key LIKE ?%` | condition_index |
| 图遍历 | `SELECT FROM memory_links WHERE source_id=? OR target_id=?` | memory_links |
| 时间检索 | `SELECT FROM experiences WHERE created_at >= ? AND <= ?` | experiences |
| 知识页面 | `SELECT FROM knowledge_pages JOIN memory_fts` | knowledge_pages + memory_fts |
| enrichResults | `SELECT FROM experiences/world_facts/observations/mental_models WHERE id=?` | 各层级表 |
| 查询回写 | `INSERT INTO compile_queue` | compile_queue |

---

## 14. 降级策略

MiniMem 的检索管道在每个环节都有降级保护：

| 环节 | 正常模式 | 降级模式 | 触发条件 |
|------|---------|---------|---------|
| 查询规划 | LLM 规划 7 种策略 | 默认 semantic + keyword | `!llm.isAvailable` 或 LLM 调用异常 |
| 语义检索 | embed → 向量搜索 | 跳过该路由 | LLM 不可用 |
| FTS5 搜索 | BM25 全文排序 | 空结果 | 查询语法异常 |
| 图遍历 | BFS 2-hop | 空结果 | 无实体或查询异常 |
| 知识页面 | FTS5 搜索 | LIKE 模糊搜索 | FTS 无结果或异常 |
| LLM 重排序 | LLM 精排 | 保持原始排序 | 结果 ≤3 条或 LLM 不可用 |
| 查询回写 | 写入 compile_queue | 跳过回写 | readonly 用户或异常 |

**完全无 LLM 时的最小可用路径**：
```
searchMemory → planQuery(规则降级) → keywordSearch(FTS5) → 层级加权排序 → 返回
```

---

## 15. 已知问题与优化方向

### ✅ 已修复（2026-04-07）

| # | 问题 | 位置 | 修复方案 |
|---|------|------|---------|
| 1 | **时间检索只覆盖 L1** | `search.ts` temporalSearch | 扩展为四层查询：L1 experiences（按 importance）、L2 world_facts（按 confidence）、L3 observations（按 confidence）、L4 mental_models（按 priority），每层分配 `ceil(limit/4)` 名额，最终按 score 合并排序 |
| 2 | **图遍历只用 `person:` 前缀** | `search.ts` graphSearch | 改为遍历 7 种前缀（person/topic/project/technology/organization/place/event），同时添加 `seenIds` Set 去重，避免同一目标节点被多条边重复命中 |
| 3 | **enrichResults 被调用两次** | `search.ts` + Gateway | `searchMemory()` 内部统一完成 enrichResults（llmRerank 内部调用 + 兜底调用），Gateway 层（MCP Server 的 search_memory/get_relevant_context + REST API 的 /search）不再重复调用 |
| 4 | **BM25 rank 归一化不精确** | `search.ts` keywordSearch | 改为动态归一化：取结果集中 `max(|rank|)` 为分母，`score = |rank| / maxRank`，空结果集返回 `[]`，maxRank=0 时给固定分 0.5 |
| 5 | **~~L2/L3/L4 无向量嵌入~~** | 设计层面 | **文档描述不准确，实际已有嵌入**：L2 在 `processing.ts:128` 生成嵌入，L3 在 `consolidation.ts:99`，L4 在 `consolidation.ts:199`。只是在离线做梦阶段生成，非实时感知阶段 |
| 6 | **查询回写无频率控制** | `search.ts` writebackQueryInsights | 添加 5 分钟冷却窗口：内存 Map 记录 `queryKey → timestamp`，相同查询（lowercase+trim）5 分钟内不重复写入 compile_queue，Map 超过 200 条时自动清理过期条目 |
| 7 | **recall_about 缺乏实体识别优化** | `mcp-server.ts` + `rest-api.ts` | 添加条件索引精确召回：先通过 7 种前缀 `lookupByPrefix` 查找实体，再与 `searchMemory` 语义结果合并去重（精确匹配给 0.95 高分），最终排序取 topK 后 enrichResults |

### 🟢 远期优化方向

| # | 方向 | 描述 |
|---|------|------|
| 1 | **向量索引加速** | 当前 O(n) 暴力扫描，数据量超过 50K 后可考虑引入 HNSW 或 IVF 近似索引（Issue-13） |
| 2 | **FTS5 中文分词** | 当前使用 `unicode61` 分词器，对中文分词效果有限，可考虑接入 jieba 或 simple 分词器 |
| 3 | **查询缓存** | 高频重复查询可引入 LRU 缓存，避免重复的 LLM embed + 六路检索 |

### 📘 概念澄清

#### 温度（Temperature）与层级（Layer）的正交关系（Issue-10）

**温度和层级是两个完全独立的维度**，不要混淆：

| 维度 | 描述 | 值域 | 影响 |
|------|------|------|------|
| **层级（Layer）** | 记忆的抽象程度 | L1（原始经历）→ L4（心智模型） | 检索权重、做梦晋升路径 |
| **温度（Temperature）** | 记忆的活跃程度 | Hot（频繁访问）→ Frozen（长期沉寂） | 存储策略、GC 优先级 |

一条 **L1 经历** 可以是 **Hot** 的（刚写入 24h 内）或 **Frozen** 的（半年没被检索到）。
一条 **L4 心智模型** 通常保持 **Hot**（因为 `planQuery` 每次都加载活跃 L4）。

**检索权重** `LAYER_WEIGHTS = { L4: 1.0, L3: 0.85, L2: 0.7, L1: 0.5 }` 反映的是层级的抽象价值，
**不是**温度的高低。温度只影响 GC 清理优先级和存储压缩级别。

当用户要求原始记录（如"他当时原话怎么说的"）时，检索引擎通过 `raw_recall` 意图检测
自动提升 L1 权重到 1.0（Issue-12），确保原始经历不被高层抽象结果压制。

#### 六路检索策略选择逻辑（Issue-9）

查询规划器会根据查询意图选择 1-6 种检索策略的组合。策略选择逻辑：

| 策略 | 触发条件 | 适用查询 |
|------|---------|---------|
| `semantic_search` | 几乎所有查询 | "关于 X 的信息" |
| `keyword_search` | 几乎所有查询 | 包含明确关键词 |
| `graph_traverse` | 识别到实体 | "Alice 和 Bob 的关系" |
| `temporal_search` | 有时间范围 | "上周发生了什么" |
| `condition_lookup` | 识别到条件键 | "person:Alice 的记忆" |
| `knowledge_page` | 需要结构化知识 | "TypeScript 最佳实践" |

所有策略对 **L1-L4 全层级** 生效。时间检索对 L1 按 importance、L2/L3 按 confidence、L4 按 priority 排序。

#### Frozen 记忆堆积行为（Issue-20）

温度衰减公式 `MAX(0, score - decay)` 确保 score 不会低于 0。score=0 的记忆
停留在 Frozen 状态，不会被自动删除——它们等待 GC 根据存储配额 `gc.storage_quotas.frozen`
清理。这是设计意图：Frozen 层是删除前的缓冲区。

#### 图存储（memory_links）数据来源（Issue-14）

`memory_links` 表中的知识图谱边在以下时机被创建：
- **做梦 Phase 2**（编译）：L1→L2 提取事实时，建立 L1 与 L2 之间的 `derived_from` 链接
- **做梦 Phase 3**（做梦）：向量漫游发现跨域关联时，建立 `related` 链接
- **查询回写**：跨域洞察写入 compile_queue 后，编译时可能建立新链接
- **知识页面编译**：`KnowledgePageEvidence` 关联页面与证据记忆

### 📅 定时任务说明

#### 层级提炼（L1→L4）的定时机制（Issue-16）

层级提炼 **不是独立的定时任务**，而是 **做梦（Dream）流程的一部分**：

| 做梦阶段 | 提炼动作 | 触发时机 |
|---------|---------|---------|
| Phase 2（编译） | L1→L2 事实提取 | daily dream: 20 条，weekly dream: 50 条 |
| Phase 2（编译） | L2→L3 观察归纳 | daily dream: 10 条，weekly dream: 30 条 |
| Phase 2（编译） | L3→L4 心智模型 | **仅 weekly dream**: 15 条（daily 不做 L4 晋升） |
| Phase 4（清理） | Surface Files 更新 | daily 更新 context.md + work.md，weekly 更新全部 |

调度配置：`dream:daily` = `0 3 * * *`（每天凌晨 3 点），`dream:weekly` = `0 4 * * 0`（周日凌晨 4 点）。
此外，攒够 50 条新记忆也会自动触发一次 daily dream。

#### 温度衰减（Hot→Frozen）的定时机制（Issue-17）

温度衰减通过 **GC 系统** 执行，关键定时任务：

| 任务 | cron | 周期 | 执行内容 |
|------|------|------|---------|
| `gc:light` | `0 */6 * * *` | 每 6 小时 | 温度衰减（`decayTemperatures()`）+ 紧急配额检查 |
| `gc:standard` | `0 4 * * *` | 每天凌晨 4 点 | 标准 GC（合并重复 + 清理低温记忆）+ 压缩管线 |
| `gc:deep` | `0 5 * * 0` | 每周日凌晨 5 点 | 深度 GC（全层级配额检查 + 来源信誉衰减）|

温度衰减公式在 `lifecycle/index.ts` 的 `decayTemperatures()` 中：
`UPDATE memory_temperature SET score = MAX(0, score - ?), temperature = ? WHERE ...`

---

## 附录：文件清单与行号索引

| 文件 | 行数 | 角色 |
|------|------|------|
| `src/retrieval/search.ts` | 464 | 检索引擎核心（searchMemory, planQuery, 六路检索, enrichResults, llmRerank, writebackQueryInsights） |
| `src/retrieval/index.ts` | 3 | 模块入口（导出 searchMemory, enrichResults, 类型） |
| `src/gateway/mcp-server.ts` | 903 | MCP Server（search_memory, recall_about, get_relevant_context） |
| `src/gateway/rest-api.ts` | 399 | REST API（GET /memory/search, /memory/recall/:entity） |
| `src/llm/prompts.ts` | 387 | LLM Prompt（queryPlannerPrompt, rerankPrompt） |
| `src/store/vectors.ts` | 392 | 内存向量存储（search, randomWalk） |
| `src/store/indexes.ts` | 104 | 条件索引 + FTS5（lookupByCondition, lookupByPrefix, searchFts） |
| `src/store/graph.ts` | 87 | 知识图谱（traverseGraph — BFS） |
| `src/store/experiences.ts` | 201 | L1 存储（getExperienceById） |
| `src/store/world-facts.ts` | 156 | L2 存储（findFactsBySubject, searchFacts） |
| `src/store/observations.ts` | 108 | L3 存储（getObservationById, findObservationsByType） |
| `src/store/mental-models.ts` | 123 | L4 存储（getActiveMentalModels, getMentalModelById） |
| `src/store/knowledge-pages/page-store.ts` | 193 | 知识页面（searchKnowledgePages — FTS5→LIKE） |
| `src/store/knowledge-pages/compile-queue.ts` | 70 | 编译队列（enqueueCompile — 查询回写目标） |
