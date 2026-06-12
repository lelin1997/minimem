# MiniMem 调度任务深度剖析（代码级）

> 本文档逐一拆解 MiniMem 的 9 个调度/事件触发动作，从调度入口到核心函数实现，精确到文件路径和行号。

---

## 目录

1. [调度器总架构](#1-调度器总架构)
2. [每日做梦 `0 3 * * *`](#2-每日做梦-0-3----)
3. [深度做梦 `0 4 * * 0`](#3-深度做梦-0-4--0)
4. [轻量 GC `0 */6 * * *`](#4-轻量-gc-0-6---)
5. [标准 GC `0 4 * * *`](#5-标准-gc-0-4----)
6. [深度 GC `0 5 * * 0`](#6-深度-gc-0-5--0)
7. [日终总结 `0 18 * * 1-5`](#7-日终总结-0-18--1-5)
8. [自动备份 `0 2 * * *`](#8-自动备份-0-2----)
9. [紧急 GC（事件触发）](#9-紧急-gc事件触发)
10. [自动做梦触发（每 50 条记忆）](#10-自动做梦触发每-50-条记忆)
11. [互斥锁机制](#11-互斥锁机制)
12. [时间线全景图](#12-时间线全景图)

---

## 1. 调度器总架构

### 入口文件

- **调度器**: `src/scheduler/index.ts`
- **进程入口**: `src/index.ts`

### 启动流程

```
src/index.ts → main()
  ├─ initDb()              // 初始化数据库
  ├─ runMigrations()       // 执行迁移
  ├─ recoverDreamSession() // 恢复中断的做梦
  ├─ startScheduler()      // ← 注册所有 cron 任务
  └─ serve() / startMCPStdio()
```

### 调度技术

- 使用 `node-cron` 库，进程内调度
- 所有任务随 MiniMem 进程启停
- 任务注册通过 `registerTask(name, cronExpr, handler)` 统一管理
- 任务存储在 `Map<string, ScheduledTask>` 中

### 任务注册代码

```typescript
// src/scheduler/index.ts:286-296
function registerTask(name: string, cronExpr: string, handler: () => void | Promise<void>): void {
  const task = schedule(cronExpr, async () => {
    try {
      await handler();
    } catch (err) {
      log.error({ name, err }, 'Scheduled task failed');
    }
  });
  tasks.set(name, task);
  log.debug({ name, cron: cronExpr }, 'Task registered');
}
```

### 关闭流程

```
shutdown(signal)
  ├─ stopScheduler()          // 停止所有 cron 任务
  ├─ syncAllSurfacesToDisk()  // 刷 Surface Files
  ├─ vectorStore.saveToDisk() // 保存向量索引
  └─ closeDb()                // 关闭数据库
```

---

## 2. 每日做梦 `0 3 * * *`

> **Cron**: `0 3 * * *` — 每天凌晨 3:00  
> **任务名**: `dream:daily`  
> **需要互斥锁**: ✅  

### 调度入口

```typescript
// src/scheduler/index.ts:156-169
registerTask('dream:daily', cfg.dreaming.daily_cron, async () => {
  const locked = await acquireTaskLock('dream:daily');
  if (!locked) { log.warn('dream:daily skipped, lock unavailable'); return; }
  try {
    const { triggerDream } = await import('../modules/dream/dream-engine.js');
    const session = await triggerDream([1, 2, 3, 4]);
    log.info({ sessionId: session.session_id, status: session.status }, 'Daily dream completed');
  } finally {
    releaseTaskLock('dream:daily');
  }
});
```

### 核心函数: `triggerDream([1,2,3,4])`

**文件**: `src/modules/dream/dream-engine.ts:38-165`

完整执行流程:

```
triggerDream([1,2,3,4])
│
├─ Pre-dream Safety
│   ├─ createSnapshot({ label: 'pre-dream-...', trigger: 'dream', branch: 'main' })
│   │     → 统计 L1/L2/L3/L4/Pages 数量
│   │     → 写入 snapshots 表
│   │     → 保存 JSON 到 data/snapshots/
│   └─ createBranch('dream-{sessionId}', preSnapshotId)
│         → 创建 dream 分支用于隔离
│
├─ Phase 1: runAudit()          ← 审计
├─ Phase 2: runCompile()        ← 编译
├─ Phase 3: runDream()          ← REM 联想
├─ Phase 4: runCleanup(pre, branch) ← 清理
│
├─ generateDreamReport()        → 汇总报告
├─ saveDreamReportToDisk()      → data/dreams/dream-{date}-{id}.md + .json
├─ syncAllSurfacesToDisk()      → 同步 Surface Files 到磁盘
└─ INSERT INTO dream_logs       → 写入总记录
```

---

### Phase 1: 审计 — `runAudit()`

**文件**: `src/modules/dream/auditor.ts:64-155`

```
runAudit(sinceDate?)
│
├─ 1. 扫描新增 L1 记忆（默认最近 24h）
│     SELECT id, importance, source FROM experiences
│     WHERE branch='main' AND created_at >= ?
│     │
│     └─ 按 importance 分为 4 级:
│         ├─ critical:  importance >= 0.8
│         ├─ important: importance >= 0.6
│         ├─ routine:   importance >= 0.3
│         └─ trivial:   importance < 0.3
│
├─ 2. 检测 L2 事实冲突
│     SELECT a.id, b.id FROM world_facts a JOIN world_facts b
│     ON a.subject = b.subject AND a.predicate = b.predicate
│     WHERE a.object != b.object AND confidence >= 0.4
│     → 同主谓不同宾 = 冲突
│
└─ 3. Knowledge Page Lint
      遍历所有 knowledge_pages:
      ├─ 检查 staleness: 页面编译后是否有新事实未处理
      │    (新事实 >= 5 → staleness += count * 0.1)
      ├─ 检查断链: 反向链接指向不存在的页面
      ├─ 检查证据链: 页面是否关联了 evidence
      └─ 不健康的发现 → enqueueCompile('lint_finding', ...) 入队供 Phase 2 处理
```

**返回**: `AuditResult` — 各级记忆数、冲突列表、lint 问题

---

### Phase 2: 编译 — `runCompile()`

**文件**: `src/modules/dream/compiler.ts:38-95`

```
runCompile()
│
├─ 1. L1→L2 事实提取
│     extractFacts(20)
│     → 从未处理的 L1 经历中提取三元组事实
│     → 写入 world_facts 表
│
├─ 2. L2→L3 观察提炼
│     distillObservations(20)
│     → 从 L2 事实群中归纳出模式/趋势/偏好
│     → 写入 observations 表
│
├─ 3. L3→L4 心智模型晋升
│     promoteToMentalModels(10)
│     → 高置信度观察升级为原则/规则/信念
│     → 写入 mental_models 表
│
├─ 4. 处理 compile_queue (Karpathy Compile)
│     getPendingCompileItems(30)  → 取最多 30 个 pending 项
│     │
│     LLM 编译 → chatJson({ messages: knowledgePageCompilePrompt(...) })
│     │
│     对每个 action:
│     ├─ create_page: 不存在则创建 → knowledge_pages
│     ├─ update_page: 追加到现有页面
│     └─ markCompiledBatch() → 标记为已处理
│
└─ 5. 维护 index.md
      getAllKnowledgePages() → 按 page_type 分组
      │
      生成 Markdown 索引:
        # 知识索引
        ## 👤 人物 (3)
        - [[alice-chen]] — Alice Chen (置信度: 0.8)
        ...
      │
      updateSurfaceFile('index.md', content) → 写入 Surface
```

**返回**: `CompileResult` — L1→L2/L2→L3/L3→L4 数量 + 页面创建/更新数

---

### Phase 3: REM 联想 — `runDream()`

**文件**: `src/modules/dream/dreamer.ts:48-235`

```
runDream()
│
├─ 前置检查: LLM 不可用 → 直接返回空结果
│
├─ 1. 随机种子选择
│     SELECT id, raw_content, importance FROM experiences
│     WHERE branch='main' AND created_at >= 24h前
│     ORDER BY RANDOM() LIMIT 5
│
├─ 2. 向量空间漫游
│     对每个 seed:
│       embedding = llm.embed(seed.raw_content)
│       walks = vectorStore.randomWalk(embedding, 3, 0.3, 0.7)
│       │                              ↑步数  ↑最小距离  ↑最大距离
│       └─ 每个 walk 结果与 seed 配对 → pairs[]
│
├─ 3. 图遍历发现
│     对前 3 个 seed:
│       links = traverseGraph(seed.id, 3, 10)
│       │                            ↑跳数  ↑最大边数
│       └─ 配对 → pairs[]
│
├─ 4. 跨层联想
│     取最近 5 个 L3 观察 (confidence >= 0.5)
│     与前 2 个 seed 两两配对
│     L1 经历 × L3 观察 → pairs[]
│
├─ 5. LLM 联想 (temperature=0.8 高创造性)
│     去重后取最多 10 对
│     │
│     chatJson({
│       system: "你是做梦联想器。分析记忆对的联系..."
│       user: "[1] 记忆A: ... 记忆B: ..."
│     })
│     │
│     → connections: [{ pair_index, connection_type, insight, novelty }]
│     → narrative: "一段梦境叙事"
│
├─ 6. 创建图连接
│     对每个 connection:
│       connection_type 映射: 类比→related, 因果→caused, 互补→supports, 矛盾→contradicts
│       createLink(idA, layerA, idB, layerB, linkType, novelty)
│       → 写入 memory_links 表
│
└─ 7. 洞察提取
      novelty >= 0.7 的洞察:
        enqueueCompile('query_insight', insight) → 入队待后续写入 L3
```

**返回**: `DreamResult` — 叙事文本、新连接数、图发现数、洞察数

---

### Phase 4: 清理 — `runCleanup()`

**文件**: `src/modules/dream/cleaner.ts:36-102`

```
runCleanup(preSnapshotId, dreamBranch)
│
├─ 1. 执行标准 GC
│     runStandardGC() → [详见第 5 节]
│
├─ 2. 更新 Surface Files
│     processUpdateQueue()
│     → 从 surface_update_queue 表取 pending 建议（最多 10 条）
│     → 对每条调用 smartUpdateSurfaceFile() 让 LLM 合并写入
│
├─ 3. 创建做梦后快照
│     createSnapshot({ label: 'post-dream-...', trigger: 'dream' })
│
├─ 4. Diff 对比
│     diffSnapshots(preSnapshotId, postSnapshotId)
│     → 比较两个快照的 L1/L2/L3/L4/Pages 数量差异
│
├─ 5. 合并 dream 分支到 main
│     mergeBranch(dreamBranch, 'main')
│
└─ 6. 清理 dream 分支
      deactivateBranch(dreamBranch)
```

**返回**: `CleanupResult` — GC 删除数、压缩数、Surface 更新数、后快照 ID、Diff、Merge 结果

---

## 3. 深度做梦 `0 4 * * 0`

> **Cron**: `0 4 * * 0` — 每周日凌晨 4:00  
> **任务名**: `dream:weekly`  
> **需要互斥锁**: ✅  

### 调度入口

```typescript
// src/scheduler/index.ts:171-184
registerTask('dream:weekly', cfg.dreaming.weekly_cron, async () => {
  const locked = await acquireTaskLock('dream:weekly');
  if (!locked) { log.warn('dream:weekly skipped, lock unavailable'); return; }
  try {
    const { triggerDream } = await import('../modules/dream/dream-engine.js');
    const session = await triggerDream([1, 2, 3, 4]);
  } finally {
    releaseTaskLock('dream:weekly');
  }
});
```

### 与每日做梦的区别

| 维度 | 每日做梦 | 深度做梦（每周） |
|------|---------|---------------|
| Cron | `0 3 * * *` 每天 3:00 | `0 4 * * 0` 周日 4:00 |
| 执行阶段 | `[1,2,3,4]` 全部 4 阶段 | `[1,2,3,4]` 全部 4 阶段 |
| 代码路径 | **完全相同** | **完全相同** |
| 组合效果 | 独立执行 | 与 `gc:deep`（凌晨 5 点）串联 |

**当前实现中两者调用的是同一个 `triggerDream([1,2,3,4])`。** 周日会形成 "深度做梦(4:00) → 深度 GC(5:00)" 的连续深度维护窗口。

---

## 4. 轻量 GC `0 */6 * * *`

> **Cron**: `0 */6 * * *` — 每 6 小时  
> **任务名**: `gc:light`  
> **需要互斥锁**: ✅  

### 调度入口

```typescript
// src/scheduler/index.ts:104-124
registerTask('gc:light', cfg.gc.light_cron, async () => {
  const locked = await acquireTaskLock('gc:light');
  if (!locked) return;
  try {
    const result = runLightGC();

    // 检查是否需要紧急 GC
    const dist = getTemperatureDistribution();
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    if (total > 160000) { // 80% of 200K
      runEmergencyGC();
    }
  } finally {
    releaseTaskLock('gc:light');
  }
});
```

### 核心函数: `runLightGC()`

**文件**: `src/lifecycle/index.ts:137-176`

```
runLightGC()
│
├─ 1. 温度衰减
│     decayTemperatures(decayRate=2)
│     │
│     UPDATE memory_temperature
│     SET score = MAX(0, score - 2),
│         temperature = CASE
│           WHEN score >= 80 THEN 'hot'
│           WHEN score >= 60 THEN 'warm'
│           WHEN score >= 40 THEN 'cool'
│           WHEN score >= 20 THEN 'cold'
│           ELSE 'frozen'
│         END
│     WHERE pinned = 0
│     │
│     → 所有非置顶记忆分数 -2
│
├─ 2. 噪音过滤
│     查找满足以下所有条件的 L1 记忆:
│     ├─ access_count = 0     （从未被访问）
│     ├─ importance < 0.2     （低重要性）
│     ├─ created_at < 14天前   （已过 14 天冷却期）
│     ├─ pinned = 0           （未置顶）
│     └─ temperature IN ('cold', 'frozen')
│     │
│     → 强制设为 score=0, temperature='frozen'
│
└─ logGC() → 写入 gc_log 表
```

**返回**: `GCResult { gc_type: 'light', scanned, merged:0, compressed:0, deleted:0 }`

> 注意: 轻量 GC 不会删除任何记忆，只做降温和标记。

---

## 5. 标准 GC `0 4 * * *`

> **Cron**: `0 4 * * *` — 每天凌晨 4:00  
> **任务名**: `gc:standard`  
> **需要互斥锁**: ✅  

### 调度入口

```typescript
// src/scheduler/index.ts:126-138
registerTask('gc:standard', cfg.gc.standard_cron, async () => {
  const locked = await acquireTaskLock('gc:standard');
  if (!locked) return;
  try {
    const result = runStandardGC();
  } finally {
    releaseTaskLock('gc:standard');
  }
});
```

### 核心函数: `runStandardGC()`

**文件**: `src/lifecycle/index.ts:181-216`

```
runStandardGC()
│
├─ 1. 先执行轻量 GC
│     runLightGC() → 温度衰减 + 噪音过滤
│
├─ 2. 过时清理
│     DELETE FROM world_facts
│     WHERE valid_until IS NOT NULL
│       AND valid_until < datetime('now')
│       AND branch = 'main'
│     │
│     → 删除已过有效期的 L2 事实
│     → 例: "Alice 在字节工作" valid_until="2024-06-01" 过期后删除
│
├─ 3. 压缩标记
│     UPDATE memory_temperature
│     SET compression_level = MAX(compression_level, 1)
│     WHERE temperature = 'frozen'
│       AND pinned = 0
│       AND compression_level = 0
│       AND (last_accessed IS NULL OR last_accessed < 30天前)
│     │
│     → frozen + 未置顶 + 未压缩 + 30 天无访问 → 标记 compression_level=1
│     → 后续由压缩管线进一步处理
│
└─ logGC() → 写入 gc_log 表
```

**返回**: `GCResult { gc_type: 'standard', deleted: 过期事实数, compressed: 标记待压缩数 }`

### 附: 压缩管线 `runCompression()`

**文件**: `src/lifecycle/compressor.ts:33-129`  
**Cron**: 与标准 GC 相同 `0 4 * * *`（不参与互斥锁）

```
runCompression(batchSize=20)
│
├─ Level 0→1: 首次压缩（frozen + 30天无访问）
│     LLM: "将以下内容压缩为 2-3 句话的摘要"
│     │
│     ├─ 保留原始内容到 context 字段: "[ORIGINAL] 原文..."
│     └─ 替换 raw_content: "[COMPRESSED:summary] 摘要..."
│
├─ Level 1→2: 进一步压缩（frozen + 60天无访问）
│     LLM: "提取为 3-5 个关键要点，分号分隔"
│     │
│     └─ raw_content: "[COMPRESSED:key-points] 要点1; 要点2; ..."
│
└─ Level 2→3: 极限压缩（frozen + 90天无访问）
      LLM: "压缩为一行话（不超过 20 字）"
      │
      └─ raw_content: "[COMPRESSED:one-line] 一句话描述"
```

---

## 6. 深度 GC `0 5 * * 0`

> **Cron**: `0 5 * * 0` — 每周日凌晨 5:00  
> **任务名**: `gc:deep`  
> **需要互斥锁**: ✅  

### 调度入口

```typescript
// src/scheduler/index.ts:140-152
registerTask('gc:deep', cfg.gc.deep_cron, async () => {
  const locked = await acquireTaskLock('gc:deep');
  if (!locked) return;
  try {
    const result = runDeepGC();
  } finally {
    releaseTaskLock('gc:deep');
  }
});
```

### 核心函数: `runDeepGC()`

**文件**: `src/lifecycle/index.ts:221-254`

```
runDeepGC()
│
├─ 1. 先执行标准 GC
│     runStandardGC()
│       └─ runLightGC() → 温度衰减 + 噪音过滤
│       └─ 过时清理 + 压缩标记
│
├─ 2. 存储配额检查
│     配额定义:
│       hot:    500
│       warm:   2,000
│       cool:   10,000
│       cold:   50,000
│       frozen: 200,000
│     │
│     if frozen 数量 > 200,000:
│       excess = frozen - 200,000
│       deleteOldestFrozen(excess) → 删除最老的 frozen 记忆
│
└─ 3. 来源信誉更新
      updateSourceReputations()
      │
      对每个 source:
      ├─ 统计总记忆数 + 被 GC 清理的比率
      ├─ score = max(0, 100 - rate * 100)
      ├─ 清理率 > 50% → 施加 importance_penalty
      └─ UPSERT INTO source_reputation
```

### `deleteOldestFrozen(count)` 的删除流程

**文件**: `src/lifecycle/index.ts:297-333`

```
deleteOldestFrozen(count)
│
├─ SELECT memory_id, memory_type FROM memory_temperature
│  WHERE temperature='frozen' AND pinned=0
│  ORDER BY score ASC, updated_at ASC  ← 最低分最老的优先
│  LIMIT ?
│
└─ 对每条记忆执行 6 步级联删除:
    ├─ INSERT INTO memory_tombstones (墓碑记录)
    ├─ DELETE FROM memory_temperature
    ├─ vectorStore.deleteByMemoryId()  ← 清理向量
    ├─ DELETE FROM knowledge_page_evidence WHERE evidence_id = ?
    ├─ DELETE FROM memory_fts WHERE memory_id = ?
    └─ DELETE FROM condition_index WHERE memory_id = ?
```

---

## 7. 日终总结 `0 18 * * 1-5`

> **Cron**: `0 18 * * 1-5` — 工作日 18:00  
> **任务名**: `summary:daily`  
> **需要互斥锁**: ❌（不参与）  

### 调度入口

```typescript
// src/scheduler/index.ts:188-201
registerTask('summary:daily', cfg.summary.daily_cron, () => {
  import('../modules/work/daily-summary.js').then(mod => {
    mod.generateDailySummary().then(() => {
      log.info('Daily summary completed');
    });
  });
});
```

### 核心函数: `generateDailySummary()`

**文件**: `src/modules/work/daily-summary.ts:25-99`

```
generateDailySummary(date?)
│
├─ 1. 获取今日任务
│     getTodayTasks()  → 所有 status 的任务
│     getTaskStats()   → { done, in_progress, todo, cancelled }
│
├─ 2. 获取今日记忆
│     SELECT raw_content FROM experiences
│     WHERE branch='main'
│       AND created_at >= '{date}T00:00:00'
│       AND created_at < '{date}T23:59:59'
│     ORDER BY importance DESC
│     LIMIT 20
│
├─ 3a. LLM 可用时 → 智能总结
│     llm.chatJson({
│       messages: dailySummaryPrompt(tasks, memories),
│       tier: 'medium',
│       temperature: 0.5,
│     })
│     │
│     → { summary: "...", highlights: [...], mood: "productive" }
│
├─ 3b. LLM 不可用时 → 规则降级
│     buildFallbackSummary():
│       # {date} 日终总结
│       ## 完成 (3)
│       - ✅ 实现 GC 模块
│       ## 进行中 (1)
│       - 🚧 设计做梦引擎
│       ## 今日记忆 (15 条)
│       - 讨论了 MiniMem 架构...
│
└─ 保存到 dream_logs (phase=0 表示日终总结)
     INSERT INTO dream_logs (phase=0, narrative=JSON.stringify(summary))
```

**返回**: `DailySummary { date, summary, highlights, mood, task_stats }`

---

## 8. 自动备份 `0 2 * * *`

> **Cron**: `0 2 * * *` — 每天凌晨 2:00  
> **任务名**: `backup:daily`  
> **需要互斥锁**: ❌（不参与）  

### 调度入口

```typescript
// src/scheduler/index.ts:205-213
registerTask('backup:daily', cfg.backup.cron, () => {
  createSnapshot({
    label: `backup-${new Date().toISOString().slice(0, 10)}`,
    trigger: 'auto'
  });
});
```

> **注意**: 调度器中调用的是 `createSnapshot()` 而非 `createBackup()`。这意味着每日自动备份创建的是**逻辑快照**，不是物理文件拷贝。

### 核心函数: `createSnapshot()`

**文件**: `src/version/snapshot.ts:18-83`

```
createSnapshot({ label, trigger, branch })
│
├─ 1. 统计各层数量
│     SELECT COUNT(*) FROM experiences WHERE branch = ?
│     SELECT COUNT(*) FROM world_facts WHERE branch = ?
│     SELECT COUNT(*) FROM observations WHERE branch = ?
│     SELECT COUNT(*) FROM mental_models WHERE branch = ?
│     SELECT COUNT(*) FROM knowledge_pages WHERE branch = ?
│
├─ 2. 查找父快照
│     SELECT id FROM snapshots WHERE branch = ?
│     ORDER BY created_at DESC LIMIT 1
│
├─ 3. 写入数据库
│     INSERT INTO snapshots (id, label, branch, trigger, parent_snapshot_id,
│       stats_l1, stats_l2, stats_l3, stats_l4, stats_pages, created_at)
│
└─ 4. 保存到磁盘
      saveSnapshotToDisk()
      → data/snapshots/snapshot-main-2026-04-07-{shortId}.json
```

### 独立备份工具: `createBackup()`（调度器未直接使用）

**文件**: `src/store/backup.ts:15-70`

```
createBackup()  ← 可能由 API 手动触发
│
├─ copyFileSync(minimem.db → backups/minimem-{timestamp}.db)
├─ copyFileSync(minimem.db-wal → ...)  ← WAL 一起备份
│
├─ 备份 data/ 子目录:
│   cpSync(vectors/ → backups/data-{timestamp}/vectors/)
│   cpSync(dreams/  → backups/data-{timestamp}/dreams/)
│   cpSync(surfaces/ → backups/data-{timestamp}/surfaces/)
│
└─ 保留策略: applyRetentionPolicy()
     保留最近 7 个备份（retention_count 配置）
     按修改时间排序，删除超额旧备份
```

---

## 9. 紧急 GC（事件触发）

> **触发条件**: 轻量 GC 执行后，发现总记忆温度记录数 > 160,000（80% of 200K）  
> **触发位置**: `gc:light` 任务的回调中  

### 触发代码

```typescript
// src/scheduler/index.ts:112-118 (在 gc:light 回调内)
const dist = getTemperatureDistribution();
const total = Object.values(dist).reduce((a, b) => a + b, 0);
if (total > 160000) { // 80% of 200K
  log.warn({ total }, 'Storage nearing quota, running emergency GC');
  runEmergencyGC();
}
```

### 核心函数: `runEmergencyGC()`

**文件**: `src/lifecycle/index.ts:356-414`

```
runEmergencyGC(quotaLimit=200000)
│
├─ 检查总数
│     SELECT COUNT(*) FROM memory_temperature
│     if totalCount < 80% quota → 跳过
│
├─ 计算目标
│     toDelete = totalCount - (quotaLimit * 0.6)
│     → 目标: 降到 60% 配额
│
├─ 第一轮: 删除 frozen（70% 的待删量）
│     deleteOldestFrozen(ceil(toDelete * 0.7))
│     → 墓碑 + 温度删除 + 向量删除 + 索引清理
│
├─ 第二轮: 如果还不够，删除 cold
│     SELECT memory_id FROM memory_temperature
│     WHERE temperature='cold' AND pinned=0
│     ORDER BY score ASC LIMIT remaining
│     │
│     → 同样的 6 步级联删除
│
└─ logGC({ gc_type: 'emergency', deleted })
```

---

## 10. 自动做梦触发（每 50 条记忆）

> **触发条件**: 新记忆计数达到 50 条（`auto_trigger_count`）  
> **当前状态**: 函数已导出但尚未被其他模块 import 调用（预留接口）  

### 实现代码

**文件**: `src/scheduler/index.ts:255-274`

```typescript
let newMemoryCount = 0;

export function incrementMemoryCount(): void {
  newMemoryCount++;
  if (newMemoryCount >= DEFAULT_CONFIG.dreaming.auto_trigger_count) { // 50
    log.info({ count: newMemoryCount }, 'Auto-trigger dream threshold reached');
    newMemoryCount = 0; // 重置计数
    // 触发做梦（异步，不阻塞主流程）
    import('../modules/dream/dream-engine.js').then(mod => {
      mod.triggerDream([1, 2, 3, 4]).catch(err => {
        log.error({ err }, 'Auto-trigger dream execution failed');
      });
    });
  }
}
```

### 设计意图

```
每次 add_memory 写入新记忆
    │
    └─ incrementMemoryCount()
         │
         newMemoryCount += 1
         │
         if (newMemoryCount >= 50):
           newMemoryCount = 0
           triggerDream([1,2,3,4])  ← 异步不阻塞
```

### 配置

```typescript
// src/config/index.ts:63-67
dreaming: {
  schedule: '0 3 * * *',
  auto_trigger_threshold: 50,    // 正常阈值
  cold_start_threshold: 20,      // 冷启动期降低门槛
}
```

---

## 11. 互斥锁机制

**文件**: `src/scheduler/index.ts:15-49`

### 参与互斥锁的任务

| 任务 | 需要锁 |
|------|-------|
| `gc:light` | ✅ |
| `gc:standard` | ✅ |
| `gc:deep` | ✅ |
| `dream:daily` | ✅ |
| `dream:weekly` | ✅ |
| `summary:daily` | ❌ |
| `backup:daily` | ❌ |
| `compression` | ❌ |

### 实现

```
全局状态:
  _taskLock: string | null = null     ← 当前持锁者名
  _lockQueue: Array<{ name, resolve }>  ← FIFO 等待队列

acquireTaskLock(name):
  ├─ 锁空闲(_taskLock === null)
  │   └─ _taskLock = name → return true
  │
  └─ 锁被占用
      └─ 加入等待队列
         设置 5 分钟超时
         │
         ├─ 超时 → return false（跳过本次执行）
         └─ 被唤醒 → _taskLock = name → return true

releaseTaskLock(name):
  ├─ 验证 _taskLock === name（只有持锁者能释放）
  ├─ _taskLock = null
  └─ 队列非空 → shift() 唤醒下一个等待者
```

### 防冲突示例

```
03:00  dream:daily 开始 → acquireTaskLock('dream:daily') ✅ 拿到锁
03:05  做梦进行中...
04:00  gc:standard 到点 → acquireTaskLock('gc:standard') → 锁被 dream:daily 持有 → 排队
04:02  做梦结束 → releaseTaskLock('dream:daily') → 唤醒 gc:standard
04:02  gc:standard 开始执行
```

---

## 12. 时间线全景图

```
────────── 白天（你在使用） ──────────────────────────

每次 add_memory ──→ incrementMemoryCount()
                      ↓
                  达到 50 条? ──→ triggerDream([1,2,3,4]) 立即做梦!

Agent 调用 suggest_surface_update
    ↓
  写入 surface_update_queue (status='pending')
    ↓
  等待做梦 Phase 4 处理 ↗

每 6h   gc:light ──→ 温度衰减(-2) + 噪音过滤 + [紧急 GC 检查]
18:00   summary:daily ──→ LLM 生成日终总结 (不参与互斥锁)

────────── 夜间（MiniMem 自己工作） ──────────────────

02:00   backup:daily ──→ createSnapshot (逻辑快照)

03:00   dream:daily ──→ triggerDream([1,2,3,4])  🔒 互斥锁
         │
         ├─ Pre: 前快照 + dream 分支
         ├─ Phase 1: 审计（扫描/分级/冲突/Lint）
         ├─ Phase 2: 编译（L1→L2→L3→L4 + Karpathy + index.md）
         ├─ Phase 3: REM（向量漫游 + 图遍历 + LLM 联想）
         ├─ Phase 4: 清理（标准GC + Surface更新 + 后快照 + Diff + 合并）
         └─ Post: 报告 → .md/.json → syncSurfaces

04:00   gc:standard ──→ 轻量GC + 过时清理 + 压缩标记  🔒
04:00   compression ──→ 4级渐进LLM压缩

────────── 每周日额外 ────────────────────────────────

04:00   dream:weekly ──→ 同 dream:daily（完整 4 阶段） 🔒
05:00   gc:deep ──→ 标准GC + 配额检查 + 来源信誉  🔒
```

### 周日完整执行顺序（互斥锁保障）

```
02:00  backup:daily    (无锁) ─── 创建快照
03:00  dream:daily     (🔒) ──── 4 阶段做梦
       gc:light        (排队等锁)
04:00  dream:weekly    (排队等锁 ← 等 dream:daily 完成)
       gc:standard     (排队等锁)
       compression     (无锁，可能并行)
05:00  gc:deep         (排队等锁 ← 等前面的完成)
```

> 由于互斥锁是 FIFO 队列 + 5 分钟超时，周日凌晨如果做梦耗时过长（>5分钟），后面排队的任务可能会超时跳过。

---

## 附录: 关键文件索引

| 文件路径 | 职责 |
|---------|------|
| `src/scheduler/index.ts` | 调度器主文件，注册/启停所有 cron 任务，互斥锁，自动触发 |
| `src/index.ts` | 进程入口，启动/关闭调度器 |
| `src/modules/dream/dream-engine.ts` | 做梦主调度器，4 阶段流水线 |
| `src/modules/dream/auditor.ts` | Phase 1: 审计 + Knowledge Page Lint |
| `src/modules/dream/compiler.ts` | Phase 2: 编译 + Karpathy Compile + index.md |
| `src/modules/dream/dreamer.ts` | Phase 3: REM 创造性联想 |
| `src/modules/dream/cleaner.ts` | Phase 4: 清理 + Surface 更新 + 版本合并 |
| `src/modules/dream/dream-report.ts` | 做梦报告生成 + Markdown 格式化 |
| `src/lifecycle/index.ts` | 温度引擎 + 轻量/标准/深度/紧急 GC |
| `src/lifecycle/compressor.ts` | 4 级渐进压缩管线 |
| `src/lifecycle/forget.ts` | 遗忘权: 7 步级联删除 |
| `src/lifecycle/health.ts` | 健康监控 + 告警检测 |
| `src/lifecycle/recovery.ts` | GC 中断恢复 |
| `src/modules/work/daily-summary.ts` | 日终总结生成 |
| `src/store/backup.ts` | 物理备份 + 保留策略 |
| `src/version/snapshot.ts` | 逻辑快照管理 |
| `src/config/index.ts` | 配置管理（含调度 cron 表达式） |
