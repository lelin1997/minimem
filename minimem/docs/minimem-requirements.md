# MiniMem 系统改进需求单

> **来源**：基于 belief-state 文章框架对 MiniMem 进行的代码级审计（含安全、可观测性、认知能力深度审计）  
> **日期**：2026-04-22  
> **代码审计日期**：2026-04-22（三路并行代码审计，覆盖全部 21 项需求 + 4 项新发现）  
> **代码库**：`/path/to/minimem`  
> **核心问题**：冷启动死亡螺旋 + 认知能力缺失（信念漂移不可感知、反馈不传播）+ 生产运维短板  
> **需求总数**：22 条（P0 × 7 / P1 × 9 / P2 × 6）  
> **审计结论**：21 项原始需求中 18 项完全属实，3 项属实但需补充细节，另发现 4 项新问题

---

## 〇、问题全景

三个已确认的问题不是孤立的，而是构成一条**正反馈的死亡螺旋**：

```
冷启动（多级晋升漏斗卡住）
    → Dream 产出少（高层记忆无法生成）
        → Surface Files 空白（无数据可写）
            → 高层语义缺失（belief state 断层）
                → 检索质量差（六路检索缺乏高质量候选）
                    → 用户体验不佳
                        → 用户不再写入
                            → 冷启动更严重
```

打破这个循环需要在链条的**多个环节**同时引入旁路机制。

---

## 一、冷启动破冰

### REQ-001：激活 `cold_start_threshold` 运行时检查

| 字段 | 内容 |
|------|------|
| **优先级** | P0 — 阻塞性问题 |
| **现状** | `config.default.toml` 声明了 `cold_start_threshold = 20`，`types.ts`、`config/index.ts`、`schema.ts` 均有类型定义，但 **零运行时代码读取此值** |
| **影响** | 系统只有 1 条记忆时 Cron 也会触发 Dream，Phase 3 因无 seed 返回空结果——白跑一趟，浪费 LLM 调用 |
| **目标** | Dream 触发前检查记忆总数，低于阈值时跳过并记录日志 |
| **涉及文件** | `src/modules/dream/dream-engine.ts`、`src/modules/dream/dreamer.ts` |
| **实现要点** | 1. 在 Dream 启动入口读取 `cold_start_threshold` 配置<br>2. 查询当前记忆总数，低于阈值时 skip 并 log `[dream] skipped: memory count below cold_start_threshold`<br>3. 可选：冷启动阶段切换为"轻量模式"（只做 L1→L2，跳过 L2→L3/L3→L4） |
| **验收标准** | 记忆数 < 20 时 Dream 不执行完整流程；记忆数 ≥ 20 后恢复正常 |

---

### REQ-002：降低多级晋升漏斗门槛

| 字段 | 内容 |
|------|------|
| **优先级** | P0 — 核心瓶颈 |
| **现状** | L2→L3 需同一主题 ≥3 条 L2 事实（`consolidation.ts` L48 `HAVING COUNT(*) >= 3`）；L3→L4 需 ≥2 条 confidence≥0.7 的 L3（`consolidation.ts` L154）；Daily Dream 设 `promoteToMentalModels: 0` 完全跳过 L4 晋升 |
| **影响** | 个人用户记忆分散，同一主题积累 3 条 L2 极为困难，导致 L3 仅 1 条、L4 为 0 |
| **目标** | 在冷启动阶段降低聚合门槛，加速高层记忆生成 |
| **涉及文件** | `src/core/consolidation.ts`、`src/modules/dream/dream-engine.ts` |
| **实现要点** | 1. L2→L3 聚合条件从 `>= 3` 降为 `>= 2`（可配置化）<br>2. L3→L4 保持 `>= 2` 但 confidence 门槛从 0.7 降为 0.6（可配置化）<br>3. Daily Dream 的 `promoteToMentalModels` 从 0 改为一个较小的正数（如 3-5），允许日常也做少量 L4 晋升<br>4. 以上阈值抽取到 `config.default.toml` 中，便于运营期调优 |
| **验收标准** | 冷启动期用户写入 20-30 条记忆后应能产生 ≥3 条 L3 和 ≥1 条 L4 |

---

### REQ-003：`auto_trigger_count` 梯度化 + 命名修正

| 字段 | 内容 |
|------|------|
| **优先级** | P1 |
| **现状** | `auto_trigger_count = 50` 固定值，由 `perception.ts` → `incrementMemoryCount()` 累加触发。**⚠️ 审计发现**：`scheduler/index.ts:83` 使用 `DEFAULT_CONFIG.dreaming.auto_trigger_count` 硬编码值，**不读取运行时配置**。且存在命名不一致：配置文件用 `auto_trigger_threshold`，代码用 `auto_trigger_count` |
| **影响** | 个人用户日常写入量远低于 50，自动触发路径几乎不会命中，完全依赖 Cron。命名不一致增加维护混淆 |
| **目标** | 根据用户使用阶段动态调整自动触发阈值，统一命名 |
| **涉及文件** | `src/scheduler/index.ts`、`config.default.toml` |
| **实现要点** | 1. **修复硬编码**：从运行时配置读取阈值，而非 `DEFAULT_CONFIG`<br>2. **统一命名**：配置项和代码变量统一为 `auto_trigger_threshold`<br>3. 引入分级阈值：记忆总量 <100 时 `auto_trigger = 10`，100-500 时 `= 25`，>500 时 `= 50`<br>4. 或改为基于时间的自适应：距上次 Dream >12h 且有新记忆即触发 |
| **验收标准** | 冷启动期每 10 条新记忆触发一次 Dream；配置与代码命名一致 |

---

## 二、检索质量加固

### REQ-004：L2/L3/L4 Embedding 补偿机制

| 字段 | 内容 |
|------|------|
| **优先级** | P0 — 检索核心依赖 |
| **现状** | L1 有 `embedding_backfill` 队列（R-026，`perception.ts` L202-215），失败后可重试。L2/L3/L4 在 `processing.ts`、`consolidation.ts` 中 embedding 失败 **只打 warning，无重试机制** |
| **影响** | embedding API 不稳定时高层记忆没有向量索引，六路检索中 semantic 路返回空，检索质量直接腰斩 |
| **目标** | 所有层级的 embedding 失败都有补偿机制 |
| **涉及文件** | `src/core/processing.ts`、`src/core/consolidation.ts`、`src/store/vectors.ts` |
| **实现要点** | 1. 复用 L1 的 `embedding_backfill` 队列机制，扩展支持 L2/L3/L4<br>2. 或新建统一的 `embedding_retry_queue` 表，记录失败的 memory_id + layer + retry_count<br>3. 在每次 Dream 启动前或 GC light 阶段扫描并重试 |
| **验收标准** | embedding 失败后 24h 内自动补偿成功率 > 95% |

---

### REQ-005：FTS5 中文分词增强 + 输入清洗

| 字段 | 内容 |
|------|------|
| **优先级** | P1 |
| **现状** | SQLite FTS5 默认 tokenizer 对中文支持有限，中英文混合查询（如 "MiniMem 系统设计 架构 功能"）可能匹配失败。**⚠️ 审计发现**：`indexes.ts:89` 直接把用户查询字符串扔进 FTS5 MATCH，**未转义 FTS5 特殊字符**（如 `*`, `"`, `NEAR`, `AND`, `OR` 等），可能导致查询语法错误 |
| **影响** | keyword 路检索在中文场景下效果差，六路中至少两路（keyword + knowledge_page）受影响。特殊字符注入可导致查询异常 |
| **目标** | 中文查询的关键词匹配能力达到基本可用水平，同时防止 FTS5 语法注入 |
| **涉及文件** | FTS5 索引创建逻辑、`src/retrieval/search.ts`、`src/retrieval/indexes.ts` |
| **实现要点** | 方案任选其一：<br>1. 接入 `simple` tokenizer + 自定义中文分词（如 jieba-wasm）<br>2. 在查询侧做预处理：将中文文本按字符 bigram 拆分后构造 FTS5 查询<br>3. 退而求其次：对中文查询增加 LIKE 模糊匹配 fallback<br><br>**另需增加 FTS5 输入清洗**：<br>4. 转义或移除 FTS5 特殊语法字符（`"`, `*`, `NEAR`, `AND`, `OR`, `NOT`, `(`, `)`）<br>5. 用 `"..."` 包裹每个搜索词，防止被解析为 FTS5 操作符 |
| **验收标准** | 中文关键词查询召回率 > 70%（与 LIKE 全表扫描对比）；含特殊字符的查询不报错 |

---

### REQ-006：LLM 不可用时检索降级策略优化

| 字段 | 内容 |
|------|------|
| **优先级** | P2 |
| **现状** | `MemSifter` 查询规划器在 LLM 不可用时 fallback 为只做 semantic + keyword 两路（`search.ts` L184-241），跳过 graph/temporal/condition/knowledge_page |
| **影响** | 如果 embedding 同时不可用，两路都失效，检索完全瘫痪 |
| **目标** | LLM 不可用时保留更多检索路径 |
| **涉及文件** | `src/retrieval/search.ts` |
| **实现要点** | 1. LLM 不可用时 fallback 应包含 temporal + keyword + knowledge_page 三路（这三路不依赖 LLM）<br>2. graph 路在有足够图数据时也应保留<br>3. 增加 "最终兜底"：若所有路返回 0 结果，执行简单的 SQL LIKE 全文搜索 |
| **验收标准** | LLM 和 embedding 同时不可用时，keyword + temporal + LIKE fallback 仍能返回相关结果 |

---

## 三、Surface Files 活性恢复

### REQ-007：增加非 Dream 的 Surface Files 直接更新路径

| 字段 | 内容 |
|------|------|
| **优先级** | P0 — belief state 摘要层的核心价值 |
| **现状** | Surface Files 更新 **100% 依赖 Dream Engine**。`suggest_surface_update` MCP 工具只入 `surface_update_queue` 队列，必须等 Dream Phase 4 消费。如果 Dream 不运行，Surface Files 永远不更新 |
| **影响** | Dream 不运行 = Surface Files 全部过时，belief state 摘要层失效 |
| **目标** | Surface Files 有独立于 Dream 的更新机制 |
| **涉及文件** | `src/surface/index.ts`、`src/surface/sync.ts`、MCP handler |
| **实现要点** | 1. 新增 `immediateUpdateSurface()` 方法，绕过队列直接调用 `smartUpdateSurfaceFile()`<br>2. `suggest_surface_update` MCP 工具增加 `immediate: boolean` 参数，默认 false 保持兼容<br>3. 新增定时任务（如每 6h）独立执行 `processUpdateQueue()`，不依赖 Dream 调度<br>4. 可选：每次 `perception.ts` 写入 L1 后，检查是否需要增量更新 `context.md`（热路径上需注意性能） |
| **验收标准** | Dream 未运行时，Surface Files 在 6h 内仍能得到更新 |

---

### REQ-008：补全 `agent.md` Syncer

| 字段 | 内容 |
|------|------|
| **优先级** | P1 |
| **现状** | 6 个 Syncer 已注册（me/soul/work/social/context/life），`agent.md` **完全没有 Syncer**，无论日做梦还是周做梦都不会被自动更新 |
| **影响** | `agent.md` 永远是空的初始状态，无法作为 agent 的自我认知摘要 |
| **目标** | `agent.md` 有对应的 Syncer 并参与 Dream 更新 |
| **涉及文件** | `src/surface/syncers/`（新增 `agent-syncer.ts`）、`src/surface/sync.ts`（注册） |
| **实现要点** | 1. 新建 `agent-syncer.ts`，数据源为：系统配置、已激活的 MCP tools 列表、用户偏好（`owner_profile`）、近期交互模式<br>2. 在 `sync.ts` 中注册 agent syncer<br>3. 将 `agent.md` 加入 Daily Dream 的 `surfaceFiles` 列表 |
| **验收标准** | Dream 运行后 `agent.md` 包含当前 agent 的能力摘要和配置状态 |

---

### REQ-009：Daily Dream Surface Files 覆盖范围扩大

| 字段 | 内容 |
|------|------|
| **优先级** | P2 |
| **现状** | Daily Dream 只更新 `context.md` + `work.md`（2 个）；Weekly Dream 更新 6 个 |
| **影响** | `soul.md`、`me.md`、`life.md`、`social.md` 只有周做梦才更新，如果服务在周日 4am 不在线则长期不更新 |
| **目标** | 提高 Surface Files 的日常更新频率 |
| **涉及文件** | `src/modules/dream/dream-engine.ts` Daily Profile |
| **实现要点** | 1. Daily Dream 增加条件性更新：检查各 Syncer 的 `hasChanges()`，有变化的才纳入本次更新<br>2. 或改为"轮换策略"：每天轮换更新 1-2 个额外的 Surface File（如周一 me.md，周二 soul.md...）<br>3. 保持 Daily Dream 的轻量特性，不全量更新 6 个 |
| **验收标准** | 每个 Surface File 至少每 3 天更新一次（假设服务持续在线） |

---

## 四、系统健壮性

### REQ-010：记忆纠错机制（新增能力）

| 字段 | 内容 |
|------|------|
| **优先级** | P1 — belief-state 文章明确指出的关键能力 |
| **现状** | `consolidation.ts` L254-299 的 `detectConflicts()` 能检测到矛盾记忆，但 **没有自动解决机制**，只是返回冲突列表 |
| **影响** | 错误记忆一旦写入并晋升到 L3/L4，会持续污染 belief state，且无法自我纠正 |
| **目标** | 系统能检测并处理矛盾记忆 |
| **涉及文件** | `src/core/consolidation.ts`、新增 `src/core/correction.ts` |
| **实现要点** | 1. 在 `detectConflicts()` 返回冲突后，调用 LLM 判断哪条更可信（基于时间新近性、来源可信度、置信度）<br>2. 被判定为过时/错误的记忆标记为 `superseded`，降低 confidence 但不删除（保留审计轨迹）<br>3. 新增 `feedback_memory` 的 `incorrect` 反馈类型的运行时处理逻辑<br>4. Dream 阶段增加"冲突检测与解决"子阶段 |
| **验收标准** | 写入矛盾信息后，下一次 Dream 能自动标记旧记忆为 `superseded` |

---

### REQ-011：文档与代码同步

| 字段 | 内容 |
|------|------|
| **优先级** | P2 |
| **现状** | `INGEST-PIPELINE.md` 记载 `incrementMemoryCount` "未接线"，但代码中 `perception.ts` L200 已接线。文档说"四路检索"，实际是六路 |
| **影响** | 误导后续维护者，增加排障难度 |
| **目标** | 关键文档与代码实现一致 |
| **涉及文件** | 项目文档（`INGEST-PIPELINE.md` 等） |
| **实现要点** | 1. 修正 `incrementMemoryCount` 的描述为"已接线"<br>2. 检索架构描述更正为"六路并行"<br>3. 补充 Surface Files 更新机制的完整说明 |
| **验收标准** | 文档描述与代码实现无矛盾 |

---

## 五、认知能力补全

### REQ-012：信念漂移检测机制

| 字段 | 内容 |
|------|------|
| **优先级** | P0 — belief-state 核心差距 |
| **现状** | 温度衰减只基于"分数"（importance × 100 + 20），不基于**置信度**。`detectConflicts()` 能发现矛盾但不做自动解决。没有显式的"信念漂移指标"——系统无法感知自身 belief state 是否在偏离现实 |
| **影响** | 系统不知道自己"可能错了"，无法从被动存储进化到主动认知。长期运行后 L3/L4 可能积累大量过时认知而毫无察觉 |
| **目标** | 系统能计算并跟踪信念漂移指标，当偏离超过阈值时主动标记或触发修正 |
| **涉及文件** | 新增 `src/core/drift-detector.ts`、`src/core/consolidation.ts`、`src/modules/dream/dreamer.ts` |
| **实现要点** | 1. 为每条 L3/L4 记忆增加 `confidence_decay` 字段，随时间衰减（区别于 temperature 的访问热度衰减）<br>2. 引入"支撑度"指标：一条 L3 由多少条活跃 L2 支撑，支撑数下降 = 信念动摇<br>3. Dream 阶段增加"漂移扫描"：识别高 confidence 但低支撑度的 L3/L4，标记为 `drift_risk`<br>4. 暴露 MCP 工具 `get_belief_health` 供 Agent 查询当前信念健康度 |
| **验收标准** | 当 L3 的支撑 L2 被标记为 `incorrect` 或过期后，该 L3 的 confidence 在下一次 Dream 中自动下调 |

---

### REQ-013：反馈传播机制

| 字段 | 内容 |
|------|------|
| **优先级** | P0 — 错误修正链完整性 |
| **现状** | `feedback_memory` 工具的三种反馈（`useful` → 温度+5，`incorrect` → 重要性-0.3，`outdated` → 重要性-0.2）**只作用于单条记忆**，不传播到由此编译出的 L2 事实、L3 观察、L4 心智模型 |
| **影响** | 标记一条 L1 为 `incorrect`，由它编译出的 L2/L3/L4 仍然存在且不受影响。错误信息在高层记忆中持续存在，污染 belief state |
| **目标** | 反馈能沿编译链传播到上层受影响的记忆 |
| **涉及文件** | `src/gateway/mcp-server.ts`、新增 `src/core/feedback-propagator.ts`、`src/store/schema.ts`（需要 `compilation_trace` 表记录编译来源） |
| **实现要点** | 1. L1→L2→L3→L4 编译时记录来源关系（`source_memory_ids`）到 `compilation_trace` 表<br>2. 收到 `incorrect` 反馈时，查询 `compilation_trace` 找到所有下游记忆<br>3. 对下游记忆递归降低 confidence（衰减因子 0.7 逐层递减），标记为 `review_needed`<br>4. 下一次 Dream 的冲突检测阶段优先处理 `review_needed` 记忆 |
| **验收标准** | 标记一条 L1 为 `incorrect` 后，由其编译出的 L2 事实 confidence 在 24h 内被下调 |

---

### REQ-014：Forget 操作层保护对齐

| 字段 | 内容 |
|------|------|
| **优先级** | P0 — 安全一致性 |
| **现状** | GC 系统精心设计了层保护：L4 永不压缩/删除，L3/L2 永不删除。但 `src/lifecycle/forget.ts` 的 `forgetAbout()` 用 7 步级联删除**直接删除 L4 心智模型**，完全绕过 GC 保护。且只支持"按主题全删"，不支持按时间范围或按层级遗忘 |
| **影响** | 用户一次随意遗忘操作可能摧毁系统花了很多 Dream 周期才建立起来的高层认知 |
| **目标** | Forget 操作尊重层保护规则，并支持更精细的遗忘范围 |
| **涉及文件** | `src/lifecycle/forget.ts`、`src/gateway/mcp-server.ts` |
| **实现要点** | 1. L4 默认不删除，改为降低 confidence 到 0.1 + 标记 `superseded_by_forget`（可通过 `force: true` 参数强制删除）<br>2. L3 同样改为软删除（标记 + 降 confidence），除非 `force: true`<br>3. 新增参数 `scope`：`all`（现有行为）、`time_range`（指定起止时间）、`layer`（指定层级）<br>4. dry-run 模式展示将受影响的各层记忆数量和具体的 L4 内容 |
| **验收标准** | 默认 `forget_about` 不删除 L3/L4，仅软标记；dry-run 输出清晰标注各层影响 |

---

## 六、生产运维能力

### REQ-015：外部指标导出（Prometheus/OpenTelemetry）

| 字段 | 内容 |
|------|------|
| **优先级** | P1 — 生产系统必须可观测 |
| **现状** | 内部有 pino 结构化日志、`memory_traces` 表链路追踪、`health.ts` 4 类告警检测。但**无 Prometheus / StatsD / OpenTelemetry 集成**。`/api/v1/health` 端点只返回基础层计数，没调用完整的 `checkHealth()` |
| **影响** | 运行时完全是黑盒，无法接入 Grafana 看 Dream 执行耗时、检索命中率、GC 回收量等核心指标。出了问题只能翻日志 |
| **目标** | 核心运行指标可被外部监控系统采集 |
| **涉及文件** | 新增 `src/observability/metrics.ts`、`src/gateway/routes.ts`（`/metrics` 端点）、`src/lifecycle/health.ts` |
| **实现要点** | 1. 定义核心指标集：Dream 执行耗时/状态、检索延迟/命中率、GC 各级回收量、各层记忆数、embedding 队列深度、LLM 调用次数/延迟<br>2. 暴露 `/metrics` 端点（Prometheus 文本格式）<br>3. `/api/v1/health` 调用完整的 `checkHealth()` 并返回结构化告警<br>4. 可选：接入 OpenTelemetry SDK，将 `memory_traces` 导出为标准 trace |
| **验收标准** | Prometheus 能 scrape `/metrics` 并展示 Dream 执行频率、检索 P99 延迟、各层记忆数趋势 |

---

### REQ-016：LLM 缓存实现

| 字段 | 内容 |
|------|------|
| **优先级** | P1 — 成本与延迟直接影响 |
| **现状** | `config.default.toml` 声明了 `[llm.cache]`（`enabled = true`，`semantic_threshold = 0.95`，`ttl_hours = 24`），但 `src/llm/client.ts` **零缓存相关代码** |
| **影响** | 每次 Dream、检索 rerank、Surface 生成都重复调用 LLM。相似查询反复付费，延迟叠加 |
| **目标** | 相似 LLM 调用命中缓存，减少重复调用 |
| **涉及文件** | `src/llm/client.ts`、新增 `src/llm/cache.ts`、`src/store/schema.ts` |
| **实现要点** | 1. 新建 `llm_cache` 表（prompt_hash, embedding, response, created_at, ttl）<br>2. 调用 LLM 前计算 prompt embedding，在缓存中搜索 cosine ≥ `semantic_threshold` 的条目<br>3. 命中则直接返回缓存 response（检查 TTL）<br>4. 未命中则正常调用后写入缓存<br>5. GC light 阶段清理过期缓存 |
| **验收标准** | 相同语义的 LLM 调用在 TTL 内不重复请求；缓存命中率指标可通过 REQ-015 观测 |

---

### REQ-017：上下文组装 Token 预算管控

| 字段 | 内容 |
|------|------|
| **优先级** | P1 — 可能导致 LLM 调用失败 |
| **现状** | `get_relevant_context` 加载 Surface Files（按 agent 类型 4-8 个文件）+ top-5 深度检索结果。Surface Files 有单文件 token 预算（`MAX_BORROW_RATIO = 1.5`），但**组装后的总上下文没有总量控制**。**⚠️ 审计发现**：`get_relevant_context` 中 `top_k: 5` 为硬编码值，不可配置 |
| **影响** | 当 Surface Files 接近各自预算上限且检索结果丰富时，组装后的上下文可能超出 LLM 上下文窗口，导致调用失败或截断丢失关键信息 |
| **目标** | 上下文组装有全局 token 预算，超出时智能裁剪 |
| **涉及文件** | `src/gateway/mcp-server.ts`（`get_relevant_context` handler）、`src/surface/index.ts` |
| **实现要点** | 1. 新增配置 `context.max_total_tokens`（默认 8000）<br>2. 组装时先计算 Surface Files 总 token，再计算剩余预算分配给检索结果<br>3. 超出预算时按优先级裁剪：先缩减检索结果数量 → 再触发 Surface Files 的 graceful degradation<br>4. 返回结果中附带 `token_usage` 字段，告知 Agent 实际使用量 |
| **验收标准** | 任何情况下 `get_relevant_context` 返回的总 token 数不超过配置的 `max_total_tokens` |

---

### REQ-018：向量检索引擎可扩展

| 字段 | 内容 |
|------|------|
| **优先级** | P1 — 中等数据量即遇性能瓶颈 |
| **现状** | `src/store/vectors.ts` 用内存 `Map<string, VectorEntry>` + 暴力余弦相似度。Config 声明 `provider: 'memory' \| 'qdrant' \| 'chroma'` 但只实现了 `memory`。代码注释 `// 后续可切换为 Qdrant / ChromaDB` |
| **影响** | 记忆量到几万条时每次检索都遍历全量向量，semantic 路延迟线性增长 |
| **目标** | 向量存储层可切换后端，支持 ANN 近似检索 |
| **涉及文件** | `src/store/vectors.ts`、新增 `src/store/vector-providers/`（qdrant.ts, chroma.ts） |
| **实现要点** | 1. 抽象 `VectorProvider` 接口（search, upsert, delete, count）<br>2. 现有内存实现改为 `MemoryVectorProvider`<br>3. 新增 `QdrantVectorProvider`（HTTP API 对接），作为首选外部后端<br>4. 通过 config `vector.provider` 选择后端，启动时初始化<br>5. 可选：小数据量（<5000）自动使用内存，超过后提示切换 |
| **验收标准** | 配置 Qdrant 后端后，1 万条记忆的 semantic 检索 P99 < 100ms |

---

## 七、安全与数据完整性

### REQ-019：安全默认值加固

| 字段 | 内容 |
|------|------|
| **优先级** | P2 |
| **现状** | SQLCipher 加密代码完备（`src/store/encryption.ts`），JWT 三级权限实现完整（`src/gateway/auth.ts`），PII 检测 13 模式、Prompt 注入防御 7 模式均工作正常。但**加密默认关闭**（`encryption.enabled = false`）、**认证默认关闭**（`auth.enabled = false`，所有请求默认获得 `trusted` 权限）、**无 HTTPS/TLS**（REST API 只绑 `127.0.0.1`）、**无多租户隔离**、macOS Keychain 是占位代码 |
| **影响** | 存储个人记忆的系统"安全功能存在但默认关闭"，任何本地进程都能无认证读写全部记忆 |
| **目标** | 默认安全配置，需要时可放宽 |
| **涉及文件** | `config.default.toml`、`src/gateway/auth.ts`、`src/store/encryption.ts` |
| **实现要点** | 1. `auth.enabled` 默认改为 `true`，首次启动自动生成 JWT secret<br>2. `encryption.enabled` 默认改为 `true`，首次启动自动生成密钥并存储到系统 keychain<br>3. 补全 macOS Keychain 集成（用 `keytar` 或系统 `security` 命令）<br>4. 新增 `--insecure` 启动参数用于开发模式，明确 log 警告 |
| **验收标准** | 全新安装后默认启用认证和加密；`--insecure` 模式下可关闭并有明确警告 |

---

### REQ-020：增量 Schema 迁移机制

| 字段 | 内容 |
|------|------|
| **优先级** | P2 |
| **现状** | `src/store/migrate.ts` 只有 `CREATE TABLE IF NOT EXISTS`，没有真正的增量迁移链。`_meta` 表记录 schema_version 但迁移逻辑只支持全量创建或重置 |
| **影响** | 新增字段需手动 ALTER TABLE、不能安全回滚、没有迁移版本链。生产升级风险高，尤其是涉及 REQ-012/013 新增字段时 |
| **目标** | 支持有序的增量迁移，可前进可回滚 |
| **涉及文件** | `src/store/migrate.ts`、新增 `src/store/migrations/` 目录 |
| **实现要点** | 1. 新建 `migrations/` 目录，每个迁移文件为 `NNNN_description.ts`（up/down 方法）<br>2. `_meta` 表记录当前版本号<br>3. 启动时自动执行未应用的迁移（按编号升序）<br>4. 每个迁移在事务内执行，失败则回滚<br>5. 提供 CLI 命令 `minimem migrate:status`、`minimem migrate:rollback` |
| **验收标准** | 新版本部署后自动执行增量迁移；回滚命令能还原最近一次迁移 |

---

### REQ-021：外部数据源连接器框架

| 字段 | 内容 |
|------|------|
| **优先级** | P2 |
| **现状** | 记忆采集只通过 MCP 工具（`add_memory`、`add_memories_batch`）和 REST API（`POST /api/v1/memory`）主动写入。`import_memories` 支持 JSON/Markdown/chat_log 三种格式。**无 webhook、无日历/邮件/浏览器等外部连接器** |
| **影响** | 记忆来源单一，完全依赖 Agent 主动写入。用户日常大量信息（会议、邮件、浏览记录）无法自动进入记忆系统 |
| **目标** | 提供可扩展的外部数据源连接器框架 |
| **涉及文件** | 新增 `src/connectors/` 目录、`src/connectors/base.ts`（抽象接口） |
| **实现要点** | 1. 定义 `Connector` 抽象接口（init, poll, transform, shutdown）<br>2. 每个 Connector 实现 `transform()` 将外部数据转换为标准 L1 记忆格式<br>3. 首批实现：Webhook Connector（通用 HTTP 回调）、File Watcher Connector（监控指定目录的 Markdown 文件）<br>4. Connector 配置在 `config.default.toml` 的 `[connectors]` 节<br>5. 接入后的数据标记 `source: connector/{name}`，便于追踪和按来源过滤 |
| **验收标准** | Webhook Connector 能接收外部 POST 请求并自动转换为 L1 记忆 |

---

### REQ-022：健康检查能力通过 MCP 完整暴露

| 字段 | 内容 |
|------|------|
| **优先级** | P1 — 审计新发现 |
| **现状** | `src/lifecycle/health.ts:52` 的 `checkHealth()` 实现了完整的 6 项检查 + 4 种告警类型（`dream_stalled`, `gc_backlog`, `embedding_gap`, `storage_pressure`）。但 `get_memory_health` MCP handler（`mcp-server.ts:977`）**只返回简单的各层记忆计数**，完全没有调用 `checkHealth()` |
| **影响** | Agent 通过 MCP 获取的健康信息极其简陋，无法感知 Dream 停滞、GC 积压、embedding 缺口等关键问题。完整的健康检查能力被"浪费"了 |
| **目标** | `get_memory_health` MCP handler 暴露完整的健康检查结果 |
| **涉及文件** | `src/gateway/mcp-server.ts`、`src/lifecycle/health.ts` |
| **实现要点** | 1. `get_memory_health` handler 调用完整的 `checkHealth()` 并返回告警列表<br>2. 返回格式包含：各层计数 + 告警列表 + 最近 Dream 时间 + embedding 缺口数 + GC 积压量<br>3. 可选：增加 `detail` 参数，`false` 返回简要计数（向后兼容），`true` 返回完整健康报告 |
| **验收标准** | `get_memory_health` 返回完整告警信息；Agent 可据此判断是否需要触发 Dream 或修复操作 |

---

## 八、需求优先级总览

| 优先级 | 编号 | 标题 | 维度 | 审计状态 |
|--------|------|------|------|----------|
| **P0** | REQ-001 | 激活 cold_start_threshold | 冷启动 → 避免白跑 | ✅ 完全属实 |
| **P0** | REQ-002 | 降低多级晋升漏斗门槛 | 冷启动 → 加速高层记忆 | ✅ 完全属实 |
| **P0** | REQ-004 | L2-L4 Embedding 补偿 | 检索 → 保障向量完整 | ✅ 完全属实 |
| **P0** | REQ-007 | Surface Files 非 Dream 更新路径 | Surface → 打破 Dream 单点依赖 | ✅ 完全属实 |
| **P0** | REQ-012 | 信念漂移检测机制 | 认知 → belief state 核心差距 | ✅ 完全属实 |
| **P0** | REQ-013 | 反馈传播机制 | 认知 → 错误修正链完整性 | ✅ 完全属实 |
| **P0** | REQ-014 | Forget 操作层保护对齐 | 认知 → 安全一致性 | ✅ 完全属实 |
| **P1** | REQ-003 | auto_trigger 梯度化 + 命名修正 | 冷启动 → 更早触发 Dream | ⚠️ 属实 + 补充命名不一致 |
| **P1** | REQ-005 | FTS5 中文分词 + 输入清洗 | 检索 → 关键词路可用 | ⚠️ 属实 + 补充输入清洗 |
| **P1** | REQ-008 | 补全 agent.md Syncer | Surface → 消除设计遗漏 | ✅ 完全属实 |
| **P1** | REQ-010 | 记忆纠错机制 | 全局 → belief state 自我修正 | ✅ 完全属实 |
| **P1** | REQ-015 | 外部指标导出 | 运维 → 生产可观测性 | ✅ 完全属实 |
| **P1** | REQ-016 | LLM 缓存实现 | 运维 → 成本与延迟 | ✅ 完全属实 |
| **P1** | REQ-017 | 上下文组装 Token 预算 | 运维 → 防止 LLM 调用失败 | ⚠️ 属实 + 补充 top_k 硬编码 |
| **P1** | REQ-018 | 向量检索引擎可扩展 | 运维 → 性能可扩展性 | ✅ 完全属实 |
| **P1** | REQ-022 | 健康检查能力完整暴露 | 运维 → Agent 可感知系统状态 | 🆕 审计新发现 |
| **P2** | REQ-006 | LLM 不可用时降级优化 | 检索 → 极端场景兜底 | ✅ 完全属实 |
| **P2** | REQ-009 | Daily Dream 覆盖扩大 | Surface → 提高更新频率 | ✅ 完全属实 |
| **P2** | REQ-011 | 文档同步 | 维护性 | ✅ 完全属实 |
| **P2** | REQ-019 | 安全默认值加固 | 安全 → 默认安全 | ✅ 完全属实 |
| **P2** | REQ-020 | 增量 Schema 迁移 | 数据 → 生产升级安全 | ✅ 完全属实 |
| **P2** | REQ-021 | 外部数据源连接器框架 | 扩展 → 记忆采集多样性 | ✅ 完全属实 |

---

## 九、推荐实施路径（审计后修订版）

> 基于 2026-04-22 三路并行代码审计结果，将原四阶段调整为"止血 → 补强 → 演进"三波模型。

### 🩸 第一波：止血（1-2 周）— 打破冷启动死亡螺旋

核心目标：解决死亡螺旋链条上的关键断裂点，让系统进入正向循环的最低条件。

```
第一波 — 止血
├── REQ-001 激活 cold_start_threshold（0.5 天）
│   └── 审计确认：cold_start_threshold 运行时零引用，1 条记忆即触发 Dream
├── REQ-003 auto_trigger 梯度化 + 命名修正（1 天）
│   └── 审计新发现：scheduler 用 DEFAULT_CONFIG 硬编码，命名不一致
├── REQ-004 L2-L4 embedding 补偿（1-2 天）
│   └── 审计确认：L2/L3/L4 embedding 失败只 log.warn，无重试
├── REQ-005 FTS5 中文分词 + 输入清洗（2-3 天）
│   └── 审计新发现：FTS5 特殊字符未转义，可导致查询语法错误
├── REQ-006 LLM 降级链完善（1 天）
│   └── 审计确认：降级路径实质只剩 keyword_search
└── REQ-007 Surface Files 独立更新路径（2 天）
    └── 审计确认：processUpdateQueue() 只被 Dream Phase 4 调用
```

### 💪 第二波：补强（2-3 周）— 补全记忆生命周期

核心目标：让记忆系统具备自愈、反馈传播和层级保护能力。

```
第二波 — 补强
├── REQ-008 agent-syncer + index-syncer（1 天）
│   └── 审计确认：只有 6 个 syncer，agent.md 和 index.md 无人更新
├── REQ-009 Daily Dream 覆盖面扩大（0.5 天）
│   └── 审计确认：Daily 只更新 context.md + work.md
├── REQ-002 降低多级晋升门槛 + Daily L4 策略（1 天）
│   └── 审计确认：Daily promoteToMentalModels=0 完全跳过 L4
├── REQ-010 冲突自动解决（2-3 天）
│   └── 审计确认：detectConflicts() 只返回列表，无解决机制
├── REQ-013 反馈传播机制（2 天）
│   └── 审计确认：feedback_memory 只影响单条 L1，不向上传播
├── REQ-014 Forget 层保护合规（1 天）
│   └── 审计确认：forgetAbout() 直接 DELETE L4，绕过 GC 层保护
├── REQ-017 Token 预算 + top_k 配置化（1-2 天）
│   └── 审计发现：top_k=5 硬编码
├── REQ-022 健康检查能力完整暴露（0.5 天）
│   └── 审计新发现：get_memory_health 未调用 checkHealth()
└── REQ-016 LLM 缓存实现（2 天）
    └── 审计确认：config 声明缓存，client.ts 零缓存代码
```

### 🚀 第三波：演进（按需）— 架构升级与长期能力建设

核心目标：高级认知能力和生产化运维，可根据实际使用情况选择性实施。

```
第三波 — 演进
├── REQ-020 增量 Schema 迁移（2 天）
│   └── 当前 --reset 可用，但每次发版需要时才做
├── REQ-012 信念漂移检测（3-4 天）
│   └── 高级认知特性，需先完成 REQ-013 反馈传播
├── REQ-011 文档同步（0.5 天）
├── REQ-015 外部指标导出（2-3 天）
├── REQ-018 向量存储 Provider 抽象（3-4 天）
│   └── 当前内存实现够用，数据量到万级再做
├── REQ-019 安全默认值加固（1-2 天）
│   └── 个人使用暂不紧急，多用户部署前必做
└── REQ-021 外部数据源连接器框架（3-4 天）
    └── 扩展性需求，核心功能稳定后再做
```

> **第一波完成后**，冷启动死亡螺旋即被打破——Dream 不再空转、embedding 有补偿、检索有兜底、Surface Files 不依赖 Dream。  
> **第二波完成后**，记忆生命周期完整——反馈可传播、遗忘有保护、冲突可解决、健康可感知。MiniMem 从"被动存储"进化为"主动认知"。  
> **第三波按需推进**，系统具备生产运行和长期演进条件——可观测、可扩展、可安全升级。

---

## 十、代码审计结论

> **审计时间**：2026-04-22  
> **审计方式**：三路并行代码审计（冷启动/Dream、检索/Surface、运维/安全）  
> **覆盖范围**：全部 21 项原始需求涉及的源文件

### 审计总结

| 分类 | 数量 | 说明 |
|------|------|------|
| ✅ 完全属实 | 18 项 | 代码审计完全验证需求文档描述 |
| ⚠️ 属实但需补充 | 3 项 | REQ-003（命名不一致）、REQ-005（输入清洗）、REQ-017（top_k 硬编码） |
| 🆕 审计新发现 | 4 项 | 见下表 |
| ❌ 不属实 | 0 项 | 无 |

### 审计新发现明细

| 编号 | 发现 | 严重度 | 处理方式 |
|------|------|--------|----------|
| NEW-1 | `auto_trigger_threshold`（配置）vs `auto_trigger_count`（代码）命名不一致 | P1 | 已并入 REQ-003 |
| NEW-2 | FTS5 输入无清洗，特殊字符导致查询语法错误 | P0 | 已并入 REQ-005 |
| NEW-3 | `get_memory_health` MCP handler 未调用完整 `checkHealth()`，6 项检查 + 4 种告警被浪费 | P1 | 新增为 REQ-022 |
| NEW-4 | Daily Dream `promoteToMentalModels: 0` 完全跳过 L4，需明确修复策略 | P1 | 已在 REQ-002 实现要点中明确 |

### 关键代码定位（审计证据）

| 需求 | 关键代码位置 | 问题描述 |
|------|-------------|----------|
| REQ-001 | `config.default.toml:67` | `cold_start_threshold = 20` 声明但运行时零引用 |
| REQ-002 | `consolidation.ts:48` | `HAVING COUNT(*) >= 3`（L2→L3 门槛） |
| REQ-002 | `consolidation.ts:149` | `confidence >= 0.7`（L3→L4 门槛） |
| REQ-002 | `dream-engine.ts:64` | `promoteToMentalModels: 0`（Daily 跳过 L4） |
| REQ-003 | `scheduler/index.ts:83` | `DEFAULT_CONFIG.dreaming.auto_trigger_count` 硬编码 |
| REQ-004 | `processing.ts:135` | L2 embedding 失败只 `log.warn` |
| REQ-004 | `consolidation.ts:118` | L3 embedding 失败只 `log.warn` |
| REQ-004 | `consolidation.ts:225` | L4 embedding 失败只 `log.warn` |
| REQ-005 | `indexes.ts:89` | FTS5 MATCH 直接用用户输入，无转义 |
| REQ-006 | `search.ts:192-201` | 降级返回 semantic+keyword，但 semantic 也依赖 embedding |
| REQ-007 | Dream Phase 4 | `processUpdateQueue()` 唯一调用点 |
| REQ-008 | `sync.ts:152-164` | 只注册 6 个 syncer，无 agent/index |
| REQ-013 | `mcp-server.ts:809-828` | `feedback_memory` 只修改单条 L1 |
| REQ-014 | `forget.ts:119-121` | L4 直接 DELETE，绕过层保护 |
| REQ-016 | `src/llm/client.ts` | 659 行，零缓存代码 |
| REQ-017 | `mcp-server.ts:640-659` | `top_k: 5` 硬编码 |
| REQ-018 | `src/store/vectors.ts` | 只有 `MemoryVectorStore`，无 Provider 抽象 |
| REQ-019 | `auth.ts` + `encryption.ts` | 默认均 disabled，Keychain 是占位代码 |
| REQ-020 | `migrate.ts` | 只有 CREATE TABLE IF NOT EXISTS + --reset |
| REQ-022 | `mcp-server.ts:977` | `get_memory_health` 未调用 `health.ts:checkHealth()` |
