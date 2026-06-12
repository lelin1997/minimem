# MiniMem — 记忆写入管线完整剖析

> 从外部调用到落盘存储，一条记忆经历的完整旅程。
> 精确到代码文件、函数签名、行号、SQL 语句和 LLM Prompt。

---

## 总体架构

```
外部调用 (MCP / REST / SDK)
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│  Gateway 层                                                  │
│  rest-api.ts:49   POST /api/v1/memory → ingestMemory()      │
│  mcp-server.ts:445  tool: add_memory  → ingestMemory()      │
│  sdk/index.ts:94    sdk.addMemory()   → POST /api/v1/memory │
└──────────────┬──────────────────────────────────────────────┘
               │ ingestMemory(input)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  感知层 (Perception) — 实时同步执行                           │
│  src/core/perception.ts                                      │
│                                                              │
│  Step 1.  基本验证                                           │
│  Step 2.  文本清洗 cleanText()                               │
│  Step 3.  SHA-256 去重                                       │
│  Step 4.  PII 检测 & 遮罩（14 种模式）                       │
│  Step 5.  LLM 质量门控（light 模型）                         │
│  Step 6.  LLM 重要性评分 ─┐                                 │
│  Step 7.  LLM NER 实体识别 ┘ Promise.allSettled 并行         │
│  Step 8.  LLM Embedding 生成                                 │
│  Step 9.  写入 L1 experiences 表                             │
│  Step 10. 修正向量 memoryId                                  │
│  Step 11. 条件索引 condition_index                           │
│  Step 12. FTS5 全文索引 memory_fts                           │
└──────────────┬──────────────────────────────────────────────┘
               │ 返回 IngestResult (experience + entities + importance)
               │
               │ ═══ 以下为离线异步执行（做梦阶段触发）═══
               ▼
┌─────────────────────────────────────────────────────────────┐
│  加工层 (Processing) — L1→L2 事实提取                        │
│  src/core/processing.ts                                      │
│                                                              │
│  extractFacts(batchSize=10)                                  │
│  · 查询未处理 L1 → LLM 提取三元组 → 去重 → 写入 L2          │
│  · 每条 L2: 条件索引 + FTS + 向量嵌入 + 温度初始化 + 图边    │
└──────────────┬──────────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────┐
│  巩固层 (Consolidation) — L2→L3→L4 提炼                     │
│  src/core/consolidation.ts                                   │
│                                                              │
│  distillObservations()   同 subject ≥3 条事实 → L3 观察      │
│  promoteToMentalModels() 高置信度 L3 → L4 心智模型           │
│  detectConflicts()       同主谓不同宾 / stale 页面           │
└─────────────────────────────────────────────────────────────┘
```

---

## 一、Gateway 入口

### 1.1 REST API — `src/gateway/rest-api.ts`

两个写入端点，都直接调用 `src/core/perception.ts`：

```typescript
// 单条写入 — 第 49-66 行
app.post('/api/v1/memory', async (c) => {
  const body = await c.req.json();
  const result = await ingestMemory({
    content: body.content,
    source: body.source,
    content_type: body.content_type,
    importance: body.importance,
    tags: body.tags,
    participants: body.participants,
    context: body.context,
  });
  return c.json({
    memory_id: result.experience.id,
    layer: 'L1',
    importance: result.importance,
    entities: result.entities.length,
  }, 201);
});

// 批量写入 — 第 68-75 行
app.post('/api/v1/memory/batch', async (c) => {
  const body = await c.req.json();
  const results = await ingestMemoriesBatch(body.memories);
  return c.json({
    added: results.length,
    memory_ids: results.map(r => r.experience.id),
  }, 201);
});
```

### 1.2 MCP Server — `src/gateway/mcp-server.ts`

同样两个 Tool，调用完全相同的函数：

| Tool | 行号 | 调用 |
|------|------|------|
| `add_memory` | 445-458 | `ingestMemory()` |
| `add_memories_batch` | 461-471 | `ingestMemoriesBatch()` |

### 1.3 TypeScript SDK — `src/sdk/index.ts`

```typescript
async addMemory(input: AddMemoryInput): Promise<unknown> {
  return this.post('/api/v1/memory', input);  // HTTP 调用 REST API
}
```

**三个入口殊途同归**：都经过 `ingestMemory()` 这一个函数。

---

## 二、感知层 12 步管线（实时同步）

文件：`src/core/perception.ts`

### Step 1: 基本验证（第 61-67 行）

```typescript
if (!input.content || input.content.trim().length === 0) {
  throw new ValidationError('Content cannot be empty');
}
if (input.content.length > 100_000) {
  throw new ValidationError('Content too long (max 100KB)');
}
```

| 规则 | 阈值 |
|------|------|
| 最小长度 | >0 字符（去空格后） |
| 最大长度 | 100,000 字符（≈100KB） |

### Step 2: 文本清洗（第 70 行 → `cleanText` 第 240-246 行）

```typescript
function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')          // 统一换行符
    .replace(/\n{3,}/g, '\n\n')      // 压缩多余空行（≥3 → 2）
    .replace(/\t/g, '  ')            // Tab → 2 空格
    .trim();                          // 去首尾空白
}
```

### Step 3: 内容去重 — SHA-256 哈希（第 73-77 行）

```typescript
const contentHash = await hashContent(`${input.source}:${content}`);
if (experienceExistsByHash(contentHash)) {
  throw new ValidationError('Duplicate content already exists');
}
```

去重键 = `SHA-256(来源 + ":" + 清洗后内容)`

查询走 `idx_experiences_content_hash` 索引（O(1)）：

```sql
SELECT 1 FROM experiences WHERE content_hash = ?
```

### Step 4: PII 检测与遮罩（第 80-84 行）

**14 种 PII 正则模式**（第 20-35 行定义）：

| # | 名称 | 正则模式 | 匹配目标 |
|---|------|---------|----------|
| 1 | `credit_card` | `\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b` | 信用卡号 |
| 2 | `phone_cn` | `\b1[3-9]\d{9}\b` | 中国手机号 |
| 3 | `phone_intl` | `\+\d{1,3}[\s-]?\d{4,14}\b` | 国际电话 |
| 4 | `id_card_cn` | `\b\d{17}[\dXx]\b` | 身份证号 |
| 5 | `email` | `[A-Za-z0-9._%+-]+@...` | 邮箱地址 |
| 6 | `api_key` | `\b(sk-\|ak-\|key-\|token-\|AKIA)[A-Za-z0-9]{16,}\b` | API 密钥 |
| 7 | `password` | `(?:password\|passwd\|pwd\|密码)\s*[:=]\s*\S+` | 密码字段 |
| 8 | `ssn_us` | `\b\d{3}-\d{2}-\d{4}\b` | 美国 SSN |
| 9 | `passport_cn` | `\b[EeGg]\d{8}\b` | 中国护照 |
| 10 | `bank_account_cn` | `\b\d{16,19}\b` | 银行卡号 |
| 11 | `ip_address` | `\b(?:\d{1,3}\.){3}\d{1,3}\b` | IP 地址 |
| 12 | `jwt_token` | `\beyJ[A-Za-z0-9_-]{10,}\.…` | JWT Token |
| 13 | `private_key` | `-----BEGIN … PRIVATE KEY-----` | 私钥文件 |

**处理策略**：命中后替换为 `[PII_TYPE_MASKED]`，如 `[PHONE_CN_MASKED]`。

```typescript
function detectPII(content: string): { masked: string; detected: string[] } {
  const detected: string[] = [];
  let masked = content;
  for (const { name, pattern } of PII_PATTERNS) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      detected.push(name);
      masked = masked.replace(pattern, `[${name.toUpperCase()}_MASKED]`);
    }
  }
  return { masked, detected };
}
```

### Step 5: 质量门控 — LLM（第 87-107 行）

**触发条件**：`llm.isAvailable && estimateTokens(content) > 5`

```typescript
const qualityResult = await llm.chatJson<{ accept: boolean; reason: string }>({
  messages: qualityGatePrompt(content),
  tier: 'light',           // 轻量模型（qwen-turbo 等）
  temperature: 0.1,        // 低随机性
  fallback: { accept: true, reason: 'LLM fallback' },
});
```

**Prompt 模板**（`src/llm/prompts.ts` 第 81-101 行）：

```
判断以下内容是否值得存入长期记忆。

拒绝的情况：
- 纯问候/客套话（"你好"、"谢谢"）
- 无实质信息的确认（"好的"、"明白了"）
- 纯代码无注释无上下文
- 重复的系统消息
- 无法理解的乱码

返回 JSON: { "accept": true/false, "reason": "一句话解释" }
```

**降级策略**：LLM 调用失败时**放行**（不阻塞写入）。

### Step 6 + 7: 重要性评分 + NER（并行执行，第 110-144 行）

```typescript
const [importanceResult, nerResult] = await Promise.allSettled([
  // 重要性评分（用户未指定时才调 LLM）
  input.importance === undefined
    ? llm.chatJson<{ importance: number; reason: string }>({
        messages: importanceScoringPrompt(content, input.context),
        tier: 'light', temperature: 0.1,
        fallback: { importance: 0.5, reason: 'default' },
      })
    : Promise.resolve(null),
  // NER 实体识别
  llm.chatJson<{ entities: [...] }>({
    messages: nerPrompt(content),
    tier: 'light', temperature: 0.1,
    fallback: { entities: [] },
  }),
]);
```

#### 重要性评分 Prompt（`prompts.ts` 第 54-76 行）

```
评分标准 (0-1)：
┌────────────┬──────────────────────────────┐
│ 0.9 - 1.0  │ 改变人生/重大决策/核心身份信息 │
│ 0.7 - 0.8  │ 重要偏好/关键关系/专业知识     │
│ 0.5 - 0.6  │ 一般对话/日常事件/常见话题     │
│ 0.3 - 0.4  │ 琐碎信息/临时上下文           │
│ 0.0 - 0.2  │ 噪音/无意义内容               │
└────────────┴──────────────────────────────┘
返回 JSON: { "importance": 0.7, "reason": "一句话解释" }
```

结果钳制到 `[0, 1]`：`Math.max(0, Math.min(1, result.importance))`

#### NER 实体识别 Prompt（`prompts.ts` 第 106-133 行）

```
实体类型：
- person: 人名
- project: 项目/产品名
- technology: 技术/工具/语言
- organization: 组织/公司
- place: 地点
- event: 事件
- topic: 话题/主题

返回 JSON: {
  "entities": [
    { "text": "实体文本", "type": "person", "condition_key": "person:xxx" }
  ]
}
```

**两者任一失败不影响写入**，`Promise.allSettled` 保证独立处理。

### Step 8: Embedding 生成（第 147-159 行）

```typescript
const embResult = await llm.embed(content);  // OpenAI 兼容 /embeddings API
embeddingId = generateId();
const vectorStore = getVectorStore();
vectorStore.add(embeddingId, '', 'L1', embResult.embedding, { source: input.source });
```

- 先用**空 memoryId** 占位（此时还没有 experience.id）
- 失败时标记 `embeddingFailed = true`

### Step 9: 写入 L1 — `createExperience()`（第 162-172 行）

调用 `src/store/experiences.ts:31`：

```sql
INSERT INTO experiences (
  id, raw_content, content_type, source, importance,
  tags, participants, context, content_hash, embedding_id,
  branch, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?, ?)
```

| 字段 | 来源 |
|------|------|
| `id` | `generateId()` — ULID 生成 |
| `raw_content` | PII 遮罩后的文本 |
| `content_type` | 默认 `'conversation'` |
| `importance` | LLM 评分或用户指定 |
| `tags` | JSON 数组 |
| `content_hash` | SHA-256 |
| `embedding_id` | 向量 ID |
| `branch` | 固定 `'main'` |

### Step 10: 修正 Embedding memoryId（第 175-179 行）

```typescript
if (embeddingId) {
  vectorStore.delete(embeddingId);                 // 删除空 memoryId 的旧向量
  const emb = await llm.embed(content);            // 重新 embed
  vectorStore.add(embeddingId, experience.id, 'L1', emb.embedding, { source: input.source });
}
```

> ⚠️ **注意**：这里重复调用了一次 `embed()`，可优化为复用 Step 8 的结果。

### Step 11: 条件索引更新（第 183-187 行）

```typescript
for (const entity of entities) {
  addConditionIndex(entity.condition_key, 'L1', experience.id);
}
```

写入 `condition_index` 表：

```sql
INSERT OR IGNORE INTO condition_index (condition_key, memory_type, memory_id)
VALUES (?, ?, ?)
```

例如：`("person:alice", "L1", "01HXZ...")`, `("topic:typescript", "L1", "01HXZ...")`

### Step 12: FTS5 全文索引（第 190 行）

```typescript
addToFts(experience.id, 'L1', content, input.tags ?? [], conditionKeys);
```

```sql
INSERT INTO memory_fts (memory_id, memory_type, content, tags, condition_keys)
VALUES (?, ?, ?, ?, ?)
```

### 额外: Embedding 回填队列（第 193-205 行）

当 Step 8 嵌入失败时，写入编译队列等做梦时补齐：

```sql
INSERT INTO compile_queue (id, source_type, content, target_page, priority, status, created_at)
VALUES (?, 'embedding_backfill', ?, NULL, 8, 'pending', ?)
```

### 批量写入 `ingestMemoriesBatch`（第 225-236 行）

**串行循环** `ingestMemory`，单条失败不影响整批：

```typescript
for (const input of inputs) {
  try {
    const result = await ingestMemory(input);
    results.push(result);
  } catch (err) {
    log.warn({ err, source: input.source }, 'Batch ingest item failed');
  }
}
```

---

## 三、感知层返回值

```typescript
interface IngestResult {
  experience: Experience;    // L1 记录对象
  entities: Array<{          // NER 识别的实体
    text: string;
    type: string;            // person/project/technology/...
    condition_key: string;   // person:xxx
  }>;
  pii_detected: string[];   // 检测到的 PII 类型
  importance: number;        // 最终重要性分数 (0-1)
}
```

Gateway 返回给客户端的是精简版：

```json
{
  "memory_id": "01HXZ...",
  "layer": "L1",
  "importance": 0.7,
  "entities": 3
}
```

---

## 四、LLM 调用汇总（单次 ingestMemory）

一次完整的 `ingestMemory` 最多发起 **4 次 LLM 调用 + 2 次 Embedding**：

| # | 用途 | Tier | Temperature | 条件 | 失败策略 |
|---|------|------|-------------|------|---------|
| 1 | 质量门控 | `light` | 0.1 | token > 5 | 放行 |
| 2 | 重要性评分 | `light` | 0.1 | 用户未指定 importance | 默认 0.5 |
| 3 | NER 实体识别 | `light` | 0.1 | LLM 可用 | 空列表 |
| 4 | Embedding (Step 8) | — | — | LLM 可用 | 标记回填 |
| 5 | Embedding (Step 10) | — | — | Step 8 成功 | — |

> 第 2+3 通过 `Promise.allSettled` 并行，不互相阻塞。
> 第 4+5 实际上重复了一次 embed 调用（可优化点）。

---

## 五、加工层 — L1→L2 事实提取（离线异步）

文件：`src/core/processing.ts`

**触发时机**：做梦 Phase 1（由 scheduler 定时触发或手动 `trigger_dream`），**不在写入管线中同步执行**。

### 5.1 获取未处理的 L1

```typescript
export async function extractFacts(batchSize: number = 10): Promise<ProcessingResult> {
  const experiences = getUnprocessedExperiences(batchSize);
```

```sql
SELECT e.* FROM experiences e
WHERE e.branch = 'main'
  AND e.id NOT IN (
    SELECT json_each.value
    FROM world_facts wf, json_each(wf.evidence_experience_ids)
  )
ORDER BY e.created_at ASC LIMIT ?
```

> "未处理" = 没有任何 L2 事实引用这条经历的 ID。

### 5.2 LLM 事实提取

```typescript
const result = await llm.chatJson<{ facts: ExtractedFact[] }>({
  messages: factExtractionPrompt(experiences.map(e => ({ id: e.id, content: e.raw_content }))),
  tier: 'medium',           // 中等模型（qwen-plus 等）
  temperature: 0.3,
  fallback: { facts: [] },
});
```

**Prompt 模板**（`prompts.ts` 第 10-49 行）：

```
系统角色：精确的事实提取器

规则：
1. 每个事实必须是 (主语, 谓语, 宾语) 三元组
2. 只提取明确表述的事实，不要推测
3. 人名、项目名等实体保持原文
4. 为每个事实生成条件索引键（如 "person:alice", "topic:typescript"）
5. 评估每个事实的置信度 (0-1)
6. 如果事实有时间限制，标注 valid_from 和 valid_until

返回 JSON:
{
  "facts": [
    {
      "subject": "主语",
      "predicate": "谓语",
      "object": "宾语",
      "confidence": 0.9,
      "valid_from": null,
      "valid_until": null,
      "evidence_ids": ["来源经历ID"],
      "condition_keys": ["person:xxx"]
    }
  ]
}
```

### 5.3 事实去重（第 88-99 行）

```sql
SELECT 1 FROM world_facts
WHERE subject = ? AND predicate = ? AND object = ? AND branch = 'main'
LIMIT 1
```

精确匹配三元组 `(subject, predicate, object)`，已存在则跳过。

### 5.4 批量写入 L2

```sql
INSERT INTO world_facts (
  id, subject, predicate, object, confidence,
  valid_from, valid_until, evidence_experience_ids, condition_keys,
  source, branch, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?, ?)
```

### 5.5 每条 L2 的后处理（第 112-165 行）

对每条新创建的 L2 事实，执行 **6 步索引构建**：

```
L2 事实写入
  │
  ├─→ 条件索引  addConditionIndex(key, 'L2', fact.id)
  │     → INSERT INTO condition_index
  │
  ├─→ FTS 索引   addToFts(fact.id, 'L2', "subject predicate object", ...)
  │     → INSERT INTO memory_fts
  │
  ├─→ 向量嵌入  llm.embed("subject predicate object")
  │     → vectorStore.add(embId, fact.id, 'L2', embedding)
  │
  ├─→ 温度初始化 initTemperature(fact.id, 'L2', confidence)
  │     → INSERT INTO memory_temperature
  │     │  score = confidence × 100 + 20
  │     │  ≥80 → hot, ≥60 → warm, ≥40 → cool, ≥20 → cold, <20 → frozen
  │
  ├─→ 图边：来源  createLink(fact.id, 'L2', evidenceId, 'L1', 'derived_from', 0.9)
  │     → INSERT INTO memory_links
  │
  ├─→ 图边：同批关联  如果同 subject/object → createLink(..., 'related', 0.6)
  │
  └─→ 图边：跨批关联  findFactsBySubject() → createLink(..., 'related', 0.5)
```

### 5.6 批量处理 `processAllPending`（第 185-204 行）

```typescript
export async function processAllPending(batchSize = 10, maxBatches = 10) {
  for (let i = 0; i < maxBatches; i++) {
    const result = await extractFacts(batchSize);
    if (result.processed_experiences === 0) break;
  }
}
```

最多处理 10 批 × 10 条 = **100 条积压**。

---

## 六、巩固层 — L2→L3→L4 提炼（离线异步）

文件：`src/core/consolidation.ts`

### 6.1 L2→L3: `distillObservations(limit=20)`

**条件**：同一 `subject` 下有 ≥3 条置信度 ≥0.5 的事实。

```sql
SELECT subject, COUNT(*) as fact_count
FROM world_facts
WHERE branch = 'main' AND confidence >= 0.5
GROUP BY subject
HAVING COUNT(*) >= 3
```

LLM 分析事实群，提取 `pattern`/`preference`/`habit`/`insight`/`trend`：

```
分析以下关于"alice"的事实，提取一个高层次的观察或模式。
返回 JSON: { "description": "描述", "type": "pattern|...", "confidence": 0.8 }
```

写入 `observations` 表 + L3 向量嵌入 + 温度初始化 + FTS 索引。

### 6.2 L3→L4: `promoteToMentalModels(limit=10)`

**条件**：≥2 条置信度 ≥0.7 的 L3 观察。

LLM 归纳为 `principle`/`rule`/`belief`/`value`/`preference`：

```
归纳出一条高层心智模型（原则、规则或信念）。
返回 JSON: { "title": "标题", "content": "描述", "type": "principle|...",
             "scope": "global|work|social|life", "priority": 1-10 }
```

写入 `mental_models` 表 + L4 向量嵌入 + 温度初始化（初始 0.8）+ FTS 索引。

### 6.3 冲突检测: `detectConflicts()`

两种冲突类型：

| 类型 | 检测逻辑 | SQL |
|------|---------|-----|
| `fact_contradiction` | 同 subject + predicate，不同 object | `a.subject = b.subject AND a.predicate = b.predicate AND a.object != b.object` |
| `page_outdated` | Knowledge Page lint_status = 'conflicted' 或 staleness > 0.7 | `lint_status = 'conflicted' OR staleness_score > 0.7` |

---

## 七、Store 层详解

### 7.1 数据库 — `src/store/database.ts`

```typescript
_db = new Database(resolvedPath);           // better-sqlite3

// 性能优化
_db.pragma('journal_mode = WAL');           // 并发读写
_db.pragma('synchronous = NORMAL');
_db.pragma('busy_timeout = 5000');
_db.pragma('cache_size = -64000');          // 64MB
_db.pragma('foreign_keys = ON');
_db.pragma('temp_store = MEMORY');
```

### 7.2 四层存储文件

| 文件 | 表 | 写入函数 | 调用时机 |
|------|------|---------|---------|
| `experiences.ts` | `experiences` | `createExperience()` | 感知层 Step 9 |
| `world-facts.ts` | `world_facts` | `createWorldFactsBatch()` | 加工层 extractFacts |
| `observations.ts` | `observations` | 直接 SQL | 巩固层 distillObservations |
| `mental-models.ts` | `mental_models` | 直接 SQL | 巩固层 promoteToMentalModels |

### 7.3 向量存储 — `src/store/vectors.ts`

**架构**：内存 `Map<string, VectorEntry>` 为主，磁盘 JSON 持久化为辅。

```typescript
class MemoryVectorStore {
  private vectors: Map<string, VectorEntry>;  // id → { vector: Float32Array, ... }
}
```

| 操作 | 复杂度 | 说明 |
|------|--------|------|
| `add()` | O(1) | 写入内存 Map |
| `search()` | O(n) | 暴力余弦相似度扫描 |
| `randomWalk()` | O(n) | cos sim 在 [0.3, 0.7] 区间的候选 + 随机打乱 |
| `delete()` | O(1) | Map 删除 |

**持久化策略**（R-002）：

```
自动保存触发条件：
├─ 周期性：每 5 分钟检查一次，有脏数据则保存
└─ 阈值：更新 100 次后立即保存

保存格式：data/vectors/vector-index.json
├─ Float32Array → number[] 序列化
└─ 重启后从 JSON 加载恢复
```

### 7.4 条件索引 — `src/store/indexes.ts`

```sql
-- O(1) 查找
CREATE TABLE condition_index (
  condition_key TEXT NOT NULL,    -- e.g. "person:alice"
  memory_type TEXT NOT NULL,      -- 'L1' | 'L2' | 'L3' | 'L4'
  memory_id TEXT NOT NULL,
  PRIMARY KEY (condition_key, memory_type, memory_id)
);
```

### 7.5 FTS5 全文搜索

```sql
CREATE VIRTUAL TABLE memory_fts USING fts5(
  memory_id, memory_type, content, tags, condition_keys,
  tokenize='unicode61'           -- Unicode 分词
);
```

### 7.6 知识图谱 — `src/store/graph.ts`

```sql
CREATE TABLE memory_links (
  source_id TEXT, source_type TEXT,
  target_id TEXT, target_type TEXT,
  link_type TEXT DEFAULT 'related',  -- 'derived_from' | 'related'
  weight REAL DEFAULT 0.5
);
```

边类型：

| link_type | weight | 含义 |
|-----------|--------|------|
| `derived_from` | 0.9 | L2 来源于 L1 |
| `related` | 0.6 | 同批次同 subject/object |
| `related` | 0.5 | 跨批次同 subject |

图遍历：BFS N 跳（默认 2 跳，最多 50 结果）。

### 7.7 Knowledge Pages — `src/store/knowledge-pages/`

| 文件 | 职责 |
|------|------|
| `page-store.ts` | 知识页面 CRUD，版本历史，FTS 降级搜索 |
| `link-store.ts` | `[[backlink]]` 反向链接，`syncBacklinks()` 解析 `[[slug]]` 语法 |
| `evidence-store.ts` | 页面 ↔ 证据（L1/L2/L3）关联管理 |
| `compile-queue.ts` | 编译队列：入队 → 按优先级出队 → 标记已处理 |

---

## 八、温度初始化

文件：`src/lifecycle/index.ts`（第 36-43 行）

```typescript
export function initTemperature(memoryId: string, memoryType: string, importance: number = 0.5): void {
  const score = Math.min(100, importance * 100 + 20);  // 公式：初始分 = importance×100 + 基础 20 分

  db.prepare(`
    INSERT OR IGNORE INTO memory_temperature (...)
    VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)
  `).run(memoryId, memoryType, scoreToLevel(score), score, now(), now());
}
```

温度等级映射：

```
分数 ≥ 80  →  🔥 hot     (新记忆/高重要性)
分数 ≥ 60  →  🟧 warm    (中等重要)
分数 ≥ 40  →  🟦 cool    (一般)
分数 ≥ 20  →  🧊 cold    (低重要)
分数 < 20  →  ❄️ frozen  (极低/待清理)
```

> **关键发现**：感知层（L1 写入）中**没有调用** `initTemperature`。温度初始化**仅在** L2（加工层）和 L3/L4（巩固层）写入时执行。L1 记忆没有温度记录，直到被提炼为 L2 时才获得温度。

---

## 九、自动触发做梦 — 当前状态

文件：`src/scheduler/index.ts`（第 255-274 行）

```typescript
let newMemoryCount = 0;

export function incrementMemoryCount(): void {
  newMemoryCount++;
  if (newMemoryCount >= DEFAULT_CONFIG.dreaming.auto_trigger_count) { // 阈值 = 50
    newMemoryCount = 0;
    import('../modules/dream/dream-engine.js').then(mod => {
      mod.triggerDream([1, 2, 3, 4]).catch(err => { ... });
    });
  }
}
```

> ✅ **已接线**（Wave 1 修复）：`incrementMemoryCount` 已在 `perception.ts` 的 `ingestMemory()` L1 写入后调用。阈值从固定 50 改为梯度化：记忆 <100 时每 10 条触发，100-500 时每 25 条，>500 时每 50 条。配置项统一为 `auto_trigger_threshold`。

---

### Surface Files 更新机制（Wave 1-2 完善后）

Surface Files 现有**三条更新路径**（不再 100% 依赖 Dream Engine）：

| # | 路径 | 触发方式 | 说明 |
|---|------|---------|------|
| 1 | **Dream Phase 4** | Dream 日做梦/周做梦 | 消费 `surface_update_queue` + 调用各 Syncer |
| 2 | **定时独立消费** | `surface:auto-process` 定时任务（每 6h） | 独立于 Dream，直接消费 `surface_update_queue` |
| 3 | **即时更新** | `suggest_surface_update` MCP 工具 `immediate=true` | 绕过队列，直接调用 `smartUpdateSurfaceFile()` |

已注册的 Syncer（8 个）：

| Syncer | 对应文件 | 数据源 |
|--------|---------|--------|
| me-syncer | `me.md` | Owner Profile（identity/preferences） |
| soul-syncer | `soul.md` | L3 观察 + L4 心智模型归纳 |
| work-syncer | `work.md` | 工作任务 + 近期 work 标签记忆 |
| social-syncer | `social.md` | Person Profiles + 社交相关记忆 |
| life-syncer | `life.md` | 非工作类 L1 记忆 |
| agent-syncer | `agent.md` | 系统配置 + MCP tools + `_meta` + `owner_profile` |
| context-syncer | `context.md` | 最近交互上下文 |
| index-syncer | `index.md` | 各层记忆数量 + Surface 概览 + 最近 Dream |

Daily Dream 更新 `context.md` + `work.md` + `agent.md` + 有变化的 Syncer（条件性更新）。
Weekly Dream 更新全部 8 个文件。

---

## 十、完整时序图

```
Client              Gateway              Perception             Store             LLM
  │                   │                     │                    │                  │
  ├─ POST /memory ───►│                     │                    │                  │
  │                   ├─ ingestMemory() ───►│                    │                  │
  │                   │                     │                    │                  │
  │                   │   Step 1: validate  │                    │                  │
  │                   │   Step 2: cleanText │                    │                  │
  │                   │   Step 3: hash ─────├── existsByHash? ──►│                  │
  │                   │                     │◄── false ──────────│                  │
  │                   │   Step 4: PII mask  │                    │                  │
  │                   │                     │                    │                  │
  │                   │   Step 5: ──────────├────────────────────├──► qualityGate   │
  │                   │                     │◄───────────────────├──  {accept:true} │
  │                   │                     │                    │                  │
  │                   │   Step 6+7: ────────├────────────────────├──► importance ───┤
  │                   │   (并行)            │                    │    + NER         │
  │                   │                     │◄───────────────────├──  {0.7, [...]}  │
  │                   │                     │                    │                  │
  │                   │   Step 8: ──────────├────────────────────├──► embed()       │
  │                   │                     │◄───────────────────├──  [0.1, 0.3,...] │
  │                   │                     ├─ vectorStore.add() ►│                  │
  │                   │                     │                    │                  │
  │                   │   Step 9: ──────────├── createExperience ►│                  │
  │                   │                     │   INSERT experiences│                  │
  │                   │                     │                    │                  │
  │                   │   Step 10: ─────────├─ vector fix ───────►│                  │
  │                   │   Step 11: ─────────├─ condition_index ──►│                  │
  │                   │   Step 12: ─────────├─ memory_fts ───────►│                  │
  │                   │                     │                    │                  │
  │                   │◄─ IngestResult ─────│                    │                  │
  │◄─ 201 { id } ────│                     │                    │                  │
  │                   │                     │                    │                  │
  │    ═══ 后续做梦阶段（定时/手动触发）═══  │                    │                  │
  │                   │                     │                    │                  │
  │    Processing     ├─ extractFacts() ───►│                    │                  │
  │                   │                     ├─ getUnprocessed() ►│                  │
  │                   │                     ├───────────────────►├──► factExtract   │
  │                   │                     │◄──────────────────►├── {facts:[...]}  │
  │                   │                     ├─ dedup check ─────►│                  │
  │                   │                     ├─ createWorldFacts ►│                  │
  │                   │                     ├─ indexes ─────────►│                  │
  │                   │                     ├─ embed ───────────►├──► L2 embed      │
  │                   │                     ├─ initTemp ────────►│                  │
  │                   │                     ├─ createLink ──────►│                  │
  │                   │                     │                    │                  │
  │    Consolidation  ├─ distillObs() ─────►│                    │                  │
  │                   │                     ├─ subject ≥3? ─────►│                  │
  │                   │                     ├───────────────────►├──► L3 distill    │
  │                   │                     ├─ INSERT obs ──────►│                  │
  │                   │                     │                    │                  │
  │                   ├─ promoteMental() ──►│                    │                  │
  │                   │                     ├─ conf ≥0.7? ──────►│                  │
  │                   │                     ├───────────────────►├──► L4 promote    │
  │                   │                     ├─ INSERT models ───►│                  │
```

---

## 十一、写入触发的存储变更汇总

一次 `ingestMemory` 成功后，以下存储发生了变化：

### 实时同步（感知层）

| # | 存储位置 | 操作 | 数据 |
|---|---------|------|------|
| 1 | `experiences` 表 | INSERT | 1 行（L1 记忆） |
| 2 | 内存向量存储 | add | 1 个 float32 向量 |
| 3 | `condition_index` 表 | INSERT × N | N 个实体的条件键 |
| 4 | `memory_fts` 虚拟表 | INSERT | 1 行全文索引 |
| 5 | `compile_queue` 表 | INSERT（仅嵌入失败时） | 回填任务 |

### 离线异步（做梦阶段）

| # | 存储位置 | 操作 | 数据 |
|---|---------|------|------|
| 6 | `world_facts` 表 | INSERT × M | M 条三元组事实 |
| 7 | `condition_index` 表 | INSERT × K | K 个 L2 条件键 |
| 8 | `memory_fts` 虚拟表 | INSERT × M | M 行 L2 全文索引 |
| 9 | 内存向量存储 | add × M | M 个 L2 向量 |
| 10 | `memory_temperature` 表 | INSERT × M | M 行温度记录 |
| 11 | `memory_links` 表 | INSERT × P | P 条图边 |
| 12 | `observations` 表 | INSERT（可能） | L3 观察 |
| 13 | `mental_models` 表 | INSERT（可能） | L4 心智模型 |

---

## 十二、已知问题与优化点

### ✅ 已修复（2026-04-07）

| # | 问题 | 位置 | 修复方案 |
|---|------|------|---------|
| 1 | **Embedding 重复调用** | perception.ts Step 8+10 | Step 8 的 embedding 结果缓存到 `cachedEmbedding`，Step 10 复用而非重新调用 |
| 2 | ~~**incrementMemoryCount 未接线**~~ ✅ 已修复 | perception.ts / scheduler | `ingestMemory` L1 写入后已调用 `incrementMemoryCount()`，梯度化阈值（10/25/50），配置统一为 `auto_trigger_threshold` |
| 3 | **L1 无温度记录** | perception.ts | L1 写入后添加 `initTemperature(experience.id, 'L1', importance)` 调用 |
| 4 | **批量写入串行** | perception.ts | `ingestMemoriesBatch` 改为 `Promise.allSettled` 并发（concurrency=5） |
| 5 | **向量索引 O(n)** | vectors.ts | 预计算 L2 范数存入 `norm` 字段，`cosineSimilarityWithNorms()` 减少运算量 |
| 6 | **审计中间件未挂载** | rest-api.ts | 添加 `app.use('/api/*', auditMiddleware())` |
| 7 | **限流中间件未挂载** | rest-api.ts | 添加 `app.use('/api/*', rateLimiterMiddleware())` |

---

## 十三、LLM 客户端架构

文件：`src/llm/client.ts`

```typescript
class LLMClient {
  private baseUrl: string;           // config.llm.base_url
  private apiKey: string;            // env[config.llm.api_key_env]
  private models: {
    heavy: string,                   // gpt-4o / claude-3.5-sonnet / qwen-max
    medium: string,                  // gpt-4o-mini / qwen-plus
    light: string,                   // qwen-turbo / gpt-3.5-turbo
  };
}
```

| 方法 | 用途 | 接口 |
|------|------|------|
| `chat()` | 通用对话 | OpenAI `/chat/completions` |
| `chatJson<T>()` | JSON 模式 + 自动解析 + fallback | 同上 + `response_format: json_object` |
| `embed()` | 单条嵌入 | OpenAI `/embeddings` |
| `embedBatch()` | 批量嵌入（串行） | 逐个调用 `embed()` |
| `isAvailable` | API Key 是否配置 | 检查 `this.apiKey` |

**降级策略**：API Key 未配置时 `isAvailable = false`，所有 LLM 步骤跳过，记忆仍能写入但：
- 无质量门控（全部放行）
- 重要性默认 0.5
- 无 NER 实体（无条件索引）
- 无 Embedding（无语义检索）

---

*文件生成时间：2026-04-07*
*基于 minimem v0.1.0 代码分析*
