# MiniMem — 系统架构文档

> 本文档从纯架构角度描述 MiniMem 的系统组成。
> 不涉及设计理念、认知科学类比、框架借鉴等内容——那些在 DESIGN.md 中。
> 这里只回答：**有哪些模块、怎么连接、数据怎么流、接口长什么样。**

---

## 1. 系统定位

MiniMem 是一个**独立运行的记忆服务进程**，对外暴露标准化接口，任何 AI Agent 作为客户端接入。

```
单进程服务 · TypeScript/Bun · SQLite 存储 · 本地优先
```

---

## 2. 总体架构

```
                    ┌──────────────┐
                    │   客户端们    │
                    │              │
                    │  CodeBuddy   │  ← Skill 接入（推荐）
                    │  Claude      │  ← MCP 接入
                    │  OpenClaw    │  ← REST API
                    │  自定义 Agent │  ← SDK / REST
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │     Gateway 接入层       │
              │                         │
              │  MCP Server (stdio/HTTP) │
              │  REST API (Hono)        │
              │  TypeScript SDK         │
              │  CLI                    │
              │                         │
              │  认证(JWT) · 权限 · 限流  │
              │  审计日志                │
              └────────────┬────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌────────────┐   ┌────────────────┐   ┌──────────┐
│ Surface    │   │  Core Engine   │   │ Retrieval│
│ Files 引擎 │   │  核心引擎      │   │ 检索引擎  │
└─────┬──────┘   └───────┬────────┘   └────┬─────┘
      │                  │                  │
      │         ┌────────┼────────┐         │
      │         ▼        ▼        ▼         │
      │   ┌─────────┐ ┌──────┐ ┌──────┐    │
      │   │ 感知层   │ │加工层│ │做梦  │    │
      │   │Perception│ │Proc. │ │Dream │    │
      │   └────┬────┘ └──┬───┘ └──┬───┘    │
      │        │         │  Compile│         │
      │        └─────────┼────────┘         │
      │                  │                  │
      ▼                  ▼                  ▼
┌──────────────────────────────────────────────────┐
│              Lifecycle 生命周期管理                 │
│                                                    │
│  温度引擎 · GC · 压缩管线 · 流控 · 来源信誉        │
└──────────────────────┬─────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────┐
│              Version Control 版本控制                │
│                                                      │
│  快照 · 分支 · Diff · 合并 · 回滚 · 审计日志        │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────┐
│                  Storage 存储层                      │
│                                                      │
│  SQLite (结构化)  ·  向量索引  ·  FTS5 全文  ·       │
│  条件索引 (HashMap)  ·  知识图谱  ·  Markdown 文件   │
└──────────────────────────────────────────────────────┘
```

---

## 3. 模块清单

| # | 模块 | 目录 | 职责 |
|---|------|------|------|
| 1 | **Gateway** | `src/gateway/` | MCP Server、REST API、认证、权限、限流、审计 |
| 2 | **Owner Profile** | `src/owner/` | 统一用户画像管理、偏好推断、多 Agent 一致性 |
| 3 | **Surface Files** | `src/surface/` | 8 个 Markdown 文件的自动维护、预算控制、按 Agent 裁剪加载 |
| 4 | **Core Engine** | `src/core/` | 感知层（写入）、加工层（L1→L2→L3→L4 提炼）、巩固层（做梦入口） |
| 5 | **Store** | `src/store/` | L1-L4 四层存储、Knowledge Pages（知识页面+反向链接+证据链）、编译队列、工作记忆、程序记忆、向量存储、知识图谱 |
| 6 | **Retrieval** | `src/retrieval/` | 四路并行检索、查询规划、条件索引、重排序、压缩 |
| 7 | **Lifecycle** | `src/lifecycle/` | 温度计算、GC（4 种策略）、压缩管线、流控、来源信誉、健康监控 |
| 8 | **Version Control** | `src/version/` | 快照、分支、Diff、合并、回滚、审计日志 |
| 9 | **Dream Engine** | `src/modules/dream/` | 4 阶段做梦流水线：审计(+Lint)→编译(Karpathy Compile)→联想→清理 |
| 10 | **Work Module** | `src/modules/work/` | 日志、日总结、周回顾、优先级排序 |
| 11 | **Social Module** | `src/modules/social/` | 聊天摘要、人设画像、关系图谱、话题追踪 |
| 12 | **LLM** | `src/llm/` | LLM 客户端（主模型 + 代理模型）、Prompt 模板、Embedding |
| 13 | **Scheduler** | `src/scheduler/` | 定时任务调度（cron + 事件驱动） |
| 14 | **SDK** | `src/sdk/` | 对外发布的 TypeScript SDK（`@minimem/sdk`） |

---

## 4. 数据分层（四层存储 + 知识页面）

```
写入方向（自下而上编译）：

L1 经历 (experiences)     ← 原始对话/事件，只增不改 (= Karpathy raw/)
    │ LLM 事实提取
    ▼
L2 事实 (world_facts)     ← 三元组 (主-谓-宾)，带置信度和时间有效性
    │ Dream Phase 2 编译
    ▼
L3 观察 (observations)    ← 简单模式、趋势（散点记录）
L3 知识页面 (knowledge_pages) ← 围绕实体/概念的结构化 Wiki 页面 (Karpathy Compile)
    │                           含反向链接 [[related]]、证据追溯、INDEX 索引
    │ 做梦晋升/用户策划
    ▼
L4 心智模型 (mental_models) ← 最高优先级规则/原则，指导系统行为 (= Karpathy Schema)

读取方向（自上而下优先）：
检索时优先返回 L4 > L3(知识页面) > L3(观察) > L2 > L1

编译队列：
compile_queue             ← 查询洞察/反馈/Lint 发现 → 排队等 Dream Phase 2 编译
```

**辅助存储**：
- **工作记忆**：临时上下文缓存（TTL 自动过期）
- **程序记忆**：操作规则/流程（条件触发执行）

---

## 5. 接入层接口

### 5.1 MCP Tools（共 27 个）

#### 记忆写入
| 工具 | 说明 |
|------|------|
| `add_memory` | 添加一条记忆（自动分层） |
| `add_memories_batch` | 批量添加 |
| `import_memories` | 从 JSON/Markdown/聊天记录导入 |

#### 记忆检索
| 工具 | 说明 |
|------|------|
| `search_memory` | 语义+关键词+图遍历+时间 四路混合搜索 |
| `recall_about` | 获取某实体的所有关联记忆 |
| `get_relevant_context` | 获取当前对话的完整上下文（Surface Files + 深层检索 + 主动推送） |
| `get_memory_by_id` | 按 ID 获取单条记忆 |
| `list_memories` | 分页浏览记忆 |

#### 记忆管理
| 工具 | 说明 |
|------|------|
| `update_memory` | 修正记忆内容/置信度/标签 |
| `delete_memory` | 删除单条记忆（可级联） |
| `forget_about` | 遗忘关于某事的所有记忆（级联删除） |
| `pin_memory` | 置顶/取消置顶（防止被 GC） |
| `feedback_memory` | 对记忆进行反馈（useful/incorrect/outdated） |
| `export_memories` | 导出记忆（JSON/Markdown/SQLite） |

#### Owner Profile
| 工具 | 说明 |
|------|------|
| `get_owner_profile` | 获取用户画像 |
| `get_owner_preference` | 获取特定话题偏好 |
| `get_person_profile` | 获取某人的画像 |

#### Surface Files
| 工具 | 说明 |
|------|------|
| `load_surfaces` | 按 Agent 类型批量加载 Surface Files |
| `get_surface_file` | 获取单个 Surface File |
| `suggest_surface_update` | 建议更新某个 Surface File（排队等做梦引擎审核） |

#### 系统操作
| 工具 | 说明 |
|------|------|
| `trigger_dream` | 手动触发做梦 |
| `get_summary` | 获取日/周/月总结 |
| `create_snapshot` | 创建版本快照 |
| `diff_memory` | 对比两个快照的差异 |
| `start_onboarding` | 新用户引导 |
| `get_memory_health` | 获取系统健康状态 |

### 5.2 REST API

与 MCP Tools 一一对应：

```
POST   /api/v1/memory                → add_memory
POST   /api/v1/memory/batch          → add_memories_batch
GET    /api/v1/memory/search         → search_memory
GET    /api/v1/memory/recall/:entity → recall_about
GET    /api/v1/memory/:id            → get_memory_by_id
PUT    /api/v1/memory/:id            → update_memory
DELETE /api/v1/memory/:id            → delete_memory
POST   /api/v1/memory/forget         → forget_about
POST   /api/v1/memory/pin            → pin_memory
POST   /api/v1/memory/feedback       → feedback_memory
GET    /api/v1/memory/list           → list_memories
POST   /api/v1/memory/export         → export_memories
POST   /api/v1/memory/import         → import_memories

GET    /api/v1/owner/profile         → get_owner_profile
GET    /api/v1/owner/preference      → get_owner_preference
GET    /api/v1/person/:name          → get_person_profile

POST   /api/v1/context/relevant      → get_relevant_context
GET    /api/v1/surface               → load_surfaces
GET    /api/v1/surface/:file         → get_surface_file
POST   /api/v1/surface/suggest       → suggest_surface_update

POST   /api/v1/dream/trigger         → trigger_dream
GET    /api/v1/summary/:period       → get_summary
POST   /api/v1/snapshot              → create_snapshot
GET    /api/v1/snapshot/diff         → diff_memory
POST   /api/v1/onboarding            → start_onboarding
GET    /api/v1/health                → get_memory_health

POST   /api/v1/auth/token            → 获取访问令牌
GET    /api/v1/auth/clients          → 查看已注册客户端
GET    /api/v1/admin/stats           → 记忆统计
GET    /api/v1/admin/audit           → 审计日志
```

---

## 6. 数据流

### 6.1 写入流（记忆摄入）

```
外部输入（对话/文件/聊天记录/手动）
    │
    ▼
Gateway → 认证(JWT) → 权限检查 → 速率限制
    │
    ▼
感知层(Perception)
    ├─ 文本清洗 & 分段
    ├─ NER 实体识别 → 生成条件索引键
    ├─ 重要性评分
    ├─ PII 检测 → mask / reject / keep
    ├─ 来源信誉检查 → 调整初始重要性
    ├─ 质量门控 → 低质量则拒绝
    ├─ 向量 Embedding 生成
    └─ 写入 L1 (experiences 表)
         ├─ → 向量索引
         ├─ → FTS5 全文索引
         ├─ → 条件索引 (condition_index 表)
         ├─ → 知识图谱 (memory_links 表)
         └─ → 温度初始化为 hot (memory_temperature 表)
```

### 6.2 提炼流（层级晋升 + Karpathy 编译）

```
L1 experiences
    │ [LLM 事实提取，批量 10 条一次]
    ▼
L2 world_facts ← 三元组 + 置信度 + 时间有效性 + 证据链
    │ [Dream Phase 2 编译]
    ▼
编译决策 (LLM 判断):
    ├─ 新实体/概念 → 创建 Knowledge Page (knowledge_pages 表)
    │                  含 Markdown 内容 + [[backlink]] 语法
    │                  自动维护反向链接 (knowledge_page_links 表)
    │                  记录证据链 (knowledge_page_evidence 表)
    │                  更新 INDEX (Surface Files index.md 知识索引区)
    │
    ├─ 已有页面需更新 → 增量追加（不重写），更新反向链接
    │
    ├─ 简单模式/趋势 → 创建独立 Observation (observations 表)
    │
    └─ 冲突检测 → 新事实与页面矛盾 → 标记 conflicted，不自动覆盖
    │
    │ [做梦晋升/用户策划]
    ▼
L4 mental_models ← 原则/偏好/规则（需确认）

编译队列 (compile_queue):
    查询洞察/用户反馈/Lint 发现 → 排队 → Dream Phase 2 统一编译
```

### 6.3 检索流

```
查询请求
    │
    ▼
查询规划器 (MemSifter)
    ├─ LLM 分析意图 → 检索计划
    │  (可用轻量代理模型降低成本)
    │
    ├─ 如果 L4 心智模型已有答案 → 跳过检索，直接返回
    │
    ├─ Knowledge Page 路径:
    │    读取 index.md 知识索引区 → 命中相关页面?
    │    → 整页或段落级返回（高置信、结构化）
    │
    └─ 执行四路并行检索:
         ├─ 语义检索 (向量 cosine similarity)
         ├─ 关键词检索 (SQLite FTS5 + BM25)
         ├─ 图遍历检索 (knowledge_graph + knowledge_page_links 2-3 跳)
         └─ 时间范围检索 (时间索引)
              │
              ▼
         结果融合 & LLM 重排序
              │
              ▼
         层级优先排序: L4 > L3(知识页面) > L3(观察) > L2 > L1
              │
              ▼
         条件索引快速补充 (O(1) 查找)
              │
              ▼
         主动推送引擎附加提醒
              │
              ▼
         Top-K 返回
              │
              ▼
         查询回写判断:
              有跨域洞察/新连接? → 记录到 compile_queue
              用户反馈 useful? → 强化温度 + 记录到 compile_queue
```

### 6.4 做梦流（后台任务）

```
触发 → 定时(每日凌晨3点) / 空闲 / 手动 / 新记忆达阈值(50条)

Pre-Dream:
    创建版本快照 → 创建 dream 分支
    │
Phase 1 — 审计 + Knowledge Page Lint:
    扫描新增记忆 → 评估重要性 → 分级(critical/important/routine/trivial)
    重建条件索引 → 检测冲突/重复/过时
    Knowledge Page 健康检查:
      · 过时页面(>7天未更新且有新证据)
      · 孤立页面(入链为0)
      · 矛盾页面(内容与新事实冲突)
      · 缺失页面(多次出现但无页面的实体)
      · 索引完整性(INDEX 与实际页面一致性)
    [事务提交 checkpoint-1]
    │
Phase 2 — 编译 (Karpathy Compile 模式):
    L1→L2 事实提取
    读取 Knowledge Pages INDEX → LLM 编译决策:
      · 创建新 Knowledge Page
      · 增量更新已有页面
      · 创建独立 Observation
      · 更新反向链接(双向同步)
    处理 compile_queue (查询洞察/反馈/Lint 发现)
    维护 INDEX (每页一行摘要)
    碎片记忆合并 → 冲突标记(不自动覆盖)
    触发压缩管线(老记忆)
    [事务提交 checkpoint-2]
    │
Phase 3 — 联想:
    随机种子(3-5条) → 向量空间漫游(cos sim 0.3-0.7)
    → 图遍历(2-3跳) → 跨层配对(L1+L3)
    → 跨 Knowledge Page 模式发现(不同页面间的隐藏关联)
    → LLM 联想 → 洞察提取
    → 高置信度洞察写入 L3/L4 或创建新 Knowledge Page
    [事务提交 checkpoint-3]
    │
Phase 4 — 清理:
    选择性遗忘(温度衰减) → 更新索引
    → 更新 Surface Files (含 index.md 知识索引区)
    → Diff(做梦前后快照)
    → 合并 dream 分支 → main
    → 生成做梦报告
```

### 6.5 GC 流（生命周期管理）

```
温度衰减(每6小时):
    遍历所有记忆 → 重算温度分数 → 更新温度等级

轻量 GC(每6小时):
    温度衰减 + 噪音过滤(低重要性+零访问+超14天 → 快速降温)

标准 GC(每日做梦时):
    + 重复合并(cos sim > 0.92)
    + 过时清理(valid_until 过期 / 支撑事实不足)

深度 GC(每周):
    + 存储配额检查(hot≤500/warm≤2000/cool≤10000/cold≤50000/frozen≤200000)
    + 来源信誉评估(GC清理率>50% → 惩罚该来源)

紧急 GC:
    存储超80%配额时触发
```

### 6.6 Surface Files 更新流

```
Surface Files = 8 个 Markdown 文件，总预算 ≤ 10K tokens

更新触发:
    会话结束 → context.md
    做梦完成 → context.md, work.md
    每周做梦 → soul.md, me.md, life.md
    Dream Phase 2 编译后 → index.md (知识页面索引区自动更新)

更新流程:
    读取当前文件 → 从深层记忆检索新信息
    → LLM 智能合并(保持格式、不超预算)
    → 预算检查(超出则压缩)
    → 冲突检测(hash对比，用户编辑优先)
    → 写入(带版本追踪)

index.md 知识索引区:
    每个 Knowledge Page 一行摘要(≤80字符)
    按最近更新时间降序
    上限 50 条，预算 ≤ 600 tokens
    Dream Phase 2 编译后自动维护

加载策略(按 Agent 裁剪):
    CodeBuddy → me.md + work.md + agent.md + context.md (~4800 tok)
    OpenClaw  → me.md + soul.md + social.md + context.md
    全功能     → 全部 8 个文件 (~8700 tok)
```

---

## 7. 存储设计

### 7.1 SQLite 表结构（28 张表 + 1 虚拟表）

#### 核心存储

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `experiences` | L1 经历 | `raw_content`, `content_type`, `source`, `embedding_id`, `snapshot_id`, `branch` |
| `world_facts` | L2 事实 | `subject`, `predicate`, `object`(三元组), `confidence`, `valid_from/until`, `evidence_experience_ids`, `condition_keys` |
| `observations` | L3 观察(散点) | `description`, `observation_type`, `supporting_fact_ids`, `contradicting_fact_ids`, `confidence_history` |
| `mental_models` | L4 模型 | `title`, `content`, `model_type`, `priority`(1-10), `scope`, `origin`, `is_active` |
| `person_profiles` | 人设画像 | `name`, `aliases`, `personality`, `interests`, `opinions`, `speech_patterns`, `relationships` |

#### Knowledge Pages（Karpathy 编译范式）

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `knowledge_pages` | L3 知识页面 | `slug`(唯一), `title`, `page_type`(person/topic/project/...), `content`(Markdown+[[backlink]]), `compile_count`, `last_compiled`, `lint_status`, `staleness_score`, `confidence`, `embedding_id` |
| `knowledge_page_links` | 反向链接 | `from_page_id`, `to_page_id`, `link_context` — 双向索引，支持入链查询 |
| `knowledge_page_evidence` | 证据链 | `page_id`, `evidence_type`(l1/l2/l3), `evidence_id`, `section_hint` |
| `compile_queue` | 编译队列 | `source_type`(new_fact/query_insight/feedback/lint_finding), `content`, `target_page`, `priority`, `status`(pending/compiled/skipped) |

#### 接入与认证

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `clients` | 客户端注册 | `id`, `client_secret_hash`, `read_layers`, `can_write`, `reads_per_minute` |
| `owner_profile` | 用户画像(KV) | `key`(如 "identity.name"), `value`(JSON), `category`, `confidence` |
| `access_log` | 接入审计 | `client_id`, `action`, `tool_name`, `latency_ms` |

#### 版本控制

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `snapshots` | 版本快照 | `label`, `branch`, `trigger`, `parent_snapshot_id`, `stats_*` |
| `branches` | 分支 | `name`, `created_from_snapshot`, `is_active` |
| `audit_log` | 变更审计 | `action`, `target_type`, `target_id`, `before_value`, `after_value`, `triggered_by` |

#### 索引与检索

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `condition_index` | 条件索引(O(1)) | `condition_key`(如 "person:alice"), `memory_type`, `memory_id` |
| `memory_links` | 知识图谱(边) | `source_id`, `target_id`, `link_type`, `weight` |
| `memory_fts` | FTS5 全文(虚拟表) | `memory_id`, `content`, `tags`, `condition_keys` |

#### Surface Files

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `surface_files` | 当前文件 | `file_name`(PK), `content`, `token_count`, `budget_tokens` |
| `surface_file_history` | 版本历史 | `file_name`, `content`, `version`, `change_summary` |
| `surface_update_queue` | 更新队列 | `file_name`, `suggestion`, `importance`, `status`(pending/applied/rejected) |

#### 生命周期管理

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `memory_temperature` | 温度追踪 | `memory_id+type`(PK), `temperature`, `score`(0-100), `access_count`, `pinned`, `compression_level` |
| `memory_tombstones` | 已删除墓碑 | `original_type`, `topics`, `reason`(lifecycle_gc/manual/merge) |
| `gc_log` | GC 日志 | `gc_type`, `memories_scanned`, `duplicates_merged`, `compressed`, `deleted` |
| `source_reputation` | 来源信誉 | `client_id`(PK), `reputation_score`, `gc_cleaned_rate`, `importance_penalty` |

#### 做梦与任务

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `dream_logs` | 做梦日志 | `phase`, `narrative`, `l1_to_l2/l2_to_l3/l3_to_l4`, `pre/post_snapshot_id` |
| `work_tasks` | 工作任务 | `title`, `status`, `priority_score`, `linked_memories` |

#### 可观测性

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `memory_traces` | 链路追踪 | `trace_id`, `memory_id`, `span_name`, `phase`, `result`, `metadata` |

### 7.2 文件存储

```
~/.minimem/
├── config.toml              # 统一配置
├── db/
│   └── minimem.db           # SQLite 数据库 (可选 SQLCipher 加密)
├── vectors/                 # 向量索引文件
├── surfaces/                # Surface Files (8 个 .md)
│   ├── me.md
│   ├── soul.md
│   ├── work.md
│   ├── social.md
│   ├── life.md
│   ├── agent.md
│   ├── context.md
│   └── index.md
├── snapshots/               # 版本快照
├── exports/                 # 导出文件
├── backups/                 # 自动备份
├── dreams/                  # 做梦报告 (.md)
└── logs/                    # 结构化日志
```

---

## 8. 定时任务

| 调度 | 任务 | 说明 |
|------|------|------|
| `0 18 * * 1-5` | 日终总结 | 工作日 18:00 生成当日摘要 |
| `0 23 * * *` | 聊天总结 | 每天 23:00 OpenClaw 聊天摘要 |
| `0 3 * * *` | 每日做梦 | 凌晨 3:00 做梦 (4 阶段) |
| `0 4 * * 0` | 深度做梦 | 周日凌晨 4:00 |
| `0 20 * * 0` | 周回顾 | 周日 20:00 |
| `0 */6 * * *` | 温度衰减 + 轻量 GC | 每 6 小时 |
| `0 4 * * *` | 标准 GC | 做梦后 |
| `0 5 * * 0` | 深度 GC | 每周做梦后 |
| 事件触发 | 紧急 GC | 存储超 80% |
| 事件触发 | Surface 更新 | 会话结束时更新 context.md |
| 每 50 条新记忆 | 自动做梦 | 冷启动期为 20 条 |

---

## 9. 认证与权限

### 9.1 认证

- JWT Token 认证
- 客户端注册在 `clients` 表
- 密钥哈希存储，不保存明文

### 9.2 权限三档

| 级别 | 可读层 | 可写 | 可做梦 | 可快照 | 适用 |
|------|--------|------|--------|--------|------|
| `trusted` | L1-L4 全部 | ✅ | ✅ | ✅ | 自有 Agent (CodeBuddy) |
| `standard` | L2-L4 (不含原始对话) | ✅ | ❌ | ❌ | 第三方 Agent |
| `readonly` | L3-L4 (仅观察和模型) | ❌ | ❌ | ❌ | 只读客户端 |

### 9.3 速率限制

- 全局: 60 次写/分钟
- 单客户端: 20 次写/分钟
- 批量导入上限: 500 条/次

---

## 10. 安全设计

| 层面 | 方案 |
|------|------|
| **存储加密** | 可选 SQLCipher (PBKDF2 密钥派生)，密钥存 Keychain/环境变量 |
| **传输安全** | REST: TLS 1.2+ / MCP stdio: 无需(进程间) / MCP HTTP: 强制 TLS |
| **PII 检测** | 正则扫描 (信用卡/手机号/身份证/API Key/密码)，策略: mask/reject/keep |
| **敏感分级** | normal / sensitive / highly_sensitive (强制加密+短TTL) |
| **遗忘权** | `forget_about` 级联删除 7 步流程，全事务，二次确认 |

---

## 11. LLM 依赖与降级

### 11.1 模型分级

| 级别 | 用途 | 模型示例 |
|------|------|---------|
| **heavy** | 做梦 Phase 2-3（含 Knowledge Page 编译）、L4 更新 | gpt-4o, claude-3.5-sonnet, qwen-max |
| **medium** | 事实提取、查询规划 | gpt-4o-mini, qwen-plus |
| **light** | 质量门控、分类、重排序 | qwen-turbo, gpt-3.5-turbo, local-7b |
| **rule_based** | 无 LLM 兜底 | 正则/规则/启发式 |

### 11.2 成本控制

- **批处理**: 事实提取 10 条一批，最多等 5 分钟
- **缓存**: 语义相似度 >0.95 的查询返回缓存 (TTL 24h)
- **去重**: 30 秒窗口内相似请求合并
- **花费限制**: 每日/每月上限，达 80% 告警

### 11.3 降级模式

LLM 不可用时自动触发：
- 摄入: 跳过事实提取，存 L1 后排队
- 检索: 退化为关键词+向量搜索
- 做梦: 暂停，积压到恢复后补做
- GC: 仅执行规则 GC (温度衰减/TTL)
- Surface: 冻结，保持最后有效版本

预估成本: ~221K tokens/天 ≈ ¥75/月 (qwen-plus) 或 $3/月 (gpt-4o-mini)

---

## 12. 错误处理与恢复

### 12.1 事务设计

- SQLite WAL 模式 (并发读写)
- 做梦引擎: 每 Phase 一个事务 + 检查点
- GC: 分批执行 (50 条/批)，可中断恢复
- 级联删除: 全事务包裹

### 12.2 幂等操作

- `add_memory`: hash(client_id + content + timestamp) 去重
- `trigger_dream`: session_id 唯一，重复触发则恢复
- GC: run_id 唯一，中断后继续

### 12.3 启动恢复

```
启动时自动检查:
1. WAL 恢复 → 回滚未提交事务
2. 做梦恢复 → 有未完成 session? → 从 checkpoint 继续
3. GC 恢复 → 有未完成 run? → 继续
4. 级联删除恢复 → 有未完成删除? → 继续或回滚
5. 引用完整性 → 修复悬空引用
6. 向量同步 → 向量索引与 SQLite 对齐
```

---

## 13. 可观测性

| 维度 | 实现 |
|------|------|
| **链路追踪** | `memory_traces` 表，记录每条记忆从写入→提炼→检索→GC 的完整生命周期 |
| **健康 API** | `get_memory_health` 返回: 各层记忆数、温度分布、存储用量、LLM 花费、告警 |
| **结构化日志** | JSON 格式，按模块分级，文件轮转 (10MB × 10)，支持 OpenTelemetry 导出 |
| **审计日志** | 所有客户端操作记录在 `access_log`，变更操作记录在 `audit_log` |

---

## 14. 配置体系

### 14.1 配置文件

路径: `~/.minimem/config.toml`

```toml
[server]        # host, port, mode(local/self-hosted/cloud)
[auth]          # enabled, jwt_secret_env, token_expiry
[encryption]    # enabled, provider(sqlcipher), key_storage
[llm]           # provider, models.heavy/medium/light, cost_limit
[llm.batch]     # batch_size, max_wait_time
[llm.cache]     # enabled, semantic_threshold, ttl
[llm.degraded]  # auto_enable, queue_for_later
[ingest]        # rate_limit, quality_gate, pii_detection
[dreaming]      # schedule, auto_trigger_threshold
[gc]            # schedule, temperature_decay_interval
[surface]       # budget_tokens, files[]
[storage]       # data_dir, sqlite.wal_mode, vector.provider, log.*
[onboarding]    # auto_detect, cold_start_*
[tracing]       # enabled, retention, export
[backup]        # enabled, schedule, retention, format
```

### 14.2 优先级

```
命令行参数 > 环境变量 (MINIMEM_*) > config.toml > 内置默认值
```

### 14.3 热更新

不需重启: `llm.cost_limit`, `ingest.rate_limit`, `gc.schedule`, `dreaming.schedule`, `log.level`

需要重启: `server.port`, `encryption.enabled`, `storage.data_dir`

---

## 15. 接入方式总览

```
┌───────────────────────────────────────────────────┐
│                  接入层                             │
│                                                    │
│  ┌──────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Skill 接入    │  │ MCP 接入  │  │ REST / SDK  │ │
│  │ ⭐⭐⭐⭐⭐     │  │ ⭐⭐⭐     │  │ ⭐⭐~⭐⭐⭐⭐ │ │
│  │              │  │          │  │              │ │
│  │ 带 prompt    │  │ 标准协议  │  │ HTTP / npm   │ │
│  │ 教 Agent     │  │ Agent    │  │ 开发者自定义  │ │
│  │ 怎么用       │  │ 自己推理  │  │              │ │
│  │              │  │          │  │              │ │
│  │ CodeBuddy    │  │ Claude   │  │ OpenClaw     │ │
│  │              │  │ Cursor   │  │ 自定义 Agent  │ │
│  └──────┬───────┘  └─────┬────┘  └──────┬───────┘ │
│         └────────────────┼───────────────┘         │
│                          ▼                          │
│            MiniMem MCP Server (底座)                │
│            27 个标准化工具接口                        │
└───────────────────────────────────────────────────┘
```

Skill 接入 = MCP Tools + SKILL.md prompt 指导（教 Agent 什么时候用什么工具）

---

## 16. 项目目录结构

```
minimem/
├── src/
│   ├── index.ts                  # 入口
│   ├── gateway/                  # 接入层 (MCP + REST + Auth + 限流 + 审计)
│   ├── owner/                    # Owner Profile 中心
│   ├── surface/                  # Surface Files 引擎 + 模板
│   ├── lifecycle/                # 温度 + GC + 压缩 + 流控 + 信誉 + 健康
│   ├── core/                     # 感知层 + 加工层 + 巩固层
│   ├── store/
│   │   ├── experiences.ts        # L1
│   │   ├── world-facts.ts        # L2
│   │   ├── observations.ts       # L3 散点观察
│   │   ├── knowledge-pages/      # L3 知识页面 (Karpathy 编译)
│   │   │   ├── page-store.ts     # Knowledge Page CRUD
│   │   │   ├── link-store.ts     # 反向链接管理
│   │   │   ├── evidence-store.ts # 证据链管理
│   │   │   └── compile-queue.ts  # 编译队列
│   │   ├── mental-models.ts      # L4
│   │   ├── vectors.ts            # 向量存储
│   │   └── graph.ts              # 知识图谱
│   ├── version/                  # 快照 + 分支 + Diff + 合并 + 回滚
│   ├── retrieval/                # 四路检索 + 查询规划 + 条件索引 + 重排序 + 查询回写
│   ├── modules/
│   │   ├── work/                 # 工作助理
│   │   ├── social/               # 社交记忆
│   │   └── dream/                # 做梦引擎
│   │       ├── dream-engine.ts   # 做梦主流程 (4 阶段)
│   │       ├── auditor.ts        # Phase 1: 审计 + Knowledge Page Lint
│   │       ├── compiler.ts       # Phase 2: 编译器 (Karpathy Compile)
│   │       ├── dreamer.ts        # Phase 3: REM 联想
│   │       ├── cleaner.ts        # Phase 4: 清理
│   │       └── dream-report.ts   # 做梦报告 + 版本 diff
│   ├── llm/                      # LLM 客户端 + Prompt + Embedding
│   ├── scheduler/                # 定时任务
│   └── sdk/                      # TypeScript SDK (@minimem/sdk)
├── data/
│   ├── db/                       # SQLite
│   ├── vectors/                  # 向量索引
│   ├── surfaces/                 # Surface Files (.md)
│   ├── snapshots/                # 版本快照
│   ├── exports/                  # 导出
│   ├── backups/                  # 备份
│   ├── dreams/                   # 做梦报告
│   └── logs/                     # 日志
├── packages/
│   ├── mcp-server/               # @minimem/mcp-server (npm)
│   └── sdk/                      # @minimem/sdk (npm)
└── tests/                        # 按模块组织的测试
```

---

## 17. 技术栈

| 层次 | 技术 |
|------|------|
| 语言 | TypeScript |
| 运行时 | Bun / Node.js |
| MCP | @modelcontextprotocol/sdk |
| REST | Hono |
| 认证 | JWT |
| 结构化存储 | SQLite (better-sqlite3) / SQLCipher |
| 向量存储 | Qdrant (本地) 或 ChromaDB |
| 全文检索 | SQLite FTS5 |
| 图存储 | SQLite + 自定义图层 (memory_links) |
| 条件索引 | 内存 HashMap + SQLite 持久化 |
| LLM (主) | qwen-plus / gpt-4o / claude-3.5-sonnet |
| LLM (代理) | qwen-turbo / local-7b |
| Embedding | text-embedding-v3 |
| 定时任务 | node-cron |
| 配置 | TOML |
| 文件格式 | Markdown (Surface Files / 做梦报告 / Knowledge Pages 内容) |
| 知识编译 | Karpathy LLM Wiki 范式 (Compile + Lint + INDEX + Backlinks) |
