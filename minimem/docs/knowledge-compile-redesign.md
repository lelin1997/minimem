# Knowledge Compile 重新设计

> **来源**：对比 Obsidian/Roam Research 双向链接实现 + 实测 45 页知识页产出发现的缺陷
> **日期**：2026-06-20
> **代码库**：`minimem/minimem`
> **核心问题**：编译流程有结构性缺陷（审计标记堆积/全量重写/链接未落地/证据未落库）
> **需求总数**：11 条（P0 × 4 / P1 × 4 / P2 × 3）

---

## 〇、问题全景

实测 45 个 Knowledge Pages 发现三个不是"调参"能修的硬伤：

### 问题 1：审计标记堆积（同一个问题被重复标记 3 次）

Knowledge Auditor 每次 dream 都跑，发现问题时**追加**标记到页面开头，但不清除旧标记。跑了 3 次 dream 就堆 3 条几乎一样的 `> ⚠️ 审计标记`。

**根因**：审计和修复脱节——审计写标记 → 编译不读标记 → 审计又发现同样问题 → 再写一条。死循环。

### 问题 2：双向链接有语法没数据

页面里有 `[[HITL 分类体系]]` 这类 backlink 语法，但 `knowledge_page_links` 表是**空的（0 条记录）**。compiler 生成了文本，但没有后处理步骤解析链接并落库。

**根因**：`knowledge_page_links` 表只有 `DELETE`（删页面时清链接），没有 `INSERT`。知识图谱是断的。

### 问题 3：证据溯源表完全空

`knowledge_page_evidence` 表建了，**0 条数据**，完全没有 `INSERT` 代码。compiler 让 LLM 自由生成内容，没要求标注"这段话来自哪个 L1/L2 记忆"。

**根因**：LLM 没有证据约束，导致"过度哲学化"——审计标记说"缺乏原始记忆支撑"，但编译时就没给 LLM 证据信息。

### 问题 4：编译 = 全量重写，不是增量更新

Harness Engineering 编译了 6 次，每次都是 LLM 重新生成整个页面。没有"保留已有好内容 + 只更新过时部分"的增量机制。

**后果**：好的内容可能被覆盖 / 审计标记被覆盖后又重新生成 / confidence 不升反降。

---

## 一、设计目标

1. **审计即修复**——发现"过度哲学化"就当场删除，不写标记等下次
2. **增量而非全量**——每次只处理新证据影响的部分，保留已有好内容
3. **backlink 落地**——编译后解析 `[[xxx]]` 写入 links 表，知识图谱连通
4. **证据约束**——LLM 生成内容时必须引用 evidence_id，无证据的段落 confidence 低
5. **幂等性**——同一条记忆入队多次，编译结果一致

---

## 二、编译流程重新设计

当前是**单步全量编译**：

```
新记忆入队 → LLM 全量重写页面 → 审计追加标记 → (下次重复)
```

改为**六步增量编译**：

```
Step 1: 证据收集
  ├─ 从 compile_queue 取待处理记忆
  ├─ 按 slug 分组（同主题的记忆合并处理）
  └─ 拉取该 page 的现有内容 + 现有证据列表

Step 2: 差异分析 (LLM)
  ├─ 输入: 现有页面内容 + 新证据
  ├─ 输出: { keep: [...保留段落], update: [...需更新段落], add: [...新增段落], remove: [...删除段落] }
  └─ 不全量重写，只标记变更

Step 3: 增量合并 (LLM)
  ├─ 对 update/add 段落用 LLM 生成新内容
  ├─ 保留 keep 段落原样
  ├─ 删除 remove 段落
  └─ 合并成新页面

Step 4: 审计 + 修复 (LLM，关键改动)
  ├─ 审计新页面，发现问题
  ├─ 直接修复（不是写标记等下次处理）
  ├─ 清除已修复的旧标记
  └─ 更新 lint_status + confidence

Step 5: 链接解析 (新增)
  ├─ 正则提取 [[backlink]]
  ├─ 查找目标 page（不存在则标记 dangling）
  └─ INSERT knowledge_page_links

Step 6: 证据落库 (新增)
  ├─ 从 LLM 输出提取 evidence_ids
  ├─ INSERT knowledge_page_evidence
  └─ 无证据的段落 confidence 降权
```

---

## 三、能力补充（对标 Obsidian/Roam）

### P0 — 必须做（解决结构性缺陷）

#### TODO-KC01: 证据溯源落地

**现状**：`knowledge_page_evidence` 表 0 条数据，LLM 生成内容无证据约束

**改动**：
- `prompts/templates.ts`：`knowledgePageCompilePrompt` 改造，要求 LLM 输出结构化 JSON：
  ```json
  {
    "sections": [
      {
        "heading": "概述",
        "content": "...",
        "evidence_ids": ["exp_xxx", "fact_yyy"],
        "confidence": 0.8
      }
    ]
  }
  ```
- `compiler.ts`：编译后把 evidence_ids 写入 `knowledge_page_evidence` 表
- 无 evidence 的段落 confidence 自动降到 0.3 以下
- API 返回页面时附带 evidence 详情（可跳转原始 L1 记忆）

#### TODO-KC02: 双向链接落地

**现状**：`knowledge_page_links` 表 0 条数据，`[[backlink]]` 只是文本

**改动**：
- `compiler.ts` 新增 `parseBacklinks(content)` 函数：正则提取 `[[slug]]` 或 `[[title]]`
- 查找目标 page（按 slug 或 title 匹配），INSERT `knowledge_page_links`
- 目标不存在时标记 `dangling`，下次 compile 优先创建
- 新增 API：`GET /api/v1/knowledge/:slug/backlinks` 返回反向链接列表

#### TODO-KC03: 审计即修复

**现状**：Auditor 只写标记不修复，导致标记堆积

**改动**：
- `knowledge-auditor.ts` 改造：发现问题后调 LLM 直接修复（删除哲学化段落/补充证据/精简表述）
- 修复后清除旧标记（不再堆积）
- 更新 `lint_status` 为 `healthy` / `needs_evidence` / `low_confidence`
- 如果 LLM 修复失败，才保留标记 + `lint_status=missing`

#### TODO-KC04: 增量编译（差异分析 + 增量合并）

**现状**：每次 compile 全量重写页面

**改动**：
- `compiler.ts` 拆分为：
  - `collectEvidence()` — Step 1
  - `analyzeDiff()` — Step 2（LLM 输出 keep/update/add/remove）
  - `incrementalMerge()` — Step 3（只改变化部分）
- `compile_count` 仍 +1，但 `content` 是增量合并结果
- 版本历史保留每次合并的快照

### P1 — 应该做（对标 Obsidian/Roam 核心能力）

#### TODO-KC05: 结构化查询（对标 Dataview FROM/WHERE）

**现状**：只有 `searchKnowledgePages(query)` 全文搜索

**改动**：
- 新增 `queryKnowledgePages({ tags?, domain?, lintStatus?, minConfidence?, hasBacklinks? })`
- API: `GET /api/v1/knowledge?tag=xxx&domain=yyy&min_confidence=0.7&lint=healthy`
- 支持按标签/领域/置信度/审计状态组合筛选

#### TODO-KC06: 反向链接查询 API

**现状**：无法查"哪些页面引用了这个页面"

**改动**：
- `page-store.ts` 新增 `getBacklinks(slug)` 查 `knowledge_page_links` 反向
- API: `GET /api/v1/knowledge/:slug/backlinks`
- 返回引用方页面列表 + 引用上下文

#### TODO-KC07: 悬空链接检测

**现状**：`[[xxx]]` 指向不存在的页面时无感知

**改动**：
- `parseBacklinks()` 时记录 dangling links
- 新增 `knowledge_dangling_links` 表或字段
- API: `GET /api/v1/knowledge/dangling` 列出所有悬空链接
- 下次 compile 优先为 dangling link 创建页面

#### TODO-KC08: 证据详情 API

**现状**：无法查"这个知识页的每段话依据是什么"

**改动**：
- API: `GET /api/v1/knowledge/:id/evidence` 返回该页所有 evidence
- 每条 evidence 含原始 L1/L2 记忆内容 + 引用段落
- Console 点击段落可展开证据溯源

### P2 — 可以做（增强体验）

#### TODO-KC09: 知识图谱可视化

**依赖**：TODO-KC02 链接落地

**改动**：
- Console 新增 Knowledge Graph 页面
- 节点 = knowledge_pages，边 = knowledge_page_links
- 力导向布局，按 tag/domain/confidence 着色
- 点击节点跳转页面详情

#### TODO-KC10: Block Reference / 内容嵌入

**对标**：Roam 的 `((block-ref))` 和 Obsidian 的 `![[embed]]`

**改动**：
- 页面内容支持 `![[slug#section]]` 嵌入语法
- 渲染时替换为目标段落内容
- 修改源段落时所有嵌入自动更新

#### TODO-KC11: 知识页 MCP 工具暴露

**现状**：MCP 只有 `search_memory`，没有 `search_knowledge`

**改动**：
- 新增 MCP tool `search_knowledge(query)` 搜索知识页
- 新增 MCP tool `get_knowledge_page(slug)` 获取完整知识页内容
- 让 AI 助手能直接查询结构化知识而非原始记忆

---

## 四、验收标准

### P0 验收
- 跑一轮 dream，`knowledge_page_evidence` 表有数据（>0 条）
- `knowledge_page_links` 表有数据（>0 条）
- 审计标记不再堆积（同一页面同类型标记 ≤1 条）
- 增量编译保留已有内容（compile_count 增加但 content 不是全量重写）

### P1 验收
- `GET /api/v1/knowledge?tag=xxx&min_confidence=0.7` 返回筛选结果
- `GET /api/v1/knowledge/:slug/backlinks` 返回反向链接
- `GET /api/v1/knowledge/dangling` 返回悬空链接

### P2 验收
- Console Knowledge Graph 页面可渲染
- `![[slug#section]]` 嵌入语法可渲染
- MCP `search_knowledge` 工具可用

---

## 五、风险与决策

| 风险 | 决策 | 理由 |
|------|------|------|
| 增量编译的 LLM 差异分析可能不准 | 保留全量重写作为 fallback | 差异分析失败时退回全量，保证可用性 |
| 证据约束让 LLM 输出变保守 | 无证据段落 confidence 降权但不删除 | 保留 LLM 的推理能力，只是标注可信度 |
| 链接解析正则可能误匹配 | 只匹配 `[[` 开头 `]]` 结尾且内部无空格的 | 保守匹配，宁可漏链不可错链 |
| 审计即修复可能改坏内容 | 修复前后都存版本历史 | 可回滚 |

---

_本文档为 Knowledge Compile 重新设计基线，实施过程中可根据验证结果调整。_
