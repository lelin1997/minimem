# MiniMem — 交叉引用文档 (CROSS-REFERENCE)

> **本文档是 DESIGN.md、FLOWS.md、ARCHITECTURE.md 三者的桥接文档。**
> 回答三个核心问题：
> 1. FLOWS 的 17 个章节分别对应 DESIGN 的哪些层、哪些模块？
> 2. 从 SDK/MCP 接入开始，数据是怎么在各层级之间流转的？
> 3. 每个层级的输入/输出/依赖关系是什么？
>
> 创建时间: 2026-04-07

---

## 一、三文档职责划分

| 文档 | 职责 | 视角 |
|------|------|------|
| **DESIGN.md** | 设计理念、认知科学类比、框架借鉴、分层架构定义 | **为什么这么设计** |
| **FLOWS.md** | 基于源码审计的完整处理流程、步骤级细节 | **代码实际怎么跑** |
| **ARCHITECTURE.md** | 模块清单、接口定义、数据模型、技术栈 | **系统由什么组成** |
| **CROSS-REFERENCE.md**（本文档） | 三者的交叉映射、层级间数据流转、全链路追踪 | **它们之间怎么关联** |

---

## 二、DESIGN 八层架构定义

DESIGN.md §2.2 定义了从外到内的 8 层架构：

```
层级代号    DESIGN 名称                           DESIGN 章节      核心职责
────────   ─────────────────────────────         ──────────      ──────────
L-1        🔌 Unified Access Layer（统一接入层）    §三、§四、§五     MCP/REST/SDK/CLI 接入 + 认证权限限流
L-2        📄 Surface Files Layer（表层文件系统）   §六             8 个 Markdown 文件，总预算 ≤ 10K tokens
L-3        📋 Business Modules（业务模块层）       §十二            工作/社交/做梦等领域模块
L-4        🔍 Smart Retrieval Engine（智能检索）    §十             六路并行检索 + MemSifter 查询规划
L-5        🧠 Memory Core Engine（记忆核心引擎）    §十一            感知/加工/巩固三层处理管线
L-6        🔄 Memory Lifecycle Manager（生命周期）  §七             温度模型 + GC + 压缩 + 信誉系统
L-7        📌 Version Control Layer（版本控制层）   §九             快照/分支/Diff/合并/回滚
L-8        💾 Memory Store（Hindsight 四层存储）   §八、§十四、§十五  L1-L4 + Knowledge Pages + 向量/图谱/索引
```

---

## 三、FLOWS 17 章 → DESIGN 层级 完整映射

### 3.1 映射总表

| FLOWS 章节 | 标题 | DESIGN 层级 | DESIGN 章节 | ARCH 模块 | 核心源码文件 |
|-----------|------|-----------|------------|----------|------------|
| **Ch.1** | 系统启动流程 | **跨全层**（L-1→L-8 初始化） | §二 架构总览 | — | `src/index.ts` |
| **Ch.2** | 记忆感知管道 | **L-5** Memory Core | §十一 §9.1 | Core Engine | `src/core/perception.ts` |
| **Ch.3** | 事实处理管道 | **L-5** Memory Core | §十一 §9.2 | Core Engine | `src/core/processing.ts` |
| **Ch.4** | 整合管道 | **L-5** Memory Core | §十一 §9.2.2 + §十三 | Core Engine | `src/core/consolidation.ts` |
| **Ch.5** | 检索引擎 | **L-4** Smart Retrieval | §十 | Retrieval | `src/retrieval/search.ts` |
| **Ch.6** | Dream 引擎 | **L-3** + L-5 + L-6 + L-7 | §十三 | Dream Engine | `src/modules/dream/` |
| **Ch.7** | 生命周期管理 | **L-6** Lifecycle | §七 | Lifecycle | `src/lifecycle/` |
| **Ch.8** | 版本控制 | **L-7** Version Control | §九 | Version | `src/version/` |
| **Ch.9** | Surface Files | **L-2** Surface Files | §六 | Surface | `src/surface/index.ts` |
| **Ch.10** | Knowledge Pages | **L-8** 扩展存储 | §十四 | Store (KP) | `src/store/knowledge-pages/` |
| **Ch.11** | Owner/Person 档案 | **L-1** (API) + **L-3** (逻辑) | §五 §5.3 | Owner Profile | `src/owner/` |
| **Ch.12** | 调度器 | **横切关注点** | §十六 | Scheduler | `src/scheduler/index.ts` |
| **Ch.13** | 双网关 | **L-1** Unified Access | §三 | Gateway | `src/gateway/` |
| **Ch.14** | 认证与限流 | **L-1** 子模块 | §五 §5.2 | Gateway/Auth | `src/gateway/auth.ts` |
| **Ch.15** | 磁盘持久化 | **L-8** 物理层 | §十五 | Store | `src/store/` |
| **Ch.16** | 数据流依赖图 | **全局视图** | §二 §2.2 | — | — |
| **Ch.17** | 问题清单 | **全局审计** | → REPAIR.md | — | — |

### 3.2 映射关系可视化

```
DESIGN 层级         FLOWS 章节              主要模块              源码目录
──────────         ──────────              ──────────            ──────────

L-1 接入层    ←──── Ch.13 双网关            Gateway              src/gateway/
              ←──── Ch.14 认证限流          Auth + RateLimiter   src/gateway/auth.ts
              ←──── Ch.11 Owner(API面)      Owner Profile API    src/owner/
                     │
                     │ 请求路由
                     ▼
L-2 表层文件  ←──── Ch.9  Surface Files    Surface Engine        src/surface/
                     │
                     │ 深层操作
                     ▼
L-3 业务模块  ←──── Ch.6  Dream 引擎       Dream Engine          src/modules/dream/
              ←──── Ch.11 Owner(逻辑面)     Owner/Person          src/owner/
              ←──── Ch.12 调度器            Scheduler             src/scheduler/
                     │
                     │ 检索请求
                     ▼
L-4 检索引擎  ←──── Ch.5  检索引擎          Retrieval             src/retrieval/
                     │
                     │ 数据处理
                     ▼
L-5 核心引擎  ←──── Ch.2  感知管道          Perception            src/core/perception.ts
              ←──── Ch.3  处理管道          Processing            src/core/processing.ts
              ←──── Ch.4  整合管道          Consolidation         src/core/consolidation.ts
                     │
                     │ 生命周期操作
                     ▼
L-6 生命周期  ←──── Ch.7  生命周期管理      Lifecycle + GC        src/lifecycle/
                     │
                     │ 版本快照
                     ▼
L-7 版本控制  ←──── Ch.8  版本控制          Version Control       src/version/
                     │
                     │ 数据读写
                     ▼
L-8 存储层    ←──── Ch.10 Knowledge Pages   KP Store              src/store/knowledge-pages/
              ←──── Ch.15 磁盘持久化        Store + Backup        src/store/

横切关注点:
Ch.1  系统启动 ──→ 串联 L-1 到 L-8 的初始化顺序
Ch.12 调度器   ──→ 编排 L-3(Dream)、L-5(Processing)、L-6(GC)、L-7(Snapshot) 的定时执行
Ch.16 依赖图   ──→ 描述全层之间的数据流向
Ch.17 问题清单 ──→ 跨层审计发现 → 已迁移至 REPAIR.md
```

---

## 四、数据流转全链路

### 4.1 写入链路：从 Agent 调用到四层存储

```
═══════════════════════════════════════════════════════════════════════════
 阶段 0: 外部接入                      层级: L-1  |  FLOWS: Ch.13, Ch.14
═══════════════════════════════════════════════════════════════════════════

  CodeBuddy ──── SKILL.md + MCP ──┐
  Claude    ──── MCP (stdio)    ──┤
  OpenClaw  ──── REST API       ──┤──→ Gateway 路由
  Agent X   ──── SDK / REST     ──┘
                                        │
                                        ├── JWT 认证 (Ch.14)
                                        │   └→ 解析 client_id → 权限等级
                                        │      (trusted / standard / readonly)
                                        │
                                        ├── 速率限制 (Ch.14)
                                        │   └→ 全局 60w/min, 单客户端 20w/min
                                        │
                                        ├── 审计日志
                                        │   └→ access_log 表记录
                                        │
                                        └── 路由到具体 handler
                                            ├── MCP: tool_call("add_memory", {...})
                                            └── REST: POST /api/v1/memory

═══════════════════════════════════════════════════════════════════════════
 阶段 1: 感知（摄入 L1）              层级: L-5  |  FLOWS: Ch.2
═══════════════════════════════════════════════════════════════════════════

  ingestExperience(input, db, config)
    │
    ├── Step 1:  内容验证（非空、长度 ≤ 10000）
    ├── Step 2:  文本清理（trim、去重空行/空格）
    ├── Step 3:  SHA-256 哈希去重 → 查 experiences 表
    ├── Step 4:  PII 脱敏（13 类正则，R-016 扩展后）
    │            └→ mask / reject / keep
    ├── Step 5:  LLM 质量门控 ── 先行执行，失败即终止
    │
    ├── Step 6+7 (并行，R-008 优化后):
    │   ├── LLM 重要性评分 → importance: 0~1
    │   └── LLM NER 实体抽取 → condition_keys[]
    │
    ├── Step 8:  LLM 向量嵌入 → embedding_id
    │            └→ 写入 L-8 向量存储
    │            └→ 失败时写 compile_queue 等回填 (R-026)
    │
    ├── Step 9:  写入 L1 ─────→ 【L-8: experiences 表】
    ├── Step 10: 条件索引 ────→ 【L-8: condition_index 表】
    ├── Step 11: FTS 索引 ────→ 【L-8: memory_fts 虚拟表】
    └── Step 12: 温度初始化 ──→ 【L-6: memory_temperature 表】
                                  (temperature = 'hot', score = 80)

    ★ L1 记录 processed = 0，等待 Dream Phase 2 触发后续处理

═══════════════════════════════════════════════════════════════════════════
 阶段 2: 加工（L1 → L2 事实提取）     层级: L-5  |  FLOWS: Ch.3
═══════════════════════════════════════════════════════════════════════════

  extractFacts(db, config) — 由 Dream Phase 2 或定时任务触发
    │
    ├── 1. 查询 processed = 0 的 L1 记录（批量 10 条）
    ├── 2. LLM 三元组提取: { subject, predicate, object, confidence }
    ├── 3. 去重检查 (R-025): 精确匹配 (S,P,O) 已存在 → 跳过
    │
    ├── 4. 写入 L2 ─────────→ 【L-8: world_facts 表】
    ├── 5. 向量嵌入 (R-003) → 【L-8: 向量存储】
    ├── 6. 温度初始化 ───────→ 【L-6: memory_temperature 表】
    ├── 7. 条件索引 + FTS ──→ 【L-8: condition_index + memory_fts】
    │
    ├── 8. 图链接:
    │   ├── L1 → L2 (derived_from) → 【L-8: memory_links 表】
    │   ├── 同 subject L2 ↔ L2 (related, 本批次)
    │   └── 跨批次 related (R-009): 查历史同 subject → weight=0.5
    │
    └── 9. 标记 L1 processed = 1

═══════════════════════════════════════════════════════════════════════════
 阶段 3: 巩固（L2 → L3 → L4）        层级: L-5  |  FLOWS: Ch.4
═══════════════════════════════════════════════════════════════════════════

  consolidate(db, config) — 由 Dream Phase 2 触发
    │
    ├── 3a. L2 → L3 蒸馏观察 (distillObservations)
    │   ├── 查找 COUNT(L2) ≥ 3 的 subject
    │   ├── LLM 归纳模式 → L3 Observation
    │   ├── 写入 ──────→ 【L-8: observations 表】
    │   ├── 向量嵌入 ──→ 【L-8: 向量存储】(R-003)
    │   ├── FTS 索引 ──→ 【L-8: memory_fts】(R-003)
    │   ├── 温度初始化 → 【L-6: memory_temperature】
    │   └── 图链接 L2→L3 → 【L-8: memory_links】
    │
    └── 3b. L3 → L4 心智模型晋升 (promoteToMentalModels)
        ├── 查找 confidence ≥ 0.7 的 L3
        ├── LLM 泛化为原则 → L4 Mental Model
        ├── 写入 ──────→ 【L-8: mental_models 表】
        ├── 向量嵌入 ──→ 【L-8: 向量存储】(R-003)
        ├── FTS 索引 ──→ 【L-8: memory_fts】(R-003)
        ├── 温度初始化 → 【L-6: memory_temperature】
        └── 图链接 L3→L4 → 【L-8: memory_links】

═══════════════════════════════════════════════════════════════════════════
 阶段 4: 知识编译                     层级: L-8  |  FLOWS: Ch.10
         (Karpathy Compile)           DESIGN: §十四
═══════════════════════════════════════════════════════════════════════════

  compile(db, config) — Dream Phase 2 后半段
    │
    ├── 从 compile_queue 取待处理项
    │   (来源: new_fact / query_insight / feedback / lint_finding)
    │
    ├── LLM 编译决策:
    │   ├── 创建新 Knowledge Page → 【L-8: knowledge_pages 表】
    │   ├── 更新已有页面（增量追加）
    │   └── 冲突检测 → 标记 conflicted，不自动覆盖
    │
    ├── 版本历史 (R-013) → 【L-8: knowledge_page_versions 表】
    ├── 反向链接 [[backlink]] → 【L-8: knowledge_page_links 表】
    ├── 证据链 → 【L-8: knowledge_page_evidence 表】
    └── 更新 INDEX → 【L-2: Surface Files index.md】

═══════════════════════════════════════════════════════════════════════════
 阶段 5: 表层更新                     层级: L-2  |  FLOWS: Ch.9
═══════════════════════════════════════════════════════════════════════════

  updateSurfaceFiles(db, config) — Dream Phase 4 / 会话结束
    │
    ├── processUpdateQueue: 按优先级处理更新请求
    ├── 读取当前文件 + 从深层记忆检索新信息
    ├── LLM 智能合并: 新信息 + 旧内容 → 合并
    ├── Token 预算控制: 每文件有上限，总 ≤ 10K
    ├── 写入 DB → 【L-8: surface_files + surface_file_history】
    └── syncSurfaceToDisk → data/surfaces/*.md
```

### 4.2 读取链路：从 Agent 查询到六路检索

```
═══════════════════════════════════════════════════════════════════════════
 查询接入                              层级: L-1  |  FLOWS: Ch.13
═══════════════════════════════════════════════════════════════════════════

  Agent → search_memory / GET /memory/search
    │
    ├── JWT 认证 → 确定可读层级
    │   ├── trusted:  L1-L4 全部
    │   ├── standard: L2-L4 (不含原始对话)
    │   └── readonly: L3-L4 (仅观察和模型)
    │
    └── 路由到 searchMemory()

═══════════════════════════════════════════════════════════════════════════
 检索引擎                              层级: L-4  |  FLOWS: Ch.5
═══════════════════════════════════════════════════════════════════════════

  searchMemory(query, db, config)
    │
    ├── 1. LLM 查询规划 (MemSifter 式)
    │   └→ { keywords, semantic_query, graph_seeds, time_range, layers }
    │
    ├── 2. L4 快速回答: 心智模型已有答案 → 跳过检索直接返回
    │
    ├── 3. 六路并行检索 (Promise.all) → 【从 L-8 读取】
    │   ├── Route 1: 向量语义 → cosine similarity (L1/L2/L3/L4)
    │   ├── Route 2: FTS 关键词 → FTS5 + BM25 评分
    │   ├── Route 3: 图遍历 → BFS 2-3 跳 (memory_links)
    │   ├── Route 4: 时间范围 → WHERE created_at BETWEEN
    │   ├── Route 5: 条件索引 → O(1) HashMap 查找 (Engram 式)
    │   └── Route 6: 知识页面 → FTS/LIKE (R-017 优化后先 FTS)
    │
    ├── 4. 去重合并 + 层级加权
    │   └→ L4:1.0 > L3:0.85 > L2:0.7 > L1:0.5
    │
    ├── 5. 内容充实 (enrichResults)
    │   └→ 从四层表查完整内容
    │
    ├── 6. LLM 重排序 (Rerank) → Top-K
    │
    └── 7. 查询回写 (R-022: readonly 跳过)
        └→ 有跨域洞察? → compile_queue → 等 Dream Phase 2 编译

═══════════════════════════════════════════════════════════════════════════
 Surface Files 快速加载               层级: L-2  |  FLOWS: Ch.9
═══════════════════════════════════════════════════════════════════════════

  Agent 启动时 → load_surfaces / GET /surface
    │
    └── 按 Agent 类型裁剪加载（不走检索引擎）:
        ├── CodeBuddy  → me.md + work.md + agent.md + context.md (~4800 tok)
        ├── OpenClaw   → me.md + soul.md + social.md + context.md
        └── 全功能      → 全部 8 个文件 (~8700 tok)
```

### 4.3 后台循环：Dream + GC + 调度

```
═══════════════════════════════════════════════════════════════════════════
 调度器编排                            横切关注点  |  FLOWS: Ch.12
═══════════════════════════════════════════════════════════════════════════

  startScheduler(db, config) — 系统启动时调用 (R-001)
    │
    ├── 0 3 * * *    → 每日做梦 ────────→ Dream Engine (Ch.6)
    ├── 0 4 * * 0    → 深度做梦 ────────→ Dream Engine (深度模式)
    ├── 0 */6 * * *  → 轻量 GC ─────────→ Lifecycle (Ch.7)
    ├── 0 4 * * *    → 标准 GC ─────────→ Lifecycle (Ch.7)
    ├── 0 5 * * 0    → 深度 GC ─────────→ Lifecycle (Ch.7)
    ├── 0 18 * * 1-5 → 日终总结 ────────→ Work Module (Ch.11)
    ├── 0 2 * * *    → 自动备份 ────────→ Backup (Ch.15)
    ├── 事件触发      → 紧急 GC ─────────→ Lifecycle (存储超 80%)
    └── 每 50 条记忆  → 自动做梦触发 ──→ Dream Engine

    ★ 任务互斥锁 (R-011): Dream 和 GC 不能并发

═══════════════════════════════════════════════════════════════════════════
 做梦引擎 4 阶段                       层级: L-3 + L-5 + L-6 + L-7 + L-8
                                       FLOWS: Ch.6
═══════════════════════════════════════════════════════════════════════════

  Pre-Dream:
    └── 创建版本快照 (L-7) → 创建 dream 分支 (L-7)

  Phase 1 — 审计 + Knowledge Page Lint          跨 L-5 / L-8
    ├── 扫描新增记忆 → 评估重要性分级
    ├── 重建条件索引 → 检测冲突/重复/过时
    ├── Knowledge Page 健康检查:
    │   过时 / 孤立 / 矛盾 / 缺失 / 索引不一致
    └── [事务提交 checkpoint-1]

  Phase 2 — 编译                                跨 L-5 / L-8
    ├── 调用 Ch.3 Processing: L1→L2 事实提取
    ├── 调用 Ch.4 Consolidation: L2→L3→L4 巩固
    ├── 调用 Ch.10 Karpathy Compile: 知识页面编译
    ├── 处理 compile_queue 积压
    ├── 触发 Ch.7 压缩管线（老记忆）
    └── [事务提交 checkpoint-2]

  Phase 3 — 联想 (REM)                         跨 L-4 / L-5 / L-8
    ├── 随机种子 3-5 条 → 向量空间漫游 (cos sim 0.3-0.7)
    ├── 图遍历 2-3 跳 → 跨层配对 (L1+L3)
    ├── 跨 Knowledge Page 模式发现
    ├── LLM 联想 → 洞察提取
    ├── 高置信度洞察写入 L3/L4 或创建新 Knowledge Page
    └── [事务提交 checkpoint-3]

  Phase 4 — 清理                               跨 L-2 / L-6 / L-7
    ├── 调用 Ch.7 GC: 选择性遗忘（温度衰减）
    ├── 调用 Ch.9 Surface 更新
    ├── 调用 Ch.8 Diff: 做梦前后快照对比
    ├── 合并 dream 分支 → main (L-7)
    └── 生成做梦报告 → data/dreams/*.md

═══════════════════════════════════════════════════════════════════════════
 GC 三级策略                           层级: L-6  |  FLOWS: Ch.7
═══════════════════════════════════════════════════════════════════════════

  轻量 GC (每 6h):
    温度衰减 -2 + 噪声过滤 (低重要性+零访问+超14天 → 快速降温)

  标准 GC (每日做梦后):
    └── 轻量 GC + 过期清理 (valid_until) + 压缩标记

  深度 GC (每周日):
    └── 标准 GC + 配额检查 + 来源信誉惩罚

  紧急 GC (事件触发):
    └── 存储超 80% 配额 → 删除最冷 frozen 记忆
        级联清理: 向量(R-004) + 证据链(R-012) + FTS + 条件索引
```

---

## 五、层级输入/输出/依赖矩阵

### 5.1 每层的 I/O 与依赖

| 层级 | 输入来源 | 输出目标 | 向上依赖 | 向下依赖 |
|------|---------|---------|---------|---------|
| **L-1** 接入层 | 外部 Agent (MCP/REST/SDK) | L-2, L-4, L-5 | — | L-2, L-4, L-5 |
| **L-2** Surface | L-8 深层数据, L-5 做梦更新 | L-1 (Agent 加载) | L-1 | L-8 (surface_files 表) |
| **L-3** 业务模块 | L-1 调度指令, L-5 处理结果 | L-5, L-6, L-7, L-8 | L-1 | L-5, L-6, L-7, L-8 |
| **L-4** 检索引擎 | L-1 查询请求 | L-1 (返回结果), L-8 (查询回写) | L-1 | L-8 |
| **L-5** 核心引擎 | L-1 写入请求, L-3 做梦触发 | L-6, L-8 | L-1, L-3 | L-6, L-8, LLM |
| **L-6** 生命周期 | L-5 新记忆, 调度器 cron | L-8 (温度/GC/压缩) | L-3 (调度器) | L-8 |
| **L-7** 版本控制 | L-3 做梦触发, L-1 手动触发 | L-8 (快照/分支) | L-1, L-3 | L-8 |
| **L-8** 存储层 | 上层所有写入 | 上层所有读取 | 所有上层 | — (底层) |

### 5.2 模块间调用关系图

```
┌──────────────────────────────────────────────────────────────────────┐
│                         调度器 (Ch.12)                                │
│                    ╔══════════════════╗                               │
│                    ║  cron 触发器      ║                               │
│                    ╚═══════╤══════════╝                               │
│                            │                                          │
│              ┌─────────────┼─────────────┐                           │
│              ▼             ▼             ▼                            │
│        ┌──────────┐ ┌──────────┐ ┌──────────┐                       │
│        │  Dream   │ │   GC     │ │  Backup  │                       │
│        │ Engine   │ │ (3种)    │ │          │                       │
│        │ (Ch.6)   │ │ (Ch.7)   │ │ (Ch.15)  │                       │
│        └──┬──┬────┘ └────┬─────┘ └────┬─────┘                       │
│           │  │           │            │                               │
│     ┌─────┘  └─────┐    │            │                               │
│     ▼              ▼    ▼            ▼                               │
│ ┌──────────┐ ┌──────────┐ ┌──────────────────┐                      │
│ │Processing│ │Consolid. │ │ Version Control  │                      │
│ │ (Ch.3)   │ │ (Ch.4)   │ │ (Ch.8)           │                      │
│ └────┬─────┘ └────┬─────┘ └────┬─────────────┘                      │
│      │            │            │                                      │
│      └────────────┼────────────┘                                      │
│                   ▼                                                    │
│     ┌──────────────────────────┐                                      │
│     │    L-8 Memory Store      │                                      │
│     │  (四层表 + KP + 向量 +   │                                      │
│     │   图谱 + FTS + 条件索引) │                                      │
│     └──────────────────────────┘                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 六、REPAIR.md 修复项与层级归属

REPAIR.md 中 26 个修复项按层级分布：

| 层级 | 修复项 | 数量 |
|------|--------|------|
| **L-1** 接入层 | R-020 (MCP/REST 功能不对称), R-022 (readonly 写入) | 2 |
| **L-2** Surface | R-006 (shutdown 未同步) | 1 |
| **L-5** 核心引擎 | R-003 (L2-L4 无嵌入), R-008 (串行 LLM), R-009 (跨批次 related), R-015 (raw_content 语义), R-016 (PII 覆盖), R-025 (事实去重), R-026 (嵌入重试) | 7 |
| **L-6** 生命周期 | R-004 (GC 不清理向量), R-010 (压缩覆盖), R-012 (证据悬挂), R-021 (温度覆盖) | 4 |
| **L-7** 版本控制 | R-005 (Dream 分支隔离), R-019 (Diff 不检测修改), R-023 (Dream Recovery) | 3 |
| **L-8** 存储层 | R-002 (向量崩溃丢失), R-013 (KP 无版本), R-014 (备份不含文件), R-017 (KP 用 LIKE), R-018 (aliases JSON LIKE) | 5 |
| **L-3** 业务模块 | R-011 (任务竞争无锁) | 1 |
| **跨层/启动** | R-001 (调度器未启动), R-007 (无 Dream Recovery), R-024 (data/ 初始化分散) | 3 |
| **总计** | | **26** |

可以看出，**L-5 核心引擎**（7 个）和 **L-8 存储层**（5 个）是修复密度最高的区域，也是系统最复杂的部分。

---

## 七、数据结构在各层的变形

一条记忆从接入到最终存储，经历了以下数据结构变化：

```
Agent 传入                L-1 接收                L-5 感知处理
─────────                ─────────               ─────────────
{                        验证 + 路由              {
  content: "原始文本",   ──────────→              raw_content: "PII 遮罩后文本",
  source: "codebuddy",                            content_hash: "sha256...",
  content_type: "chat"                            importance: 0.72,
}                                                 entities: ["alice", "project-x"],
                                                  embedding_id: "emb_xxx",
                                                  processed: 0
                                                 }
                                                    │
                L-5 加工处理                         ▼
                ─────────────
                {                    L2 world_facts
                  subject: "alice",
                  predicate: "manages",
                  object: "project-x",
                  confidence: 0.85,
                  evidence_experience_ids: ["exp_001"]
                }
                    │
                    ▼
                L-5 巩固处理
                ─────────────
                {                    L3 observations
                  description: "Alice 频繁管理多个项目",
                  observation_type: "behavioral_pattern",
                  confidence: 0.78,
                  supporting_fact_ids: ["fact_001", "fact_002", "fact_003"]
                }
                    │
                    ▼
                L-8 编译                L-8 knowledge_pages
                ────────
                {
                  slug: "alice",
                  title: "Alice",
                  page_type: "person",
                  content: "## Alice\n管理多个项目...\n\n[[project-x]]...",
                  compile_count: 3,
                  confidence: 0.82
                }
                    │
                    ▼
                L-5 巩固晋升            L4 mental_models
                ─────────────
                {
                  title: "项目负责人倾向于...",
                  content: "当某人管理多个项目时，应优先...",
                  model_type: "behavioral_principle",
                  priority: 7,
                  is_active: true
                }
```

---

## 八、文档间引用索引

### 从 DESIGN 章节找 FLOWS 细节

| DESIGN 章节 | 内容 | 对应 FLOWS 章节（细节在此） |
|-------------|------|--------------------------|
| §二 架构总览 | 八层架构图 | Ch.1 启动流程, Ch.16 依赖图 |
| §三 统一接入层 | MCP/REST/SDK/CLI | Ch.13 双网关, Ch.14 认证限流 |
| §四 SKILL.md 接入 | CodeBuddy 专属接入 | Ch.13 (MCP handler 部分) |
| §五 权限与 Owner | 权限模型 + Owner Profile | Ch.14 认证, Ch.11 Owner 档案 |
| §六 Surface Files | 表层文件系统设计 | Ch.9 Surface Files 管理 |
| §七 记忆生命周期 | 温度模型 + GC + 压缩 | Ch.7 生命周期管理 |
| §八 四层存储 (Hindsight) | L1-L4 数据模型 | Ch.2-4 (各层写入), Ch.15 持久化 |
| §九 版本控制 (Memoria) | 快照/分支/合并 | Ch.8 版本控制 |
| §十 智能检索 | 六路检索 + MemSifter + Engram | Ch.5 检索引擎 |
| §十一 记忆核心引擎 | 感知/加工/巩固 | Ch.2 感知, Ch.3 加工, Ch.4 巩固 |
| §十二 业务模块 | 工作/社交 | Ch.11 Owner (含 person), Ch.6 Dream |
| §十三 做梦机制 | 4 阶段做梦 | Ch.6 Dream 引擎 |
| §十四 Karpathy 编译 | Knowledge Pages | Ch.10 Knowledge Pages |
| §十五 数据模型 | 28 张表 Schema | Ch.15 磁盘持久化 |
| §十六 调度策略 | cron 调度 | Ch.12 调度器 |

### 从 FLOWS 章节找 ARCHITECTURE 模块

| FLOWS 章节 | ARCHITECTURE §3 模块编号 | 模块名 |
|-----------|------------------------|--------|
| Ch.1 | — | 入口 (src/index.ts) |
| Ch.2-4 | #4 | Core Engine |
| Ch.5 | #6 | Retrieval |
| Ch.6 | #9 | Dream Engine |
| Ch.7 | #7 | Lifecycle |
| Ch.8 | #8 | Version Control |
| Ch.9 | #3 | Surface Files |
| Ch.10 | #5 (子模块) | Store / Knowledge Pages |
| Ch.11 | #2 | Owner Profile |
| Ch.12 | #13 | Scheduler |
| Ch.13-14 | #1 | Gateway |
| Ch.15 | #5 | Store |

---

## 九、系统启动初始化顺序 vs 层级

Ch.1 定义的启动顺序，映射到层级：

```
启动步骤                               涉及层级        修复项
─────────                             ──────────      ──────
1. loadConfig()                       配置（跨层）     —
2. initLogger()                       可观测性         —
3. 解析 CLI 参数                       L-1             —
4. initDb() + WAL                     L-8             —
5. runMigrations()                    L-8             —
6. loadVectorFromDisk()               L-8             R-002 (自动保存)
7. mkdir data/ 子目录                  L-8             R-024 (统一初始化)
8. recoverDreamSession()              L-7 + L-3       R-007 (启动恢复)
9. 启动 Gateway (MCP/REST)             L-1             —
10. startScheduler()                  L-3 (横切)       R-001 (必须调用)
11. 注册 shutdown handlers:
    ├─ syncAllSurfacesToDisk()        L-2             R-006 (补全)
    ├─ saveToDisk() (向量)            L-8             R-002
    └─ db.close()                     L-8             —
```

---

## 十、总结

### 核心洞察

1. **数据始终是自底向上"提炼"的**：L1 原始经验 → L2 结构化事实 → L3 模式/知识页面 → L4 原则心智模型
2. **检索是自顶向下"优先"的**：L4 权重 1.0 > L3 权重 0.85 > L2 权重 0.7 > L1 权重 0.5
3. **做梦引擎是跨层编排者**：一次 Dream 串联了 L-5(处理)→L-8(存储)→L-6(GC)→L-7(版本)→L-2(Surface) 五个层
4. **调度器是全局触发器**：不属于任何单一层，而是编排所有后台引擎的横切关注点
5. **修复密度最高的是 L-5 和 L-8**：最复杂的核心引擎和最底层的存储，是系统健壮性的关键

### 文档阅读顺序建议

```
想了解设计理念？      → DESIGN.md (从 §二 架构总览 开始)
想了解代码实现？      → FLOWS.md (从 Ch.1 启动流程 开始)
想了解系统组成？      → ARCHITECTURE.md (从 §3 模块清单 开始)
想了解修复历史？      → REPAIR.md (从 P0 必须修复 开始)
想了解开发进度？      → TODO.md (从进度总览 开始)
想了解层级映射？      → CROSS-REFERENCE.md (本文档)
```

---

> 本文档于 2026-04-07 创建，基于 DESIGN.md v3、FLOWS.md 源码审计、ARCHITECTURE.md 架构描述、REPAIR.md 26 项修复记录生成。
