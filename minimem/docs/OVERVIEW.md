# MiniMem — 个人统一记忆系统

> **一句话定义**：MiniMem 是一个为 AI Agent 设计的**仿生记忆系统**——单进程 TypeScript 架构、SQLite 存储、本地优先，模拟人类记忆的存储、巩固、遗忘与创造。

---

## 目录

1. [系统概览](#1-系统概览)
2. [设计哲学](#2-设计哲学)
3. [四层记忆模型](#3-四层记忆模型)
4. [六路检索引擎](#4-六路检索引擎)
5. [Dream Engine（做梦引擎）](#5-dream-engine做梦引擎)
6. [灵感层（Inspiration Layer）](#6-灵感层inspiration-layer)
7. [领域隔离](#7-领域隔离)
8. [认知引擎优化](#8-认知引擎优化)
9. [Knowledge Pages（知识页面）](#9-knowledge-pages知识页面)
10. [Surface Files（表面文件）](#10-surface-files表面文件)
11. [生命周期管理](#11-生命周期管理)
12. [Owner / Person 档案](#12-owner--person-档案)
13. [工作与社交模块](#13-工作与社交模块)
14. [版本控制](#14-版本控制)
15. [多模态感知（MINIMEM-005）](#15-多模态感知minimem-005)
16. [Hint-Driven Recall（MINIMEM-006）](#16-hint-driven-recallminimem-006)
17. [Gateway（网关）](#17-gateway网关)
18. [安全与权限](#18-安全与权限)
19. [调度系统](#19-调度系统)
20. [部署与运维](#20-部署与运维)
21. [项目状态](#21-项目状态)
22. [文档索引](#22-文档索引)

---

## 1. 系统概览

### 1.1 基本信息

| 项目 | 内容 |
|------|------|
| **名称** | MiniMem |
| **版本** | v0.1.0 |
| **定位** | AI Agent 个人统一记忆系统 |
| **技术栈** | TypeScript + SQLite(WAL) + 内存向量存储 |
| **运行时** | Node.js ≥ 20.0.0（单进程） |
| **代码规模** | 110+ 源文件 / 310+ 测试通过 / 28+ 数据表 |
| **许可证** | MIT |

### 1.2 核心依赖

| 依赖 | 用途 |
|------|------|
| `better-sqlite3` | SQLite 数据库（WAL 模式） |
| `hono` / `@hono/node-server` | REST API（HTTP 网关） |
| `@modelcontextprotocol/sdk` | MCP Server（stdio/HTTP） |
| `node-cron` | 进程内定时调度 |
| `pino` | 结构化日志 |
| `jsonwebtoken` | JWT 认证 |
| `zod` | 输入验证 |
| `toml` | 配置文件解析 |

### 1.3 系统架构总览

```
┌───────────────────────── Gateway ─────────────────────────┐
│  MCP Server (stdio/HTTP)  │  REST API (Hono)  │  TS SDK  │
└──────────────┬────────────┴──────────┬────────┴──────────┘
               │                       │
       ┌───────┴───────────────────────┴───────┐
       │             Core Engine                │
       │  Perception → Processing → Consolidation │
       │  Search Engine (6-route parallel)      │
       │  Dream Engine (4+1 phases)             │
       └───────┬───────────────────────┬───────┘
               │                       │
       ┌───────┴───────┐       ┌───────┴───────┐
       │   Modules     │       │   Lifecycle   │
       │  Work/Social  │       │  Temperature  │
       │  Knowledge    │       │  GC / Forget  │
       │  Owner/Person │       │  Compressor   │
       │  Inspiration  │       │  Version Ctrl │
       └───────┬───────┘       └───────┬───────┘
               │                       │
       ┌───────┴───────────────────────┴───────┐
       │            Storage Layer               │
       │  SQLite (28+ tables) + FTS5            │
       │  Memory Vector Store (in-memory+JSON)  │
       │  Knowledge Graph (memory_links)        │
       │  Surface Files (9× .md)                │
       └───────────────────────────────────────┘
```

### 1.4 数据目录结构

```
data/
├─ minimem.db          ← SQLite 主数据库（WAL 模式）
├─ vectors/            ← 向量索引（vector-index.json）
├─ surfaces/           ← Surface Files（9 个 .md）
├─ dreams/             ← Dream 报告（.md + .json）
├─ snapshots/          ← 版本快照（JSON）
├─ exports/            ← 导出文件
├─ backups/            ← SQLite 物理备份
└─ logs/               ← pino 日志（自动轮转）
```

---

## 2. 设计哲学

### 2.1 核心定位：有态度的仿生记忆系统

MiniMem **不是**通用的 Key-Value 记忆存储，而是一个**带有强烈设计主张**的记忆系统：

| 设计主张 | 说明 |
|----------|------|
| **记忆是人格化的** | 四层巩固、REM 做梦、温度衰减、遗忘曲线——全是仿生隐喻 |
| **记忆的主体是一个人** | Owner Profile、Person Profile——围绕"人"建模 |
| **记忆需要自主演化** | 做梦、巩固、GC——后台自主进程是核心价值 |
| **交互是对话式的** | Surface Files、对话上下文检索——为聊天场景优化 |

### 2.2 策略：A+C

> **保持设计主张（Attitude）+ 增加可组合性（Composability）**

- **A（Attitude）**：不去掉四层模型、做梦、遗忘等核心特性
- **C（Composability）**：通过 MCP 协议和 REST API 让其他系统可选择性调用

### 2.3 Agent 哲学

MiniMem 采用「脱离式 Agent」架构——Agent 是"指挥者"而非"执行者"：
- MiniMem 提供记忆能力，Agent 决定何时读写
- MiniMem 自主做梦和巩固，但不主动干预 Agent 行为
- Surface Files 是 Agent 与 MiniMem 之间的"共享黑板"

---

## 3. 四层记忆模型

MiniMem 模拟人类记忆的层级巩固过程，将记忆从原始体验逐步提炼为抽象原则：

```
                     ┌─────────────────────────┐
                     │  L4 心智模型              │  ← 最高抽象层
                     │  (Mental Models)         │     原则 / 规则 / 信念
                     │  表: mental_models       │     权重: 1.0
                     └────────────┬────────────┘
                                  │ promoteToMentalModels()
                     ┌────────────┴────────────┐
                     │  L3 观察 + 知识页面       │  ← 提炼层
                     │  (Observations + KP)     │     模式 / 趋势 / 洞察
                     │  表: observations /       │     权重: 0.85
                     │      knowledge_pages     │
                     └────────────┬────────────┘
                                  │ distillObservations()
                     ┌────────────┴────────────┐
                     │  L2 世界事实              │  ← 结构化层
                     │  (World Facts)           │     三元组: 主 / 谓 / 宾
                     │  表: world_facts         │     权重: 0.7
                     └────────────┬────────────┘
                                  │ extractFacts()
                     ┌────────────┴────────────┐
                     │  L1 经历                  │  ← 原始层
                     │  (Experiences)           │     原始对话 / 事件文本
                     │  表: experiences          │     权重: 0.5
                     └─────────────────────────┘
```

### 层级晋升链

| 阶段 | 方向 | 触发条件 | LLM 角色 |
|------|------|---------|----------|
| L1→L2 | 事实提取 | Dream Phase 2（离线） | 三元组抽取（medium tier） |
| L2→L3 | 观察蒸馏 | 同 subject ≥3 条 L2 且 confidence ≥0.5 | 模式归纳（medium tier） |
| L3→L4 | 心智提升 | ≥2 条 L3 且 confidence ≥0.7 | 原则泛化（heavy tier） |
| L4→下层 | **自顶向下编译**（MINIMEM-003） | L4 变更触发 | 反向传播验证 |

### 写入管线（Perception Pipeline）

单次 `ingestMemory` 执行 12 步同步管线：

```
验证 → 清洗 → SHA-256去重 → PII遮罩(14种) → LLM质量门控
→ 重要性评分 + NER(并行) → Embedding → 写入L1 → 向量索引
→ 条件索引 → FTS5全文索引
```

- **三个入口殊途同归**：REST `POST /memory` / MCP `add_memory` / SDK `addMemory()` → 统一调用 `ingestMemory()`
- **单次最多**：4 次 LLM 调用 + 1 次 Embedding
- **降级策略**：LLM 不可用时全部放行，importance 默认 0.5，无 NER/Embedding

---

## 4. 六路检索引擎

MiniMem 采用**六路并行检索 + 融合排序**架构，通过 `Promise.all` 真正并行执行：

```
用户查询
  │
  ├─ [1] planQuery()     ← LLM 查询规划（MemSifter）
  │     输入 L4 心智模型摘要，决定检索策略
  │
  ├─ [2] 六路并行
  │     ├─ 语义搜索 (Semantic)    ← 向量余弦相似度，minSimilarity=0.3
  │     ├─ 关键词搜索 (Keyword)   ← FTS5 BM25 排序
  │     ├─ 图遍历 (Graph)         ← BFS 2-hop，7种前缀
  │     ├─ 时间搜索 (Temporal)    ← 四层时间范围查询
  │     ├─ 条件索引 (Condition)   ← O(1) 精确匹配
  │     └─ 知识页面 (Knowledge)   ← FTS5 → LIKE 降级
  │
  ├─ [3] 去重融合         ← Map<id, result>，保留最高分
  ├─ [4] 层级加权排序     ← score × LAYER_WEIGHTS[layer]
  ├─ [5] LLM 重排序       ← 结果 >3 条时启用，positionBoost 衰减
  └─ [6] 查询回写         ← 跨域洞察 → compile_queue（readonly 用户跳过）
```

### 检索策略选择

| 策略 | 标识符 | 适用场景 |
|------|--------|---------|
| L4 直接回答 | `mental_model_direct` | L4 已有答案，跳过检索 |
| 知识页面 | `knowledge_page` | 结构化知识查找 |
| 语义检索 | `semantic_search` | 模糊/概念性查询 |
| 关键词检索 | `keyword_search` | 精确关键词匹配 |
| 图遍历 | `graph_traverse` | 实体关联查询 |
| 时间检索 | `temporal_search` | 时间范围查询 |
| 条件索引 | `condition_lookup` | O(1) 精确查找 |

### 无 LLM 最小可用路径

```
searchMemory → planQuery(规则降级) → keywordSearch(FTS5) → 层级加权排序 → 返回
```

---

## 5. Dream Engine（做梦引擎）

Dream Engine 是 MiniMem 最具特色的模块，模拟人类睡眠中的记忆巩固过程。采用 **4+1 阶段流水线**：

```
                Pre-Dream
                ├─ 创建前置快照
                └─ 创建 dream 分支（隔离写入）
                    │
    ┌───────────────┼───────────────────────────────────┐
    │               ▼                                   │
    │  Phase 1: Audit（审计）                            │
    │    ├─ 扫描新增 L1，按重要性分为 4 级               │
    │    ├─ 检测 L2 事实冲突（同主谓不同宾）             │
    │    └─ Knowledge Page Lint（陈旧/断链/缺证据）      │
    │               │                                   │
    │  Phase 2: Compile（Karpathy 编译）                 │
    │    ├─ L1→L2 事实提取（三元组）                     │
    │    ├─ L2→L3 观察蒸馏                              │
    │    ├─ L3→L4 心智模型晋升                          │
    │    ├─ 处理 compile_queue → 创建/更新 Knowledge Pages │
    │    └─ 更新 index.md Surface File                  │
    │               │                                   │
    │  Phase 3: REM Dream（创造性联想）                   │
    │    ├─ 随机种子选择（MMR 多样性采样）               │
    │    ├─ 多步向量空间漫游（similarity 0.3-0.7）       │
    │    ├─ 图遍历发现（BFS 3-hop）                     │
    │    ├─ 跨层配对（L1×L3）                           │
    │    ├─ LLM 创意联想（temperature=0.8）              │
    │    └─ 高新颖度洞察(≥0.7) → compile_queue          │
    │               │                                   │
    │  Phase 3.5: Inspiration（灵感引擎 MINIMEM-002）    │
    │    ├─ Spark（火花捕捉）                           │
    │    ├─ Cross-pollinate（跨域授粉）                  │
    │    ├─ Habit-detect（习惯检测）                     │
    │    ├─ Incubate（孵化）                            │
    │    ├─ Hypothesize（假说生成）                      │
    │    └─ Evaluate（评估）                            │
    │               │                                   │
    │  Phase 4: Cleanup（清理）                          │
    │    ├─ 执行标准 GC                                 │
    │    ├─ 处理 Surface 更新队列                        │
    │    ├─ 创建后置快照 + Diff 对比                     │
    │    ├─ 合并 dream 分支到 main                       │
    │    └─ 停用 dream 分支                             │
    │               │                                   │
    └───────────────┼───────────────────────────────────┘
                    ▼
                Post-Dream
                ├─ 生成 Dream 报告（.md + .json）
                ├─ 同步 Surface Files 到磁盘
                └─ 写入 dream_logs 表
```

### 做梦触发方式

| 方式 | 时机 | 说明 |
|------|------|------|
| 每日做梦 | cron `0 3 * * *` | 凌晨 3:00 自动触发 |
| 每周做梦 | cron `0 4 * * 0` | 周日凌晨 4:00 |
| 自动触发 | 每攒满 N 条新记忆 | 梯度化阈值：<100 记忆每 10 条，100-500 每 25 条，>500 每 50 条 |
| 手动触发 | MCP `trigger_dream` / REST `POST /dream/trigger` | 按需触发 |

---

## 6. 灵感层（Inspiration Layer）

> **需求编号**：MINIMEM-002 | **定位**：从"被动记忆"到"主动思考"

灵感层是 MiniMem 的认知创新模块。它**不是第五层记忆**（L5），而是一个与四层记忆并行的**独立灵感池**，由 Dream Engine 的 Phase 3.5 驱动。

### 6.1 六步灵感管线

```
┌─ Spark（火花捕捉）      ← 从 REM Dream 的跨域关联中捕获灵感种子
├─ Cross-pollinate（跨域授粉）← 在不同领域的记忆间建立意外联系
├─ Habit-detect（习惯检测）  ← 从重复行为模式中发现机会
├─ Incubate（孵化）        ← 让灵感在后台静默发酵
├─ Hypothesize（假说生成）  ← 将灵感提炼为可验证的假说
└─ Evaluate（评估）        ← 基于新证据验证假说
```

### 6.2 灵感生命周期

```
spark → incubating → mature → acted → archived
  ↑        ↓           ↓
  └── rejected ←── stale
```

### 6.3 数据存储

- **表**：`inspirations`（28 列）
- **MCP 工具**：4 个新工具（`list_inspirations`、`get_inspiration`、`act_on_inspiration`、`evaluate_inspiration`）
- **Surface File**：`insight.md`（灵感摘要输出）

---

## 7. 领域隔离

> **需求编号**：MINIMEM-001 | **定位**：架构级的多领域支持

领域隔离解决了 MiniMem 在多场景混合使用时的记忆污染问题。

### 7.1 核心设计

- **Domain 字段**：添加到 `experiences`、`world_facts`、`observations`、`mental_models`、`knowledge_pages` 等核心表
- **默认域**：`default`（未指定时的兜底）
- **域解析优先级链**：

```
显式指定 domain > source 规则匹配 > 配置默认域 > "default"
```

### 7.2 影响范围

| 子系统 | 变更 |
|--------|------|
| 数据库 Schema | 全表添加 domain 字段 + 复合索引 |
| 写入链路 | `ingestMemory()` 支持 domain 参数 |
| 检索引擎 | 六路搜索均支持 domain 过滤 |
| Dream Engine | 域内做梦 + 跨域联想 |
| Surface Files | 按域生成独立的 Surface |
| 向量存储 | 向量 metadata 携带 domain |
| MCP/REST API | 新增 `list_domains`、`create_domain` 工具 |

---

## 8. 认知引擎优化

> **需求编号**：MINIMEM-003 | **8 项优化，覆盖 P0-P3**

### 优化矩阵

| # | 优化项 | 优先级 | 核心改进 |
|---|--------|--------|----------|
| ① | **HNSW 向量索引** | P0 | O(n) 暴力扫描 → O(log n) 近似搜索 |
| ② | **多步向量漫游** | P1 | 单步随机 → 多步深入探索，发现更远关联 |
| ③ | **语义去重** | P1 | Hash 去重 → 语义相似度去重（L2→L3） |
| ④ | **时间衰减支撑度** | P1 | 事实置信度随时间衰减 + 信念漂移检测 |
| ⑤ | **MMR 种子采样** | P2 | 随机选种 → 最大边际相关性多样化采样 |
| ⑥ | **迭代联想** | P2 | 单轮联想 → 多轮链式联想，更深层洞察 |
| ⑦ | **遗忘曲线建模** | P2 | 线性衰减 → Ebbinghaus 指数遗忘曲线 |
| ⑧ | **自顶向下编译** | P3 | 纯底→顶 → L4 变更反向传播到 L2/L3 |

### 关键技术细节

- **HNSW**：引入 `@nmslib/hnswlib-node` 或类似库，替代内存 Map 暴力扫描
- **语义去重**：L2 写入前计算与已有 L2 的 cosine similarity，>0.9 则合并
- **Ebbinghaus 遗忘曲线**：`retention = e^(-t/S)`，S 为记忆强度（由复习次数和重要性决定）
- **自顶向下编译**：L4 修改/新增时，遍历 derived_from 图边，验证下层 L2/L3 是否需要更新

---

## 9. Knowledge Pages（知识页面）

Knowledge Pages 实现了 **Karpathy Compile**——将分散的事实编译为结构化的知识文档。

### 9.1 页面类型

| page_type | 标签 | 示例 |
|-----------|------|------|
| person | 👤 人物 | Alice Chen 的完整画像 |
| topic | 📋 主题 | TypeScript 最佳实践 |
| project | 🔨 项目 | MiniMem 项目信息 |
| concept | 💡 概念 | 微服务架构要点 |
| skill | 🎯 技能 | Docker 使用技巧 |
| place | 📍 地点 | 上海办公室 |
| event_series | 📅 事件 | 每周 standup 会议 |

### 9.2 编译队列

5 个入口将内容写入 `compile_queue`，Dream Phase 2 统一消费：

| 入口 | source_type | 说明 |
|------|-------------|------|
| search.ts（查询回写） | `query_insight` | 检索时发现的跨域关联 |
| dreamer.ts（REM） | `new_fact` | 做梦发现的新事实 |
| auditor.ts（Lint） | `lint_finding` | 页面健康问题 |
| chat-summary.ts | `query_insight` | 聊天摘要中的实体/话题 |

### 9.3 Lint 系统

三维度自动检查（Dream Phase 1 执行）：

| 维度 | 检查逻辑 | 触发条件 |
|------|---------|---------|
| 陈旧度 | 编译后是否有 ≥5 条新事实未处理 | staleness > 0.5 |
| 断链 | `[[backlink]]` 指向不存在的页面 | count > 0 |
| 证据缺失 | 页面无证据链（evidence_count=0） | count = 0 |

### 9.4 版本历史

每次 `updateKnowledgePageContent()` 自动将旧内容保存到 `knowledge_page_versions` 表，实现完整变更追踪。

---

## 10. Surface Files（表面文件）

Surface Files 是 Agent 与 MiniMem 之间的"共享黑板"——9 个 Markdown 文件，总 token 预算 ≤ 10K。

### 10.1 文件列表

| 文件 | 用途 | Token 预算 |
|------|------|-----------|
| `me.md` | 自我认知（身份/偏好） | 2,000 |
| `soul.md` | 价值观 / 原则 | 1,500 |
| `work.md` | 工作相关 | 2,000 |
| `social.md` | 社交网络 | 1,500 |
| `life.md` | 日常生活 | 1,500 |
| `agent.md` | Agent 行为偏好 | 1,000 |
| `context.md` | 当前上下文 | 500 |
| `index.md` | Knowledge Pages 索引 | 自动 |
| `insight.md` | 灵感摘要 | — |

### 10.2 更新路径

| 路径 | 触发方式 | 说明 |
|------|---------|------|
| Dream Phase 4 | 日做梦/周做梦 | 消费 `surface_update_queue` + 调用各 Syncer |
| 定时独立消费 | 每 6h | 独立于 Dream，直接消费更新队列 |
| 即时更新 | MCP `suggest_surface_update(immediate=true)` | 绕过队列，LLM 直接智能合并 |

### 10.3 Agent 类型映射

| Agent 类型 | 加载的文件 |
|-----------|-----------|
| `codebuddy` | me, work, agent, context |
| `openclaw` | me, soul, social, context |
| `general` | 全部 9 个文件 |

### 10.4 同步到磁盘

Surface Files 同时存储在数据库（`surface_files` 表）和磁盘（`data/surfaces/`、`references/`），Agent 通过读取 `references/` 目录获取最新上下文。

---

## 11. 生命周期管理

### 11.1 温度模型

模拟记忆的"活跃度"，与层级（抽象度）正交：

| 温度等级 | 分数范围 | 含义 |
|---------|---------|------|
| 🔥 hot | ≥ 80 | 新写入/频繁访问 |
| 🟧 warm | ≥ 60 | 中等活跃 |
| 🟦 cool | ≥ 40 | 一般 |
| 🧊 cold | ≥ 20 | 低活跃 |
| ❄️ frozen | < 20 | 长期沉寂，待清理缓冲区 |

- **初始化**：`score = importance × 100 + 20`
- **访问加热**：`score += 5`
- **周期衰减**：每 6h 全局 `-2`（pinned 记忆免疫）

### 11.2 四级 GC 体系

```
┌─────────────────────────────────────────────────────────┐
│ Light GC (每 6h)                                         │
│  温度衰减 + 噪音标记（不删除）                             │
├─────────────────────────────────────────────────────────┤
│ Standard GC (每天 4am)                                   │
│  Light GC + 过期 L2 删除 + frozen 压缩标记                │
├─────────────────────────────────────────────────────────┤
│ Deep GC (每周日 5am)                                     │
│  Standard GC + 存储配额检查 + 来源信誉更新                 │
├─────────────────────────────────────────────────────────┤
│ Emergency GC (总量 > 80% 配额时触发)                      │
│  激进删除 frozen(70%) + cold(30%)，目标降至 60%            │
└─────────────────────────────────────────────────────────┘
```

**层级保护**：L4 心智模型永远不被 GC 删除。

### 11.3 渐进式压缩

| 级别 | 条件 | 压缩方式 |
|------|------|---------|
| 0→1 | frozen + 30天无访问 | LLM 生成 2-3 句摘要 |
| 1→2 | frozen + 60天无访问 | LLM 提取 3-5 个关键点 |
| 2→3 | frozen + 90天无访问 | LLM 压缩为一句话 |

原始内容保存到 `context` 字段 `[ORIGINAL]` 标记中。

### 11.4 遗忘曲线（MINIMEM-003 ⑦）

引入 Ebbinghaus 指数遗忘模型：

```
retention = e^(-t/S)
```

- `t`：距上次访问的时间
- `S`：记忆强度（由复习次数 × 重要性决定）
- 替代原有的线性衰减，更符合人类记忆规律

### 11.5 级联遗忘

`forgetAbout(topic)` 支持按主题彻底遗忘——搜索全部四层 + Knowledge Pages，事务内执行删除，同步清理所有索引（条件/FTS/向量/图/温度），留下墓碑记录。

---

## 12. Owner / Person 档案

### 12.1 Owner Profile

**底层引擎**：通用 KV 存储，操作 `owner_profile` 表。

- **Key 格式**：点分路径，如 `identity.name`、`preferences.coding.language`
- **嵌套构建**：`getFullProfile()` 递归将 KV 构建为嵌套 JSON 对象
- **偏好推断**：贝叶斯增量更新——同偏好重复 +20% 增强，矛盾偏好 -10% 惩罚

### 12.2 Person Profiles

**人设画像管理**：`person_profiles` 表，存储人物的性格、兴趣、观点、语言习惯、关系网络。

- **三级搜索**：精确名称 → json_each 别名匹配 → LIKE 模糊降级
- **增量追加**：`appendPersonInfo()` 对数组字段 Set 去重合并，relationships 按 `person:type` 去重
- **自动构建**：Social 模块的 `persona-builder.ts` 可自动从记忆中推断人设

### 12.3 新用户引导

`startOnboarding()` 流程：设置基础 profile → 为兴趣/目标创建记忆 → 创建重要人物 → 标记完成。

---

## 13. 工作与社交模块

### 13.1 Work 模块

| 子模块 | 功能 |
|--------|------|
| `tasks.ts` | 任务 CRUD + 分页 + 状态筛选 |
| `priority.ts` | **五因子加权排序**：用户权重(0.30) + 截止紧迫(0.25) + 记忆相关性(0.20) + 最近更新(0.15) + 进行中加成(0.10) |
| `daily-summary.ts` | LLM 日终总结（持久化到 dream_logs, phase=0） |
| `weekly-review.ts` | LLM 周回顾报告（基于 7 天日总结生成） |

### 13.2 Social 模块

| 子模块 | 功能 |
|--------|------|
| `chat-summary.ts` | LLM 聊天摘要 → 实体/话题 → enqueueCompile（**Social→KP 桥梁**） |
| `persona-builder.ts` | 收集 L1+L2 → LLM 推断人设 → 创建/更新 person_profiles |
| `relationships.ts` | 双向关系管理（mentor↔mentee）、共现 ≥3 次自动检测 |
| `topic-tracker.ts` | condition_index 双表 JOIN 追踪人-话题关联 |

---

## 14. 版本控制

MiniMem 内置完整的版本控制系统：

| 功能 | 说明 |
|------|------|
| **快照 (Snapshot)** | 统计各层数量，写入 DB + JSON 文件 |
| **分支 (Branch)** | 创建/停用/删除分支（Dream 使用独立分支） |
| **Diff** | 两个快照间的增删统计 + significance 评分 |
| **合并 (Merge)** | 事务内合并，按层级去重（content_hash / 三元组 / title / slug） |
| **回滚 (Rollback)** | 安全快照后，删除 cutoff 时间点之后的所有记录 |
| **审计日志** | 所有版本操作写入 audit_log 表 |

---

## 15. 多模态感知（MINIMEM-005）

> **需求编号**：MINIMEM-005 | **定位**：多模态输入，纯文本存储

MiniMem 支持从多种外部来源导入知识，所有输入经过 Preprocessor 转换为纯文本后，统一进入 14 步 Ingest 管线。

### 15.1 核心架构

```
多模态输入
  │
  ├─ 纯文本 content → bypass（直接 ingestMemory）
  ├─ URL → UrlPreprocessor (Readability + SSRF 防护)
  ├─ 图片 → ImagePreprocessor (Vision LLM 描述)
  └─ 文件 → FilePreprocessor
       ├─ .md/.txt     → 直接读取
       ├─ .pdf         → pdf-parse 文本提取
       ├─ .docx        → mammoth → Markdown 转换
       └─ .html/.htm   → Readability 正文提取
          │
          ▼
     PreprocessResult[]
          │
          ▼
     ingestMemory() × N（每个 chunk 独立写入 L1）
```

### 15.2 支持的输入类型

| 类型 | 入口字段 | Preprocessor | 分块策略 |
|------|---------|-------------|---------|
| 纯文本 | `content` | 无（bypass） | — |
| URL | `url` | UrlPreprocessor | 单块截断 |
| 图片 | `image_url` | ImagePreprocessor | 单块描述 |
| Markdown 文件 | `file_path` (.md) | FilePreprocessor | 按标题分块 |
| 纯文本文件 | `file_path` (.txt) | FilePreprocessor | 按段落分块 |
| PDF 文件 | `file_path` (.pdf) | FilePreprocessor | 按段落分块 |
| DOCX 文件 | `file_path` (.docx) | FilePreprocessor | 按标题分块 |
| HTML 文件 | `file_path` (.html) | FilePreprocessor | 按段落分块 |

### 15.3 文件导入配置

```toml
[perception.multimodal.file]
max_file_size_mb = 10          # 单文件最大 10MB
max_chunk_size = 50000         # 单块最大 50KB
chunk_overlap = 200            # 块间重叠 200 字符
max_chunks = 20                # 单文件最大 20 块
allowed_extensions = [".md", ".markdown", ".txt", ".text", ".pdf", ".docx", ".html", ".htm"]
```

### 15.4 MCP 工具

| 工具 | 用途 |
|------|------|
| `add_memory` | 通用记忆添加（支持 content/url/file_path/image_url 四选一） |
| `import_knowledge` | 知识导入专用（支持 url/file/image 三种 source_type） |

### 15.5 REST API 端点

| 端点 | 用途 |
|------|------|
| `POST /api/v1/memory` | 通用记忆添加（支持多模态） |
| `POST /api/v1/memory/import-url` | URL 导入专用 |
| `POST /api/v1/memory/batch-url` | 批量 URL 导入（并发限制 3） |

### 15.6 安全防护

- **SSRF 防护**：URL 导入经过协议白名单 + 内网 IP 检测 + DNS rebinding 防护
- **路径穿越**：文件导入禁止 `..` 路径
- **文件大小限制**：防止 OOM
- **二进制检测**：拒绝非文本二进制文件（已知格式如 PDF/DOCX 除外）
- **扫描版 PDF 检测**：低文本量 PDF 自动警告

---

## 16. Hint-Driven Recall（MINIMEM-006）

> **需求编号**：MINIMEM-006 | **定位**：跨层协作的轻量记忆召回

Hint-Driven Recall 解决 MiniMem 的核心能力缺口——"记忆可写不可读"的时序错位。远端存储的历史记忆无法参与 Agent 推理前的上下文组装，本模块通过跨层协作架构将召回决策外化到 IDE/系统层。

### 16.1 三层召回架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 0: Surface Files（常驻上下文）                          │
│    me.md / work.md / context.md — 始终注入 Agent              │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Hint-Driven Recall（本模块核心）                     │
│    IDE 层每轮消息前调用 → 注入 ≤200 token hints               │
│    Agent 看到 hints 后按需 search_memory 深入                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Agent 显式深度检索                                   │
│    search_memory / recall_about — Agent 自主决定调用           │
└─────────────────────────────────────────────────────────────┘
```

**核心创新**：将"需不需要召回"的决策从 Agent LLM 推理中外化到 IDE 宿主层 + MiniMem 服务端，不消耗 Agent 推理 token。

### 16.2 HintsEngine 管线

```
用户消息
  │
  ├─ [1] Skip 判断 (<1ms)
  │     ├─ 消息过短 (< 10 字符)
  │     ├─ 问候语匹配
  │     ├─ 确认语匹配
  │     └─ 系统指令匹配
  │
  ├─ [2] Session 缓存查询 (<1ms)
  │     └─ 精确 hash 匹配复用
  │
  ├─ [3] 实体提取 (<5ms)
  │     └─ 轻量 tokenizer（空格/标点分割 + 停词过滤）
  │
  ├─ [4] 四路信号并行 (~80ms)
  │     ├─ 语义信号 — embedding cosine similarity (topK=20)
  │     ├─ 实体信号 — condition_index + world_facts LIKE
  │     ├─ 时间信号 — 时间表达式解析 + 近期 boost
  │     └─ 图信号   — 1-hop 知识图谱遍历
  │
  ├─ [5] 融合评分 (<5ms)
  │     └─ weighted sum + layer boost + min_relevance 过滤
  │
  └─ [6] 格式化 (<10ms)
        └─ 时间标签 + 摘要截断 + recall_query 生成
```

**延迟预算**：≤200ms（P99），缓存命中 <10ms

### 16.3 四路信号融合

| 信号 | 权重 | 数据源 | 特点 |
|------|------|--------|------|
| 语义 (semantic) | 0.50 | 向量库 cosine search | 主力信号，需 embedding |
| 实体 (entity) | 0.25 | condition_index + world_facts LIKE | 精确匹配，无需 LLM |
| 时间 (time) | 0.15 | 时间表达式解析 + recent boost | 支持中英文时间词 |
| 图 (graph) | 0.10 | world_facts 1-hop 关联 | 发现间接相关记忆 |

**层级加权 (Layer Boost)**：L4=1.1, L3=1.2, L2=1.0, L1=0.6

**降级策略**：语义信号失败时自动降级为仅 entity + time 信号（关键词匹配），不阻塞整体。

### 16.4 三级缓存

| 级别 | Key | TTL | 命中条件 |
|------|-----|-----|---------|
| L1 Embedding | message_hash | 5 min | 相同消息跳过重复 embed |
| L2 摘要 | memory_id | 10 min | 热点记忆的格式化结果复用 |
| L3 Session | session_id + message_hash | 会话级 | 精确重复消息直接复用完整响应 |

基于 LRU Map 实现，不引入外部依赖。

### 16.5 REST API

| 端点 | 用途 | 限流 |
|------|------|------|
| `POST /api/v1/recall/hints` | 轻量 hints 生成（每轮消息调） | 60 req/min/client |
| `POST /api/v1/recall/auto` | 自动召回（hint/full/smart 三模式） | 30 req/min/client |

**hints 请求体**：

```json
{
  "message": "用户最新消息",
  "context_summary": "当前对话摘要（可选）",
  "conversation_history": ["前几轮消息（可选）"],
  "max_hints": 3,
  "token_budget": 200,
  "domain": "work"
}
```

**hints 响应体**：

```json
{
  "hints": [
    {
      "id": "hint_xxx",
      "memory_id": "mem_yyy",
      "summary": "3天前讨论了 TypeScript 泛型约束问题",
      "time_label": "3 天前",
      "relevance_score": 0.82,
      "recall_query": "TypeScript 泛型 约束",
      "layer": "L2",
      "tags": ["typescript"]
    }
  ],
  "meta": {
    "search_time_ms": 45,
    "total_candidates": 8,
    "token_count": 62
  }
}
```

**auto 三模式**：
- `hint`：纯机械检索，只返回 hints
- `full`：hints + top-1 自动执行 search_memory 返回完整内容
- `smart`：先 hints，若 relevance_score ≥ 0.8 自动升级为 full

### 16.6 MCP 工具

| 工具 | 用途 |
|------|------|
| `get_memory_hints` | Agent 在推理中主动获取 hints（topic → hints） |
| `get_relevant_context` | 返回 Surface Files + 可选 hints（include_hints=true） |

### 16.7 IDE 集成协议

```
┌─────── IDE 宿主层 ───────┐
│ 1. 拦截用户消息           │
│ 2. POST /recall/hints    │
│ 3. 注入 <memory_hints>   │
│ 4. 转发给 Agent          │
└──────────────────────────┘
         │
         ▼
┌─────── Agent 推理层 ─────┐
│ 1. 看到 <memory_hints>   │
│ 2. 判断是否需要深入       │
│ 3. 按需调 search_memory  │
└──────────────────────────┘
```

### 16.8 可观测性

Prometheus 指标（进程内计数器，`/api/v1/metrics` 端点暴露）：

| 指标 | 类型 | 说明 |
|------|------|------|
| `minimem_recall_hints_requests_total` | counter | hints 请求总数（按 status 标签） |
| `minimem_recall_auto_requests_total` | counter | auto 请求总数 |
| `minimem_recall_hints_skipped_total` | counter | 跳过次数（按 reason 标签） |
| `minimem_recall_signal_calls_total` | counter | 信号调用次数（按 signal_type） |
| `minimem_recall_signal_failures_total` | counter | 信号失败次数 |
| `minimem_recall_signal_avg_duration_ms` | gauge | 信号平均延迟 |
| `minimem_recall_cache_hits_total` | counter | 缓存命中（按 cache_level） |
| `minimem_recall_avg_latency_ms` | gauge | 平均延迟 |
| `minimem_recall_max_latency_ms` | gauge | 最大延迟 |

### 16.9 配置

```toml
[recall]
enabled = true

[recall.hints]
max_hints = 3                    # 默认返回最多 3 条 hint
min_relevance = 0.55             # 最低相关性阈值
token_budget = 200               # Token 预算上限
summary_max_chars = 80           # 单条摘要最大字符数
skip_min_length = 10             # 消息低于此长度自动跳过

[recall.hints.signals]
semantic_weight = 0.50           # 语义信号权重
entity_weight = 0.25             # 实体信号权重
time_weight = 0.15               # 时间信号权重
graph_weight = 0.10              # 图关联信号权重

[recall.hints.cache]
embedding_ttl = 300              # Embedding 缓存 TTL (秒)
summary_ttl = 600                # 摘要缓存 TTL (秒)
session_reuse_threshold = 0.9    # Session 复用相似度阈值

[recall.auto]
default_mode = "hint"            # 默认模式
smart_threshold = 0.8            # smart 模式升级阈值
```

### 16.10 关键文件

| 文件 | 职责 |
|------|------|
| `src/recall/hints-engine.ts` | HintsEngine 核心编排器 |
| `src/recall/skip-rules.ts` | 消息跳过规则（4 类模式） |
| `src/recall/signals/` | 四路信号源实现 |
| `src/recall/score-fusion.ts` | 多路信号加权融合 |
| `src/recall/hint-formatter.ts` | Hint 摘要格式化器 |
| `src/recall/cache.ts` | 三级 LRU 缓存 |
| `src/recall/metrics.ts` | 进程内指标收集 |
| `src/recall/types.ts` | 全部类型定义 |

---

## 17. Gateway（网关）

### 17.1 MCP Server

30+ 个 MCP Tool，支持 stdio 和 HTTP (Streamable) 两种传输：

| 分类 | 工具 |
|------|------|
| **记忆操作** | add_memory, add_memories_batch, search_memory, recall_about, get_relevant_context, get_memory_by_id, list_memories, update_memory, delete_memory, forget_about, pin_memory, feedback_memory |
| **导入导出** | export_memories, import_memories, import_knowledge |
| **Owner/Person** | get_owner_profile, get_owner_preference, get_person_profile |
| **Surface Files** | load_surfaces, get_surface_file, suggest_surface_update, check_surface_version |
| **系统操作** | trigger_dream, get_summary, create_snapshot, diff_memory, start_onboarding, get_memory_health |
| **领域** | list_domains, create_domain |
| **灵感** | list_inspirations, get_inspiration, act_on_inspiration, evaluate_inspiration |

### 17.2 REST API

20+ 个 HTTP 端点（Hono 框架），功能与 MCP 基本对齐：

```
POST   /api/v1/memory              添加记忆（支持 content/url/file_path/image_url）
POST   /api/v1/memory/batch        批量添加（纯文本）
POST   /api/v1/memory/batch-url    批量 URL 导入（并发限制 3）
POST   /api/v1/memory/import-url   URL 导入专用
GET    /api/v1/memory/search       搜索
GET    /api/v1/memory/recall/:topic 回忆
GET    /api/v1/memory/context      获取上下文
GET    /api/v1/memory/:id          按 ID 获取
PUT    /api/v1/memory/:id          更新
DELETE /api/v1/memory/:id          删除
POST   /api/v1/memory/forget       级联遗忘
POST   /api/v1/memory/:id/pin      固定
POST   /api/v1/memory/:id/feedback 反馈
POST   /api/v1/memory/export       导出
POST   /api/v1/memory/import       导入
GET    /api/v1/owner/profile       Owner 档案
GET    /api/v1/surface             Surface Files
POST   /api/v1/dream/trigger       触发做梦
GET    /api/v1/health              健康检查
GET    /api/v1/admin/stats         管理统计
POST   /api/v1/snapshot            创建快照
GET    /api/v1/diff                Diff 对比
```

### 17.3 TypeScript SDK

```typescript
const client = new MiniMemClient({ baseUrl: 'http://localhost:3000' });
await client.addMemory({ content: '...', source: 'app' });
const results = await client.searchMemory({ query: 'Alice' });
```

---

## 18. 安全与权限

### 18.1 JWT 认证

- 认证可选（`config.auth.enabled`），默认关闭
- 三级权限：

| 级别 | 读 | 写 | Dream/Snapshot/Admin |
|------|----|----|---------------------|
| `trusted` | ✅ | ✅ | ✅ |
| `standard` | ✅ | ✅ | ❌ |
| `readonly` | ✅ | ❌ | ❌ |

### 18.2 滑动窗口限流

| 限制 | 阈值 |
|------|------|
| 全局写入 | 60 writes/min |
| 客户端写入 | 20 writes/min/client |
| 客户端读取 | 60 reads/min/client |

超限返回 `429 Too Many Requests`，携带 `X-RateLimit-*` 响应头。

### 18.3 PII 防护

14 种 PII 正则模式自动检测与遮罩：信用卡、手机号（中国/国际）、身份证、邮箱、API Key、密码、SSN、护照、银行卡、IP、JWT、私钥等。

---

## 19. 调度系统

基于 `node-cron` 的进程内调度，配合 FIFO 互斥锁（5 分钟超时）防止任务冲突。

### 任务矩阵

| 任务 | Cron | 频率 | 互斥锁 |
|------|------|------|--------|
| 自动备份 | `0 2 * * *` | 每天 2:00 | ❌ |
| 每日做梦 | `0 3 * * *` | 每天 3:00 | 🔒 |
| 标准 GC | `0 4 * * *` | 每天 4:00 | 🔒 |
| 轻量 GC | `0 */6 * * *` | 每 6h | 🔒 |
| 日终总结 | `0 18 * * 1-5` | 工作日 18:00 | ❌ |
| 每周做梦 | `0 4 * * 0` | 周日 4:00 | 🔒 |
| 深度 GC | `0 5 * * 0` | 周日 5:00 | 🔒 |
| 紧急 GC | 事件触发 | 总量 > 80%配额 | 🔒 |
| 自动做梦 | 事件触发 | 攒满 N 条记忆 | — |

### 周日完整时序

```
02:00  backup        (无锁) ── 创建快照
03:00  dream:daily   (🔒)  ── 4 阶段做梦
04:00  dream:weekly  (排队) ── 等 daily 完成后执行
04:00  gc:standard   (排队)
05:00  gc:deep       (排队) ── 等前面全部完成
```

---

## 20. 部署与运维

### 20.1 本地开发

```bash
npm install
cp config.default.toml config.local.toml  # 修改配置
npm run dev                                 # tsx watch 热重载
npm test                                    # vitest 运行测试
```

### 20.2 Docker 部署

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY config.default.toml ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 20.3 Systemd 服务

```ini
[Unit]
Description=MiniMem Memory Service
After=network.target

[Service]
Type=simple
User=minimem
ExecStart=/usr/bin/node /opt/minimem/dist/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 20.4 MCP 远程接入

通过 Nginx 反向代理 + MCP Streamable HTTP，支持远程 Agent 接入：

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### 20.5 备份策略

| 方式 | 频率 | 内容 |
|------|------|------|
| 逻辑快照 | 每天 2:00 | `createSnapshot()` — 统计快照写入 DB |
| 物理备份 | API 手动触发 | `createBackup()` — 复制 DB + WAL + vectors + dreams + surfaces |
| 保留策略 | 最近 7 个 | 按修改时间排序，删除超额旧备份 |

---

## 21. 项目状态

### 21.1 已完成

| 里程碑 | 状态 | 详情 |
|--------|------|------|
| **核心功能** | ✅ 100% (155/155) | 四层记忆、六路检索、Dream Engine、Surface Files、版本控制 |
| **22 项需求审计** (REQ-001~022) | ✅ 全部完成 | 冷启动、检索质量、系统健壮性、认知能力、生产运维、安全 |
| **MINIMEM-002 灵感层** | ✅ 全部完成 (18/18) | 6 步管线、inspirations 表、4 个 MCP 工具、insight.md |
| **MINIMEM-003 认知引擎优化** | ✅ 全部完成 | HNSW、多步漫游、语义去重、时间衰减、MMR、迭代联想、Ebbinghaus、自顶向下编译 |
| **MINIMEM-005 多模态感知** | ✅ 全部完成 (Phase 1-5) | URL 抓取、MD/TXT 文件、图片描述、PDF/DOCX/HTML 解析、MCP Tool 整合、批量导入 |
| **MINIMEM-006 Hint-Driven Recall** | ✅ 全部完成 (Phase 1-6) | 四路信号融合引擎、MCP 集成、三级缓存、安全加固、文档、171 tests |

### 21.2 待实施

| 里程碑 | 状态 | 说明 |
|--------|------|------|
| **MINIMEM-001 领域隔离** | 📋 需求已定义 | 架构级 domain 字段、域解析、域内做梦 |
| **Phase 2-5 SaaS 路线图** | 📋 规划中 | 多用户、分布式部署、Web UI、插件系统 |

### 21.3 测试覆盖

- **测试框架**：vitest
- **测试文件**：29 个
- **通过率**：310+ 测试全部通过

---

## 22. 文档索引

### 架构文档

| 文件 | 内容 |
|------|------|
| `docs/architecture/ARCHITECTURE.md` | 系统架构详细文档（14 模块、28+ 表、API 规格） |
| `docs/architecture/DESIGN.md` | 核心系统设计（详细实现方案） |
| `docs/architecture/POSITIONING.md` | 产品定位论（通用性 vs 专精性） |
| `docs/architecture/AGENT-SOUL.md` | Agent 哲学（脱离式架构） |
| `docs/architecture/DETACHED-AGENT.md` | 脱离式 Agent 工程设计 |

### 管线文档（代码级剖析）

| 文件 | 内容 |
|------|------|
| `docs/pipelines/FLOWS.md` | 全局架构总览（17 个子系统流程） |
| `docs/pipelines/INGEST-PIPELINE.md` | 写入管线完整剖析（12 步感知管道） |
| `docs/pipelines/RETRIEVAL-PIPELINE.md` | 检索管道深度解析（六路并行） |
| `docs/pipelines/MODULES-DEEP-DIVE.md` | Knowledge Pages / Owner / Work / Social 模块剖析 |
| `docs/pipelines/SCHEDULER-DEEP-DIVE.md` | 调度器系统代码级剖析（9 个任务） |

### 需求文档

| 文件 | 内容 |
|------|------|
| `docs/minimem-requirements.md` | 原始 22 项需求审计（REQ-001~022） |
| `docs/需求-MiniMem领域隔离.md` | MINIMEM-001 领域隔离需求 |
| `docs/需求-MiniMem灵感层.md` | MINIMEM-002 灵感层需求 |
| `docs/需求-MiniMem认知引擎优化.md` | MINIMEM-003 认知引擎优化需求 |

### 实施追踪

| 文件 | 内容 |
|------|------|
| `docs/TODO.md` | 核心开发 TODO（155/155 完成） |
| `docs/TODO-requirements.md` | 22 项需求实施追踪（全部完成） |
| `docs/TODO-灵感层.md` | MINIMEM-002 实施追踪（18/18 完成） |
| `docs/TODO-认知引擎优化.md` | MINIMEM-003 实施追踪（全部完成） |

### 运维文档

| 文件 | 内容 |
|------|------|
| `docs/BUILD.md` | 云部署指南（Docker / Systemd / Nginx / MCP 远程） |
| `docs/run_able.md` | 可运行性评估与启动验证 |

### 修复记录

| 文件 | 内容 |
|------|------|
| `docs/repairs/REPAIR.md` ~ `REPAIR-5.md` | 6 轮修复记录 |

### MCP Skill

| 文件 | 内容 |
|------|------|
| `SKILL.md` | MCP Skill 定义（hooks、Surface 同步策略、工具使用指南） |

---

> **文档生成时间**：2026-04-23
> **基于源码审计**：110+ TypeScript 源文件，29 测试文件，20+ 文档文件
> **版本**：MiniMem v0.1.0
