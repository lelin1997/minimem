# MiniMem 认知引擎优化 需求单

## 基本信息

| 字段 | 内容 |
|------|------|
| **需求编号** | MINIMEM-003 |
| **标题** | 认知引擎八项优化：从暴力搜索到智能记忆 |
| **优先级** | P0-P3 分层（详见优先级矩阵） |
| **提出日期** | 2026-04-23 |
| **最后更新** | 2026-04-23 |
| **需求类型** | 基础架构 + 认知质量 + 性能优化 |
| **影响范围** | 向量存储 / Dream Engine / 编译管线 / 生命周期管理 / 检索引擎 / 配置系统 |
| **前置需求** | 无硬性前置，P0 项建议优先实施 |

---

## 1. 优先级矩阵

| # | 优化项 | 影响域 | 难度 | 优先级 | 状态 |
|---|--------|--------|------|--------|------|
| ① | HNSW/Qdrant 向量索引 | 🔴 性能 | 中 | **P0**（数据量增长后必须） | 待实施 |
| ② | 多步向量漫游 | 🟡 Dream 质量 | 中 | **P1** | 待实施 |
| ③ | L2→L3 语义去重 | 🟡 数据质量 | 低 | **P1** | 待实施 |
| ④ | 时间衰减支撑度 | 🟡 漂移检测准确性 | 低 | **P1** | 待实施 |
| ⑤ | MMR 种子采样 | 🟢 Dream 多样性 | 低 | **P2** | 待实施 |
| ⑥ | 迭代联想 | 🟢 Dream 深度 | 中 | **P2** | 待实施 |
| ⑦ | 遗忘曲线建模 | 🟢 记忆管理 | 中 | **P2** | 待实施 |
| ⑧ | 自顶向下编译 | 🟢 认知闭环 | 高 | **P3** | 待实施 |

---

## 2. 现状分析与差距

### ① HNSW/Qdrant 向量索引

**现状**：`MemoryVectorStore`（`src/store/vectors.ts`）使用 `Map<string, VectorEntry>` 内存存储，搜索时**线性遍历所有向量**（O(n)），逐一计算余弦相似度。唯一优化是预计算 L2 范数。

**Qdrant Provider** 已有框架实现（`src/store/qdrant-provider.ts`），但初始化方式是 hack：同步返回 MemoryVectorStore，后台异步 import 替换。生产可用性不足。

**差距**：
- 内存后端没有任何 ANN 索引（无 HNSW、无 IVF）
- 1000 条向量时无感知，10000 条时搜索延迟开始可观，50000+ 条时成为严重瓶颈
- Qdrant 集成不够生产级（异步替换 race condition、无健康检查、无重连）

**目标**：
1. 内存后端引入 **HNSW 近似最近邻索引**，搜索复杂度 O(log n)
2. Qdrant Provider 升级为生产级集成（异步初始化、健康检查、自动重连）
3. 自动选择：向量数 < 5000 时用暴力扫描（精确），> 5000 时启用 HNSW

---

### ② 多步向量漫游

**现状**：`MemoryVectorStore.randomWalk()`（`src/store/vectors.ts:157`）名为"漫游"实为**单步过滤**——对查询向量做一次全量扫描，过滤 similarity ∈ [minSim, maxSim] 的候选，随机取 N 个。`vectorWalkSteps` 参数实际含义是"返回数量"而非"步数"。

```
当前: seed → [单次全量扫描] → 随机N个结果
目标: seed → hop1 → hop2 → hop3  (每一跳以上一跳结果为新查询向量)
```

**差距**：
- 不是真正的"向量空间漫步"（random walk in embedding space）
- 无法发现间接关联（A→B→C 中 A 和 C 可能相似度很低，但通过 B 可以联通）
- Dream Phase 3 的联想深度受限

**目标**：
1. 实现真正的多步向量漫游：每一跳以上一跳最有趣的结果作为新查询
2. 漫游路径记录：保存完整的漫游轨迹（seed → hop1 → hop2 → ...）供联想分析
3. 参数语义纠正：`vectorWalkSteps` 改为真正的步数（hops），新增 `vectorWalkBreadth` 控制每步宽度

---

### ③ L2→L3 语义去重

**现状**：

| 层级 | 去重方式 | 代码位置 | 问题 |
|------|---------|----------|------|
| L1 摄入 | content_hash 精确匹配 | `perception.ts:79` | ✅ 够用 |
| L1→L2 | 三元组精确匹配 | `processing.ts:89` | ❌ 措辞不同即绕过 |
| L2→L3 | `LIKE '%{subject}%'` | `consolidation.ts:64` | ❌ 极粗糙 |
| L3→L4 | 标题精确匹配 | `consolidation.ts:211` | ❌ 标题不同即绕过 |

**差距**：
- "喜欢 TypeScript" vs "偏好 TypeScript" → 两条 L2 → 两条几乎相同的 L3
- 随时间积累，同义观察越来越多，浪费存储和 LLM 调用
- Dream 联想中重复记忆降低信噪比

**目标**：
1. L2→L3 编译前增加**向量语义去重**：新观察与已有观察余弦相似度 > 0.85 时合并而非新建
2. L3→L4 晋升前增加**语义相似度检查**：与已有模型相似度 > 0.9 时增强而非新建
3. 可选：L1→L2 事实提取时增加模糊三元组匹配

---

### ④ 时间衰减支撑度

**现状**：

温度衰减（`lifecycle/index.ts:77`）：
```typescript
// 每 6 小时，所有非 pinned 记忆 score -= 2（固定值）
UPDATE memory_temperature SET score = MAX(0, score - ?) WHERE pinned = 0
```

信念漂移检测（`drift-detector.ts:65`）只检查支撑度数量（活跃 L2 < 2），**不考虑时间因素**。

**差距**：
- 线性固定衰减不区分"1天前访问"和"1个月前访问"
- 漂移检测不考虑支撑事实的时效性（1年前的支撑和今天的支撑权重相同）
- 高频短期记忆和低频长期记忆用同一衰减速率

**目标**：
1. **时间感知衰减**：衰减量 = f(距上次访问时间)，而非固定值
   - 建议公式：`decay = baseRate * ln(1 + hoursSinceLastAccess / 24)`
   - 近期访问的记忆衰减慢，长期未访问的衰减快
2. **支撑度时间加权**：漂移检测中，支撑事实权重按时间衰减
   - 建议公式：`support_weight = confidence * exp(-λ * daysSinceCreated)`
   - λ 可配置，默认 0.01（~70 天半衰期）
3. 配置：`[gc] decay_function = "logarithmic"` 和 `[dreaming] support_decay_lambda = 0.01`

---

### ⑤ MMR 种子采样

**现状**：Dream Phase 3 种子选择（`dreamer.ts:71`）：
```sql
SELECT id, raw_content, importance FROM experiences
WHERE branch = 'main' AND created_at >= ?
ORDER BY RANDOM() LIMIT ?
```
纯 `RANDOM()` 抽取，importance 字段虽然 SELECT 了但未参与排序。

**差距**：
- 如果最近 24h 记忆集中在同一话题，种子可能全部聚集
- 重要记忆（importance=0.9）和琐碎记忆（importance=0.1）被选中概率相同
- 做梦质量取决于种子多样性，单一种子 = 单调联想

**目标**：
1. 实现 **MMR（Maximal Marginal Relevance）种子选择**：
   - 第一颗种子：importance 最高的记忆
   - 后续种子：`MMR(d) = λ * importance(d) - (1-λ) * max_sim(d, selected)`
   - λ=0.5（平衡重要性和多样性）
2. 确保种子覆盖不同主题/实体/领域
3. 配置：`[dreaming] seed_selection = "mmr"` (可选 "random" 保持兼容)

---

### ⑥ 迭代联想

**现状**：Dream Phase 3 流程（`dreamer.ts:53`）是**单轮执行**：
```
种子 → 向量漫游(单步) → 图遍历(多步BFS) → 跨层配对 → LLM联想 → 完成
```
不会将联想结果作为新种子再进行第二轮。

**差距**：
- 人类做梦是反复深入的：一个联想引发更多联想
- 当前只能发现"一步之遥"的联系，无法发现需要多步推理才能到达的深层洞察
- 联想的深度受限于单轮 LLM 调用的能力

**目标**：
1. 实现 **2-3 轮迭代联想**：
   - Round 1：标准联想流程（现有逻辑）
   - Round 2：将 Round 1 中 novelty ≥ 0.7 的洞察作为新种子，再次执行向量漫游+LLM联想
   - Round 3（仅 weekly）：继续深入
2. 迭代终止条件：novelty 均 < 0.5 或达到最大轮数
3. 联想结果标注 `depth`（第几轮发现），深层联想 novelty 加权提升
4. 配置：`[dreaming] max_dream_iterations = 2`（daily）/ `3`（weekly）

---

### ⑦ 遗忘曲线建模

**现状**：
- **零 Ebbinghaus 实现**，搜索 "forgetting", "ebbinghaus", "spaced repetition" 在源码中零匹配
- 记忆衰退完全依赖线性温度扣分 + GC 配额清理
- `forget.ts` 是用户主动遗忘功能，不是自动遗忘

**差距**：
- 无法模拟人类"先快后慢"的遗忘规律
- 重要但长时间未被检索的记忆，和不重要的记忆衰减速率相同
- 没有"间隔复习"机制——被检索过的记忆应该更持久

**目标**：
1. 引入 **Ebbinghaus 遗忘曲线**：
   - 记忆保留率：`R = e^(-t/S)`，S = 记忆稳定性
   - S 初始值 = f(importance, layer)：L4 > L3 > L2 > L1
   - 每次被检索，S 增大（间隔效应）：`S_new = S * (1 + α * ln(1 + interval / S))`
2. 温度衰减改用遗忘曲线驱动：
   - `score = initial_score * R` 代替 `score -= fixedRate`
3. **复习效应**：被检索的记忆不仅升温，还增强稳定性
4. 在 `memory_temperature` 表新增 `stability` 和 `review_count` 字段
5. 配置：`[gc] decay_model = "ebbinghaus"` (可选 "linear" 保持兼容)

---

### ⑧ 自顶向下编译

**现状**：编译方向完全是 **bottom-up**：
```
L1 → L2 → L3 → L4    ← 唯一方向
     extractFacts  distillObs  promoteMentalModels
```
- L4 心智模型**不会向下影响** L3/L2 的生成或修正
- 新 L2 事实写入时不检查是否与已有 L4 原则矛盾
- 搜索 "top-down"、"自顶向下" 在源码中零匹配

**差距**：
- 如果用户已经有 L4 原则 "偏好函数式编程"，新进来一条 L1 "今天用了面向对象写了个模块"，系统无法自动产生"这可能是例外情况"的认知
- L4 原则只是被动存储，不主动指导低层记忆的组织和解读
- 缺少认知一致性检查——低层记忆可能与高层信念矛盾而不被发现

**目标**：
1. **L4→L3 一致性校验**：L3 观察生成时，检查是否与活跃 L4 原则矛盾
   - 矛盾时创建 `conflict_resolution` compile_queue 条目
   - 高置信度矛盾 → 可能需要修订 L4 原则
2. **L4 指导 L2→L3 提炼**：将 L4 原则作为提炼 prompt 的上下文
   - 使 LLM 在归纳 L3 时考虑已有的高层信念
3. **L4 验证 L1 摄入**：新 L1 写入时，快速匹配相关 L4 原则
   - 矛盾标记 `importance += 0.2`（矛盾记忆更重要）
   - 支撑标记 `importance += 0.1`
4. 配置：`[dreaming] top_down_compile = true`

---

## 3. 设计决策

### 3.1 渐进式实施 vs 一次性重构

**决策**：渐进式实施。8 个优化项相互独立性强，按优先级分批落地。

**理由**：
- P0（HNSW）是性能刚需，数据量增长后必须有
- P1（多步漫游 + 语义去重 + 时间衰减）是质量基础，直接提升现有功能
- P2（MMR + 迭代 + 遗忘曲线）是认知升级，锦上添花
- P3（top-down）是架构变革，需要充分验证

### 3.2 HNSW 实现策略

**方案 A**：内置 HNSW（纯 TypeScript 实现）
- 优点：零依赖，开箱即用
- 缺点：性能不如 C++ 实现，维护成本高

**方案 B**：hnswlib-node（Node.js binding）
- 优点：性能优异（C++ 核心）
- 缺点：引入 native 依赖

**方案 C**：强化 Qdrant 集成
- 优点：生产级 ANN + 自带 HNSW
- 缺点：需要外部服务

**决策**：**方案 A 为主 + 方案 C 为辅**。内置轻量 HNSW 作为默认后端（无需外部依赖），Qdrant 升级为生产级可选后端（大规模部署用）。

### 3.3 遗忘曲线 vs 线性衰减

**决策**：遗忘曲线为默认，线性衰减保留为兼容选项。

**理由**：
- Ebbinghaus 模型更贴近人类认知，对用户体验提升明显
- 通过 `decay_model` 配置项平滑切换，不 break 现有行为

### 3.4 自顶向下编译的切入点

**决策**：从 L4→L3 一致性校验 + L4 作为编译上下文 两个最小切入点开始。

**理由**：
- 完整的 top-down 编译是大工程
- 先让 L4 原则在编译 prompt 中可见，再逐步增强
- 不改变现有编译管线的主体结构

---

## 4. 详细设计

### 4.1 HNSW 索引 — 数据结构

```typescript
// src/store/hnsw-index.ts

interface HNSWConfig {
  M: number;              // 每层最大连接数，默认 16
  efConstruction: number; // 构建时搜索宽度，默认 200
  efSearch: number;       // 查询时搜索宽度，默认 50
  maxLevel: number;       // 最大层级，默认 auto = ln(n)
}

interface HNSWNode {
  id: string;
  vector: Float32Array;
  neighbors: Map<number, string[]>; // level → neighbor IDs
  level: number;
}

class HNSWIndex {
  // 核心方法
  insert(id: string, vector: Float32Array): void;
  search(query: Float32Array, topK: number, efSearch?: number): Array<{ id: string; distance: number }>;
  remove(id: string): boolean;

  // 持久化（复用现有二进制格式扩展）
  serialize(): Buffer;
  static deserialize(buf: Buffer): HNSWIndex;
}
```

### 4.2 多步向量漫游 — 算法

```
function multiStepRandomWalk(seed: Float32Array, steps: number, breadth: number):
  trail = [seed]
  for step in 1..steps:
    current = trail[last]
    candidates = vectorStore.search(current, breadth * 3, minSim=0.2, maxSim=0.8)
    // 过滤已访问的
    candidates = candidates.filter(c => !trail.includes(c))
    // 选择最"有趣"的（相似度在 sweet spot 0.3-0.6）
    selected = candidates.sortBy(c => -gaussianWeight(c.similarity, center=0.45, sigma=0.15))
                         .slice(0, breadth)
    trail.push(...selected.vectors)
  return trail  // 完整的漫游轨迹
```

### 4.3 语义去重 — 融合策略

```
function semanticDedup(newContent: string, existingItems: Item[], threshold: number):
  newEmb = embed(newContent)
  for item in existingItems:
    sim = cosine(newEmb, item.embedding)
    if sim > threshold:
      return { action: 'merge', target: item.id, similarity: sim }
  return { action: 'create' }
```

### 4.4 遗忘曲线 — 核心公式

```
// 记忆保留率
R(t) = e^(-t / S)

// 初始稳定性（取决于层级和重要性）
S_initial = {
  L1: 24h  * (1 + importance),
  L2: 72h  * (1 + confidence),
  L3: 168h * (1 + confidence),
  L4: Infinity  // L4 永不自然遗忘
}

// 检索后稳定性增长（间隔效应）
S_after_review = S * (1 + α * ln(1 + interval / S))
  // α = 0.3（学习率），interval = 距上次检索的时间

// 温度分数
score = initial_score * R(t)
```

### 4.5 自顶向下编译 — L4 注入策略

```
// 在 L2→L3 编译时，将相关 L4 原则注入 prompt

function distillObservationsWithL4(subject: string, facts: WorldFact[]):
  // 1. 找到可能相关的 L4 原则
  relevantL4 = searchL4ByKeywords(subject)
  
  // 2. 构建增强 prompt
  prompt = `
    分析以下关于 "${subject}" 的事实，提取观察或模式。
    
    已有的高层原则（参考，不一定适用）：
    ${relevantL4.map(m => `- [${m.model_type}] ${m.title}: ${m.content}`)}
    
    事实列表：
    ${facts.map(f => formatFact(f))}
    
    注意：如果事实与上述原则矛盾，请明确指出。
  `
```

---

## 5. 数据库变更

### 5.1 `memory_temperature` 表扩展

```sql
-- 遗忘曲线相关字段
ALTER TABLE memory_temperature ADD COLUMN stability REAL DEFAULT 24.0;
ALTER TABLE memory_temperature ADD COLUMN review_count INTEGER DEFAULT 0;
ALTER TABLE memory_temperature ADD COLUMN initial_score REAL DEFAULT 50.0;
```

### 5.2 `vector_index_meta` 表（HNSW 元数据）

```sql
CREATE TABLE IF NOT EXISTS vector_index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- 存储: index_type, M, efConstruction, node_count, level_count 等
```

---

## 6. 配置变更

```toml
# config.default.toml 新增/修改

[gc]
# 衰减模型：linear（现有）| logarithmic（时间感知）| ebbinghaus（遗忘曲线）
decay_model = "ebbinghaus"
# 对数衰减基础速率
decay_base_rate = 2
# 遗忘曲线学习率 α
ebbinghaus_alpha = 0.3

[dreaming]
# 种子选择策略：random（现有）| mmr（多样性保证）
seed_selection = "mmr"
# MMR 多样性权重 λ (0=纯多样性, 1=纯重要性)
mmr_lambda = 0.5
# 联想迭代最大轮数（daily/weekly）
max_dream_iterations_daily = 2
max_dream_iterations_weekly = 3
# 自顶向下编译
top_down_compile = true
# 支撑度时间衰减系数 λ
support_decay_lambda = 0.01

[dreaming.dedup]
# 语义去重阈值
l2_to_l3_similarity_threshold = 0.85
l3_to_l4_similarity_threshold = 0.90

[storage.vector]
# HNSW 参数（内存后端使用）
hnsw_m = 16
hnsw_ef_construction = 200
hnsw_ef_search = 50
hnsw_auto_threshold = 5000  # 向量数超过此值自动启用 HNSW
```

---

## 7. 验收标准

### 7.1 性能（P0）

- [ ] 向量数 50,000 时，搜索延迟 < 50ms（当前 O(n) 约 500ms）
- [ ] HNSW 召回率 > 95%（相比暴力搜索 Top-10）
- [ ] 向量索引构建增量化，单条插入 < 1ms

### 7.2 Dream 质量（P1-P2）

- [ ] 多步漫游后，Dream Phase 3 发现的 novelty ≥ 0.7 联想数量提升 ≥ 30%
- [ ] MMR 种子采样下，种子间平均余弦相似度 < 0.4（多样性保证）
- [ ] 迭代联想中，Round 2+ 发现的洞察占总洞察的 ≥ 20%

### 7.3 数据质量（P1）

- [ ] 语义去重启用后，同义 L3 观察数量减少 ≥ 50%
- [ ] 无误合并（相似度阈值 0.85 不会合并语义不同的观察）

### 7.4 记忆管理（P1-P2）

- [ ] 时间感知衰减下，30 天未访问记忆的温度显著低于 7 天未访问
- [ ] 遗忘曲线模型下，被多次检索的记忆稳定性 > 未检索的 3 倍
- [ ] L4 原则永不自然遗忘（稳定性 = Infinity）

### 7.5 认知闭环（P3）

- [ ] L4 原则注入后，L2→L3 提炼生成的观察与 L4 一致性提升
- [ ] 矛盾检测能发现 "L1 事实" 与 "L4 原则" 的不一致
- [ ] 不引入回归（现有编译管线行为不变，top_down_compile 可关闭）

---

## 8. 用户场景

### 场景 1：大规模记忆的性能保证

> 用户积累了 30,000 条记忆。搜索 "我上次和 Alice 聊了什么" 时：
> - **优化前**：向量搜索遍历全部 30,000 条，耗时 ~300ms
> - **优化后**：HNSW 索引定位到 Top-10 只需 ~5ms，整体搜索延迟 < 100ms

### 场景 2：Dream 发现深层联想

> 用户最近记了 3 条记忆：学 Rust、读了一本关于冥想的书、解决了一个并发 bug。
> - **优化前**：种子随机选了 "学 Rust" × 2，联想结果围绕编程
> - **优化后**：MMR 选了 "学 Rust"、"冥想"、"并发 bug" 三颗多样种子
>   - Round 1：发现 "Rust ownership → 冥想中的专注" 类比
>   - Round 2：从类比出发，发现 "专注 → 并发中的 mutex → 资源独占" 深层链
>   - 生成洞察："专注力就像 mutex——一次只能锁定一个任务才能避免冲突"

### 场景 3：遗忘曲线自然淘汰

> 用户 2 个月前记了 "今天午饭吃了麻辣烫"（importance=0.2）：
> - **优化前**：线性衰减，2 个月后 score ≈ 50 - 60*0.33 ≈ 30（还是 cold）
> - **优化后**：S_initial = 24h * 1.2 = 28.8h，60 天后 R = e^(-1440/28.8) ≈ 0，score ≈ 0（frozen，被 GC 回收）
> 
> 而 "偏好函数式编程"（L4, importance=0.9）：S = Infinity，永不遗忘。

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| HNSW 纯 TS 实现性能不够 | P0 优化效果打折 | 基准测试，必要时引入 hnswlib-node |
| 语义去重阈值设错 | 误合并不同语义的记忆 | 初始阈值保守（0.85），提供 dry-run 模式 |
| 遗忘曲线导致有用记忆被遗忘 | 用户找不到历史记忆 | L3/L4 不可物理删除（已有 LAYER_PROTECTION），只降温 |
| top-down 编译引入偏见 | L4 原则强化确认偏误 | 矛盾检测双向：不仅报告矛盾，也提示可能需要修订 L4 |
| 迭代联想增加 LLM 调用 | 成本增加 | 严格终止条件 + cost_limit 控制，daily 最多 2 轮 |
