# MiniMem 领域隔离能力增强需求单

## 基本信息

| 字段 | 内容 |
|------|------|
| **需求编号** | MINIMEM-001 |
| **标题** | MiniMem 缺乏架构级的领域隔离能力 |
| **优先级** | P1 — 高 |
| **提出日期** | 2026-04-22 |
| **最后更新** | 2026-04-22 |
| **需求类型** | 架构增强 |
| **影响范围** | 数据库 Schema / 写入链路 / 查询层 / 晋升链路 / 生命周期 / Dream Engine / Surface Files / MCP API / REST API / 向量存储 |

---

## 1. 背景与问题

### 1.1 现状

MiniMem 当前是**纯单用户、无领域分类**的架构。所有记忆（memories）、体验（experiences）、日志、Surface Files 均存储在同一个扁平空间中，没有任何维度进行逻辑隔离。

### 1.2 核心问题

当用户将 MiniMem 用于**多场景混合使用**时（如同时管理工作记忆和个人记忆），会出现以下问题：

| 问题 | 影响 | 严重程度 |
|------|------|---------|
| **记忆检索污染** | 搜索工作相关记忆时，个人/生活记忆混入结果，降低检索精度 | 高 |
| **Dream 引擎无法聚焦** | 做梦时将所有领域的记忆混合处理，生成的洞察缺乏领域针对性 | 高 |
| **日报/周报/月报无法按领域生成** | `get_summary` 只能生成全量总结，无法按"工作"/"个人"分别输出 | 高 |
| **Surface Files 无分域** | `me.md` 是全局唯一，无法区分"工作中的我"和"生活中的我" | 中 |
| **Owner Preference 无分域** | 偏好设置全局生效，无法按领域设置不同偏好（如工作用正式语气，个人用轻松语气） | 中 |

### 1.3 代码级证据

通过对 MiniMem 源码的全面分析，确认以下事实：

- **数据库 Schema**：28 张表 + 1 张 FTS5 虚拟表，**0 个领域/租户字段**
- **memories 表**：无 `domain`、`category`、`scope` 等字段，只有 `tags`（用户自定义标签，非结构化）
- **experiences 表**：只有 `branch` 字段（值固定为 `main`），无领域区分
- **owner_profile 表**：全局 KV 存储，无 owner 分域
- **向量存储**：进程级单例 `Map`，搜索时遍历全量，无过滤维度
- **Dream Engine**：`WHERE branch = 'main'` 直接查全量 experiences，无领域过滤
- **get_summary**：生成日/周/月总结时查全量记忆，无法指定领域
- **Perception（写入入口）**：`ingestMemory()` 无领域参数
- **Consolidation（晋升链路）**：L1→L2→L3→L4 晋升时无领域传播
- **Lifecycle（GC + 温度衰减）**：遍历全量记忆，无按领域过滤能力
- **Social 模块**：persona-builder、relationships 查询全量 experiences

---

## 2. 需求描述

### 2.1 目标

在 MiniMem 中引入**架构级的领域（Domain）隔离能力**，使得：

1. 每条记忆可以归属于一个明确的领域
2. 检索、做梦、总结等核心操作可以按领域过滤
3. 不同领域的数据在逻辑上相互隔离，物理上共享存储
4. API 兼容：不传 `domain` 参数时写入默认 `'default'`，查询搜索全部领域

### 2.2 非目标

- ❌ 不做多用户/多租户（MiniMem 仍然是单用户架构）
- ❌ 不做物理隔离（不需要每个领域一个数据库）
- ❌ 不做权限控制（不需要"谁能访问哪个领域"）
- ❌ 不做跨领域关联分析（第一期不做，可后续扩展）
- ❌ 不做旧数据迁移（可以接受 `--reset` 重建数据库，旧数据可抛弃）

### 2.3 数据策略

**本次升级采用"破坏性升级"策略**：直接在 `schema.ts` 建表语句中加入 `domain` 字段，通过 `--reset` 重建数据库。不需要编写增量迁移脚本，不需要保留旧数据。

理由：
- 当前处于早期开发阶段，数据量有限
- 省去增量迁移框架的开发成本
- 向量存储二进制格式也无需向后兼容，直接重建即可

---

## 3. 详细设计要求

### 3.1 数据库 Schema 变更

> **注意**：以下变更直接修改 `src/store/schema.ts` 中的建表语句，不使用 `ALTER TABLE`。

#### 3.1.1 memories 表

```sql
-- 在 CREATE TABLE memories 中新增字段
domain TEXT NOT NULL DEFAULT 'default'

-- 新增索引
CREATE INDEX idx_memories_domain ON memories(domain);

-- 复合索引（域+时间，用于按域查询最近记忆）
CREATE INDEX idx_memories_domain_created ON memories(domain, created_at);
```

#### 3.1.2 experiences 表

```sql
-- 在 CREATE TABLE experiences 中新增字段
domain TEXT NOT NULL DEFAULT 'default'

CREATE INDEX idx_experiences_domain ON experiences(domain);
```

#### 3.1.3 FTS5 虚拟表

```sql
-- FTS5 虚拟表（memory_fts）无需修改结构
-- 已包含 memory_id 字段，搜索时通过 memory_id JOIN 回 memories 主表过滤 domain
-- 查询模式：先 FTS5 搜索 → 用 memory_id JOIN memories → WHERE domain = ?
```

#### 3.1.4 新增 domains 元数据表

```sql
CREATE TABLE IF NOT EXISTS domains (
    name        TEXT PRIMARY KEY,       -- 领域名称，如 'work', 'personal', 'side-project'
    label       TEXT,                   -- 显示名称，如 '工作', '个人'
    description TEXT,                   -- 领域描述
    color       TEXT,                   -- UI 用颜色标识（可选）
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 预置默认领域
INSERT INTO domains (name, label, description) VALUES
    ('default', '默认', '未分类记忆的默认领域'),
    ('work', '工作', '工作相关的记忆和体验'),
    ('personal', '个人', '个人生活相关的记忆');
```

### 3.2 MCP API 变更

#### 3.2.1 add_memory — 新增 `domain` 参数

```typescript
// 现有参数不变，新增：
{
  domain?: string  // 可选，默认 'default'
}
```

#### 3.2.2 search_memory — 新增 `domain` 过滤

```typescript
// 现有参数不变，新增：
{
  domain?: string | string[]  // 可选，支持单个或多个领域
                               // 不传 = 搜索全部领域
                               // 传 ['work'] = 仅搜索工作领域
}
```

#### 3.2.3 get_summary — 新增 `domain` 过滤

```typescript
// 现有参数不变，新增：
{
  domain?: string  // 可选，按领域生成总结
}
```

#### 3.2.4 trigger_dream — 新增 `domain` 过滤

```typescript
// 现有参数不变，新增：
{
  domain?: string  // 可选，仅对指定领域的记忆做梦
}
```

#### 3.2.5 新增 MCP 工具（Phase 1 精简版）

| 工具名 | 功能 | 阶段 |
|--------|------|------|
| `list_domains` | 列出所有已注册的领域 | Phase 1 |
| `create_domain` | 创建新领域 | Phase 1 |
| `update_domain` | 更新领域信息（label、description 等） | Phase 2+ |
| `delete_domain` | 删除领域（需处理该领域下的记忆迁移） | Phase 3+ |
| `move_memories_domain` | 批量将记忆从一个领域迁移到另一个领域 | Phase 3+ |

> **Phase 1 只实现 `list_domains` + `create_domain`**，MVP 够用。`delete_domain` 和 `move_memories_domain` 是极低频操作，推迟到后续阶段。

#### 3.2.6 MCP Auth 风险分级

新增的 MCP 工具需要加入 `src/gateway/mcp-auth.ts` 的 `TOOL_RISK_MAP`：

```typescript
// 新增到 TOOL_RISK_MAP
list_domains: 'read',
create_domain: 'write',
update_domain: 'write',        // Phase 2+
delete_domain: 'dangerous',    // Phase 3+
move_memories_domain: 'dangerous',  // Phase 3+
```

### 3.3 向量存储变更

当前 `MemoryVectorStore` 使用纯内存 `Map<string, VectorEntry>`，`VectorEntry` 结构为：

```typescript
interface VectorEntry {
  id: string;
  memoryId: string;
  memoryType: string;  // 'L1' | 'L2' | 'L3' | 'L4'
  vector: Float32Array;
  norm: number;
  metadata: Record<string, unknown>;
}
```

**方案**：在 `VectorEntry.metadata` 中存储 `domain` 字段，搜索时在余弦相似度计算循环中加入 `metadata.domain` 前过滤。改动最小，不影响现有接口结构。

```typescript
// 写入时
metadata: { ...existing, domain: 'work' }

// 搜索时（在遍历 Map 计算相似度前）
if (filterDomain && entry.metadata.domain !== filterDomain) continue;
```

> 由于不需要兼容旧数据，向量存储重建时会自然带上 domain 字段。

### 3.4 Dream Engine 变更

模块路径：`src/modules/dream/`

- `consolidateExperiences()` 增加 `domain` 参数
- 做梦时只处理指定领域的 experiences
- 梦的产出（洞察）也带上 `domain` 标记

### 3.5 Surface Files 变更

模块路径：`src/surface/`

- `me.md` 保持全局（个人基本信息不分域）
- 新增 `me-{domain}.md`（如 `me-work.md`），存放特定领域的补充信息
- `load_surfaces` 可传入 `domain` 参数，返回全局 + 指定领域的 Surface Files

### 3.6 受影响的其他模块

以下模块在需求文档主体中未单独列出设计，但在实现时**必须适配 domain**：

| 模块 | 文件路径 | 需要做的改动 |
|------|---------|-------------|
| **Perception（写入入口）** | `src/core/perception.ts` | `ingestMemory()` 新增 domain 参数，所有记忆入口携带 domain |
| **Consolidation（晋升链路）** | `src/core/consolidation.ts` | L1→L2→L3→L4 晋升时 domain 跟随传播 |
| **Lifecycle — GC** | `src/lifecycle/index.ts` | GC 遍历和温度衰减需支持按 domain 过滤（或至少在结果中保留 domain） |
| **Lifecycle — Forget** | `src/lifecycle/forget.ts` | `forgetAbout()` 需支持 domain 限定范围 |
| **Knowledge Pages** | `src/store/knowledge-pages/` | 知识页面可能需要关联 domain |
| **REST API** | `src/gateway/rest-api.ts` | 与 MCP API 同样需要加 domain 参数 |
| **索引系统** | `src/store/indexes.ts` | condition_index 查询需适配 domain |
| **Social 模块** | `src/modules/social/` | persona-builder、relationships 查询需支持 domain 过滤 |
| **Work 模块** | `src/modules/work/daily-summary.ts` | 每日/每周总结需支持 domain |

### 3.7 领域归属判定策略

记忆写入时如何确定其所属领域，是整个领域隔离方案的**核心环节**。采用**三级优先级链**策略（MVP 阶段）：

```
显式传入 domain > 来源规则推断 > 默认 'default'
```

> **AI 自动分类（Level 3）标记为可选/Phase 3+**。对于主场景（SRE 工作智能总结），80%+ 的记忆来自 project-memory 联动，Level 1/2 已可 100% 命中，AI 分类暂不必要。

判定流程：

```
                    ┌─────────────────────┐
                    │   add_memory 调用    │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │  传了 domain 参数？   │
                    └──┬──────────────┬───┘
                      Yes            No
                       │              │
                  直接使用      ┌──────▼──────────┐
                              │ 来源能推断吗？     │
                              │ (project-memory   │
                              │  → work)          │
                              └──┬───────────┬───┘
                                Yes          No
                                 │            │
                            使用推断      fallback
                                         'default'
```

#### 3.7.1 Level 1：客户端显式传入（最高优先级）

调用方在 `add_memory` 时直接传入 `domain` 参数，系统直接使用，不做任何推断。

```typescript
add_memory({ content: "完成了 CI/CD 流水线优化", domain: "work" })
```

**适用场景**：
- 自动化 pipeline（如 project-memory 联动、git commit 采集）中写死 domain
- 用户通过 UI 手动选择领域

#### 3.7.2 Level 2：来源规则推断

当未传 `domain` 时，根据记忆的**来源（source/client）** 和**关键词**进行规则匹配：

```typescript
// 来源 → 领域映射规则（可配置，存储在 domains 表或配置文件中）
const sourceRules: DomainRule[] = [
  // 按来源直接映射
  { domain: 'work',     sources: ['project-memory', 'codebuddy'] },
  { domain: 'personal', sources: ['manual-journal'] },

  // 按关键词匹配（兜底）
  { domain: 'work',     keywords: ['部署', '上线', 'PR', 'code review', '需求',
                                    'SRE', '告警', '监控', '发布', '迭代', '排障'] },
  { domain: 'personal', keywords: ['健身', '读书', '旅行', '家庭', '理财',
                                    '电影', '音乐', '美食', '运动'] },
];
```

**特点**：零延迟、零成本、完全可控，但需要维护规则

#### 3.7.3 Level 3：AI 自动分类（可选 / Phase 3+）

> ⚠️ **此功能标记为可选，不在 MVP 阶段实现**。当 Level 1/2 无法满足需求时再考虑。

当规则无法判定时，调用 LLM 做一次轻量分类：

```typescript
async function classifyDomain(content: string, domains: Domain[]): Promise<{ domain: string; confidence: number }> {
  const domainList = domains.map(d => `${d.name}(${d.label}: ${d.description})`).join(', ');
  const prompt = `已注册的领域：${domainList}\n\n请判断以下内容属于哪个领域，返回 JSON {domain, confidence}：\n"${content}"`;
  // 调用 LLM...
}
```

- 置信度 > 0.8 → 使用分类结果
- 置信度 ≤ 0.8 → fallback 到 `'default'`
- 可配置是否启用此级别（避免不必要的 LLM 开销）

#### 3.7.4 Level 4：默认 fallback

所有策略都无法判定时，归入 `'default'` 领域。用户可以后续通过 `move_memories_domain` 手动调整。

#### 3.7.5 实际场景覆盖分析

| 记忆来源 | 判定级别 | domain | 预估准确率 |
|----------|---------|--------|-----------|
| project-memory 工作沉淀 → 上传 MiniMem | Level 1（来源写死） | `work` | 100% |
| CodeBuddy 工作对话中 AI 帮记录 | Level 2（来源规则） | `work` | ~98% |
| 用户手动让 AI 记录个人内容 | Level 4（fallback → default） | `default` | N/A |
| 自动化采集（git/CI 等） | Level 1（pipeline 配置） | `work` | 100% |
| 来源和内容都模糊的记忆 | Level 4（fallback） | `default` | N/A |

> **注**：对于主场景（SRE 工作智能总结），80%+ 的记忆来自 project-memory 联动，天然命中 Level 1/2，无需 AI 分类。不确定的记忆先进 `default`，用户后续可手动调整。

#### 3.7.6 配置化要求

领域判定规则应**可配置**，不硬编码：

```toml
# config.local.toml 示例
[domain.rules]
# 来源映射
[domain.rules.source_map]
"project-memory" = "work"
"codebuddy" = "work"
"manual-journal" = "personal"

# AI 自动分类（Phase 3+ 可选功能）
[domain.rules.ai_classify]
enabled = false                 # MVP 阶段默认关闭
confidence_threshold = 0.8
```

---

## 4. 兼容性要求

| 场景 | 处理方式 |
|------|---------|
| API 调用不传 `domain` | 写入时默认 `'default'`，查询时搜索全部领域 |
| 旧版 MCP 客户端 | 完全兼容，表现与升级前一致（均为 default 领域） |
| tags 与 domain 的关系 | `domain` 是一级分类（架构级），`tags` 是二级标签（用户自定义），两者正交 |

> **注**：本次不做旧数据迁移。升级后通过 `--reset` 重建数据库，旧数据清空。

---

## 5. 验收标准

### 5.1 功能验收

- [ ] `add_memory` 支持传入 `domain`，未传时默认 `'default'`
- [ ] `search_memory` 支持 `domain` 过滤，搜索结果仅包含指定领域
- [ ] `get_summary` 支持按领域生成独立总结
- [ ] `trigger_dream` 支持按领域做梦，洞察产出带有领域标记
- [ ] `list_domains` / `create_domain` 正常工作
- [ ] 向量搜索支持 domain 过滤，不会返回其他领域的记忆
- [ ] 领域归属判定链正常工作（显式传入 > 来源规则 > 默认 fallback）
- [ ] 来源规则可通过配置文件自定义
- [ ] project-memory 来源的记忆自动归属 `work` 领域
- [ ] Perception 写入链路正确传递 domain
- [ ] Consolidation 晋升链路 domain 跟随传播

### 5.2 兼容性验收

- [ ] 不传 `domain` 参数时，所有 API 行为与升级前一致
- [ ] 旧版 MCP 客户端连接后功能正常
- [ ] `--reset` 重建数据库后所有功能正常

### 5.3 性能验收

- [ ] 带 `domain` 过滤的查询不慢于无过滤查询（索引保证）
- [ ] 向量搜索在 domain 过滤后遍历量显著减少
- [ ] 10,000 条记忆、5 个领域场景下，搜索响应 < 200ms

---

## 6. 用户场景示例

### 场景 1：工作智能总结

```
用户: "帮我总结这周的工作"
→ get_summary(period="weekly", domain="work")
→ 只包含工作领域的记忆，不掺杂个人生活内容
```

### 场景 2：个人复盘

```
用户: "回顾我最近的个人目标进展"
→ search_memory(query="个人目标 进展", domain="personal")
→ 只返回个人领域的相关记忆
```

### 场景 3：工作做梦（深度洞察）

```
用户: "对我最近的工作做一次深度分析"
→ trigger_dream(domain="work")
→ Dream Engine 只处理工作领域的 experiences
→ 产出的洞察聚焦于工作模式和趋势
```

### 场景 4：全局视角

```
用户: "我最近都做了什么？"
→ search_memory(query="最近做了什么")  // 不传 domain
→ 返回所有领域的记忆，全景展示
```

---

## 7. 实现建议

### 7.1 分阶段实施

| 阶段 | 内容 | 工作量估计 |
|------|------|-----------|
| **Phase 1** | Schema 变更（直接改建表语句）+ `domain` 字段读写 + `list_domains` / `create_domain` | 0.5-1 天 |
| **Phase 2** | 核心链路适配：Perception 写入 + Consolidation 晋升 + 核心 API（add/search/summary）支持 domain 过滤 | 3-4 天 |
| **Phase 3** | Dream Engine 支持 domain + Lifecycle（GC/Forget）适配 | 2-3 天 |
| **Phase 4** | 向量搜索 domain 前过滤 + Surface Files 分域 + Social/Work 模块适配 | 1-2 天 |
| **Phase 5** | 测试 + 文档 | 1.5-2 天 |

**总计：8-12 天**

### 7.2 风险点

| 风险 | 缓解措施 |
|------|---------|
| FTS5 虚拟表不支持直接加列 | 通过 `memory_id` JOIN 回 `memories` 主表过滤 domain，无需修改 FTS5 结构 |
| 向量存储内存增长 | 在 `VectorEntry.metadata` 中存 domain，搜索时前过滤，改动最小 |
| 用户忘记传 domain | 默认 `'default'`，查询默认全部，体验不退化 |
| domain 命名冲突 | domains 表主键约束 + 创建时校验 |
| SQL 查询改动面广（46+ 处 `WHERE branch = 'main'`） | 逐一审查，优先改高频路径 |

---

## 8. 关联需求

- **个人工作智能总结系统**（主需求）：依赖此能力实现"按工作领域生成周报/月报"
- **Project Memory 联动**：CodeBuddy project-memory 沉淀的内容上传 MiniMem 时，自动打上 `domain=work` 标签

---

## 附录：当前 MiniMem 架构快照

```
minimem/
├── src/
│   ├── index.ts               ← 应用入口（启动 MCP Server + REST API）
│   ├── cli/
│   │   └── index.ts           ← CLI 入口（参数解析、--reset 等）
│   ├── config/
│   │   ├── index.ts           ← 配置加载（TOML → 合并）
│   │   └── schema.ts          ← 配置 schema 校验
│   ├── core/
│   │   ├── perception.ts      ← 写入入口：ingestMemory()
│   │   ├── processing.ts      ← 记忆提取与处理
│   │   ├── consolidation.ts   ← L1→L2→L3→L4 晋升
│   │   └── onboarding.ts      ← 新用户引导
│   ├── gateway/
│   │   ├── mcp-server.ts      ← MCP Server + Tool handler（44KB，核心文件）
│   │   ├── mcp-auth.ts        ← MCP 认证鉴权 + TOOL_RISK_MAP
│   │   ├── rest-api.ts        ← REST API 端点
│   │   ├── auth.ts            ← 通用认证
│   │   ├── audit.ts           ← 审计日志
│   │   └── rate-limiter.ts    ← 速率限制
│   ├── store/
│   │   ├── schema.ts          ← 28 张表定义，0 个 domain 字段
│   │   ├── database.ts        ← SQLite 单例初始化
│   │   ├── migrate.ts         ← 简单迁移（全量建表 / --reset 删库重来）
│   │   ├── vectors.ts         ← MemoryVectorStore（纯内存 Map）
│   │   ├── experiences.ts     ← experiences 表操作
│   │   ├── indexes.ts         ← condition_index + memory_fts
│   │   ├── knowledge-pages/   ← 知识页面存储
│   │   └── ...                ← backup, encryption, graph, integrity 等
│   ├── retrieval/
│   │   └── search.ts          ← 六路混合搜索引擎（语义+关键词+图遍历+时间+条件索引+知识页面）
│   ├── lifecycle/
│   │   ├── index.ts           ← GC + 温度衰减调度
│   │   ├── forget.ts          ← forgetAbout() 遗忘
│   │   ├── promotion.ts       ← 晋升
│   │   ├── demotion.ts        ← 降级
│   │   ├── compressor.ts      ← 压缩
│   │   └── ...                ← health, recovery
│   ├── modules/
│   │   ├── dream/             ← Dream Engine（7 个文件）
│   │   ├── social/            ← 社交模块（persona, relationships, topic）
│   │   └── work/              ← 工作模块（daily-summary, weekly-review, tasks）
│   ├── surface/
│   │   ├── index.ts           ← Surface Files 管理
│   │   ├── sync.ts            ← Surface 同步
│   │   └── syncers/           ← me, work, life, social, soul, context syncers
│   ├── owner/                 ← profile, preferences, persons
│   ├── llm/                   ← LLM client + prompts
│   ├── scheduler/             ← 定时任务调度
│   ├── sdk/                   ← SDK 封装
│   └── version/               ← 版本管理（snapshot, branch, diff, merge）
├── config.default.toml
├── config.local.toml
└── data/
    └── minimem.db             ← 单一 SQLite 文件
```
