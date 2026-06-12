# MiniMem Hint-Driven Recall 需求单

## 基本信息

| 字段 | 内容 |
|------|------|
| **需求编号** | MINIMEM-006 |
| **标题** | Hint-Driven Recall：跨层协作的轻量记忆召回机制 |
| **优先级** | P0（核心能力缺口：记忆可写不可读，远端记忆无法参与推理） |
| **提出日期** | 2026-04-30 |
| **最后更新** | 2026-04-30 |
| **需求类型** | 召回层新增 |
| **影响范围** | REST API / MCP Server / Retrieval 层 / Surface Files / 配置系统 |
| **前置需求** | 核心检索（search_memory/recall_about）已可用 |

---

## 1. 问题陈述

### 1.1 核心矛盾

MiniMem 当前作为远端记忆服务，与 Agent（如 CodeBuddy）的交互存在**时序错位**：

```
当前时序（有问题）：
  用户发消息 → Agent 推理 + 执行任务 → 任务完成 → 调用 MiniMem 写入记忆
                                                          ↑
                                                   只在这里交互！

期望时序：
  用户发消息 → [记忆召回] → Agent 推理（已有历史上下文）→ 执行任务 → 写入记忆
                  ↑
           这里需要 MiniMem 参与！
```

**结果**：记忆只能写不能在推理前读，10 天前的相关记忆永远无法参与当前推理。

### 1.2 为什么现有方案不够

| 现有方案 | 问题 |
|----------|------|
| Agent 推理中调 `search_memory` | 依赖 LLM 是否"想到"要搜索，经常忘记 |
| 全量注入 Surface Files | 只有高层摘要，缺乏具体细节 |
| 每轮完整检索注入 | Token 消耗过高，可能注入大量无关内容 |
| Agent 自主反思检索（MemR³模式） | 消耗推理 token 做"要不要搜"的决策 |

### 1.3 解法思路

**Hint-Driven Recall**：IDE 宿主层在构建 prompt 前调用 MiniMem 的轻量级 hints 接口，获取简短线索注入 prompt，让 Agent 在推理中"灵感一闪"后按需深度展开。

---

## 2. 设计哲学

### 核心原则：轻量线索 + 按需展开

模拟人类记忆的"线索触发"机制：
- 人类不会时刻想着所有事
- 但当有线索提示时，会"啊对！想起来了"然后主动回忆细节
- 完整回忆只在需要时发生，平时只保留一个"指向"

### 类比

```
人类记忆：
  看到同事名字 → 脑中闪过"上周讨论过部署方案" → 决定是否要细想 → 主动回忆细节

MiniMem Hint-Driven Recall：
  用户消息到达 → MiniMem 返回 hint("4/20 讨论过类似方案") → Agent 看到线索
  → 决定是否需要 → 调用 search_memory 获取完整记忆
```

### 学术定位

| 相关工作 | 关系 |
|----------|------|
| **HyMem** (2026.02) | 双粒度存储 + 动态两级检索 — 概念最相似，但在 Agent 内部实现 |
| **Dual-Thought Retrieval** (2026.03) | 快慢双通道 — 思路一致，但无跨层协作 |
| **MemR³** (2025.12) | 闭环反思检索 — Agent 自主触发，无外部 hint |
| **ProMem** (2026.01) | 主动记忆提取 — 关注存储时，非召回时 |
| **我们的独特贡献** | **跨层协作**：将召回决策从 Agent 推理中外化到 IDE 宿主层 + MiniMem 服务端 |

---

## 3. 架构设计

### 3.1 三层协作架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     完整召回架构                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─ Layer 0: 常驻上下文 ─────────────────────────────────────┐  │
│  │  • 会话开始时 load_surfaces() → 用户画像注入              │  │
│  │  • check_surface_version() → 增量刷新                     │  │
│  │  • Token 预算: ~500-1000 tokens                          │  │
│  │  • 触发时机: 会话初始化（一次性）                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Layer 1: Hint 注入（本需求核心）────────────────────────┐  │
│  │  • IDE 层拦截用户消息                                     │  │
│  │  • 调用 MiniMem hints API                                 │  │
│  │  • 返回 ≤3 条轻量线索（~100-200 tokens）                  │  │
│  │  • 注入 prompt 的 <memory_hints> 区域                     │  │
│  │  • 触发时机: 每轮用户消息（推理前）                        │  │
│  │  • 延迟预算: ≤200ms                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Layer 2: Agent 显式深度检索 ─────────────────────────────┐  │
│  │  • Agent 看到 hint 后决定是否深入                          │  │
│  │  • 调用 search_memory / recall_about 获取完整记忆          │  │
│  │  • 也可由 Agent 推理中自主触发（无 hint 也能搜）           │  │
│  │  • 触发时机: Agent 推理过程中（Tool Call）                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Hint 生成流水线

```
用户消息 "帮我看看之前的微服务拆分方案"
         │
         ▼
┌─ MiniMem Hints Engine ──────────────────────────────────┐
│                                                          │
│  Step 1: 快速语义匹配（embedding 相似度）                │
│    • 对用户消息生成 embedding                            │
│    • 在向量库中 top-K 近邻搜索（K=10）                   │
│    • 延迟: ~50ms                                        │
│                                                          │
│  Step 2: 轻量评分 & 过滤                                 │
│    • 相关性阈值过滤（score > 0.6）                       │
│    • 时间衰减加权（近期记忆优先）                         │
│    • 去重（同一记忆的多个 chunk 合并）                    │
│    • 取 top-N 结果（N=3, 可配置）                        │
│                                                          │
│  Step 3: 生成 Hint 摘要                                  │
│    • 提取: 时间 + 主题 + 一句话摘要                      │
│    • 附带 recall_query（供 Agent 深度检索用）             │
│    • 不需要 LLM（直接用元数据 + 内容截断）               │
│                                                          │
└────────────────────────────────────────┬─────────────────┘
                                         │
                                         ▼
                        Hints Response（~100-200 tokens）
```

### 3.3 数据流时序图

```
┌──────┐       ┌───────┐       ┌─────────┐       ┌─────┐
│ User │       │  IDE  │       │ MiniMem │       │ LLM │
└──┬───┘       └──┬────┘       └────┬────┘       └──┬──┘
   │               │                 │                │
   │─── 输入消息 ──▶│                 │                │
   │               │                 │                │
   │               │── POST /hints ─▶│                │
   │               │                 │── embedding ──▶│(optional)
   │               │                 │◀── vector ────│
   │               │                 │                │
   │               │◀── hints[] ─────│                │
   │               │                 │                │
   │               │── 构建 prompt ───────────────────▶│
   │               │   (含 <memory_hints>)            │
   │               │                 │                │
   │               │                 │   Agent 推理...│
   │               │                 │                │
   │               │                 │◀─ search_memory│ (可选，Agent 深入)
   │               │                 │──── results ──▶│
   │               │                 │                │
   │               │◀──── 最终回复 ──────────────────│
   │◀── 显示回复 ──│                 │                │
```

---

## 4. 接口设计

### 4.1 Hints API（REST — 供 IDE 宿主调用）

```
POST /api/v1/recall/hints
```

**请求体**：

```json
{
  "message": "帮我看看之前的微服务拆分方案",
  "context_summary": "用户在讨论系统架构设计",
  "conversation_history": [
    "用户: 我想重新设计一下服务架构",
    "AI: 好的，你想怎么拆分？"
  ],
  "max_hints": 3,
  "token_budget": 200,
  "domain": "default"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | ✅ | 当前用户消息 |
| `context_summary` | string | ❌ | 对话上下文摘要（提升检索精度） |
| `conversation_history` | string[] | ❌ | 最近 2-3 轮对话（辅助理解意图） |
| `max_hints` | number | ❌ | 最大返回条数（默认 3） |
| `token_budget` | number | ❌ | Hint 总 token 预算（默认 200） |
| `domain` | string | ❌ | 领域过滤（默认 'default'） |

**响应体**：

```json
{
  "hints": [
    {
      "id": "hint_abc123",
      "memory_id": "mem_xyz789",
      "summary": "4/20 你讨论过基于 Docker Compose 的微服务拆分方案，倾向于渐进式拆分",
      "time_label": "10 天前",
      "relevance_score": 0.87,
      "recall_query": "微服务拆分 Docker Compose 渐进式",
      "layer": "L2",
      "tags": ["architecture", "deployment"]
    },
    {
      "id": "hint_def456",
      "memory_id": "mem_uvw012",
      "summary": "4/15 你确认过服务间通信优先用 gRPC，HTTP 作为 fallback",
      "time_label": "15 天前",
      "relevance_score": 0.72,
      "recall_query": "服务间通信 gRPC HTTP",
      "layer": "L3",
      "tags": ["architecture", "protocol"]
    }
  ],
  "meta": {
    "search_time_ms": 45,
    "total_candidates": 8,
    "token_count": 156
  }
}
```

### 4.2 Hint 注入格式（Agent 端）

IDE 拿到 hints 后，注入到 prompt 中的格式：

```markdown
<memory_hints>
以下是与当前对话可能相关的历史记忆线索。如果这些信息对回答有帮助，
你可以调用 search_memory 获取完整内容。

⚡ 10 天前：你讨论过基于 Docker Compose 的微服务拆分方案，倾向于渐进式拆分
  → 深入了解: search_memory({ query: "微服务拆分 Docker Compose 渐进式" })

⚡ 15 天前：你确认过服务间通信优先用 gRPC，HTTP 作为 fallback
  → 深入了解: search_memory({ query: "服务间通信 gRPC HTTP" })
</memory_hints>
```

### 4.3 Auto-Recall API（增强版 — 含 LLM 意图识别）

```
POST /api/v1/recall/auto
```

**请求体**：

```json
{
  "message": "帮我看看之前的微服务拆分方案",
  "context_summary": "系统架构讨论",
  "agent_type": "codebuddy",
  "mode": "hint"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | ✅ | 当前用户消息 |
| `context_summary` | string | ❌ | 对话摘要 |
| `agent_type` | string | ❌ | Agent 类型（影响 Surface Files 选择） |
| `mode` | enum | ❌ | `"hint"`（默认，轻量）/ `"full"`（含完整记忆）/ `"skip"`（LLM 判断不需要） |

**响应体**：

```json
{
  "should_recall": true,
  "reasoning": "用户提到'之前的方案'，明确指向历史记忆",
  "hints": [...],
  "full_memories": null,
  "surface_delta": null
}
```

**与 hints API 的区别**：
- `hints` API：纯机械检索，无 LLM，延迟极低（<100ms），适合每轮调用
- `auto` API：可选 LLM 意图识别，延迟较高（200-500ms），适合重要场景

### 4.4 MCP Tool 扩展（供 Agent 推理中使用）

新增 MCP Tool `get_memory_hints`：

```typescript
{
  name: "get_memory_hints",
  description: "获取与当前话题相关的记忆线索。返回轻量级摘要，如需完整内容请用 search_memory。",
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "当前讨论话题" },
      max_hints: { type: "number", description: "最大线索数", default: 3 }
    },
    required: ["topic"]
  }
}
```

---

## 5. Hint 生成策略

### 5.1 多路信号融合

```
┌─ 信号源 ──────────────────────────────────────────┐
│                                                     │
│  Signal 1: 语义相似度（embedding cosine）           │
│    • 用户消息 vs 所有记忆 embedding                 │
│    • 权重: 0.5                                     │
│                                                     │
│  Signal 2: 实体匹配（NER 关键词命中）               │
│    • 提取用户消息中的实体 → 匹配记忆中的实体         │
│    • 权重: 0.25                                    │
│                                                     │
│  Signal 3: 时间信号（时间表达式解析）                │
│    • "之前"/"上次"/"上周" → 时间范围过滤            │
│    • "最近" → 7天内加权                            │
│    • 权重: 0.15                                    │
│                                                     │
│  Signal 4: 图关联（知识图谱 1-hop）                  │
│    • 用户提到实体 A → A 关联的 B 记忆也纳入候选      │
│    • 权重: 0.1                                     │
│                                                     │
└─────────────────────────────────────────────────────┘
         │
         ▼
  Fusion Score = Σ(weight_i × signal_i)
         │
         ▼
  Top-N (N=max_hints) → 生成 Hint
```

### 5.2 Hint 摘要生成规则

**不使用 LLM**（延迟优先），用模板生成：

```
模板: "{time_label}：{memory_summary_truncated_to_50_chars}"

示例:
- "10 天前：你讨论过基于 Docker Compose 的微服务拆分方案..."
- "3 周前：你设定了 API 响应时间 ≤200ms 的性能目标"
- "昨天：你提到想用 Redis 替换 Memcached"
```

摘要来源优先级：
1. 记忆自身的 `summary` 字段（如果有）
2. L3 Observation 的 `subject + predicate + object` 拼接
3. L1 Experience 的 `content` 前 50 字符截断

### 5.3 "无需召回"判断

某些消息明显不需要历史记忆：

```
快速跳过条件（硬规则，不走检索）：
- 纯问候语: "你好"、"嗨"、"早上好"
- 系统指令: "帮我格式化代码"、"翻译这段文字"
- 无实质内容: 消息长度 < 10 字符且无实体

可选 LLM 判断（auto API 的 mode=smart）：
- 发给 light 模型判断: "这条消息是否需要历史上下文才能准确回答？"
- 返回 should_recall: false 时跳过检索
```

---

## 6. 性能约束

### 6.1 延迟预算

| 路径 | 目标延迟 | 说明 |
|------|----------|------|
| hints API（纯向量） | ≤100ms | 每轮必调，不能拖慢对话 |
| hints API（含 NER + 图） | ≤200ms | 完整四路信号 |
| auto API（含 LLM 判断） | ≤500ms | 仅复杂场景可选 |
| 跳过判断（硬规则） | ≤5ms | 正则匹配即返回 |

### 6.2 Token 预算

| 项目 | 预算 | 说明 |
|------|------|------|
| 单条 Hint | ≤80 tokens | 一句话摘要 + recall_query |
| 整体 Hints 注入 | ≤300 tokens | 含模板文字 + 3 条 hints |
| 占 prompt 比例 | <2% | 相对 128k context 微乎其微 |

### 6.3 缓存策略

```
┌─ 缓存层 ─────────────────────────────────────────┐
│                                                    │
│  L1 缓存: Embedding 缓存                           │
│    • 同一消息重复请求不重新 embed                    │
│    • TTL: 5 分钟                                   │
│                                                    │
│  L2 缓存: 热点记忆摘要缓存                          │
│    • 高频命中的记忆预生成摘要                        │
│    • TTL: 1 小时                                   │
│                                                    │
│  L3 缓存: Session 级 hints 缓存                     │
│    • 同一会话中相似度 >0.95 的消息复用 hints         │
│    • TTL: 会话生命周期                              │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## 7. 配置设计

```toml
[recall]
# Hint-Driven Recall 总开关
enabled = true

[recall.hints]
# 每次请求最大返回 hint 数
max_hints = 3
# 相关性最低阈值（低于此分数的不返回）
min_relevance = 0.55
# Hint 总 token 预算
token_budget = 200
# 单条 hint 摘要最大字符数
summary_max_chars = 80
# 跳过条件：消息最短长度（低于此长度跳过检索）
skip_min_length = 10

[recall.hints.signals]
# 各信号源权重
semantic_weight = 0.50
entity_weight = 0.25
time_weight = 0.15
graph_weight = 0.10

[recall.hints.cache]
# Embedding 缓存 TTL（秒）
embedding_ttl = 300
# 热点摘要缓存 TTL（秒）
summary_ttl = 3600
# Session 相似度复用阈值
session_reuse_threshold = 0.95

[recall.auto]
# Auto-recall 模式（hint / full / smart）
default_mode = "hint"
# LLM 意图识别模型（smart 模式用）
intent_model = "light"
# 意图判断超时（ms）
intent_timeout_ms = 500
```

---

## 8. 安全设计

### 8.1 认证

- hints API 与现有 REST API 共享 JWT 认证
- 请求头: `Authorization: Bearer <token>`
- 无认证时返回 401

### 8.2 Rate Limiting

| 端点 | 限制 | 说明 |
|------|------|------|
| `/api/v1/recall/hints` | 60 req/min | 正常对话频率足够 |
| `/api/v1/recall/auto` | 30 req/min | 含 LLM 调用，限制更严 |

### 8.3 输入过滤

- `message` 字段经过 `sanitizeUserContent()` 消毒后再用于检索
- 防止通过 message 注入攻击操纵检索结果

---

## 9. 可观测性

### 9.1 Prometheus 指标

```
# 每个 API 的请求量和延迟
minimem_recall_hints_requests_total{status="200|400|500"}
minimem_recall_hints_duration_seconds{quantile="0.5|0.9|0.99"}

# Hint 质量指标
minimem_recall_hints_returned_count{} # 每次返回的 hint 数
minimem_recall_hints_skipped_total{reason="short_message|no_match|cached"}

# 深度展开转化率（Agent 是否真的去深入搜索了）
minimem_recall_hint_expansion_total{expanded="true|false"}

# 缓存命中率
minimem_recall_cache_hits_total{cache_level="embedding|summary|session"}
```

### 9.2 日志

```
[INFO] hints request: message="帮我看看之前的微服务..." candidates=8 returned=3 time_ms=67
[DEBUG] hint generated: memory_id=mem_xyz score=0.87 summary="4/20 讨论 Docker Compose..."
[INFO] hints skipped: reason="message_too_short" message="好的"
```

---

## 10. 未来演进

### 10.1 Phase 2 — 自适应学习

- 跟踪 Agent 是否对 hint 进行了深度展开（调用了 search_memory）
- 学习哪些类型的 hint 有用，哪些被忽略
- 动态调整信号权重和阈值

### 10.2 Phase 3 — 跨会话上下文追踪

- 记录用户跨多次会话的"主题线索"
- 自动识别"这个话题上次没聊完"并主动提示

### 10.3 Phase 4 — MCP Resources 集成

- 当 MCP 协议的 `resources` 机制成熟后，将 hints 改为 resource 声明
- IDE 自动订阅，无需显式 API 调用

---

## 11. 验收标准

### 功能验收

| # | 验收项 | 标准 |
|---|--------|------|
| 1 | hints API 基本可用 | 输入消息，返回 ≤3 条相关 hints |
| 2 | 相关性准确 | 人工评测 50 条消息，Top-1 hit rate ≥70% |
| 3 | 跳过规则生效 | 短消息/问候语不触发检索 |
| 4 | Token 预算可控 | 单次注入 ≤300 tokens |
| 5 | 延迟达标 | P99 ≤200ms（hints API） |
| 6 | 认证正确 | 无 token 时返回 401 |
| 7 | 缓存生效 | 相同消息重复请求命中缓存 |

### 集成验收

| # | 验收项 | 标准 |
|---|--------|------|
| 8 | SKILL.md 更新 | 包含 hints 使用说明 |
| 9 | MCP Tool 可用 | `get_memory_hints` 正常工作 |
| 10 | 配置完整 | config.default.toml 含完整默认配置 |
| 11 | 指标可观测 | Prometheus 端点有对应指标 |
