# MiniMem — Knowledge Pages / Owner Profile / Work / Social 模块完整剖析

> 补充覆盖 INGEST/RETRIEVAL/SCHEDULER 三大文档未深入展开的业务模块。
> 精确到代码文件、函数签名、行号、SQL 语句和 LLM Prompt。

---

## 目录

1. [Knowledge Pages（Karpathy Compile）](#1-knowledge-pages)
   - 1.1 [模块架构总览](#11-模块架构总览)
   - 1.2 [page-store.ts — 知识页面 CRUD](#12-page-storets)
   - 1.3 [link-store.ts — 反向链接管理](#13-link-storets)
   - 1.4 [evidence-store.ts — 证据链管理](#14-evidence-storets)
   - 1.5 [compile-queue.ts — 编译队列](#15-compile-queuets)
   - 1.6 [compiler.ts — Karpathy Compile 执行引擎](#16-compilerts)
   - 1.7 [auditor.ts — Knowledge Page Lint](#17-auditorts)
   - 1.8 [完整数据流图](#18-完整数据流图)
2. [Owner / Person Profile](#2-owner--person-profile)
   - 2.1 [profile.ts — Owner KV 存储引擎](#21-profilets)
   - 2.2 [preferences.ts — 偏好推断系统](#22-preferencests)
   - 2.3 [persons.ts — 人设画像管理](#23-personsts)
   - 2.4 [三者协作关系](#24-三者协作关系)
3. [Work 工作模块](#3-work-工作模块)
   - 3.1 [tasks.ts — 任务管理 CRUD](#31-tasksts)
   - 3.2 [priority.ts — 智能优先级排序](#32-priorityts)
   - 3.3 [daily-summary.ts — 日终总结](#33-daily-summaryts)
   - 3.4 [weekly-review.ts — 周回顾报告](#34-weekly-reviewts)
4. [Social 社交模块](#4-social-社交模块)
   - 4.1 [chat-summary.ts — 聊天摘要提取](#41-chat-summaryts)
   - 4.2 [persona-builder.ts — 人设画像自动构建](#42-persona-builderts)
   - 4.3 [relationships.ts — 关系图谱管理](#43-relationshipsts)
   - 4.4 [topic-tracker.ts — 话题追踪](#44-topic-trackerts)
5. [全模块交叉引用](#5-全模块交叉引用)
6. [已知设计缺陷与优化建议](#6-已知设计缺陷与优化建议)

---

## 1. Knowledge Pages

### 1.1 模块架构总览

```
                          ┌─────────────────────────────────────┐
                          │  compile_queue 表                    │
                          │  (pending → compiled/skipped)       │
                          └────────┬───────────┬────────────────┘
                        enqueueCompile()      getPendingCompileItems()
                                 ▲                     │
         ┌───────────────┬───────┤                     ▼
         │               │       │         ┌───────────────────────┐
  search.ts         dreamer.ts  auditor.ts │  compiler.ts          │
  (查询回写)       (做梦 L1→L2)  (lint发现)│  processCompileQueue()│
                                           │  ┌─────────────────┐  │
                                           │  │ LLM 编译决策    │  │
                                           │  │ create_page     │  │
                                           │  │ update_page     │  │
                                           │  └────────┬────────┘  │
                                           └───────────┼───────────┘
                                                       │
                                                       ▼
                          ┌─────────────────────────────────────┐
                          │  knowledge_pages 表                  │
                          │  + knowledge_page_versions (历史)    │
                          │  + knowledge_page_links (反向链接)   │
                          │  + knowledge_page_evidence (证据链)  │
                          └─────────────────────────────────────┘
```

**文件清单**（5 文件 + 2 消费方）：

| 文件 | 行数 | 导出函数 | 职责 |
|------|------|----------|------|
| `src/store/knowledge-pages/page-store.ts` | 193 | 9 | 知识页面 CRUD、版本历史、FTS 降级搜索 |
| `src/store/knowledge-pages/link-store.ts` | 105 | 6 | `[[backlink]]` 反向链接管理 |
| `src/store/knowledge-pages/evidence-store.ts` | 57 | 4 | 页面 ↔ 证据（L1/L2/L3）关联 |
| `src/store/knowledge-pages/compile-queue.ts` | 70 | 5 | 编译队列入队/出队/批量标记 |
| `src/store/knowledge-pages/index.ts` | 5 | 24（re-export） | 统一导出 |
| `src/modules/dream/compiler.ts` | 244 | 1（`runCompile`） | Phase 2 编译执行引擎 |
| `src/modules/dream/auditor.ts` | 201 | 1（`runAudit`） | Phase 1 审计 + Knowledge Page Lint |

---

### 1.2 page-store.ts

**文件**: `src/store/knowledge-pages/page-store.ts`（193 行）

#### 类型定义

```typescript
// src/common/types.ts L69-91
type PageType = 'person' | 'topic' | 'project' | 'concept' | 'skill' | 'place' | 'event_series';
type LintStatus = 'healthy' | 'stale' | 'orphaned' | 'conflicted' | 'missing';

interface KnowledgePage {
  id: string;
  slug: string;           // 唯一标识，如 "alice-chen"
  title: string;
  page_type: PageType;    // 7 种页面类型
  content: string;        // Markdown + [[backlink]] 语法
  compile_count: number;  // 编译次数
  last_compiled: string | null;
  lint_status: LintStatus; // 5 种健康状态
  staleness_score: number; // 0-1 陈旧度
  confidence: number;      // 0-1 置信度
  embedding_id: string | null;
  snapshot_id: string | null;
  branch: string;          // 版本分支
  created_at: string;
  updated_at: string;
}
```

#### 函数逐一剖析

##### `createKnowledgePage()` — L23-L43

```
输入: { title, slug?, page_type?, content, confidence? }
  │
  ├── generateId() → ULID
  ├── slug = input.slug ?? slugify(input.title)  ← 自动生成 slug
  │
  └── INSERT INTO knowledge_pages
        (id, slug, title, page_type, content,
         compile_count=1, last_compiled=now,
         lint_status='healthy', staleness_score=0.0,
         confidence=0.5, branch='main',
         created_at, updated_at)
      │
      └── return getKnowledgePageById(id)!  ← 回查确保一致性
```

**关键设计点**：
- `compile_count` 初始为 1（创建本身视为第一次编译）
- `lint_status` 初始为 `'healthy'`
- `branch` 固定为 `'main'`（支持版本分支但默认主分支）

##### `updateKnowledgePageContent()` — L67-L85（R-013）

```
输入: (id, newContent)
  │
  ├── 读取当前 content + compile_count
  │
  ├── ⚠️ R-013: 保存版本历史
  │   INSERT INTO knowledge_page_versions
  │     (id, page_id, version=compile_count, content=旧内容, created_at)
  │
  └── UPDATE knowledge_pages SET
        content = newContent,
        compile_count = compile_count + 1,  ← 递增
        last_compiled = now,
        staleness_score = 0.0,               ← 重置陈旧度
        lint_status = 'healthy',             ← 重置健康状态
        updated_at = now
```

**⚠️ 设计亮点**：每次更新前自动保存旧版本到 `knowledge_page_versions` 表，实现完整变更追踪。

##### `searchKnowledgePages()` — L130-L164（R-017）

```
输入: (query, limit=10)
  │
  ├── 第 1 层: FTS5 搜索（优先）
  │   SELECT DISTINCT kp.* FROM knowledge_pages kp
  │   WHERE kp.branch = 'main' AND kp.id IN (
  │     SELECT memory_id FROM memory_fts
  │     WHERE memory_fts MATCH ? AND memory_type IN ('L3', 'L4')
  │   )
  │   ORDER BY kp.confidence DESC LIMIT ?
  │   │
  │   ├── 有结果 → 直接返回
  │   └── 无结果 / 异常 → 降级
  │
  └── 第 2 层: LIKE 降级（兜底）
      SELECT * FROM knowledge_pages
      WHERE branch='main' AND (title LIKE ? OR content LIKE ? OR slug LIKE ?)
      ORDER BY confidence DESC LIMIT ?
```

**⚠️ 注意**：FTS5 搜索是间接的——通过 `memory_fts` 表匹配 L3/L4 类型的记忆，再关联到知识页面。这意味着只有被索引到 FTS 的页面才能被 FTS 检索到。

##### 其他函数速览

| 函数 | 行号 | SQL | 要点 |
|------|------|-----|------|
| `getKnowledgePageById(id)` | L48 | `SELECT * WHERE id = ?` | 精确查找 |
| `getKnowledgePageBySlug(slug)` | L57 | `SELECT * WHERE slug = ?` | 按 slug 查（编译器常用） |
| `updateLintStatus(id, status, staleness?)` | L90 | 动态 SET 子句 | 审计时调用 |
| `getAllKnowledgePages()` | L107 | `WHERE branch='main' ORDER BY updated_at DESC` | INDEX 生成用 |
| `getStalePages(maxStaleness=0.5)` | L118 | `WHERE staleness_score > ? OR lint_status != 'healthy'` | Lint 候选 |
| `countKnowledgePages()` | L169 | `COUNT(*) WHERE branch='main'` | 网关 status 接口 |

---

### 1.3 link-store.ts

**文件**: `src/store/knowledge-pages/link-store.ts`（105 行）

#### 反向链接数据模型

```typescript
interface KnowledgePageLink {
  id: string;
  from_page_id: string;   // 出链方
  to_page_id: string;     // 入链方
  link_context: string;   // 链接上下文描述
  created_at: string;
}
```

#### 核心函数: `syncBacklinks()` — L75-L104

这是整个 link-store 最重要的函数——解析页面内容中的 `[[slug]]` 语法，同步到链接表：

```
输入: (pageId, content, allSlugsToIds: Map<string,string>)
  │
  ├── 正则解析: /\[\[([^\]]+)\]\]/g
  │   提取所有 [[slug]] 中的 slug → Set<string>（自动去重 + toLowerCase）
  │
  ├── 删除旧出链:
  │   DELETE FROM knowledge_page_links WHERE from_page_id = ?
  │
  └── 批量创建新链接:
      for (slug of foundSlugs):
        targetId = allSlugsToIds.get(slug)
        if (targetId && targetId !== pageId):   ← 防止自引用
          INSERT OR IGNORE INTO knowledge_page_links
            (id, from_page_id=pageId, to_page_id=targetId, link_context='', created_at)
```

**设计要点**：
- **先删后建**策略（非增量更新），保证链接表与内容一致
- `INSERT OR IGNORE` 防止重复插入
- 调用方需传入全局 slug→id 映射表（`allSlugsToIds`）

#### 其他函数

| 函数 | 行号 | SQL | 要点 |
|------|------|-----|------|
| `createPageLink(from, to, context)` | L15 | `INSERT OR IGNORE` | 创建单条链接 |
| `getOutboundLinks(pageId)` | L31 | `WHERE from_page_id = ?` | 某页的出链列表 |
| `getInboundLinks(pageId)` | L41 | `WHERE to_page_id = ?` | 某页的入链列表 |
| `getOrphanedPageIds()` | L51 | `LEFT JOIN ... WHERE kpl.id IS NULL` | 找无入链的孤立页面 |
| `deletePageLinks(pageId)` | L64 | `WHERE from_page_id=? OR to_page_id=?` | 双向清理 |

---

### 1.4 evidence-store.ts

**文件**: `src/store/knowledge-pages/evidence-store.ts`（57 行）

#### 证据链数据模型

```typescript
interface KnowledgePageEvidence {
  id: string;
  page_id: string;          // 所属知识页面
  evidence_type: 'l1' | 'l2' | 'l3';  // 证据来源层级
  evidence_id: string;      // 引用的记忆 ID
  section_hint: string | null; // 对应页面中的哪个段落
  created_at: string;
}
```

#### 函数清单

| 函数 | 行号 | SQL | 用途 |
|------|------|-----|------|
| `addEvidence(pageId, type, evidenceId, sectionHint?)` | L12 | `INSERT INTO knowledge_page_evidence` | 建立页面 ↔ 记忆关联 |
| `getPageEvidence(pageId)` | L32 | `WHERE page_id=? ORDER BY created_at DESC` | 获取某页全部证据 |
| `findPagesByEvidence(type, evidenceId)` | L42 | `WHERE evidence_type=? AND evidence_id=?` | 反向查找：某记忆关联了哪些页面 |
| `deletePageEvidence(pageId)` | L53 | `DELETE WHERE page_id=?` | 清理某页全部证据 |

**⚠️ 已知问题**：GC 删除记忆后，evidence 表中的 `evidence_id` 会成为悬挂引用（无外键约束）。在 FLOWS.md 的已知缺陷 #10 中已记录。

---

### 1.5 compile-queue.ts

**文件**: `src/store/knowledge-pages/compile-queue.ts`（70 行）

#### 队列项数据模型

```typescript
type CompileSourceType = 'new_fact' | 'query_insight' | 'feedback' | 'lint_finding';
type CompileStatus = 'pending' | 'compiled' | 'skipped';

interface CompileQueueItem {
  id: string;
  source_type: CompileSourceType;  // 4 种来源
  content: string;                 // 编译内容
  target_page: string | null;      // 目标页面 slug（可为 null）
  priority: number;                // 0-10
  status: CompileStatus;
  created_at: string;
  processed_at: string | null;
}
```

#### 队列入口 — `enqueueCompile()` L12-L27

被 **5 个不同模块**调用，是 Knowledge Pages 系统对外的核心写入接口：

```
调用方                    source_type        priority    说明
─────────────────────────────────────────────────────────────
search.ts (查询回写)      'query_insight'    4          检索时发现的新洞察
dreamer.ts (做梦 L1→L2)   'new_fact'         5          新提取的事实
auditor.ts (lint 发现)     'lint_finding'     3          页面健康问题
chat-summary.ts (聊天)     'query_insight'    4          聊天摘要中的实体/话题
compiler.ts (自身消费)     —                  —          取队列 → LLM 编译 → 标记
```

#### 队列消费 — `getPendingCompileItems(limit=50)` L32-L37

```sql
SELECT * FROM compile_queue
WHERE status = 'pending'
ORDER BY priority DESC, created_at ASC  ← 高优先级先出，同级先入先出
LIMIT ?
```

#### 批量标记 — `markCompiledBatch(ids, status='compiled')` L52-L61

```typescript
db.transaction(() => {
  for (const id of ids) {
    UPDATE compile_queue SET status=?, processed_at=now WHERE id=?
  }
})();  // ← 事务包裹，保证原子性
```

---

### 1.6 compiler.ts

**文件**: `src/modules/dream/compiler.ts`（244 行）

这是 **做梦 Phase 2** 的核心引擎，整合了四层提炼和 Karpathy Compile：

#### `runCompile(params?)` — L43-L105

```
Phase 2: 深度睡眠
  │
  ├── Step 1: L1→L2 事实提取
  │   extractFacts(p.extractFacts)               ← core/processing.ts
  │   默认批次: 20 (daily) / 50 (deep)
  │
  ├── Step 2: L2→L3 观察提炼
  │   distillObservations(p.distillObservations)  ← core/consolidation.ts
  │   默认批次: 20 (daily) / 50 (deep)
  │
  ├── Step 3: L3→L4 心智模型晋升
  │   promoteToMentalModels(p.promoteToMentalModels) ← core/consolidation.ts
  │   默认批次: 10 (daily) / 30 (deep), daily 模式下 =0 跳过
  │
  ├── Step 4: 处理 compile_queue (Karpathy Compile)
  │   processCompileQueue(p.compileQueue)
  │   默认批次: 30 (daily) / 50 (deep)
  │
  └── Step 5: 维护 index.md
      updateKnowledgeIndex()
```

#### `processCompileQueue()` — L109-L200（核心逻辑）

```
取待处理队列
  │
  ├── 过滤 source_type = 'new_fact' | 'query_insight'
  │   解析三元组: content.split(' — ') → {subject, predicate, object}
  │
  ├── 获取已有页面标题列表
  │   getAllKnowledgePages() → existingTitles
  │
  ├── LLM 编译决策（tier: medium, temp: 0.3）
  │   输入: facts[] + existingTitles[]
  │   输出: { actions: CompileAction[] }
  │
  │   CompileAction 类型:
  │     - create_page: { slug, title, page_type, content, confidence }
  │     - update_page: { slug, content }
  │     - create_observation: { title, content }
  │
  └── 执行编译动作:
      for (action of actions):
        ├── create_page:
        │   existing = getKnowledgePageBySlug(slug)
        │   if (existing) → 追加: updateKnowledgePageContent(id, merged)
        │   else → 创建: createKnowledgePage({...})
        │
        └── update_page:
            existing = getKnowledgePageBySlug(slug)
            if (existing) → 追加: updateKnowledgePageContent(id, merged)

      markCompiledBatch(ids, 'compiled')  ← 标记全部已处理
```

**⚠️ 关键设计**：LLM 返回的 `create_page` 如果 slug 已存在，自动降级为 `update_page`（追加而非覆盖）。

#### `updateKnowledgeIndex()` — L204-L230

```
获取所有知识页面
  │
  ├── 按 page_type 分组
  │
  ├── 生成 index.md 内容:
  │   # 知识索引
  │   > 共 N 个知识页面，最后更新于 YYYY-MM-DD
  │   ## 👤 人物 (3)
  │   - [[alice-chen]] — Alice Chen (置信度: 0.8)
  │   ## 📋 主题 (5)
  │   - [[typescript]] — TypeScript (置信度: 0.7)
  │
  └── updateSurfaceFile('index.md', content)  ← 写入 Surface Files
```

**类型标签映射**（L232-L243）：

| page_type | 标签 |
|-----------|------|
| person | 👤 人物 |
| topic | 📋 主题 |
| project | 🔨 项目 |
| concept | 💡 概念 |
| skill | 🎯 技能 |
| place | 📍 地点 |
| event_series | 📅 事件 |

---

### 1.7 auditor.ts

**文件**: `src/modules/dream/auditor.ts`（201 行）

做梦 Phase 1 包含 **Knowledge Page Lint** 功能：

#### `runAudit()` 中的 Lint 流程 — L117-L131

```
获取所有知识页面 (getAllKnowledgePages)
  │
  for (page of allPages):
  │  ├── lintPage(page, db) → LintIssue | null
  │  │
  │  ├── if (issue != null):
  │  │     updateLintStatus(page.id, issue, staleness)
  │  │     enqueueCompile('lint_finding', description, page.slug, priority=3)
  │  │                                                     ↑
  │  │                                    入队到 compile_queue 等 Phase 2 处理
  │  └── continue
  │
  └── 汇总: { pages_linted, lint_issues[] }
```

#### `lintPage()` — L159-L200（Lint 检查三维度）

```
输入: KnowledgePage
  │
  ├── 维度 1: 陈旧度检查
  │   SELECT COUNT(*) FROM world_facts
  │   WHERE created_at > page.last_compiled
  │     AND (subject LIKE '%title%' OR object LIKE '%title%')
  │   │
  │   └── count >= 5 → staleness += count * 0.1
  │       staleness > 0.5 → issue = 'stale'
  │
  ├── 维度 2: 断裂链接
  │   SELECT COUNT(*) FROM knowledge_page_links
  │   WHERE from_page_id = page.id
  │     AND to_page_id NOT IN (SELECT id FROM knowledge_pages)
  │   │
  │   └── count > 0 → issue = 'orphaned'  ← 最高优先级
  │
  └── 维度 3: 证据缺失
      SELECT COUNT(*) FROM knowledge_page_evidence WHERE page_id = ?
      │
      └── count = 0 → issue = 'missing'

  最终:
    healthy + staleness <= 0.3 → return null (无问题)
    否则 → return LintIssue
```

**Lint 优先级**：`orphaned` > `stale` > `missing` > `healthy`

---

### 1.8 完整数据流图

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                    写入路径 (5 个入口)                            │
  │                                                                  │
  │  search.ts ──┐                                                   │
  │  dreamer.ts ─┤  enqueueCompile()   ┌──────────────┐             │
  │  auditor.ts ─┤ ──────────────────→ │ compile_queue │             │
  │  chat-sum.ts ┘                     │   (pending)   │             │
  │                                    └──────┬───────┘             │
  │                                           │ getPendingCompileItems()
  │                                           ▼                      │
  │                                   ┌─────────────────┐           │
  │                                   │ compiler.ts      │           │
  │                                   │ LLM 编译决策     │           │
  │                                   └──┬────────┬─────┘           │
  │                                create │        │ update          │
  │                                      ▼        ▼                 │
  │                              ┌───────────────────────┐          │
  │  createKnowledgePage() ←──── │  knowledge_pages 表   │          │
  │  updateKnowledgePageContent()│  (版本历史自动保存)    │          │
  │                              └───────────────────────┘          │
  │                                      │                          │
  │                          syncBacklinks()                        │
  │                                      ▼                          │
  │                              ┌───────────────────────┐          │
  │                              │ knowledge_page_links   │          │
  │                              │ (反向链接表)            │          │
  │                              └───────────────────────┘          │
  │                                                                  │
  │  addEvidence() ──────────→  ┌───────────────────────┐          │
  │                              │ knowledge_page_evidence│          │
  │                              │ (证据链表)             │          │
  │                              └───────────────────────┘          │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │                    读取路径                                       │
  │                                                                  │
  │  search.ts → searchKnowledgePages()  FTS5 → LIKE 降级            │
  │  rest-api.ts / mcp-server.ts → countKnowledgePages()  统计      │
  │  compiler.ts → getAllKnowledgePages() + getKnowledgePageBySlug() │
  │  auditor.ts → getStalePages() + getAllKnowledgePages()           │
  │  full-e2e.test.ts → 综合测试覆盖                                │
  └──────────────────────────────────────────────────────────────────┘
```

---

## 2. Owner / Person Profile

### 模块架构

```
src/owner/
  ├── profile.ts       (184行)  底层 KV 存储引擎 → owner_profile 表
  ├── preferences.ts   (144行)  偏好推断系统 → 依赖 profile.ts
  ├── persons.ts       (206行)  人设画像管理 → person_profiles 表
  └── index.ts         (37行)   统一导出 23 个函数

消费方:
  src/modules/social/persona-builder.ts  → findPersonByName, createPerson, updatePerson
  src/modules/social/relationships.ts    → 读写 person_profiles.relationships
  src/modules/social/topic-tracker.ts    → condition_index 的 person: 前缀
```

---

### 2.1 profile.ts

**文件**: `src/owner/profile.ts`（184 行）

Owner Profile 是一个 **通用 KV 存储引擎**，操作 `owner_profile` 表：

```sql
-- 表结构（推断自代码）
CREATE TABLE owner_profile (
  key TEXT PRIMARY KEY,     -- 点分路径，如 "identity.name", "preferences.coding.language"
  value TEXT,               -- JSON 序列化的值
  category TEXT,            -- 自动推断或手动指定
  confidence REAL,          -- 0-1 置信度
  source TEXT,              -- 来源客户端
  updated_at TEXT           -- ISO 8601
);
```

#### 类型定义

```typescript
// src/common/types.ts L182-190
interface OwnerProfileEntry {
  key: string;        // e.g. "identity.name", "preferences.coding.language"
  value: unknown;     // JSON value
  category: string;   // "identity" | "preferences" | "personality" | ...
  confidence: number;
  source: MemorySource;
  updated_at: string;
}
```

#### `setProfileEntry()` — L15-L49（Upsert 模式）

```sql
INSERT INTO owner_profile (key, value, category, confidence, source, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(key) DO UPDATE SET
  value = ?,
  category = COALESCE(?, category),  ← 保留旧 category 如果未指定
  confidence = ?,
  source = ?,
  updated_at = ?
```

**分类自动推断**（`inferCategory()` L156-L159）：
```typescript
function inferCategory(key: string): string {
  const parts = key.split('.');
  return parts[0] || 'general';  // "preferences.coding.language" → "preferences"
}
```

#### `getFullProfile()` — L74-L86（嵌套对象构建）

```
SELECT * FROM owner_profile ORDER BY category, key
  │
  for (row of rows):
    key = "preferences.coding.language"
    value = "TypeScript"
    │
    setNestedValue(profile, key, value)
    │
    └── profile = {
          preferences: {
            coding: {
              language: "TypeScript"   ← 递归构建嵌套对象
            }
          }
        }
```

`setNestedValue()` 递归实现（L161-L172）：按 `.` 分割 key，逐层创建中间对象，最后一层赋值。

#### 其他函数

| 函数 | 行号 | SQL | 要点 |
|------|------|-----|------|
| `getProfileEntry(key)` | L54 | `WHERE key = ?` | 单条查询 |
| `getProfileByCategory(cat)` | L63 | `WHERE category = ? ORDER BY key` | 按分类查 |
| `getProfileByPrefix(prefix)` | L91 | `WHERE key LIKE 'prefix%'` | 前缀搜索（preferences 模块依赖） |
| `deleteProfileEntry(key)` | L102 | `DELETE WHERE key = ?` | 单条删除 |
| `setProfileEntries(entries[])` | L111 | 事务批量 `setProfileEntry()` | 原子批量写入 |
| `listProfileCategories()` | L135 | `SELECT DISTINCT category` | 枚举所有分类 |
| `countProfileEntries(cat?)` | L146 | `COUNT(*) [WHERE category=?]` | 统计条目数 |

---

### 2.2 preferences.ts

**文件**: `src/owner/preferences.ts`（144 行）

基于 `profile.ts` 的 KV 存储，提供更高级的 **偏好推断**逻辑：

#### 偏好数据模型

```typescript
interface Preference {
  topic: string;           // 偏好主题，如 "coding_language"
  preference: string;      // 偏好值，如 "TypeScript"
  confidence: number;      // 0-1 置信度
  evidence_count: number;  // 支撑该偏好的证据数
  last_updated: string;
}
```

存储方式：以 `preferences.{topic}` 为 key 存入 `owner_profile` 表，value 是 `{ preference, evidence_count }` 的 JSON。

#### `recordPreference()` — L31-L88（核心逻辑）

这是偏好系统最复杂的函数，实现了**四种分支逻辑**：

```
输入: (topic, preference, confidence=0.5, source='system')
  │
  ├── key = `preferences.${topic}`
  ├── existing = getProfileByPrefix(key)
  │
  ├── 分支 A: 已有同 topic 且相同偏好
  │   newConfidence = min(1, oldConfidence + confidence * 0.2)  ← +20% 增强
  │   evidence_count += 1
  │   setProfileEntry(key, {preference, evidence_count}, {confidence: newConfidence})
  │
  ├── 分支 B: 已有不同偏好，但新偏好置信度更高
  │   直接替换: setProfileEntry(key, {newPreference, evidence_count=1}, {confidence: new})
  │
  ├── 分支 C: 已有不同偏好，旧偏好置信度更高
  │   旧偏好衰减: oldConfidence = max(0, oldConfidence - 0.1)  ← -10% 惩罚
  │   setProfileEntry(key, {oldPreference, oldCount}, {confidence: degraded})
  │
  └── 分支 D: 全新偏好
      setProfileEntry(key, {preference, evidence_count=1}, {confidence})
```

**设计特点**：
- 同一偏好重复出现 → 置信度逐步增强（贝叶斯式增量更新）
- 矛盾偏好出现 → 老偏好的置信度被惩罚
- 只有更强的证据才能覆盖旧偏好

#### 其他函数

| 函数 | 行号 | 逻辑 | 要点 |
|------|------|------|------|
| `getPreference(topic)` | L93 | `getProfileByPrefix('preferences.{topic}')` | 单个偏好查询 |
| `getAllPreferences()` | L112 | `getProfileByPrefix('preferences.')` | 所有偏好 |
| `getStrongPreferences(min=0.7)` | L131 | `filter(p.confidence >= min)` | 高置信度偏好（Agent 指导用） |
| `deletePreference(topic)` | L138 | `DELETE WHERE key='preferences.{topic}'` | 直接操作 DB |

---

### 2.3 persons.ts

**文件**: `src/owner/persons.ts`（206 行）

#### 人设画像数据模型

```typescript
// src/common/types.ts L194-207
interface PersonProfile {
  id: string;
  name: string;
  aliases: string[];                                // ["小明", "XM"]
  personality: string | null;                       // "外向开朗"
  interests: string[];                              // ["编程", "音乐"]
  opinions: Record<string, string>;                 // { "AI": "看好" }
  speech_patterns: string[];                        // ["经常说'其实'"]
  relationships: Array<{ person: string; type: string }>;  // [{ person: "Bob", type: "colleague" }]
  first_seen: string;
  last_seen: string;
  created_at: string;
  updated_at: string;
}
```

**存储方式**：所有数组/对象字段以 **JSON 字符串**存入 SQLite，读取时 `JSON.parse()` 反序列化。

#### `findPersonByName()` — L62-L84（R-018 三级搜索策略）

```
输入: name (如 "Alice")
  │
  ├── 第 1 级: 精确名称匹配
  │   SELECT * FROM person_profiles WHERE name = ?
  │   └── 匹配 → 直接返回
  │
  ├── 第 2 级: R-018 json_each 别名匹配（大小写不敏感）
  │   SELECT pp.* FROM person_profiles pp, json_each(pp.aliases) AS alias
  │   WHERE LOWER(alias.value) = LOWER(?)
  │   LIMIT 1
  │   └── 匹配 → 返回
  │
  └── 第 3 级: LIKE 模糊降级
      SELECT * WHERE LOWER(name) LIKE '%alice%' LIMIT 1
      └── 匹配 → 返回 / 无匹配 → null
```

**⚠️ R-018 亮点**：使用 SQLite 的 `json_each()` 函数在 JSON 数组内做精确匹配，避免 LIKE `%alias%` 的误匹配（如 "ali" 匹配 "Alice"）。

#### `appendPersonInfo()` — L116-L150（增量追加，不覆盖）

```
输入: (id, { aliases?, interests?, opinions?, speech_patterns?, relationships? })
  │
  ├── 读取现有 Person
  │
  ├── aliases:    [...new Set([...existing.aliases, ...new.aliases])]      ← Set 去重
  ├── interests:  [...new Set([...existing.interests, ...new.interests])]
  ├── opinions:   { ...existing.opinions, ...new.opinions }               ← 新覆盖旧
  ├── speech_patterns: [...new Set([...existing, ...new])]
  ├── relationships:
  │   existingKeys = Set(existing.map(r => `${r.person}:${r.type}`))
  │   newRels = new.filter(r => !existingKeys.has(`${r.person}:${r.type}`))
  │   [...existing.relationships, ...newRels]                             ← 按 person:type 去重
  │
  └── updatePerson(id, mergedUpdates)
```

**设计特点**：
- 数组字段用 `Set` 去重合并
- `opinions` 用对象展开覆盖（新值优先）
- `relationships` 按 `person:type` 组合键去重，防止重复关系

---

### 2.4 三者协作关系

```
                         ┌──────────────┐
                         │ owner_profile│  (KV 表)
                         │ 表           │
                         └──────┬───────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                   │
     setProfileEntry()   getProfileByPrefix()    getFullProfile()
              │                 │                   │
              ▼                 ▼                   ▼
     ┌─────────────┐   ┌──────────────┐   ┌──────────────┐
     │ profile.ts   │   │ preferences  │   │  Agent 消费   │
     │ (底层引擎)   │←──│ .ts (偏好)   │   │  me.md 生成   │
     └─────────────┘   └──────────────┘   └──────────────┘

                         ┌──────────────┐
                         │person_profiles│  (独立表)
                         │ 表            │
                         └──────┬───────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                   │
     persons.ts         persona-builder.ts   relationships.ts
     (CRUD 基础)        (LLM 自动推断)       (关系图谱)
```

**要点**：
- `profile.ts` 和 `persons.ts` 操作**不同的表**（`owner_profile` vs `person_profiles`）
- `preferences.ts` 是 `profile.ts` 的**上层封装**，用 `preferences.*` 前缀存偏好
- `persona-builder.ts`（Social 模块）是 `persons.ts` 的**自动化消费方**

---

## 3. Work 工作模块

### 模块架构

```
src/modules/work/
  ├── tasks.ts           (205行)  任务 CRUD → work_tasks 表
  ├── priority.ts        (116行)  5 因子加权优先级排序
  ├── daily-summary.ts   (148行)  日终总结（LLM + fallback）
  └── weekly-review.ts   (108行)  周回顾报告（LLM + fallback）

调度触发:
  scheduler.ts → daily-summary (每日 23:30)
  scheduler.ts → weekly-review (每周日 23:55)
  scheduler.ts → priority ranking (每日触发)
```

---

### 3.1 tasks.ts

**文件**: `src/modules/work/tasks.ts`（205 行）

#### 任务数据模型

```typescript
// src/common/types.ts L339-351
type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

interface WorkTask {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority_score: number;      // 0-10
  linked_memories: string[];   // 关联的 experience IDs
  due_date: string | null;     // ISO 8601 日期
  created_at: string;
  updated_at: string;
}
```

#### `createTask()` — L33-L66

```sql
INSERT INTO work_tasks
  (id, title, description, status='todo',
   priority_score=5.0,
   linked_memories='[]',    -- JSON 数组
   due_date, created_at, updated_at)
```

默认值：status=`'todo'`, priority_score=`5.0`

#### `updateTask()` — L80-L105（动态 SET 构建）

```typescript
// 只更新传入的字段，未传的保留原值
const updates: string[] = [];
const values: unknown[] = [];

if (input.title !== undefined) { updates.push('title = ?'); values.push(input.title); }
if (input.status !== undefined) { updates.push('status = ?'); values.push(input.status); }
// ... 其他字段同理

updates.push('updated_at = ?');  // always update timestamp
values.push(now());
values.push(id);

db.prepare(`UPDATE work_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
```

#### `listTasks()` — L120-L146（分页 + 状态筛选）

```typescript
function listTasks(
  pagination = { page: 1, page_size: 20 },
  status?: TaskStatus
): PaginatedResult<WorkTask>
```

```sql
-- 动态 WHERE
SELECT * FROM work_tasks [WHERE status = ?]
ORDER BY priority_score DESC, created_at DESC
LIMIT ? OFFSET ?

-- 总数查询
SELECT COUNT(*) FROM work_tasks [WHERE status = ?]
```

返回 `PaginatedResult<WorkTask>`：`{ items, total, page, page_size, has_more }`

#### `getTodayTasks()` — L151-L160

```sql
SELECT * FROM work_tasks
WHERE (due_date = '2026-04-08' OR (status != 'done' AND status != 'cancelled'))
ORDER BY priority_score DESC
```

**逻辑**：今日到期的任务 **+** 所有未完成/未取消的任务

#### `linkMemoryToTask()` — L179-L188

```typescript
function linkMemoryToTask(taskId: string, memoryId: string): void {
  const task = getTaskById(taskId);
  if (!task) return;
  const memories = task.linked_memories;
  if (!memories.includes(memoryId)) {   // ← 去重
    memories.push(memoryId);
    updateTask(taskId, { linked_memories: memories });
  }
}
```

---

### 3.2 priority.ts

**文件**: `src/modules/work/priority.ts`（116 行）

#### 五因子加权评分模型

```
因子                   权重    来源              评分逻辑
────────────────────────────────────────────────────────────
user_score             0.30    task.priority_score    直接映射 (0-10 → 0-1)
due_urgency            0.25    task.due_date          阶梯式: 过期=1.0, <1d=0.9, <3d=0.7, <7d=0.4, 其他=0.1
memory_relevance       0.20    experiences.importance  关联记忆的 AVG(importance)
recency                0.15    task.updated_at         7天线性衰减: max(0, 1 - hours/(24*7))
dependency             0.10    task.status             in_progress → 0.5, 其他 → 0
```

#### `rankTasks()` — L26-L52

```
输入: tasks? (可选，默认从 DB 查活跃任务)
  │
  ├── 查询: WHERE status IN ('todo', 'in_progress') ORDER BY priority_score DESC
  │
  ├── 计算: 每个任务的 computePriorityScore()
  │
  ├── 排序: ranked.sort((a,b) => b.score - a.score)
  │
  └── 持久化: 事务批量更新 DB 中的 priority_score
      db.transaction(() => {
        for ({task, score} of ranked)
          UPDATE work_tasks SET priority_score=score, updated_at=now WHERE id=?
      })()
```

#### `computePriorityScore()` — L54-L101（详细评分）

```
let score = 0;

// 1. 用户手动优先级 (30%)
score += (task.priority_score / 10) * 0.30;

// 2. 截止日期紧迫度 (25%)
daysUntilDue = (due - now) / 86400000;
if (< 0)  score += 1.0 * 0.25;  // 已过期，最紧急
if (< 1)  score += 0.9 * 0.25;
if (< 3)  score += 0.7 * 0.25;
if (< 7)  score += 0.4 * 0.25;
else      score += 0.1 * 0.25;

// 3. 关联记忆重要性 (20%)
if (linked_memories.length > 0) {
  SELECT AVG(importance) FROM experiences WHERE id IN (?)
  score += avg_imp * 0.20;
}

// 4. 最近更新 (15%)
hoursSinceUpdate = (now - updated_at) / 3600000;
recencyScore = max(0, 1 - hoursSinceUpdate / 168);  // 168h = 7天
score += recencyScore * 0.15;

// 5. 进行中加成 (10%)
if (status === 'in_progress') score += 0.5 * 0.10;

return min(10, score * 10);  // 映射回 0-10 范围
```

---

### 3.3 daily-summary.ts

**文件**: `src/modules/work/daily-summary.ts`（148 行）

#### 数据模型

```typescript
interface DailySummary {
  date: string;          // "2026-04-08"
  summary: string;       // Markdown 格式总结
  highlights: string[];  // 亮点列表
  mood: string;          // "normal" | "productive" | "challenging" | ...
  task_stats: { done: number; in_progress: number; todo: number; cancelled: number };
}
```

#### `generateDailySummary()` — L25-L99

```
输入: date? (默认今天)
  │
  ├── 收集数据:
  │   ├── getTodayTasks() → 今日任务
  │   ├── getTaskStats() → 任务统计
  │   └── SELECT raw_content FROM experiences
  │       WHERE created_at >= '2026-04-08T00:00:00Z'
  │         AND created_at < '2026-04-08T23:59:59Z'
  │       ORDER BY importance DESC LIMIT 20
  │
  ├── LLM 生成（优先）:
  │   messages: dailySummaryPrompt(tasks, memoryTexts)
  │   tier: 'medium', temperature: 0.5
  │   fallback: buildFallbackSummary(...)
  │   │
  │   └── 输出: { summary, highlights[], mood }
  │
  ├── 规则降级（LLM 不可用时）:
  │   summary = Markdown 格式列出已完成/进行中任务和今日记忆
  │   highlights = 已完成任务的标题
  │   mood = 'normal'
  │
  └── 持久化:
      INSERT INTO dream_logs
        (id, session_id='daily-YYYY-MM-DD',
         phase=0,         ← phase=0 表示日总结（不是做梦的 phase 1-4）
         narrative=JSON.stringify(summary),
         pre_snapshot_id='', duration_ms=0)
```

#### `getDailySummaries(days=7)` — L104-L120

```sql
SELECT narrative FROM dream_logs
WHERE phase = 0              -- ← 日总结专用标识
ORDER BY created_at DESC
LIMIT ?
```

读出后 `JSON.parse(narrative)` → `DailySummary`

#### Fallback 格式（`buildFallbackSummary()` L122-L135）

```markdown
# 2026-04-08 日终总结

## 完成 (3)
- ✅ 修复登录bug
- ✅ 更新文档
- ✅ 代码审查

## 进行中 (2)
- 🚧 重构数据库模块
- 🚧 添加单元测试

## 今日记忆 (8 条)
- 用户反馈: 登录页面加载缓慢...
- 团队讨论: 决定迁移到PostgreSQL...
```

---

### 3.4 weekly-review.ts

**文件**: `src/modules/work/weekly-review.ts`（108 行）

#### 数据模型

```typescript
interface WeeklyReview {
  week_start: string;          // "2026-04-01"
  week_end: string;            // "2026-04-08"
  review: string;              // Markdown 总结
  achievements: string[];      // 成就列表
  improvements: string[];      // 改进建议
  next_week_focus: string[];   // 下周重点
  task_stats: { done: number; in_progress: number; todo: number };
}
```

#### `generateWeeklyReview()` — L26-L90

```
收集数据:
  ├── getDailySummaries(7) → 最近 7 天日总结
  └── getTaskStats() → 任务统计

LLM 生成:
  messages: weeklyReviewPrompt(summaries.map(s => s.summary), stats)
  tier: 'medium', temperature: 0.5
  fallback: buildFallbackReview(...)

输出: { review, achievements[], improvements[], next_week_focus[] }
```

**⚠️ 注意**：weekly-review 不像 daily-summary 那样持久化到 `dream_logs`——生成后直接返回，由调用方决定如何使用。

---

## 4. Social 社交模块

### 模块架构

```
src/modules/social/
  ├── chat-summary.ts     (81行)   聊天摘要 → 写入 compile_queue
  ├── persona-builder.ts  (123行)  LLM 自动构建人设 → 写入 person_profiles
  ├── relationships.ts    (176行)  关系图谱 → 写入 person_profiles + graph
  └── topic-tracker.ts    (128行)  话题追踪 → 读取 condition_index

依赖关系:
  chat-summary.ts    → compile-queue.ts (enqueueCompile)
  persona-builder.ts → owner/persons.ts (findPersonByName, createPerson, updatePerson)
  relationships.ts   → store/graph.ts (createLink)
  topic-tracker.ts   → condition_index 表 (读取)
```

---

### 4.1 chat-summary.ts

**文件**: `src/modules/social/chat-summary.ts`（81 行）

#### 数据模型

```typescript
interface ChatSummaryResult {
  id: string;
  summary: string;         // 对话摘要
  topics: string[];        // 提取的话题
  entities: string[];      // 提取的实体（人名/组织/...）
  action_items: string[];  // 行动项
  sentiment: string;       // 情感倾向
  created_at: string;
}
```

#### `extractChatSummary()` — L26-L67

```
输入: messages[{role, content}], context?
  │
  ├── 前置条件: llm.isAvailable && messages.length >= 2
  │
  ├── LLM 提取:
  │   messages: chatSummaryPrompt(messages, context)
  │   tier: 'light'        ← 使用轻量模型（快速提取）
  │   temperature: 0.3     ← 低温度（确保准确性）
  │   │
  │   └── 输出: { summary, topics[], entities[], action_items[], sentiment }
  │
  ├── ⚠️ 回写到编译队列（关键连接点）:
  │   if (entities.length > 0 || topics.length > 0):
  │     content = `聊天摘要提取：${summary.slice(0,200)}\n实体: ${entities}\n话题: ${topics}`
  │     enqueueCompile('query_insight', content, undefined, priority=4)
  │                                                          ↑
  │                               这里是 Social → Knowledge Pages 的桥梁
  │
  └── 规则降级:
      summary = `对话包含 ${n} 条消息: ${combined.slice(0,200)}...`
      topics, entities, action_items = []
      sentiment = 'neutral'
```

**⚠️ 设计亮点**：聊天摘要提取的实体和话题不会丢失——通过 `enqueueCompile()` 写入编译队列，在下次做梦时由 `compiler.ts` 编译到 Knowledge Pages 中。这是 **Social → KP** 的数据桥梁。

---

### 4.2 persona-builder.ts

**文件**: `src/modules/social/persona-builder.ts`（123 行）

#### `buildPersona()` — L17-L99（单人画像构建）

```
输入: personName (如 "Alice")
  │
  ├── Step 1: 收集关于该人的所有记忆
  │   SELECT raw_content FROM experiences
  │   WHERE branch='main' AND (raw_content LIKE '%Alice%' OR participants LIKE '%Alice%')
  │   ORDER BY importance DESC LIMIT 30
  │
  ├── Step 2: 收集 L2 事实
  │   SELECT subject, predicate, object FROM world_facts
  │   WHERE branch='main' AND (subject LIKE '%Alice%' OR object LIKE '%Alice%')
  │   ORDER BY confidence DESC LIMIT 20
  │
  ├── 如果两者都为空 → 返回（无数据可推断）
  │
  ├── Step 3: LLM 推断人设
  │   messages: personaInferPrompt(personName, memoryTexts)
  │   tier: 'medium', temperature: 0.4
  │   │
  │   └── 输出: {
  │         personality: "外向开朗，喜欢技术分享",
  │         interests: ["编程", "音乐", "咖啡"],
  │         opinions: { "AI": "看好", "远程工作": "支持" },
  │         speech_patterns: ["经常说'其实'", "喜欢用类比"],
  │         relationship_hints: ["和 Bob 是同事"]
  │       }
  │
  └── Step 4: 写入 person_profiles
      existing = findPersonByName(personName)
      │
      ├── 已存在 → updatePerson():
      │   personality: 新值 || 旧值
      │   interests: [...new Set([...old, ...new])]    ← Set 去重合并
      │   opinions: { ...old, ...new }                 ← 新覆盖旧
      │   speech_patterns: [...new Set([...old, ...new])]
      │
      └── 不存在 → createPerson():
          name, personality, interests, opinions, speech_patterns
```

#### `buildAllPersonas()` — L104-L122（批量构建）

```
从 condition_index 表查找所有 person: 前缀实体
  │
  SELECT DISTINCT REPLACE(condition_key, 'person:', '') as name
  FROM condition_index
  WHERE condition_key LIKE 'person:%'
  │
  for (name of names):
    await buildPersona(name)  ← 逐个构建（串行，避免 LLM 过载）
  │
  return built  (构建总数)
```

**⚠️ 性能注意**：`buildAllPersonas()` 是串行调用 LLM 的——如果有 100 个人名，会发 100 次 LLM 请求。适合在做梦（离线）期间执行。

---

### 4.3 relationships.ts

**文件**: `src/modules/social/relationships.ts`（176 行）

#### 关系数据模型

```typescript
interface Relationship {
  person_a: string;
  person_b: string;
  type: string;             // 'colleague' | 'friend' | 'family' | 'mentor' | 'mentee' | ...
  strength: number;         // 0-1
  context: string;
  last_interaction: string;
}
```

**存储方式**：关系存在 `person_profiles.relationships` JSON 字段中（非独立表），同时在 `memory_links` 图表中创建边。

#### `addRelationship()` — L50-L93（双向添加）

```
输入: (personA, personB, type, context?)
  │
  ├── 更新 A 的 relationships:
  │   SELECT id, relationships FROM person_profiles WHERE name = 'A'
  │   if (!rels.some(r => r.person === 'B')):
  │     rels.push({ person: 'B', type })
  │     UPDATE person_profiles SET relationships = JSON, updated_at
  │
  ├── 更新 B 的 relationships (反向):
  │   SELECT id, relationships FROM person_profiles WHERE name = 'B'
  │   reverseType = reverseRelationType(type)
  │   if (!rels.some(r => r.person === 'A')):
  │     rels.push({ person: 'A', type: reverseType })
  │     UPDATE person_profiles SET relationships = JSON, updated_at
  │
  └── 创建图边:
      if (rowA && rowB):
        createLink(rowA.id, 'L3', rowB.id, 'L3', 'related', weight=0.7)
```

**反向关系映射**（L167-L175）：

| 正向 | 反向 |
|------|------|
| mentor | mentee |
| mentee | mentor |
| manager | report |
| report | manager |
| 其他 | 保持不变 |

#### `detectRelationshipsFromMemories()` — L98-L134（自动检测）

```
从最近 100 条多参与者经历中检测关系:
  │
  ├── SELECT participants FROM experiences
  │   WHERE branch='main' AND participants != '[]'
  │   ORDER BY created_at DESC LIMIT 100
  │
  ├── 两两配对计数:
  │   for (participants of rows):
  │     for (i of participants):
  │       for (j > i of participants):
  │         pairKey = [i,j].sort().join('::')
  │         pairCounts[pairKey] += 1
  │
  └── 共现 >= 3 次 → addRelationship(a, b, 'connected')
                        ↑
            阈值: 3 次共同出现视为有关系
```

#### `getSocialNetworkOverview()` — L139-L165

```
返回:
  {
    people: 12,          // person_profiles 总数
    relationships: 8,    // 总关系数 (双向计数 / 2)
    mostConnected: [     // 连接数最多的前 5 人
      { name: "Alice", connections: 5 },
      { name: "Bob", connections: 3 },
      ...
    ]
  }
```

---

### 4.4 topic-tracker.ts

**文件**: `src/modules/social/topic-tracker.ts`（128 行）

#### 数据模型

```typescript
interface TopicStat {
  topic: string;           // 话题名
  mention_count: number;   // 提及次数
  first_seen: string;      // 首次出现时间
  last_seen: string;       // 最后出现时间
  related_people: string[]; // 相关人物
}
```

#### `getTopicTrends()` — L21-L71

```
输入: (days=30, limit=20)
  │
  ├── 从 condition_index 统计 topic: 前缀:
  │   SELECT condition_key, COUNT(*) as cnt
  │   FROM condition_index
  │   WHERE condition_key LIKE 'topic:%'
  │   GROUP BY condition_key
  │   ORDER BY cnt DESC LIMIT ?
  │
  ├── 对每个 topic:
  │   ├── 获取时间范围:
  │   │   SELECT MIN(e.created_at), MAX(e.created_at)
  │   │   FROM condition_index ci JOIN experiences e
  │   │     ON ci.memory_id = e.id AND ci.memory_type = 'L1'
  │   │   WHERE ci.condition_key = 'topic:typescript'
  │   │
  │   └── 获取相关人物:
  │       SELECT DISTINCT REPLACE(ci2.condition_key, 'person:', '')
  │       FROM condition_index ci
  │       JOIN condition_index ci2
  │         ON ci.memory_id = ci2.memory_id AND ci.memory_type = ci2.memory_type
  │       WHERE ci.condition_key = 'topic:typescript'
  │         AND ci2.condition_key LIKE 'person:%'
  │       LIMIT 5
  │
  └── 返回: TopicStat[]
```

**⚠️ 性能注意**：每个 topic 都发两条额外查询（时间范围 + 相关人物），对于 20 个 topic 就是 40 条额外 SQL。大量 topic 时可能需要优化。

#### `getPersonTopics()` — L76-L97

```
输入: personName
  │
  └── 条件索引双表 JOIN:
      SELECT DISTINCT ci2.condition_key, COUNT(*) as cnt
      FROM condition_index ci
      JOIN condition_index ci2
        ON ci.memory_id = ci2.memory_id AND ci.memory_type = ci2.memory_type
      WHERE ci.condition_key = 'person:Alice'
        AND ci2.condition_key LIKE 'topic:%'
      GROUP BY ci2.condition_key
      ORDER BY cnt DESC LIMIT 20
```

**原理**：通过同一记忆的两个条件索引（person 和 topic）建立关联——如果某条记忆同时标记了 `person:Alice` 和 `topic:TypeScript`，则 Alice 与 TypeScript 话题相关联。

#### `getTopicDetails()` — L102-L127

```
输入: (topic, limit=10)
  │
  └── SELECT e.id, e.raw_content, e.importance, e.created_at
      FROM condition_index ci
      JOIN experiences e ON ci.memory_id = e.id AND ci.memory_type = 'L1'
      WHERE ci.condition_key = 'topic:typescript' AND e.branch = 'main'
      ORDER BY e.created_at DESC LIMIT ?
```

返回该话题最近关联的原始记忆列表。

---

## 5. 全模块交叉引用

### 模块间数据流总图

```
                           ┌─────────────────────────────────────────┐
                           │           记忆核心层                      │
                           │  experiences (L1) → world_facts (L2)    │
                           │  → observations (L3) → mental_models(L4)│
                           └───────────────────┬─────────────────────┘
                                               │
              ┌────────────────────────────────┼────────────────────────────────┐
              │                                │                                │
              ▼                                ▼                                ▼
   ┌─────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
   │   Knowledge Pages   │     │   Owner / Person     │     │   Work Module        │
   │                     │     │                      │     │                      │
   │ ┌─page-store────┐   │     │ ┌─profile.ts──┐      │     │ ┌─tasks.ts────┐      │
   │ │ CRUD + 搜索    │   │     │ │ KV 存储引擎 │      │     │ │ CRUD + 分页  │      │
   │ │ 版本历史       │   │     │ └─────┬───────┘      │     │ └──────┬──────┘      │
   │ └───────────────┘   │     │       │               │     │        │              │
   │ ┌─link-store────┐   │     │ ┌─preferences.ts─┐   │     │ ┌─priority.ts──┐     │
   │ │ [[backlink]]   │   │     │ │ 偏好推断        │   │     │ │ 5因子加权     │     │
   │ │ 同步           │   │     │ │ 贝叶斯增量      │   │     │ │ 排序          │     │
   │ └───────────────┘   │     │ └────────────────┘   │     │ └──────────────┘     │
   │ ┌─evidence-store─┐  │     │ ┌─persons.ts────┐    │     │ ┌─daily-summary.ts─┐ │
   │ │ L1/L2/L3 关联  │  │     │ │ 人设画像 CRUD  │    │     │ │ LLM 日终总结     │ │
   │ └───────────────┘   │     │ │ json_each匹配  │    │     │ └─────────────────┘ │
   │ ┌─compile-queue──┐  │     │ └───────┬────────┘    │     │ ┌─weekly-review.ts─┐│
   │ │ 优先级队列     │  │     │         │              │     │ │ LLM 周回顾       ││
   │ │ 5个入口写入    │  │     │         │              │     │ └─────────────────┘ │
   │ └───────────────┘   │     └─────────┼──────────────┘     └──────────────────────┘
   └──────────┬──────────┘               │
              │                          │
              ▼                          ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                      Social Module                            │
   │                                                               │
   │  ┌─chat-summary.ts──┐   ┌─persona-builder.ts──┐             │
   │  │ LLM 聊天摘要      │   │ LLM 自动推断人设     │             │
   │  │ → enqueueCompile  │   │ → createPerson       │             │
   │  │   (Social→KP桥梁) │   │ → updatePerson       │             │
   │  └──────────────────┘   │   (Social→Person桥梁) │             │
   │                          └──────────────────────┘             │
   │  ┌─relationships.ts─┐   ┌─topic-tracker.ts───┐              │
   │  │ 双向关系管理       │   │ condition_index    │              │
   │  │ 共现检测(≥3次)     │   │ 双表 JOIN 追踪     │              │
   │  │ → graph.createLink │   │ 人-话题关联        │              │
   │  └──────────────────┘   └──────────────────────┘             │
   └──────────────────────────────────────────────────────────────┘
```

### 跨模块调用关系矩阵

| 调用方 → 被调用方 | knowledge-pages | owner/persons | store/graph | llm/client |
|------|:---:|:---:|:---:|:---:|
| **compiler.ts** | ✅ CRUD + queue | — | — | ✅ medium |
| **auditor.ts** | ✅ lint + queue | — | — | — |
| **search.ts** | ✅ search + queue | — | — | — |
| **dreamer.ts** | ✅ enqueue | — | — | ✅ medium |
| **chat-summary.ts** | ✅ enqueue | — | — | ✅ light |
| **persona-builder.ts** | — | ✅ find/create/update | — | ✅ medium |
| **relationships.ts** | — | ✅ 读写 relationships | ✅ createLink | — |
| **topic-tracker.ts** | — | — | — | — |
| **daily-summary.ts** | — | — | — | ✅ medium |
| **weekly-review.ts** | — | — | — | ✅ medium |

---

## 6. 已知设计缺陷与优化建议

### Knowledge Pages

| # | 缺陷 | 位置 | 影响 | 建议 |
|---|------|------|------|------|
| 1 | Evidence 悬挂引用 | evidence-store.ts | GC 删除记忆后 evidence_id 失效 | 添加 ON DELETE CASCADE 或 GC 后清理 evidence |
| 2 | FTS 搜索是间接的 | page-store.ts L138-L150 | 新建页面如果没有对应的 memory_fts 条目则 FTS 不可达 | 页面本身内容也应写入 FTS5 |
| 3 | syncBacklinks 需要全量映射 | link-store.ts L75 | `allSlugsToIds` 需调用方自行构建，大量页面时内存开销大 | 考虑从 DB 直接查 |
| 4 | compile_queue 无去重 | compile-queue.ts | 同一事实可能被多次入队 | 添加 content hash 去重或 UNIQUE 约束 |

### Owner / Person Profile

| # | 缺陷 | 位置 | 影响 | 建议 |
|---|------|------|------|------|
| 5 | findPersonByName LIKE 模糊匹配 | persons.ts L78-L80 | 可能误匹配（"Al" → "Alice"） | 第三级搜索加长度约束或改用 FTS |
| 6 | preferences 置信度无上界衰减 | preferences.ts L46 | 多次重复后置信度趋近 1.0 不会下降 | 添加时间衰减机制 |
| 7 | person_profiles JSON 字段无索引 | persons.ts | json_each 查询在大表时性能差 | 考虑分离到关联表 |

### Work Module

| # | 缺陷 | 位置 | 影响 | 建议 |
|---|------|------|------|------|
| 8 | getTodayTasks OR 条件过宽 | tasks.ts L154-L158 | 返回所有未完成任务 + 今日到期，可能数据量大 | 添加分页或数量限制 |
| 9 | weekly-review 不持久化 | weekly-review.ts | 周报生成后无存储，重复调用浪费 LLM | 像 daily-summary 一样存入 dream_logs |
| 10 | priority.ts 参数值(spread) | priority.ts L82 | `.get(...task.linked_memories)` 在大数组时可能超出 SQLite 参数限制 | 分批查询或使用临时表 |

### Social Module

| # | 缺陷 | 位置 | 影响 | 建议 |
|---|------|------|------|------|
| 11 | buildAllPersonas 串行 LLM | persona-builder.ts L115-L118 | 100 人 = 100 次 LLM 调用 | 批量推断或并发限流 |
| 12 | detectRelationships 阈值硬编码 | relationships.ts L125 | `count >= 3` 对低频用户可能过高 | 配置化或自适应阈值 |
| 13 | getTopicTrends N+2 查询 | topic-tracker.ts L40-L67 | 每个 topic 2 条额外 SQL | 使用 CTE 或子查询优化为单条 SQL |
| 14 | relationships 存在 JSON 字段中 | relationships.ts | 查询/索引不友好，无法直接 JOIN | 考虑独立 relationships 表 |

---

## 附录: 文件清单与行数统计

| 模块 | 文件 | 行数 | 导出函数数 |
|------|------|------|-----------|
| **Knowledge Pages** | page-store.ts | 193 | 9 |
| | link-store.ts | 105 | 6 |
| | evidence-store.ts | 57 | 4 |
| | compile-queue.ts | 70 | 5 |
| | index.ts | 5 | 24 (re-export) |
| | compiler.ts (dream) | 244 | 1 |
| | auditor.ts (dream) | 201 | 1 |
| **Owner Profile** | profile.ts | 184 | 9 |
| | preferences.ts | 144 | 5 |
| | persons.ts | 206 | 9 |
| | index.ts | 37 | 23 (re-export) |
| **Work** | tasks.ts | 205 | 8 |
| | priority.ts | 116 | 1 |
| | daily-summary.ts | 148 | 2 |
| | weekly-review.ts | 108 | 1 |
| **Social** | chat-summary.ts | 81 | 1 |
| | persona-builder.ts | 123 | 2 |
| | relationships.ts | 176 | 4 |
| | topic-tracker.ts | 128 | 3 |
| **合计** | **20 文件** | **2,730 行** | **93 个函数** |
