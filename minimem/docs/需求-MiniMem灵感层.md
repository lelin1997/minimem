# MiniMem 灵感层（Inspiration Layer）需求单

## 基本信息

| 字段 | 内容 |
|------|------|
| **需求编号** | MINIMEM-002 |
| **标题** | MiniMem 灵感层：从被动记忆到主动思考 |
| **优先级** | P1 — 高（认知能力核心升级） |
| **提出日期** | 2026-04-23 |
| **最后更新** | 2026-04-23 |
| **需求类型** | 认知能力增强 |
| **影响范围** | Dream Engine / 数据库 Schema / 类型系统 / MCP API / Surface Files / 常量定义 / 配置 |
| **前置需求** | 无硬性前置，但建议在 TODO-017（信念漂移检测）之后实施，可复用 `drift_risk` 数据 |

---

## 1. 背景与问题

### 1.1 认知科学视角

人类大脑最有价值的能力不是"记住"，而是**"想出来"**。当前 MiniMem 的四层记忆模型（L1 经历 → L2 事实 → L3 观察 → L4 原则）覆盖了**存储、结构化、归纳、抽象**四个阶段，但完全缺失**创造性思维**这一关键环节。

```
当前: 经历 → 事实 → 模式 → 原则
       存储    结构化   归纳    抽象     ← 全部是被动处理
                                          缺失: 主动思考 / 灵感 / 创造
```

### 1.2 核心问题

| 问题 | 影响 | 严重程度 |
|------|------|---------|
| **无跨域碰撞能力** | Dream Phase 3 的联想只在相似记忆间寻找连接，不会主动碰撞不同领域 | 高 |
| **联想≠灵感** | Phase 3 发现"A 和 B 有类比关系"（描述性），但不能推导出"基于此我们可以做 C"（创造性） | 高 |
| **洞察被平庸化** | Phase 3 的高 novelty 洞察写入 compile_queue 后，与普通观察无区别，灵感价值被抹平 | 高 |
| **无孵化机制** | 灵感是一次性产物，没有"反复酝酿、深化"的过程 | 中 |
| **无行动闭环** | 即使产生了好的洞察，也没有"假设→行动→反馈→固化"的链路 | 高 |
| **无习惯修正能力** | 系统不能基于记忆主动发现并修正用户的不良习惯或过往失误 | 高 |

### 1.3 代码级证据

- **Dream Phase 3**（`src/modules/dream/dreamer.ts`）：`runDream()` 的 REM 阶段做的是 seed → randomWalk → pairAndAssociate → LLM 发现联系 → 写入 graph + compile_queue
- **联想结果处理**：novelty ≥ 0.7 的洞察通过 `enqueueCompile('query_insight', ...)` 写入编译队列，后续被编译为普通 L3 观察，**没有任何特殊对待**
- **跨域碰撞**：randomWalk 的相似度窗口 [0.3, 0.7] 虽然有一定随机性，但**不会主动跨领域**（尤其在有 domain 隔离后，同一次做梦只处理单一领域的记忆）
- **无孵化**：一条洞察产生后直接入队，不会在后续做梦中被重新审视和深化

---

## 2. 需求描述

### 2.1 核心目标

在现有 L1-L4 记忆层之外，引入**独立的灵感池（Inspiration Pool）**，赋予 MiniMem 以下能力：

1. **跨域碰撞** — 主动将不同领域/主题的记忆进行创造性碰撞
2. **灵感孵化** — 对初始灵感进行多轮深化和验证，而非一次性产出
3. **可行动推论** — 每条灵感必须蕴含"所以我们可以..."的行动建议
4. **习惯修正** — 基于记忆发现重复错误/不良习惯，生成修正建议
5. **灵感闭环** — 灵感 → 行动 → 反馈 → 新记忆/新原则的完整循环
6. **Surface 展示** — 成熟灵感通过 `insight.md` 呈现给用户和 Agent

### 2.2 设计决策：独立灵感池 vs 新增 L5 层

**选择独立灵感池（路径 B）**，不在 L1-L4 之上新增 L5 层。

理由：
- 灵感不是 L4 的"升级版"，而是任意层级碰撞的**横向产物**（L1+L3 的碰撞可能比 L4+L4 更有灵感）
- 灵感有独立的生命周期（spark → incubating → mature → acted → archived），不同于 L1-L4 的编译链
- 不破坏现有的"自底向上编译链"语义
- 灵感可以反哺 L3（新观察）和 L4（新原则），形成循环而非单向链

```
         L1 ──────┐
         L2 ──────┤
         L3 ──────┼──→ [Inspiration Engine] ──→ inspirations 表
         L4 ──────┤                                    │
    graph links ──┘                              ┌─────┤─────┐
                                                 ↓     ↓     ↓
                                              L3反哺  Surface 行动建议
                                            (新观察)  (insight.md)
```

### 2.3 非目标

- ❌ 不改动 L1-L4 的编译链逻辑
- ❌ 不改动 GC / 温度衰减 / 层保护规则
- ❌ 不改动现有 Phase 1-4 的核心逻辑（只在 Phase 3 之后插入新子阶段）
- ❌ 不做灵感的多用户共享
- ❌ 灵感不参与向量检索（MVP 阶段，后续可扩展）

### 2.4 数据策略

灵感层采用新增表的方式实现。由于项目已实现增量 Schema 迁移机制（TODO-016），新增 `inspirations` 表通过迁移脚本添加，**无需 `--reset`**。

---

## 3. 详细设计

### 3.1 灵感的本质特征

从认知科学角度，灵感（Inspiration）具备以下特征：

| 特征 | 说明 | 系统对应 |
|------|------|---------|
| **跨域碰撞** | 来自两个看似无关领域的交叉 | `source_domains` 字段，cross-pollinate 算法 |
| **生成性** | 不是描述现有事物，而是提出新的可能性 | `hypothesis` 字段 |
| **可行动** | 蕴含"所以我们可以..."的推论 | `actionability` 评分 |
| **时效性** | 灵感有最佳窗口期，过了就不再新鲜 | `expires_at` 字段，保鲜期机制 |
| **稀缺性** | 真正的灵感是罕见的，不是每次做梦都有 | 严格的评分门槛 |
| **可深化** | 灵感需要反复酝酿才能成熟 | 孵化机制（incubation） |

### 3.2 数据模型

#### 3.2.1 灵感类型定义

```typescript
// ── 灵感层 (MINIMEM-002) ──

export type InspirationStatus = 'spark' | 'incubating' | 'mature' | 'acted' | 'archived';

export type InspirationOrigin =
  | 'dream_association'         // 来自 Dream Phase 3 的联想
  | 'cross_domain'              // 跨域碰撞产生
  | 'contradiction_resolution'  // 矛盾解决过程中产生
  | 'temporal_convergence'      // 时间模式汇聚（如多次在同一时间段出现类似行为）
  | 'habit_detection'           // 习惯/错误模式检测
  | 'user_triggered';           // 用户主动触发

export interface Inspiration {
  id: string;
  title: string;                    // 一句话标题
  content: string;                  // 灵感的详细描述
  hypothesis: string;               // "所以我们可以..." 的可行动推论
  origin: InspirationOrigin;        // 灵感来源类型
  source_memory_ids: string[];      // 碰撞来源（跨层、跨域的记忆 ID）
  source_layers: MemoryLayer[];     // 来源层级（如 ['L1', 'L3'] 表示 L1+L3 碰撞）
  source_domains: string[];         // 来源领域（跨域碰撞的核心标记）
  novelty: number;                  // 0-1，新颖度
  actionability: number;            // 0-1，可行动性
  confidence: number;               // 0-1，可信度（初始较低，经过孵化后提升）
  status: InspirationStatus;        // 生命周期状态
  incubation_count: number;         // 孵化次数（被重新思考了几轮）
  incubation_log: IncubationEntry[]; // 每次孵化的记录
  acted_outcome: string | null;     // 如果被行动了，结果是什么
  tags: string[];
  domain: string;                   // MINIMEM-001: 领域隔离
  branch: string;
  created_at: string;
  updated_at: string;
  expires_at: string;               // 灵感保鲜期
}

export interface IncubationEntry {
  round: number;                    // 第几轮孵化
  new_angles: string[];             // 本轮引入的新思考角度（记忆 ID）
  deepened: boolean;                // 是否被深化
  summary: string;                  // LLM 的孵化结果摘要
  confidence_delta: number;         // 信心变化值
  timestamp: string;
}
```

#### 3.2.2 数据库表

```sql
-- ═══════════════════════════════════════════════════════════
-- MINIMEM-002: 灵感池
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inspirations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  hypothesis TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'dream_association',
  source_memory_ids TEXT NOT NULL DEFAULT '[]',     -- JSON array
  source_layers TEXT NOT NULL DEFAULT '[]',         -- JSON array
  source_domains TEXT NOT NULL DEFAULT '[]',        -- JSON array
  novelty REAL NOT NULL DEFAULT 0.5,
  actionability REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.3,
  status TEXT NOT NULL DEFAULT 'spark',
  incubation_count INTEGER NOT NULL DEFAULT 0,
  incubation_log TEXT NOT NULL DEFAULT '[]',        -- JSON array of IncubationEntry
  acted_outcome TEXT,
  tags TEXT NOT NULL DEFAULT '[]',                  -- JSON array
  embedding_id TEXT,
  domain TEXT NOT NULL DEFAULT 'default',
  branch TEXT NOT NULL DEFAULT 'main',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inspirations_status ON inspirations(status);
CREATE INDEX IF NOT EXISTS idx_inspirations_origin ON inspirations(origin);
CREATE INDEX IF NOT EXISTS idx_inspirations_domain ON inspirations(domain);
CREATE INDEX IF NOT EXISTS idx_inspirations_confidence ON inspirations(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_inspirations_expires ON inspirations(expires_at);
CREATE INDEX IF NOT EXISTS idx_inspirations_created ON inspirations(created_at DESC);
```

### 3.3 灵感引擎：Dream Phase 3.5

在现有 Phase 3（REM Dream）之后、Phase 4（Cleanup）之前，插入新的子阶段：

```
Phase 1: Audit (现有)
Phase 2: Compile (现有)
Phase 3: REM Dream (现有)
   ↓ connections + insights
Phase 3.5: Inspiration Engine (新增) ← 核心
   ├── Step 1: Spark — 筛选高潜力候选
   ├── Step 2: Cross-pollinate — 跨域碰撞
   ├── Step 3: Habit-detect — 习惯/错误模式检测
   ├── Step 4: Incubate — 孵化已有灵感
   ├── Step 5: Hypothesize — LLM 生成可行动推论
   └── Step 6: Evaluate & Persist — 评分、存储、反哺
Phase 4: Cleanup (现有)
```

#### 3.3.1 Step 1: Spark — 种子筛选

**目标**：从 Phase 3 的联想结果和近期高价值记忆中筛选灵感候选。

```
输入:
  ① Phase 3 的 connections（novelty ≥ 0.6 的联想）
  ② 最近 24h 内 importance ≥ 0.7 的 L1 经历中未被联想到的
  ③ 最近 drift_risk = 1 的 L3 观察（信念动摇 = 思考契机）

筛选规则:
  - novelty ≥ 0.6（比写入 compile_queue 的 0.7 门槛低，给更多候选）
  - 涉及 ≥ 2 个不同主题/标签的记忆（多样性是灵感的前提）
  - 排除与已有 spark/incubating 灵感内容相似度 > 0.85 的重复

输出: spark_candidates[]
```

#### 3.3.2 Step 2: Cross-pollinate — 跨域碰撞（核心创新 🌟）

**目标**：主动寻找跨领域的高潜力碰撞对。这是当前系统**完全不具备**的能力。

```
算法:
  1. 从 L3 观察 + L4 心智模型中按 tags/domain 分组
  2. 对每对不同主题组，随机采样 1-2 条记忆
  3. 对每个候选对:
     a. 计算两条记忆的 embedding 相似度
     b. 相似度在 [0.15, 0.45] 区间 = "意想不到的联系"
        - 太高（>0.45）= 显而易见，不算灵感
        - 太低（<0.15）= 纯随机噪声，也不算灵感
     c. 入选为灵感候选

理论依据:
  - Phase 3 的 randomWalk 相似度窗口是 [0.3, 0.7]（偏保守）
  - Cross-pollinate 的窗口 [0.15, 0.45] 更大胆，在"意想不到"的区间寻找碰撞
  - Granovetter "弱连接优势"理论：跨圈层的弱连接往往传递最有价值的信息

配置:
  cross_pollinate_pairs: 5         # 每次最多尝试多少对
  similarity_window: [0.15, 0.45]  # 碰撞相似度窗口
```

#### 3.3.3 Step 3: Habit-detect — 习惯/错误模式检测（核心创新 🌟🌟）

**目标**：从记忆中发现重复出现的错误模式和不良习惯，生成修正建议。

这是你特别提到的能力——**"及时利用记忆不断修复过往的失误、修正不好的习惯"**。

```
算法:
  1. 查询最近 30 天的 L1 经历，寻找"负面信号"：
     - 含有"失误/错误/忘记/遗漏/延迟/bug/失败/后悔"等关键词的记忆
     - 被标记 feedback='incorrect' 的记忆
     - 被标记 superseded 的 L2 事实（说明之前的认知是错的）
  
  2. 对负面信号聚类分析：
     - 按 subject（人/事/项目）分组
     - 按 时间模式 分组（如"每周一都延迟"）
     - 按 场景模式 分组（如"每次在赶工时都忘记测试"）
  
  3. 对出现 ≥ 2 次的负面模式，生成修正灵感：
     - origin = 'habit_detection'
     - hypothesis = "如果[采取某行动]，可能可以避免[这个模式]再次发生"
     - actionability 较高（因为有明确的改进方向）

示例输出:
  灵感: "过去3周内，你有3次在周五下午部署后出现线上问题"
  假设: "建议建立'周五下午不部署'的规则，或在周五部署前增加一轮 staging 验证"
  来源: L1#abc（周五部署导致回滚）, L1#def（周五发布后加班修复）, L1#ghi（又一次周五事故）
```

#### 3.3.4 Step 4: Incubate — 灵感孵化（核心创新 🌟🌟🌟）

**目标**：对已有的 spark/incubating 灵感进行多轮深化，模拟人类"反复酝酿"的过程。

```
算法:
  1. 从 inspirations 表取 status='spark' 或 'incubating' 且 incubation_count < max_incubations 的灵感
  2. 对每条灵感:
     a. 回到其 source_memory_ids，通过知识图谱找到"邻居"（depth=2 遍历）
     b. 引入这些新邻居作为"新的思考角度"
     c. 用较高温度（0.9）的 LLM 重新审视：灵感 + 新角度
     d. LLM 判断结果:
        - 被深化 → 更新 content/hypothesis + confidence += 0.1 + incubation_count += 1
        - 被否定 → status = 'archived' + 记录否定原因
        - 无变化 → incubation_count += 1（下次用不同角度再试）
     e. 记录 incubation_log
  
  关键: 每次孵化引入不同的"新角度"，模拟人类在不同场景下反复思考同一个问题

配置:
  max_incubations: 3               # 最多孵化轮次
  incubation_llm_temperature: 0.9  # 孵化时 LLM 温度更高，鼓励发散思考
```

#### 3.3.5 Step 5: Hypothesize — 生成可行动推论

**目标**：对所有新的灵感候选（spark + cross-pollinate + habit-detect 产出），由 LLM 生成可行动的假设。

```
LLM Prompt (tier=heavy, temp=0.8):

  你是一个灵感放大器。你的任务是把模糊的联系转化为具体的行动建议。

  以下是一些有趣的认知碰撞：
  [灵感列表，每条含 content + source_memories 的摘要]

  对每条灵感：
  1. 判断它是否蕴含一个可以行动的想法
  2. 如果是，生成:
     - title: 一句话标题（精炼、有冲击力）
     - hypothesis: "基于这个发现，我建议..." 的可行动推论
     - actionability (0-1): 在多大程度上可以被具体执行？
     - confidence (0-1): 在多大程度上是合理的？
  3. 特别关注:
     - 能修正坏习惯的建议（给更高 actionability）
     - 能避免重复犯错的建议（给更高 confidence）
     - 跨领域迁移的创意（给更高 novelty）

  只保留 actionability ≥ 0.4 的灵感。不够好的直接丢弃。

输出: { title, content, hypothesis, actionability, confidence }[]
```

#### 3.3.6 Step 6: Evaluate & Persist — 评分、存储、反哺

```
评分公式:
  inspiration_score = novelty × 0.3 + actionability × 0.4 + confidence × 0.3

写入规则:
  - score ≥ 0.5 → 写入 inspirations 表，status = 'spark'
  - score ≥ 0.7 → 同时创建图连接（inspiration → source_memories）
  - incubation_count ≥ 2 && confidence ≥ 0.7 → status 自动升为 'mature'

反哺机制:
  - mature 灵感 → enqueueCompile('query_insight', content) → 下次编译可能生成新 L3
  - mature + origin='habit_detection' → 有可能升级为 L4 原则（"以后不在周五下午部署"）
  - 所有新灵感 → 更新 insight.md Surface File

保鲜期（过期自动 archive）:
  - spark: 7 天内未被孵化 → archived
  - incubating: 14 天内未成熟 → archived
  - mature: 30 天内未被行动 → archived（但内容保留，可查阅）
```

### 3.4 灵感生命周期

```
      spark ──→ incubating ──→ mature ──→ acted ──→ archived
        │          │              │          │
        │     (孵化迭代)      (反哺 L3)  (记录行动结果)
        │          │              │
        └──── archived ←──────────┘
              (被否定)       (保鲜期过期)
              (保鲜期过期)
```

| 状态 | 含义 | 保鲜期 | 进入条件 |
|------|------|--------|---------|
| `spark` | 新产生的灵感火花 | 7 天 | 评分 ≥ 0.5 |
| `incubating` | 正在被深化的灵感 | 14 天 | 第一次孵化后 |
| `mature` | 成熟的灵感，可以行动 | 30 天 | 孵化 ≥ 2 轮 + confidence ≥ 0.7 |
| `acted` | 已被行动的灵感 | 永久 | 用户通过 MCP 标记 |
| `archived` | 归档（否定/过期） | 永久 | 被否定 / 超过保鲜期 |

### 3.5 新增 Surface File: `insight.md`

灵感的用户可见呈现，也是 Agent 获取灵感信息的入口。

```markdown
# 灵感洞察

> 最后更新: 2026-04-23

## 🌟 成熟灵感

### 周五下午部署风险模式
- **洞察**: 过去3周内有3次周五下午部署导致线上问题
- **建议**: 建立"周五下午不部署"规则，或增加 staging 验证步骤
- **可行动性**: ★★★★☆
- **信心度**: ★★★★★
- **来源**: 习惯检测 (3条相关经历碰撞)
- **状态**: mature — 等待行动

## 💡 孵化中

### 代码审查与文档质量的隐含关联
- **当前想法**: 代码审查投入越多的项目，其技术文档质量也越高——可能因为审查培养了"解释代码"的习惯
- **孵化轮次**: 2/3
- **下次孵化**: 预计下次做梦

## ✨ 新火花

- [2026-04-23] 告警疲劳与误报率之间可能存在正反馈循环
- [2026-04-22] 晨会效率和前一天的代码提交频率有某种联系

## 📊 灵感统计

- 总灵感数: 12
- 成熟: 3 | 孵化中: 4 | 火花: 5
- 已行动: 2 | 归档: 5
- 最近一条: 2026-04-23
```

### 3.6 MCP 工具扩展

#### 3.6.1 新增工具

| 工具名 | 功能 | 风险等级 |
|--------|------|---------|
| `get_inspirations` | 查看灵感列表（按 status 分组，支持过滤） | `read` |
| `act_on_inspiration` | 标记灵感为"已行动"，记录结果 | `write` |
| `trigger_inspiration` | 用户主动触发灵感思考（给一个种子主题） | `write` |
| `rate_inspiration` | 用户对灵感评分（反馈循环） | `write` |

#### 3.6.2 工具详细定义

```typescript
// get_inspirations
{
  name: 'get_inspirations',
  description: '获取灵感列表。可按状态过滤，默认返回 spark + incubating + mature',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['spark', 'incubating', 'mature', 'acted', 'archived', 'all'],
        description: '过滤状态，默认返回活跃灵感（spark/incubating/mature）',
      },
      domain: { type: 'string', description: '按领域过滤' },
      limit: { type: 'number', description: '返回数量限制，默认 10' },
    },
  },
}

// act_on_inspiration
{
  name: 'act_on_inspiration',
  description: '将灵感标记为"已行动"并记录行动结果。这是灵感闭环的关键步骤。',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '灵感 ID' },
      outcome: { type: 'string', description: '行动结果描述（如"已建立周五不部署的规则，执行两周后确实减少了事故"）' },
    },
    required: ['id', 'outcome'],
  },
}

// trigger_inspiration
{
  name: 'trigger_inspiration',
  description: '用户主动触发灵感思考。给定一个种子主题，系统会围绕该主题进行跨域碰撞和深度联想。',
  inputSchema: {
    type: 'object',
    properties: {
      seed_topic: { type: 'string', description: '灵感种子主题（如"如何减少告警疲劳"）' },
      domain: { type: 'string', description: '限定搜索领域，不传则跨全部领域' },
    },
    required: ['seed_topic'],
  },
}

// rate_inspiration
{
  name: 'rate_inspiration',
  description: '对灵感进行评价反馈。好的评价会提升灵感信心度，差的评价会导致归档。',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '灵感 ID' },
      rating: {
        type: 'string',
        enum: ['brilliant', 'useful', 'meh', 'wrong'],
        description: '评价等级：brilliant(极好) > useful(有用) > meh(一般) > wrong(错误)',
      },
      comment: { type: 'string', description: '可选评语' },
    },
    required: ['id', 'rating'],
  },
}
```

### 3.7 Dream Engine 集成

在 `triggerDream()` 中插入 Phase 3.5 调用：

```typescript
// Phase 3: Dream (现有)
if (phasesToRun.includes(3)) {
  dreamResult = await runDream(profile.dream);
  saveCheckpoint(db, sessionId, 3, preSnapshotId, dreamResult);
  
  // Phase 3.5: Inspiration Engine (新增 MINIMEM-002)
  try {
    const { runInspirationEngine } = await import('./inspiration-engine.js');
    const inspirationResult = await runInspirationEngine({
      dreamResult,         // Phase 3 的联想结果
      mode,                // daily/weekly
      domain: options?.domain,
    });
    log.info(inspirationResult, '💡 Inspiration engine complete');
    saveCheckpoint(db, sessionId, 3.5, preSnapshotId, inspirationResult);
  } catch (err) {
    log.warn({ err }, 'Inspiration engine failed (non-critical)');
    // 灵感引擎失败不影响主流程
  }
}
```

### 3.8 配置项

```toml
# config.default.toml 新增

[dreaming.inspiration]
enabled = true
max_sparks_per_dream = 5           # 每次做梦最多产生的新灵感数
cross_pollinate_pairs = 5          # 跨域碰撞尝试对数
similarity_window = [0.15, 0.45]   # 碰撞相似度窗口
max_incubations = 3                # 单条灵感最大孵化轮次
incubation_temperature = 0.9       # 孵化 LLM 温度
habit_detect_days = 30             # 习惯检测回溯天数
habit_min_occurrences = 2          # 判定为"习惯"的最少出现次数
score_threshold = 0.5              # 灵感入库最低分
mature_confidence = 0.7            # 成熟灵感的最低信心度
spark_ttl_days = 7                 # 火花保鲜期
incubating_ttl_days = 14           # 孵化中保鲜期
mature_ttl_days = 30               # 成熟灵感保鲜期
```

### 3.9 灵感闭环：完整流程

```
用户日常行为
    │
    ↓ add_memory
L1 经历 ──→ L2 事实 ──→ L3 观察 ──→ L4 原则
    │            │           │           │
    └────────────┴───────────┴───────────┘
                        │
                   Dream Phase 3.5
                        │
                ┌───────┴───────┐
                ↓               ↓
           跨域碰撞        习惯检测
                ↓               ↓
            灵感(spark)    修正建议
                │               │
                ↓               ↓
           孵化(incubate)  立即可行动
                │
                ↓
           成熟(mature) ──→ insight.md ──→ Agent 读取并建议用户
                │
                ↓
          用户行动(act) ──→ 记录结果 ──→ 新的 L1 经历
                                            │
                                            ↓
                                    继续编译链... → 可能产生新 L4 原则
                                                    (如"周五不部署"成为一条原则)
```

**灵感闭环示例**：

```
记忆: "周五下午部署后出了线上问题"（L1, 出现3次）
  ↓ 习惯检测
灵感: "你可能有一个'周五下午部署'的高风险习惯"
  ↓ 孵化 → 引入新角度（L3: "你周五下午通常比较疲惫"）
灵感深化: "周五下午部署风险高可能与疲劳程度有关"
  ↓ 成熟
hypothesis: "建议周五下午不部署，或至少增加一个同事 review"
  ↓ insight.md 展示
Agent: "我注意到你有一个灵感建议...要不要试试？"
  ↓ 用户采纳并执行
act_on_inspiration(outcome: "执行两周，周五事故率降为 0")
  ↓ 记录新 L1
下一次编译: 可能自动升级为 L4 原则 "周五下午不部署"
```

---

## 4. 受影响的模块总览

| 模块 | 文件路径 | 改动类型 | 复杂度 |
|------|---------|---------|--------|
| **灵感引擎（核心）** | 新增 `src/modules/dream/inspiration-engine.ts` | 新文件 | 高 |
| **数据库 Schema** | `src/store/schema.ts` + 迁移脚本 | 新增表 | 低 |
| **类型定义** | `src/common/types.ts` | 新增类型 | 低 |
| **Dream Engine** | `src/modules/dream/dream-engine.ts` | 插入 Phase 3.5 调用（~15 行） | 低 |
| **Surface File** | 新增 `src/surface/syncers/insight-syncer.ts` | 新文件 | 中 |
| **Surface 注册** | `src/surface/sync.ts` | 注册 insight syncer | 低 |
| **MCP 工具** | `src/gateway/mcp-server.ts` | 4 个新 handler + tool 定义 | 中 |
| **MCP Auth** | `src/gateway/mcp-auth.ts` | TOOL_RISK_MAP 新增 4 项 | 低 |
| **配置 Schema** | `src/config/schema.ts` + `src/config/index.ts` | 新增 inspiration 配置节 | 低 |
| **默认配置** | `config.default.toml` | 新增 `[dreaming.inspiration]` | 低 |
| **常量定义** | `src/common/constants.ts` | 新增灵感保鲜期常量 | 低 |
| **Dream Report** | `src/modules/dream/dream-report.ts` | 报告中新增灵感统计 | 低 |

**不需要改动**：L1-L4 编译链、GC、温度衰减、层保护、检索引擎、版本控制。

---

## 5. 兼容性要求

| 场景 | 处理方式 |
|------|---------|
| 灵感引擎禁用 | `dreaming.inspiration.enabled = false` 时完全跳过 Phase 3.5 |
| 旧版 MCP 客户端 | 不调用新工具即可，Dream 流程不受影响 |
| insight.md 不存在 | Surface 初始化时自动创建空模板 |
| 灵感表为空 | `get_inspirations` 返回空列表，insight.md 显示"暂无灵感" |
| Phase 3.5 失败 | try/catch 包裹，失败不影响 Phase 4 继续执行 |

---

## 6. 验收标准

### 6.1 功能验收

- [ ] `inspirations` 表正确创建并可读写
- [ ] Dream 运行后 Phase 3.5 执行完毕（日志可见）
- [ ] Cross-pollinate 能产生至少 1 条跨域灵感（有 ≥ 2 个不同的 source_domains）
- [ ] Habit-detect 能识别出重复出现的负面模式并生成修正建议
- [ ] 灵感孵化能在多次做梦后逐步深化（incubation_count 递增，confidence 变化）
- [ ] `get_inspirations` 正确返回灵感列表，支持 status/domain 过滤
- [ ] `act_on_inspiration` 正确标记灵感为 acted 并记录 outcome
- [ ] `trigger_inspiration` 能基于用户种子主题产生灵感
- [ ] `rate_inspiration` 的 wrong 评价导致灵感被 archived
- [ ] `insight.md` Surface File 正确生成并在做梦后更新
- [ ] 成熟灵感反哺 compile_queue，最终可能生成新的 L3/L4
- [ ] 保鲜期过期的灵感自动转为 archived

### 6.2 灵感闭环验收

- [ ] 写入 3 条类似"周五部署出问题"的经历后，habit-detect 生成修正灵感
- [ ] 修正灵感经 2 轮孵化后 confidence ≥ 0.7，自动变为 mature
- [ ] 通过 `act_on_inspiration` 标记行动结果后，outcome 被记录
- [ ] 行动结果写入新的 L1 经历后，编译链可能产生新的 L4 原则

### 6.3 兼容性验收

- [ ] `dreaming.inspiration.enabled = false` 时 Dream 正常完成（无 Phase 3.5 日志）
- [ ] Phase 3.5 异常不影响 Phase 4 执行
- [ ] 无灵感数据时 `get_inspirations` 和 insight.md 表现正常

### 6.4 性能验收

- [ ] Phase 3.5 总耗时 < 30s（daily 模式）
- [ ] Phase 3.5 LLM 调用次数 ≤ 3 次（daily 模式）
- [ ] 灵感表 1000 条记录时查询响应 < 100ms

---

## 7. 用户场景示例

### 场景 1: 习惯修正

```
用户: (多次记录了周五部署导致的问题)
系统: [Dream Phase 3.5 — Habit-detect]
  → 检测到"周五下午部署"出现 3 次负面结果
  → 生成灵感: "周五下午部署存在高风险模式"
  → hypothesis: "建议建立周五下午不部署的规则"
Agent: "💡 我发现了一个灵感洞察: 你过去三周都在周五下午部署后出了问题，建议..."
用户: "确实，我们来执行这个规则"
Agent: act_on_inspiration(outcome: "团队已采纳周五冻结窗口...")
```

### 场景 2: 跨域灵感

```
系统: [Dream Phase 3.5 — Cross-pollinate]
  → 碰撞对: L3("用户喜欢用 checklist 管理部署") × L3("用户读书时习惯做批注")
  → 相似度: 0.32 (在 [0.15, 0.45] 窗口内)
  → 灵感: "用做批注的方式给 runbook 加注释，可能提高部署操作的记忆留存"
Agent: "💡 一个有趣的联想: 你读书时喜欢做批注，如果把同样的习惯用在 runbook 上..."
```

### 场景 3: 用户主动触发

```
用户: "我最近对如何减少告警疲劳很感兴趣，帮我想想"
Agent: trigger_inspiration(seed_topic: "减少告警疲劳")
系统: [灵感引擎启动]
  → 检索与"告警"相关的 L1-L4 记忆
  → 跨域碰撞: "告警" × "读书习惯"（定时消化）
  → 灵感: "像定时读书一样，设定'告警消化时间'——每天固定 30 分钟处理告警，其余时间静音"
Agent: "💡 这是我的灵感: ..."
```

---

## 8. 实施建议

### 8.1 分阶段实施

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| **Phase 1** | 数据模型 + 类型定义 + 数据库迁移 + 配置 | 0.5 天 |
| **Phase 2** | 灵感引擎核心（Spark + Cross-pollinate + Habit-detect + Hypothesize + Evaluate） | 1-2 天 |
| **Phase 3** | 灵感孵化机制（Incubate） | 0.5-1 天 |
| **Phase 4** | Dream Engine 集成 + Phase 3.5 嵌入 | 0.5 天 |
| **Phase 5** | MCP 工具 4 个 + Auth 配置 | 0.5-1 天 |
| **Phase 6** | insight.md Surface File + Syncer | 0.5 天 |
| **Phase 7** | Dream Report 灵感统计 + 保鲜期 GC | 0.5 天 |
| **Phase 8** | 测试 + 验收 | 1 天 |

**总计：5-7 天**

### 8.2 风险点

| 风险 | 缓解措施 |
|------|---------|
| LLM 调用成本增加 | daily 模式限制 Phase 3.5 最多 3 次 LLM 调用；复用 LLM 缓存（REQ-016） |
| 灵感质量低 | 严格的评分门槛（≥0.5）+ 孵化机制过滤噪声 + 用户反馈循环 |
| Phase 3.5 耗时过长 | 设置超时（30s）+ 异步非阻塞 + daily 模式参数更保守 |
| 灵感与领域隔离的交互 | 跨域碰撞天然需要打破领域边界，但结果的 domain 取主导领域 |
| 习惯检测误报 | 最少 2 次出现才判定 + 用户可通过 rate_inspiration(wrong) 纠正 |

---

## 附录: 认知模型对照

| 认知层次 | MiniMem 实现 | 人脑对应 | 特征 |
|----------|-------------|---------|------|
| L1 经历 | ✅ experiences | 情景记忆 | 原始、具体、时间标记 |
| L2 事实 | ✅ world_facts | 语义记忆 | 结构化、可验证 |
| L3 观察 | ✅ observations | 模式识别 | 归纳、统计性 |
| L4 原则 | ✅ mental_models | 信念系统 | 抽象、稳定 |
| **灵感** | 🆕 inspirations | **顿悟 / 创造性思维** | **跨域、生成性、可行动** |
| **习惯修正** | 🆕 habit_detection | **元认知 / 自我反思** | **识别重复错误、主动修正** |

灵感层的加入使 MiniMem 从**被动存储系统**进化为**主动认知系统**——不仅记住，还能"想出来"。
