# MiniMem 系统完整处理流程

> 基于源码审计（79 个 TypeScript 文件）生成，用于审查设计疏漏与不合理之处。

---

## 目录

1. [系统启动流程](#1-系统启动流程)
2. [记忆感知管道 (Perception)](#2-记忆感知管道)
3. [事实处理管道 (Processing)](#3-事实处理管道)
4. [整合管道 (Consolidation)](#4-整合管道)
5. [检索引擎 (Retrieval)](#5-检索引擎)
6. [Dream 引擎](#6-dream-引擎)
7. [生命周期管理 (Lifecycle)](#7-生命周期管理)
8. [版本控制 (Version)](#8-版本控制)
9. [Surface Files 管理](#9-surface-files-管理)
10. [Knowledge Pages (Karpathy Compile)](#10-knowledge-pages)
11. [Owner / Person 档案管理](#11-owner--person-档案管理)
12. [调度器 (Scheduler)](#12-调度器)
13. [双网关 (Gateway)](#13-双网关)
14. [认证与限流](#14-认证与限流)
15. [磁盘持久化策略](#15-磁盘持久化策略)
16. [数据流依赖图](#16-数据流依赖图)
17. [潜在疏漏与设计问题清单](#17-潜在疏漏与设计问题清单)

---

## 1. 系统启动流程

**文件**: `src/index.ts`

```
1. loadConfig(configPath)          ← 读取 TOML + 环境变量覆盖
2. initLogger(config, dataDir)     ← 初始化 pino 日志（dev: pretty, prod: file+stdout）
3. 解析 CLI 参数                    ← 判断 mcp / rest 模式
4. initDb(dbPath)                  ← 打开 SQLite, 启用 WAL 模式
5. runMigrations(db)               ← 创建 28 张表 + 1 FTS5 虚拟表
6. loadVectorFromDisk(dataDir)     ← 从 data/vectors/vector-index.json 恢复向量存储
7. 启动服务器
   ├─ MCP 模式 → 启动 stdio MCP Server (27 tools)
   └─ REST 模式 → 启动 Hono HTTP Server (20+ endpoints)
8. 注册 shutdown handlers (SIGINT/SIGTERM)
   ├─ saveToDisk(dataDir)          ← 保存向量存储到磁盘
   └─ db.close()                   ← 关闭数据库连接
```

**⚠️ 审查点**:
- 启动时未启动 Scheduler（定时任务），需手动或通过 API 触发？
- shutdown 时未同步 Surface Files 到磁盘？
- 启动时未执行 dream recovery（恢复中断的 dream session）？

---

## 2. 记忆感知管道

**文件**: `src/core/perception.ts`  
**入口**: `ingestExperience(input, db, config)`  
**作用**: 将原始内容摄入为 L1 Experience

```
步骤 1: 内容验证
  ├─ 检查 content 非空
  ├─ 检查长度 ≤ config.ingest.max_content_length (默认 10000)
  └─ 失败 → 返回错误，不继续

步骤 2: 文本清理 (cleanText)
  ├─ trim 首尾空白
  ├─ 合并连续空行为单个空行
  └─ 合并连续空格为单个空格

步骤 3: 哈希去重
  ├─ SHA-256(cleaned_content) → content_hash
  ├─ 查询 experiences 表是否已存在该 hash
  └─ 重复 → 返回 duplicate 提示，不继续

步骤 4: PII 检测与脱敏 (detectAndMaskPII)
  ├─ 正则匹配 6 类 PII:
  │   ├─ credit_card: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/
  │   ├─ phone_cn: /\b1[3-9]\d{9}\b/
  │   ├─ id_card_cn: /\b\d{17}[\dXx]\b/
  │   ├─ email: /\b[\w.-]+@[\w.-]+\.\w{2,}\b/
  │   ├─ api_key: /\b(sk|pk|api[_-]?key)[_-][\w]{20,}\b/i
  │   └─ password: /(?:password|passwd|pwd)\s*[:=]\s*\S+/i
  ├─ 替换为 [PII_TYPE_MASKED]
  └─ 记录检测到的 PII 类型列表

步骤 5: 质量门控 (LLM)
  ├─ 调用 LLM (light model) 评估内容质量
  ├─ 返回 pass/fail + 原因
  └─ fail → 返回质量不达标，不继续

步骤 6: 重要性评分 (LLM)
  ├─ 调用 LLM (light model) 评估重要性
  └─ 返回 0.0-1.0 分数

步骤 7: NER 实体抽取 (LLM)
  ├─ 调用 LLM (light model) 提取命名实体
  └─ 返回 entities 数组 [{type, value}]

步骤 8: 向量嵌入
  ├─ 调用 LLM.embed(content) 生成向量
  └─ 失败 → 记录警告，继续（无向量）

步骤 9: 写入 L1 Experience
  ├─ INSERT INTO experiences (id, content, raw_content, source, ...)
  └─ 同时写入 metadata (importance, entities, pii_types)

步骤 10: 更新向量存储
  ├─ vectorStore.upsert(embeddingId → memoryId)
  └─ 关联向量 ID 与记忆 ID

步骤 11: 条件索引
  ├─ 提取 entities 中的每个 entity
  └─ addConditionIndex(entity.type, entity.value, memoryId)

步骤 12: FTS 全文索引
  └─ addToFts(memoryId, content)
```

**⚠️ 审查点**:
- 步骤 5/6/7 三次 LLM 调用串行执行，能否合并为一次调用减少延迟？
- PII 脱敏后的内容写入 `content`，原始内容写入 `raw_content`？还是都写脱敏后的？（当前代码：都写脱敏后的内容，raw_content 也是脱敏后的）
- 向量嵌入失败时只记录警告，该记忆将无法被语义搜索命中

---

## 3. 事实处理管道

**文件**: `src/core/processing.ts`  
**入口**: `processExperiences(db, config)` / `processAllPending(db, config)`  
**作用**: 从 L1 Experience 提取 L2 World Facts

```
步骤 1: 获取未处理 L1
  ├─ SELECT FROM experiences WHERE processed = 0
  └─ 按 batchSize 分批（默认 10 条/批）

步骤 2: 批量事实抽取 (LLM)
  ├─ 对每批 L1，调用 LLM (medium model)
  ├─ Prompt: factExtractionPrompt — 提取 subject/predicate/object 三元组
  └─ 返回 facts[] 数组

步骤 3: 批量写入 L2 World Facts
  ├─ createWorldFactsBatch(facts)
  └─ 每条 fact: INSERT INTO world_facts

步骤 4: 建立条件索引
  └─ 对每条 fact 的 subject → addConditionIndex

步骤 5: 建立 FTS 索引
  └─ addToFts(factId, subject + predicate + object)

步骤 6: 建立图链接
  ├─ L1 → L2: createLink(experienceId, factId, 'derived_from')
  └─ L2 ↔ L2: 同一批次中同 subject 的 facts → createLink(factA, factB, 'related')

步骤 7: 标记 L1 已处理
  └─ UPDATE experiences SET processed = 1

步骤 8: processAllPending 循环
  ├─ 重复步骤 1-7，直到无未处理记录
  └─ 受 maxBatches 限制（默认 100）
```

**⚠️ 审查点**:
- L2 fact 没有生成向量嵌入，无法被语义搜索直接命中？
- 同 subject 的 related 链接只在同一批次内建立，跨批次的 related 关系会丢失
- 没有对 LLM 返回的 facts 做去重（同一 L1 可能抽出重复三元组）

---

## 4. 整合管道

**文件**: `src/core/consolidation.ts`

### 4.1 L2→L3 蒸馏观察 (distillObservations)

```
步骤 1: 查找可蒸馏的 subjects
  ├─ SELECT subject, COUNT(*) FROM world_facts GROUP BY subject
  └─ 过滤 count ≥ 3 的 subject

步骤 2: 对每个 subject
  ├─ 获取该 subject 所有 L2 facts
  ├─ 调用 LLM (medium model) 分析模式
  │   └─ Prompt: 从多条事实中归纳出观察/模式
  ├─ 创建 L3 Observation
  │   └─ INSERT INTO observations (subject, pattern, confidence, ...)
  └─ 建立图链接: facts → observation (derived_from)
```

### 4.2 L3→L4 提升心智模型 (promoteToMentalModels)

```
步骤 1: 查找高置信度 L3
  └─ SELECT FROM observations WHERE confidence ≥ 0.7

步骤 2: 对每条高置信 L3
  ├─ 调用 LLM (heavy model) 泛化为原则
  │   └─ Prompt: 从观察提炼为通用心智模型/原则
  ├─ 创建 L4 Mental Model
  │   └─ INSERT INTO mental_models (title, principle, confidence, ...)
  └─ 建立图链接: observation → mental_model (derived_from)
```

### 4.3 冲突检测 (detectConflicts)

```
步骤 1: 查找 L2 冲突
  ├─ 同一 subject + predicate 但不同 object
  └─ 返回冲突对列表

步骤 2: 查找 Knowledge Page 冲突
  ├─ 过期页面（超过配置天数未更新）
  └─ 标记为 stale 的页面
```

**⚠️ 审查点**:
- L3/L4 没有生成向量嵌入？（与 L2 同样的问题）
- distillObservations 的阈值 3 是硬编码的，不可配置
- 冲突检测只发现冲突，没有自动解决逻辑（需要人工介入？还是 Dream 阶段处理？）
- promoteToMentalModels 没有检查是否已存在同 title 的 L4，可能产生重复

---

## 5. 检索引擎

**文件**: `src/retrieval/search.ts`  
**入口**: `searchMemory(query, options, db, config)`

```
步骤 1: 查询规划 (planQuery) — LLM
  ├─ 调用 LLM (light model) 作为 MemSifter
  ├─ 输入: query + L4 mental model 摘要列表
  └─ 输出: 查询计划 {
       keywords: string[],        ← FTS 关键词
       semantic_query: string,    ← 语义搜索重写
       graph_seeds: string[],     ← 图遍历起点
       time_range?: {start, end}, ← 时间范围
       target_layers: number[],   ← 目标层级
       strategy: string           ← 搜索策略描述
     }

步骤 2: 6 路并行搜索
  ├─ Route 1: 语义搜索 (Semantic)
  │   ├─ embed(semantic_query) → 查询向量
  │   ├─ vectorStore.search(queryVector, topK)
  │   └─ 返回 cosine similarity 排序结果
  │
  ├─ Route 2: 关键词搜索 (Keyword)
  │   ├─ searchFts(keywords)
  │   └─ 返回 BM25 排序结果
  │
  ├─ Route 3: 图遍历 (Graph)
  │   ├─ 对每个 graph_seed → traverseGraph(seed, maxHops=3)
  │   └─ BFS N-hop 展开，返回关联记忆
  │
  ├─ Route 4: 时间搜索 (Temporal)
  │   ├─ 按 time_range 过滤
  │   └─ SELECT WHERE created_at BETWEEN start AND end
  │
  ├─ Route 5: 条件索引 (Condition)
  │   ├─ 对每个 keyword → lookupByCondition / lookupByPrefix
  │   └─ 返回精确匹配 + 前缀匹配结果
  │
  └─ Route 6: Knowledge Page 搜索
      ├─ searchKnowledgePages(query)
      └─ LIKE 模糊匹配标题和内容

步骤 3: 去重合并
  └─ 按 memoryId 去重，保留最高分

步骤 4: 层级加权评分
  ├─ L4 (Mental Model):  weight = 1.0
  ├─ L3 (Observation):   weight = 0.85
  ├─ L2 (World Fact):    weight = 0.7
  └─ L1 (Experience):    weight = 0.5

步骤 5: 内容充实 (enrichResults)
  └─ 对每条结果，从对应层级表查询完整内容

步骤 6: LLM 重排序 (Rerank)
  ├─ 调用 LLM (light model)
  ├─ 输入: query + 候选结果列表
  └─ 输出: 重排序后的结果 + relevance 分数

步骤 7: 查询回写 (Query Writeback)
  ├─ LLM 判断是否产生跨域洞察
  └─ 有洞察 → enqueueCompile(type='query_insight', content)
```

**⚠️ 审查点**:
- 6 路搜索是真正并行(Promise.all)还是串行？
- graph_seeds 如何从字符串映射到具体的 memoryId？
- L2/L3/L4 没有向量嵌入，语义搜索只能命中 L1
- Knowledge Page 搜索用 LIKE 而非 FTS5，性能较差
- 查询回写可能在高频搜索时产生大量 compile_queue 条目

---

## 6. Dream 引擎

**文件**: `src/modules/dream/dream-engine.ts` (主编排器)

### 总体流程

```
0. 前置安全措施
   ├─ createSnapshot(db, 'main') → preDreamSnapshot
   ├─ createBranch(db, 'dream-{timestamp}', preDreamSnapshot.id)
   └─ 后续操作在 dream 分支上进行

1. Phase 1: Audit (审计)     → auditor.ts
2. Phase 2: Compile (编译)   → compiler.ts
3. Phase 3: REM Dream (做梦) → dreamer.ts
4. Phase 4: Cleanup (清理)   → cleaner.ts

5. 生成报告
   ├─ generateDreamReport(allPhaseResults)
   ├─ dreamReportToMarkdown(report)
   └─ saveDreamReportToDisk(markdown, json, dataDir) → data/dreams/

6. 同步 Surface Files
   └─ syncAllSurfacesToDisk(db, dataDir)

7. 写入 dream_logs
   └─ INSERT INTO dream_logs (session, phases, duration, ...)
```

### Phase 1: Audit (审计阶段)

**文件**: `src/modules/dream/auditor.ts`

```
步骤 1: 扫描新记忆
  ├─ SELECT FROM experiences WHERE created_at > (now - 24h)
  └─ 获取最近 24 小时的 L1 记忆

步骤 2: 按重要性分类
  ├─ critical:  importance ≥ 0.8
  ├─ important: importance ≥ 0.6
  ├─ routine:   importance ≥ 0.3
  └─ trivial:   importance < 0.3

步骤 3: 检测事实冲突
  ├─ 调用 consolidation.detectConflicts()
  └─ 返回 L2 冲突对 + 过期 Knowledge Pages

步骤 4: Knowledge Page Lint
  ├─ staleness 检查: 超过 N 天未更新的页面
  ├─ broken links 检查: 引用了不存在的记忆
  ├─ missing evidence 检查: 缺少证据链的页面
  └─ 将 lint 发现 → enqueueCompile(type='lint_finding')

步骤 5: 输出审计报告
  └─ { newMemories, classification, conflicts, lintFindings }
```

### Phase 2: Compile (编译阶段)

**文件**: `src/modules/dream/compiler.ts`

```
步骤 1: L1→L2 事实抽取
  └─ 调用 processing.processAllPending(db, config)

步骤 2: L2→L3 蒸馏观察
  └─ 调用 consolidation.distillObservations(db, config)

步骤 3: L3→L4 提升心智模型
  └─ 调用 consolidation.promoteToMentalModels(db, config)

步骤 4: 处理 Compile Queue (Karpathy Compile)
  ├─ getPendingCompileItems(db)
  ├─ 对每条待处理项:
  │   ├─ type='new_fact' → LLM 决定创建/更新哪个 Knowledge Page
  │   ├─ type='query_insight' → LLM 整合跨域洞察到相关页面
  │   ├─ type='feedback' → LLM 根据反馈更新页面
  │   └─ type='lint_finding' → LLM 修复页面问题
  ├─ 创建/更新 Knowledge Pages
  └─ markCompiledBatch(processedIds)

步骤 5: 更新 index.md
  └─ 重新生成 Knowledge Pages 目录索引
```

### Phase 3: REM Dream (做梦阶段)

**文件**: `src/modules/dream/dreamer.ts`

```
步骤 1: 随机种子选择
  ├─ 从最近记忆中随机选取 5 条作为 seed
  └─ 混合不同层级的记忆

步骤 2: 向量空间随机游走
  ├─ 对每个 seed → vectorStore.randomWalk()
  ├─ 相似度范围 0.3-0.7（既不太近也不太远）
  └─ 发现"意想不到"的关联记忆

步骤 3: 图遍历发现
  ├─ 对每个 seed → traverseGraph(seed, maxHops=3)
  ├─ 每个 seed 最多 10 个结果
  └─ 沿知识图谱发现关联链

步骤 4: 跨层配对
  ├─ L1 experiences × L3 observations
  └─ 生成跨层配对组合

步骤 5: LLM 创意联想
  ├─ 调用 LLM (heavy model, temperature=0.8)
  ├─ 输入: 跨层配对 + 随机游走发现
  └─ 输出: 创意联想/洞察 [{content, novelty, connections}]

步骤 6: 创建图链接
  └─ 对 LLM 发现的关联 → createLink(memA, memB, 'dream_association')

步骤 7: 高新颖度洞察入队
  ├─ 筛选 novelty ≥ 0.7 的洞察
  └─ enqueueCompile(type='query_insight', content)
```

### Phase 4: Cleanup (清理阶段)

**文件**: `src/modules/dream/cleaner.ts`

```
步骤 1: 标准 GC
  └─ 调用 lifecycle.runStandardGC(db, config)

步骤 2: 处理 Surface 更新队列
  └─ surface.processUpdateQueue(db, config)

步骤 3: 后置快照
  └─ createSnapshot(db, dreamBranch) → postDreamSnapshot

步骤 4: Diff 计算
  └─ diffSnapshots(preDreamSnapshot, postDreamSnapshot)

步骤 5: 合并 Dream 分支
  └─ mergeBranch(db, dreamBranch, 'main')

步骤 6: 停用 Dream 分支
  └─ deactivateBranch(db, dreamBranch)
```

**⚠️ Dream 引擎审查点**:
- Dream 分支机制：所有 Phase 1-3 的写入是在 dream 分支还是 main 分支上？（代码中 branch 参数传递需确认）
- Phase 2 中 Karpathy Compile 的 LLM 调用可能很多（每个 compile_queue 项一次），需要限流
- Phase 3 的 randomWalk 只能在有向量的 L1 记忆上进行，L2/L3/L4 被排除
- 如果 Phase 3 或 Phase 4 失败，已完成的 Phase 1-2 结果如何回滚？
- Dream 恢复机制（dream/recovery.ts）：找到未完成 session，<24h 则从上次阶段恢复，否则放弃。但恢复时 dream 分支状态是否一致？

---

## 7. 生命周期管理

**文件**: `src/lifecycle/index.ts`, `compressor.ts`, `forget.ts`, `health.ts`, `recovery.ts`

### 7.1 温度模型

```
温度范围: 0-100 分
等级划分:
  ├─ hot:    ≥ 80
  ├─ warm:   ≥ 60
  ├─ cool:   ≥ 40
  ├─ cold:   ≥ 20
  └─ frozen: < 20

初始化: initTemperature(memoryId)
  └─ INSERT INTO memory_temperature (id, score=50, level='cool', ...)

访问加热: recordAccess(memoryId)
  └─ score = min(100, score + 5)

周期衰减: decayTemperatures(db, amount)
  └─ UPDATE SET score = max(0, score - amount) WHERE pinned = 0

固定: pinMemory(memoryId)
  └─ pinned = 1, 免疫衰减
```

### 7.2 GC 层级体系

```
┌─────────────────────────────────────────────────────┐
│ Light GC (每 6 小时)                                 │
│  ├─ decayTemperatures(db, 2)     ← 全局衰减 -2      │
│  └─ 噪声过滤: 删除 importance < 0.1 的 L1           │
├─────────────────────────────────────────────────────┤
│ Standard GC (每天 4am)                               │
│  ├─ 包含 Light GC 全部                               │
│  ├─ 过期事实: 删除超过 retention_days 的 L2           │
│  └─ 标记压缩: 将 frozen 记忆加入压缩候选队列          │
├─────────────────────────────────────────────────────┤
│ Deep GC (每周日 5am)                                 │
│  ├─ 包含 Standard GC 全部                            │
│  ├─ 配额检查: 总记忆数 vs max_memories               │
│  └─ 来源信誉: 高 gc_cleaned_rate 的来源 → 惩罚权重   │
├─────────────────────────────────────────────────────┤
│ Emergency GC (总量 > 80% 配额时触发)                  │
│  ├─ 激进删除 frozen 记忆                              │
│  ├─ 激进删除 cold 记忆                                │
│  └─ 目标: 降至 60% 配额以下                           │
└─────────────────────────────────────────────────────┘
```

### 7.3 渐进式压缩

**文件**: `src/lifecycle/compressor.ts`

```
Level 0 → Level 1 (30 天无访问)
  ├─ LLM 生成摘要
  └─ 替换 raw_content 为摘要

Level 1 → Level 2 (60 天无访问)
  ├─ LLM 提取关键点
  └─ 替换为关键点列表

Level 2 → Level 3 (90 天无访问)
  ├─ LLM 生成一句话总结
  └─ 替换为单行描述

更新: memory_temperature.compression_level
```

### 7.4 级联遗忘

**文件**: `src/lifecycle/forget.ts`  
**入口**: `forgetAbout(topic, db, options)`

```
步骤 1: 搜索所有层级
  ├─ L1: experiences WHERE content LIKE '%topic%'
  ├─ L2: world_facts WHERE subject/predicate/object LIKE '%topic%'
  ├─ L3: observations WHERE subject/pattern LIKE '%topic%'
  ├─ L4: mental_models WHERE title/principle LIKE '%topic%'
  └─ Pages: knowledge_pages WHERE title/content LIKE '%topic%'

步骤 2: (dry_run 模式则只返回匹配列表)

步骤 3: 事务内执行删除
  ├─ 创建 tombstones (记录被删记忆的元信息)
  ├─ 删除 L1 experiences
  ├─ 删除 L2 world_facts
  ├─ 删除 L3 observations
  ├─ 删除 L4 mental_models
  └─ 删除 knowledge_pages

步骤 4: 清理关联索引
  ├─ condition_index (按 memory_id)
  ├─ memory_fts (removeFromFts)
  ├─ memory_temperature
  ├─ memory_links (deleteNodeLinks)
  └─ knowledge_page_evidence

步骤 5: 审计日志
  └─ createAuditLog('forget', { topic, deleted_counts })
```

### 7.5 健康检查

**文件**: `src/lifecycle/health.ts`

```
检查项:
  ├─ 各层记忆数量 (L1/L2/L3/L4/Pages)
  ├─ 温度分布 (hot/warm/cool/cold/frozen 各多少)
  ├─ 存储统计 (向量数、图边数、FTS 条目数)
  ├─ GC 统计 (最近运行时间、清理数量)
  ├─ Dream 统计 (最近 dream 时间、session 数)
  └─ 告警条件:
     ├─ frozen 占比 > 50%
     ├─ 向量覆盖率低
     ├─ 距上次 dream > 72 小时
     └─ 未处理 L1 > 100 条
```

**⚠️ 生命周期审查点**:
- GC 删除记忆时，是否同步清理向量存储中的对应条目？
- Emergency GC 激进删除时，是否检查被删记忆是否被 Knowledge Page 引用？
- 压缩覆盖 raw_content 后，原始内容永久丢失，是否需要保留原始版本？
- 遗忘时 LIKE 搜索可能遗漏内容（如 topic 在 JSON metadata 中）
- 来源信誉惩罚：gc_cleaned_rate 高说明该来源产出低质量内容，但惩罚机制如何影响后续摄入？

---

## 8. 版本控制

**文件**: `src/version/snapshot.ts`, `branch.ts`, `diff.ts`, `merge.ts`, `rollback.ts`, `audit.ts`

### 8.1 快照 (Snapshot)

```
createSnapshot(db, branchName):
  ├─ 统计各层记忆数 (L1/L2/L3/L4/Pages)
  ├─ INSERT INTO snapshots (id, branch, stats, ...)
  └─ saveSnapshotToDisk(snapshot, dataDir) → data/snapshots/{id}.json
```

### 8.2 分支 (Branch)

```
createBranch(db, name, fromSnapshotId):
  └─ INSERT INTO branches (name, from_snapshot, active=1, ...)

deactivateBranch(db, name):
  └─ UPDATE branches SET active = 0

deleteBranch(db, name):
  └─ 级联删除该分支上的所有数据
```

### 8.3 Diff 比较

```
diffSnapshots(db, snapshotA, snapshotB):
  ├─ 计算时间窗口 (A.created_at → B.created_at)
  ├─ 对每个层级:
  │   ├─ added: 时间窗口内新增的记忆 IDs
  │   └─ removed: 时间窗口内被 tombstone 的 IDs
  ├─ 计算 significance 分数
  └─ 生成 summary 文本
```

### 8.4 合并 (Merge)

```
mergeBranch(db, sourceBranch, targetBranch):
  ├─ 前置快照: createSnapshot(source) + createSnapshot(target)
  ├─ 事务内合并:
  │   ├─ L1: 检查 content_hash 避免重复
  │   ├─ L2: 检查 subject+predicate+object 避免重复
  │   ├─ L3: 直接复制
  │   ├─ L4: 检查 title 避免重复
  │   └─ Pages: 检查 slug 避免重复
  ├─ 后置快照
  └─ 审计日志
```

### 8.5 回滚 (Rollback)

```
rollbackToSnapshot(db, snapshotId):
  ├─ 安全快照: 先对当前状态做快照
  ├─ 获取目标快照的 created_at 作为 cutoff
  ├─ 删除 cutoff 之后的所有记录:
  │   ├─ experiences, world_facts, observations, mental_models
  │   ├─ knowledge_pages
  │   └─ 及相关的 links, temperature, fts, condition_index
  ├─ 清理悬挂的 condition_index (引用不存在的记忆)
  ├─ 清理悬挂的 memory_fts
  └─ 审计日志
```

**⚠️ 版本控制审查点**:
- 分支隔离：当前代码中各层 CRUD 是否真正按 branch 过滤？（需确认 SQL WHERE 条件）
- Merge 时 L3 "直接复制"不去重，可能产生重复观察
- Rollback 后向量存储中的对应条目是否同步清理？
- Diff 只统计增删，不统计修改（如 L2 fact 的 object 变化）
- 审计日志只记录操作元信息，不记录具体变更内容

---

## 9. Surface Files 管理

**文件**: `src/surface/index.ts`

### 8 个 Surface Files

| 文件 | 用途 | Token 预算 |
|------|------|-----------|
| me.md | 自我认知 | 2000 |
| soul.md | 价值观/原则 | 1500 |
| work.md | 工作相关 | 2000 |
| social.md | 社交网络 | 1500 |
| life.md | 日常生活 | 1500 |
| agent.md | Agent 行为偏好 | 1000 |
| context.md | 当前上下文 | 500 |
| index.md | Knowledge Pages 索引 | 自动 |

**总预算**: ≤ 10K tokens

### 更新流程

```
updateSurfaceFile(db, fileName, content, source):
  ├─ Token 检查: content tokens ≤ file budget
  ├─ 超出则截断
  ├─ 写入 surface_files 表
  ├─ 写入 surface_file_history (版本历史)
  └─ syncSurfaceToDisk(fileName, content, dataDir)

smartUpdateSurfaceFile(db, fileName, newInfo, config):
  ├─ 读取当前内容
  ├─ 调用 LLM 智能合并
  │   └─ Prompt: 将新信息整合到现有内容中，保持在 token 预算内
  ├─ 写入合并后内容
  └─ 版本历史 + 磁盘同步

processUpdateQueue(db, config):
  ├─ SELECT FROM surface_update_queue ORDER BY priority
  ├─ 对每条更新 → smartUpdateSurfaceFile
  └─ 处理完成后删除队列项
```

**Agent 类型映射**:
```
agent 类型 → 加载哪些 surface files:
  ├─ personal_assistant → me, soul, life, context
  ├─ work_assistant → me, work, context
  ├─ social_companion → me, social, soul, context
  └─ general → 全部
```

**⚠️ Surface Files 审查点**:
- Token 预算的计算方式？是简单的字符数估算还是真正的 tokenizer？
- LLM 智能合并可能丢失重要旧信息
- context.md 只有 500 tokens，可能不足以描述复杂上下文
- index.md 是自动生成的，但在 Dream Phase 2 中更新，日常添加 Knowledge Page 时不会自动更新？

---

## 10. Knowledge Pages

**文件**: `src/store/knowledge-pages/page-store.ts`, `compile-queue.ts`

### Knowledge Page 结构

```
{
  id, slug, title, type,      ← 标识
  content, summary,            ← 内容
  confidence,                  ← 置信度
  lint_status, lint_details,   ← Lint 状态
  evidence_count,              ← 证据数量
  created_at, updated_at       ← 时间戳
}
```

### Compile Queue 类型

| 类型 | 来源 | 处理方式 |
|------|------|---------|
| new_fact | Processing 阶段产出 L2 | LLM 判断创建/更新页面 |
| query_insight | 检索回写 | LLM 整合到相关页面 |
| feedback | 用户反馈 | LLM 修正页面内容 |
| lint_finding | Dream Audit | LLM 修复问题 |

### Evidence Chain (证据链)

```
knowledge_page_evidence 表:
  ├─ page_id → 所属页面
  ├─ memory_id → 支撑记忆
  ├─ memory_layer → 来自哪个层级
  └─ relevance → 相关度

knowledge_page_links 表:
  ├─ from_page → 源页面
  ├─ to_page → 目标页面
  └─ link_type → 关系类型
```

### Lint 系统

```
检查项:
  ├─ staleness: updated_at > N 天前
  ├─ broken_links: 引用的 page 不存在
  └─ missing_evidence: evidence_count = 0

处理: Dream Phase 1 检测 → enqueue → Phase 2 修复
```

**⚠️ Knowledge Pages 审查点**:
- Knowledge Page 没有版本历史（不像 Surface Files 有 history 表）
- 页面删除时是否清理 compile_queue 中引用该页面的条目？
- evidence 中的 memory_id 被 GC 删除后，evidence 成为悬挂引用
- Lint 只在 Dream 时运行，日常操作可能长时间积累问题

---

## 11. Owner / Person 档案管理

### 11.1 Owner Profile

**文件**: `src/owner/profile.ts`

```
数据结构: KV 存储
  key: "category.subcategory.item" (如 "basics.name", "preferences.language")
  value: { value, confidence, source, updated_at }

操作:
  ├─ setProfileEntry(key, value, confidence, source)  ← upsert
  ├─ getProfileEntry(key)
  ├─ getProfileByCategory(category)
  ├─ getFullProfile() → 嵌套对象
  ├─ getProfileByPrefix(prefix)
  └─ batchSet / batchGet
```

### 11.2 Person Profiles

**文件**: `src/owner/persons.ts`

```
数据结构: {
  id, name, aliases[],
  personality, interests[], opinions[],
  speech_patterns[],
  relationships: [{target, type, strength}],
  last_interaction, interaction_count
}

操作:
  ├─ createPerson(name, info)
  ├─ findByName(name)
  │   ├─ 精确匹配 name
  │   ├─ 别名匹配 aliases (JSON LIKE)
  │   └─ 模糊匹配 (LIKE '%name%')
  ├─ updatePerson(id, changes)
  ├─ appendPersonInfo(id, newInfo)  ← 增量合并
  ├─ touchPerson(id)  ← 更新 last_interaction + count++
  └─ deletePerson(id)
```

### 11.3 偏好推理

**文件**: `src/owner/preferences.ts`

```
recordPreference(key, value, confidence, source):
  ├─ 已有同值 → boost confidence (取更高值)
  ├─ 已有不同值 + 新 confidence 更高 → 替换
  └─ 已有不同值 + 新 confidence 更低 → 降低旧值 confidence

getStrongPreferences(threshold=0.7):
  └─ 返回 confidence ≥ threshold 的偏好
```

### 11.4 新用户引导 (Onboarding)

**文件**: `src/core/onboarding.ts`

```
步骤 1: 设置基础 profile
  ├─ name, occupation, language
  ├─ personality, interests[], goals[]
  └─ 写入 owner_profile

步骤 2: 为兴趣创建记忆
  └─ 每个 interest → ingestExperience("User is interested in {interest}")

步骤 3: 为目标创建记忆
  └─ 每个 goal → ingestExperience("User's goal: {goal}")

步骤 4: 创建重要人物记忆
  └─ 每个 person → createPerson + ingestExperience

步骤 5: 标记完成
  └─ setProfileEntry('system.onboarding_completed', true)
```

**⚠️ Owner/Person 审查点**:
- Person aliases 存为 JSON 字符串，搜索时用 LIKE，性能不佳且不精确
- 偏好推理中 "降低旧值 confidence" 的幅度是固定的还是可配置的？
- Onboarding 创建的记忆会走完整的 perception 管道（含 LLM 调用），初始化成本较高

---

## 12. 调度器

**文件**: `src/scheduler/index.ts`

### 定时任务矩阵

| 任务 | Cron 表达式 | 频率 | 调用 |
|------|------------|------|------|
| Light GC | `0 */6 * * *` | 每 6 小时 | `runLightGC()` |
| Standard GC | `0 4 * * *` | 每天 4:00 | `runStandardGC()` |
| Deep GC | `0 5 * * 0` | 每周日 5:00 | `runDeepGC()` |
| Daily Dream | `0 3 * * *` | 每天 3:00 | `dreamEngine.run('daily')` |
| Weekly Dream | `0 4 * * 0` | 每周日 4:00 | `dreamEngine.run('weekly')` |
| Daily Summary | `0 18 * * 1-5` | 工作日 18:00 | `generateDailySummary()` |
| Backup | `0 2 * * *` | 每天 2:00 | `createBackup()` |
| Compression | Standard GC 后触发 | 每天 4:00+ | `runCompression()` |

### 自动触发

```
Auto Dream Trigger:
  ├─ 条件: 新记忆数 ≥ 50 (自上次 dream 以来)
  ├─ 检查频率: 每次 ingest 后检查
  └─ 触发: dreamEngine.run('auto')
```

**⚠️ 调度器审查点**:
- 每天 2:00 备份、3:00 Dream、4:00 GC — 连续三个重操作，是否会资源竞争？
- Weekly Dream (4:00) 和 Deep GC (5:00) 在周日连续执行，Dream 还在运行时 GC 可能冲突
- Scheduler 启动逻辑在 `src/index.ts` 中未见调用，是否通过其他入口启动？
- 没有任务锁机制，如果上一次 Dream 还未完成，下一次触发怎么处理？

---

## 13. 双网关

### 13.1 REST API

**文件**: `src/gateway/rest-api.ts` (Hono)

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | /memory | 添加记忆 |
| POST | /memory/batch | 批量添加 |
| GET | /memory/search | 搜索记忆 |
| GET | /memory/recall/:topic | 回忆特定主题 |
| GET | /memory/context | 获取相关上下文 |
| GET | /memory/:id | 按 ID 获取 |
| GET | /memory | 列出记忆 |
| PUT | /memory/:id | 更新记忆 |
| DELETE | /memory/:id | 删除记忆 |
| POST | /memory/forget | 级联遗忘 |
| POST | /memory/:id/pin | 固定记忆 |
| POST | /memory/:id/feedback | 反馈记忆 |
| POST | /memory/export | 导出（含 output_to_file） |
| POST | /memory/import | 导入 |
| GET | /owner/profile | 获取 Owner 档案 |
| GET | /owner/preference/:key | 获取偏好 |
| GET | /person/:name | 获取人物档案 |
| GET | /surface | 加载 Surface Files |
| GET | /surface/:name | 获取单个 Surface |
| POST | /surface/:name/suggest | 建议更新 Surface |
| POST | /dream/trigger | 触发 Dream |
| GET | /health | 健康检查 |
| GET | /admin/stats | 管理统计 |
| POST | /snapshot | 创建快照 |
| GET | /diff | Diff 比较 |

### 13.2 MCP Server

**文件**: `src/gateway/mcp-server.ts` (27 tools)

```
记忆操作:
  add_memory, add_memories_batch, search_memory, recall_about,
  get_relevant_context, get_memory_by_id, list_memories,
  update_memory, delete_memory, forget_about, pin_memory,
  feedback_memory

导入导出:
  export_memories, import_memories

Owner/Person:
  get_owner_profile, get_owner_preference, get_person_profile

Surface Files:
  load_surfaces, get_surface_file, suggest_surface_update

系统操作:
  trigger_dream, get_summary, create_snapshot, diff_memory,
  start_onboarding, get_memory_health
```

**⚠️ 网关审查点**:
- REST API 和 MCP Server 的功能是否完全对齐？（MCP 有 26 个 tool，REST 有 20+ endpoint）
- MCP 缺少: person 的 CRUD（只有 get）、rollback、merge、branch 操作
- REST 缺少: onboarding 入口？
- 批量添加只在 REST 有 /batch 端点，MCP 的 add_memories_batch 参数设计？
- 错误处理：REST 返回结构化错误码？MCP 返回什么格式？

---

## 14. 认证与限流

### 14.1 JWT 认证

**文件**: `src/gateway/auth.ts`

```
认证流程:
  ├─ config.auth.enabled = false → 默认 trusted 权限
  ├─ config.auth.enabled = true:
  │   ├─ 从 Authorization: Bearer <token> 提取 JWT
  │   ├─ 验证签名 + 过期时间
  │   └─ 提取 permission_level

权限等级:
  ├─ trusted:   全部权限
  ├─ standard:  读写，不能 dream/snapshot/admin
  └─ readonly:  只读

权限检查中间件:
  ├─ requireWrite      → trusted / standard
  ├─ requireDream      → trusted
  ├─ requireSnapshot   → trusted
  ├─ requireLayerRead  → 按配置限制可读层级
  └─ requirePermissionLevel(level)
```

### 14.2 滑动窗口限流

**文件**: `src/gateway/rate-limiter.ts`

```
全局限制:
  └─ 60 writes / minute

客户端限制:
  ├─ 20 writes / minute / client
  └─ 60 reads / minute / client

响应头:
  ├─ X-RateLimit-Limit
  ├─ X-RateLimit-Remaining
  └─ X-RateLimit-Reset

超限 → 429 Too Many Requests
```

**⚠️ 认证限流审查点**:
- MCP 模式下是否也走认证？（stdio 模式通常信任本地调用方）
- 限流器是否是内存的？重启后重置？集群部署不共享？
- readonly 权限能否触发搜索？搜索会触发查询回写（写操作）
- 没有 API Key 认证方式（除了 JWT），对简单集成不太友好

---

## 15. 磁盘持久化策略

### 15.1 数据目录结构

```
data/
├─ logs/          ← pino 日志文件 (自动轮转)
├─ dreams/        ← Dream 报告 (.md + .json)
├─ exports/       ← 导出文件 (timestamped JSON)
├─ snapshots/     ← 快照文件 (per-snapshot JSON)
├─ vectors/       ← 向量索引 (vector-index.json)
├─ surfaces/      ← Surface Files (.md)
└─ backups/       ← SQLite 备份 (含 WAL)
```

### 15.2 各组件持久化方式

| 组件 | 存储方式 | 何时写入 | 何时读取 |
|------|---------|---------|---------|
| 主数据库 | SQLite (WAL) | 实时 | 实时 |
| 向量存储 | 内存 Map + JSON 文件 | shutdown / 手动 | 启动时 |
| 日志 | pino multi-transport | 实时流式 | 外部工具查看 |
| Dream 报告 | .md + .json 文件 | Dream 完成后 | 按需查看 |
| 快照 | DB + JSON 文件 | 创建时 | 按需 |
| Surface Files | DB + .md 文件 | 更新时 | 启动/加载 |
| 导出 | JSON 文件 | API 调用时 | 外部使用 |
| 备份 | SQLite 文件拷贝 | 定时 2:00 | 手动恢复 |

### 15.3 备份流程

**文件**: `src/store/backup.ts`

```
createBackup(db, dataDir):
  ├─ SQLite .backup() API（含 WAL checkpoint）
  ├─ 保存到 data/backups/{timestamp}.db
  └─ applyRetentionPolicy: 保留最新 N 个备份

restoreBackup(backupPath, dbPath):
  ├─ 关闭当前连接
  ├─ 复制备份文件到 dbPath
  └─ 重新打开连接
```

**⚠️ 磁盘持久化审查点**:
- **关键问题**: 向量存储只在 shutdown 时保存，异常退出（kill -9、OOM）将丢失所有运行期间的向量更新
- 备份只备份 SQLite，不备份向量存储、Surface Files、日志等
- 没有 data/ 目录的初始化逻辑（首次运行时创建子目录？）
- Surface Files 在 DB 和磁盘上双写，以哪个为准？恢复时如何协调？

---

## 16. 数据流依赖图

```
用户输入
  │
  ▼
┌──────────────┐     ┌──────────────┐
│  Perception  │────▶│ L1 Experience │
│  (感知管道)   │     └──────┬───────┘
└──────────────┘            │
                            ▼
┌──────────────┐     ┌──────────────┐
│  Processing  │────▶│ L2 World Fact │
│  (处理管道)   │     └──────┬───────┘
└──────────────┘            │
                            ▼
┌──────────────┐     ┌──────────────┐
│Consolidation │────▶│L3 Observation │
│  (整合管道)   │     └──────┬───────┘
└──────────────┘            │
                            ▼
                     ┌──────────────┐
                     │L4 Mental Model│
                     └──────────────┘

横向关联:
  L1-L4 ──── Vector Store (仅 L1)
  L1-L4 ──── FTS Index (L1 + L2)
  L1-L4 ──── Condition Index (L1 + L2)
  L1-L4 ──── Knowledge Graph (全层)
  L1-L4 ──── Temperature Engine (全层?)
  L2    ──── Knowledge Pages (通过 compile_queue)

Dream 引擎依赖:
  Phase 1 → Consolidation (冲突检测) + Knowledge Pages (Lint)
  Phase 2 → Processing + Consolidation + Compile Queue
  Phase 3 → Vector Store + Knowledge Graph + LLM
  Phase 4 → GC + Surface Files + Version Control

检索引擎依赖:
  ← Vector Store, FTS, Graph, Condition Index, Knowledge Pages, LLM
  → Compile Queue (查询回写)
```

---

## 17. 潜在疏漏与设计问题清单

### 🔴 高优先级

| # | 问题 | 位置 | 描述 |
|---|------|------|------|
| 1 | **向量存储崩溃丢失** | `src/store/vectors.ts`, `src/index.ts` | 向量只在 shutdown 时保存到磁盘，异常退出将丢失全部运行时更新。建议增加周期性自动保存（如每 N 次更新或每 M 分钟）。 |
| 2 | **L2/L3/L4 无向量嵌入** | `src/core/processing.ts`, `consolidation.ts` | 只有 L1 生成向量，高层记忆无法被语义搜索命中。语义搜索实质上只搜索原始经验，无法搜到提炼后的知识。 |
| 3 | **GC 不清理向量** | `src/lifecycle/index.ts` | GC 删除记忆时未从 vectorStore 中移除对应条目，导致向量存储膨胀且搜索命中已删除记忆。 |
| 4 | **Dream 分支隔离不完整** | `src/modules/dream/` | 需确认 Processing/Consolidation 是否真正写入 dream 分支而非 main 分支，各层 CRUD 的 SQL 是否带 branch 条件。 |
| 5 | **调度器未在启动时初始化** | `src/index.ts` | 主入口文件未见 scheduler.start() 调用，定时任务可能不会自动运行。 |

### 🟡 中优先级

| # | 问题 | 位置 | 描述 |
|---|------|------|------|
| 6 | **三次串行 LLM 调用** | `src/core/perception.ts` | 质量门控、重要性评分、NER 三次 LLM 调用串行执行，可考虑合并为一次。 |
| 7 | **跨批次 related 链接缺失** | `src/core/processing.ts` | 同 subject 的 related 链接只在同一批次内建立，不同批次提取的同主题事实间无关联。 |
| 8 | **压缩覆盖原始内容** | `src/lifecycle/compressor.ts` | 压缩直接覆盖 raw_content，原始信息永久丢失。可考虑保留原始版本或创建压缩历史。 |
| 9 | **任务竞争无锁** | `src/scheduler/index.ts` | 无任务锁机制，长时间运行的 Dream 和 GC 可能并发冲突。 |
| 10 | **Evidence 悬挂引用** | `src/store/knowledge-pages/` | GC 删除记忆后，knowledge_page_evidence 中的 memory_id 成为悬挂引用。 |
| 11 | **Knowledge Page 无版本历史** | `src/store/knowledge-pages/page-store.ts` | 与 Surface Files 不同，Knowledge Page 更新无历史记录，无法追踪变更或回滚。 |
| 12 | **Shutdown 未同步 Surfaces** | `src/index.ts` | shutdown handler 只保存向量和关闭 DB，未同步 Surface Files 到磁盘。 |
| 13 | **备份不含向量和文件** | `src/store/backup.ts` | 备份只备份 SQLite，data/ 下的向量、dreams、surfaces 等文件不在备份范围内。 |

### 🟢 低优先级 / 改进建议

| # | 问题 | 位置 | 描述 |
|---|------|------|------|
| 14 | **PII 正则局限** | `src/core/perception.ts` | 只覆盖 6 类中国/通用 PII，缺少 SSN、护照号、银行账号等。 |
| 15 | **Knowledge Page 搜索用 LIKE** | `src/store/knowledge-pages/page-store.ts` | 不走 FTS5，大量页面时性能差。 |
| 16 | **Person aliases JSON LIKE** | `src/owner/persons.ts` | 别名存为 JSON 字符串用 LIKE 搜索，不精确且性能差。 |
| 17 | **Diff 不检测修改** | `src/version/diff.ts` | 只统计增删，不统计内容修改（如 fact 的 object 变化）。 |
| 18 | **MCP/REST 功能不对称** | `src/gateway/` | MCP 缺少 person CRUD、rollback、branch 操作；REST 缺少 onboarding。 |
| 19 | **data/ 目录初始化** | 多处 | 首次运行时各子目录的创建逻辑分散，缺少统一的 ensureDataDirs() 初始化。 |
| 20 | **温度引擎覆盖范围** | `src/lifecycle/index.ts` | 不确定 L2/L3/L4 是否有温度记录，还是只有 L1。如果没有，高层记忆无法被温度衰减和 GC 触及。 |
| 21 | **readonly 用户搜索触发写入** | `src/gateway/auth.ts`, `src/retrieval/search.ts` | readonly 权限可触发搜索，搜索的查询回写是写操作，存在权限冲突。 |
| 22 | **Dream Recovery 时分支一致性** | `src/modules/dream/recovery.ts` | 恢复中断的 dream session 时，dream 分支可能处于不一致状态（部分阶段完成）。 |

---

> 文档生成时间: 2026-04-07  
> 基于源码审计: 79 个 TypeScript 文件，13 个目录  
> 建议: 逐项审查 **🔴 高优先级** 问题，优先修复 #1（向量崩溃丢失）和 #2（高层无向量）

