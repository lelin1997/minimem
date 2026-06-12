# MiniMem 认知管线引擎（Pipeline Engine）需求单（废弃）

## 基本信息

| 字段 | 内容 |
|------|------|
| **需求编号** | MINIMEM-002-PE |
| **标题** | MiniMem 新增可配置认知管线引擎（Pipeline Engine） |
| **优先级** | P1 — 高 |
| **提出日期** | 2026-04-27 |
| **需求类型** | 架构增强 — 新增模块 |
| **前置依赖** | MINIMEM-001（领域隔离）✅ 已完成 |
| **影响范围** | 新增 `src/pipeline/` 模块 + Scheduler 扩展 + 配置体系 + REST API |

---

## 1. 背景与动机

### 1.1 当前状态

MiniMem 的四层记忆金字塔（L1→L2→L3→L4）和做梦引擎（Dream Engine）提供了强大的记忆编译能力。但目前**从记忆到人类可读输出**的链路是硬编码的：

| 现有模块 | 功能 | 问题 |
|----------|------|------|
| `daily-summary.ts` | 查今日记忆 → LLM 生成日报 → 存 DB | 硬编码在 `src/modules/work/`，不可配置 |
| `weekly-review.ts` | 聚合 7 天日报 → LLM 生成周报 → 返回对象 | **已实现但未接入调度器**，不写磁盘 |
| 月报 | — | **完全不存在** |
| 年报 | — | **完全不存在** |

每新增一个"定期从记忆中提炼输出"的场景，都需要：
1. 新写一个 TypeScript 模块
2. 手动注册到 `scheduler/index.ts`
3. 手动加入 `COMPENSATION_RULES`
4. 修改 `SchedulerConfig` 接口

这种方式**不可扩展**，且违反了 MiniMem 作为"记忆 + 认知系统"的产品定位。

### 1.2 目标

引入 **Pipeline Engine（认知管线引擎）**，使得：

1. 新的认知任务（如周报、月报、年报、学习复盘、健康分析等）可以**纯配置定义**，无需写代码
2. 每个 Pipeline 通过 TOML 配置文件 + Prompt 模板文件声明
3. Pipeline Engine 在启动时自动扫描、解析、注册到调度器
4. 执行时自动完成：数据查询 → 上下文组装 → LLM 生成 → 输出持久化
5. 已有的 `daily-summary.ts` 和 `weekly-review.ts` 可以**渐进迁移**为 Pipeline 配置

### 1.3 产品定位调整

> MiniMem 不只是"记忆存取系统"，它是一个 **记忆 + 认知引擎**：
> - **记忆层（Memory）**：存取、检索、关联
> - **编译层（Dream Engine）**：L1→L2→L3→L4 自动编译提炼
> - **认知层（Pipeline Engine）**：可配置的定期认知任务 — 将记忆编译结果格式化为人类可读输出

Pipeline 输出（日报、周报、月报等）本质上是 **L3→L4 的人类可读投影**，不是新功能，而是记忆系统的自然延伸。

---

## 2. 核心概念

### 2.1 架构分层

```
┌──────────────────────────────────────┐
│        Pipeline Engine (新增)        │  ← 可配置的认知任务
│  ┌──────────┐  ┌──────────────────┐  │
│  │ TOML 配置 │  │ Prompt 模板      │  │
│  └──────────┘  └──────────────────┘  │
├──────────────────────────────────────┤
│        Scheduler (已有，需扩展)       │  ← 定时调度基础设施
├──────────────────────────────────────┤
│        Dream Engine (已有，不变)      │  ← L1→L4 自动编译
├──────────────────────────────────────┤
│        Memory Core (已有，不变)       │  ← 存取检索关联
├──────────────────────────────────────┤
│        LLM / Vector / SQLite         │  ← 底层能力
└──────────────────────────────────────┘
```

### 2.2 关键术语

| 术语 | 定义 |
|------|------|
| **Pipeline** | 一个完整的认知任务定义，包含数据源、调度规则、Prompt 模板、输出配置 |
| **Schedule** | Pipeline 内的一个定时执行单元（如"日报"是一个 schedule，"周报"是另一个） |
| **Prompt Template** | Markdown 格式的 LLM prompt 模板，支持变量插值 |
| **Pipeline Run** | 一次 Schedule 的具体执行记录 |

---

## 3. 详细设计要求

### 3.1 Pipeline 配置格式

每个 Pipeline 定义为一个 TOML 文件，存放在 `~/.minimem/pipelines/` 目录下。

#### 3.1.1 完整配置 Schema

```toml
# ~/.minimem/pipelines/{pipeline-id}.toml

[pipeline]
id = "work-summary"                    # 唯一标识符，用于日志和 API
name = "工作智能总结"                    # 人类可读名称
description = "自动生成日报/周报/月报/年报"
enabled = true                          # 总开关

# ── 数据源配置 ──
[pipeline.source]
domain = "work"                         # 限定查询的领域（对应 MINIMEM-001）
                                        # 空字符串 = 不限领域
layers = ["L1", "L2", "L3"]            # 查询的记忆层级
tags_include = []                       # 包含标签（AND）
tags_exclude = []                       # 排除标签

# ── Schedule 定义（一个 Pipeline 可包含多个 Schedule） ──
[[pipeline.schedules]]
id = "daily"                            # 在 Pipeline 内唯一
cron = "0 18 * * 1-5"                  # cron 表达式
window = "today"                        # 数据时间窗口
prompt_template = "daily-summary"       # 对应 prompts/ 目录下的模板
output_path = "reports/daily/{date}.md" # 输出路径（相对于 data_dir）
output_format = "markdown"              # "markdown" | "json" | "both"
depends_on = []                         # 依赖的前级 schedule（空 = 无依赖）
condition = ""                          # 可选：额外执行条件
llm_tier = "medium"                     # LLM 模型层级
llm_temperature = 0.5                   # LLM 温度

[[pipeline.schedules]]
id = "weekly"
cron = "0 17 * * 5"                    # 周五 17:00
window = "7d"
prompt_template = "weekly-review"
output_path = "reports/weekly/{year}-W{week}.md"
depends_on = ["daily"]                  # 聚合本周的日报输出
condition = ""

[[pipeline.schedules]]
id = "monthly"
cron = "0 17 * * 5"                    # 复用周五 17:00
window = "30d"
prompt_template = "monthly-summary"
output_path = "reports/monthly/{year}-{month}.md"
depends_on = ["weekly"]
condition = "last_friday_of_month"      # 仅在月末最后一个周五执行

[[pipeline.schedules]]
id = "annual"
cron = "0 17 * * 5"
window = "365d"
prompt_template = "annual-summary"
output_path = "reports/annual/{year}.md"
depends_on = ["monthly"]
condition = "last_friday_of_december"

# ── 输出配置 ──
[pipeline.output]
save_to_db = true                       # 同时存入 pipeline_runs 表
save_to_disk = true                     # 写文件到 output_path
webhook = ""                            # 可选：生成后 POST 到该 URL
```

#### 3.1.2 字段说明

**`pipeline.source`**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `domain` | string | 否 | 限定查询领域，空字符串 = 全领域 |
| `layers` | string[] | 否 | 限定查询层级，默认 `["L1"]` |
| `tags_include` | string[] | 否 | 包含这些标签的记忆 |
| `tags_exclude` | string[] | 否 | 排除这些标签的记忆 |

**`pipeline.schedules[]`**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | Pipeline 内唯一标识 |
| `cron` | string | ✅ | node-cron 兼容的 cron 表达式 |
| `window` | string | ✅ | 数据时间窗口：`"today"` / `"7d"` / `"30d"` / `"365d"` / `"all"` |
| `prompt_template` | string | ✅ | Prompt 模板名（对应 `prompts/{name}.md`） |
| `output_path` | string | ✅ | 输出文件路径模板，支持变量插值 |
| `output_format` | string | 否 | `"markdown"`（默认）/ `"json"` / `"both"` |
| `depends_on` | string[] | 否 | 依赖的其他 schedule ID |
| `condition` | string | 否 | 额外执行条件（见 3.1.3） |
| `llm_tier` | string | 否 | LLM 模型层级，默认 `"medium"` |
| `llm_temperature` | number | 否 | LLM 温度，默认 `0.5` |

**`pipeline.output`**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `save_to_db` | boolean | 否 | 是否存入 `pipeline_runs` 表，默认 `true` |
| `save_to_disk` | boolean | 否 | 是否写磁盘文件，默认 `true` |
| `webhook` | string | 否 | 生成后 POST 的 webhook URL，空 = 不推送 |

#### 3.1.3 内置执行条件（Condition）

| Condition 值 | 语义 | 判定逻辑 |
|--------------|------|---------|
| `""` (空) | 无条件，cron 触发即执行 | — |
| `last_friday_of_month` | 本月最后一个周五 | `下个周五的月份 ≠ 当前月份` |
| `last_friday_of_december` | 12月最后一个周五 | `当前月份 = 12 && last_friday_of_month` |
| `last_day_of_month` | 本月最后一天 | `明天的月份 ≠ 当前月份` |
| `weekday_only` | 仅工作日 | `getDay() ∈ {1,2,3,4,5}` |

> 后续可扩展自定义 condition 函数，第一版支持上述内置条件即可。

#### 3.1.4 路径变量插值

`output_path` 支持以下变量：

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{date}` | 当天日期 YYYY-MM-DD | `2026-04-27` |
| `{year}` | 四位年份 | `2026` |
| `{month}` | 两位月份 | `04` |
| `{week}` | 两位 ISO 周号 | `17` |
| `{pipeline_id}` | Pipeline 的 ID | `work-summary` |
| `{schedule_id}` | Schedule 的 ID | `weekly` |

---

### 3.2 Prompt 模板格式

Prompt 模板存放在 `~/.minimem/prompts/` 目录下，文件名即模板名。

#### 3.2.1 模板结构

```markdown
<!-- ~/.minimem/prompts/weekly-review.md -->
---
output_schema:
  review: string
  achievements: string[]
  improvements: string[]
  next_week_focus: string[]
---

# 周报生成

你是一个工作总结助手。请根据以下本周的工作记忆和日报汇总，生成一份结构化周报。

## 本周工作记忆

{{memories}}

## 本周日报汇总

{{depends.daily}}

## 输出要求

请用 JSON 格式输出，包含以下字段：
- review: 完整的周报 Markdown 正文
- achievements: 本周重点成果（数组）
- improvements: 需要改进的地方（数组）
- next_week_focus: 下周重点关注（数组）
```

#### 3.2.2 模板变量

| 变量 | 说明 |
|------|------|
| `{{memories}}` | 按 `source` 配置和 `window` 时间窗口查询到的记忆内容（拼接为文本） |
| `{{depends.<schedule_id>}}` | 当前周期内依赖的前级 schedule 的输出内容 |
| `{{observations}}` | L3 层的观察（当 source.layers 包含 L3 时可用） |
| `{{mental_models}}` | L4 层的心智模型（当 source.layers 包含 L4 时可用） |
| `{{task_stats}}` | 任务统计信息（done/in_progress/todo/cancelled） |
| `{{date}}` | 当前日期 |
| `{{window_start}}` | 数据窗口起始日期 |
| `{{window_end}}` | 数据窗口结束日期 |
| `{{domain}}` | 当前 Pipeline 的领域名 |
| `{{pipeline_name}}` | Pipeline 名称 |

#### 3.2.3 Frontmatter

模板的 YAML frontmatter 中 `output_schema` 字段定义了期望的 LLM 输出 JSON 结构。Pipeline Engine 在调用 `chatJson()` 时：
- 将 `output_schema` 转为 JSON Schema 描述，注入到 system prompt 中
- 使用 `output_schema` 的字段作为 `fallback` 对象的骨架（值为空字符串/空数组）

---

### 3.3 Pipeline Engine 运行时

#### 3.3.1 生命周期

```
启动阶段：
  1. 扫描 ~/.minimem/pipelines/*.toml
  2. 解析并校验每个 Pipeline 配置
  3. 对每个 enabled 的 Pipeline 的每个 schedule：
     → 调用 registerPipelineTask(pipelineId, scheduleId, cron, condition)
     → 注册到 Scheduler（复用已有的 registerTask 机制）
  4. 记录注册结果日志

执行阶段（某个 schedule 被 cron 触发）：
  1. 检查 condition（如果有），不满足则跳过
  2. 计算数据时间窗口（window → 起止时间）
  3. 按 source 配置查询记忆
     └─ SELECT raw_content FROM experiences
        WHERE domain = ? AND created_at BETWEEN ? AND ?
        ORDER BY importance DESC LIMIT 50
  4. 如果有 depends_on，从磁盘读取前一级 schedule 最新的输出文件
  5. 加载 prompt 模板，执行变量插值
  6. 调用 LLM chatJson()（含 fallback 降级）
  7. 按 output 配置写 DB / 写磁盘 / 推送 webhook
  8. 记录执行结果到 pipeline_runs 表
```

#### 3.3.2 代码结构

```
src/pipeline/
├── index.ts              # Pipeline Engine 入口：扫描、注册、导出 API
├── loader.ts             # TOML 配置解析 + 校验
├── executor.ts           # Schedule 执行器（查询→组装→LLM→输出）
├── template.ts           # Prompt 模板加载 + 变量插值
├── conditions.ts         # 内置 condition 判定函数
├── types.ts              # Pipeline 相关类型定义
└── output.ts             # 输出持久化（写磁盘、写 DB、推 webhook）
```

#### 3.3.3 模块依赖关系

```
pipeline/index.ts
  ├── pipeline/loader.ts       ← 读取 TOML 文件
  ├── pipeline/executor.ts     ← 执行 schedule
  │     ├── pipeline/template.ts  ← 加载 prompt 模板
  │     ├── pipeline/conditions.ts  ← 判定 condition
  │     ├── pipeline/output.ts     ← 输出持久化
  │     ├── store/database.ts      ← 查询记忆（已有）
  │     └── llm/client.ts          ← LLM chatJson（已有）
  └── scheduler/index.ts       ← 注册 cron 任务（已有，需扩展）
```

---

### 3.4 数据库变更

#### 3.4.1 新增 `pipeline_runs` 表

记录每次 Pipeline Schedule 的执行结果。

```sql
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id              TEXT PRIMARY KEY,
    pipeline_id     TEXT NOT NULL,           -- Pipeline 的 ID（如 'work-summary'）
    schedule_id     TEXT NOT NULL,           -- Schedule 的 ID（如 'weekly'）
    status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
    output_text     TEXT,                    -- LLM 生成的输出内容（完整文本）
    output_json     TEXT,                    -- LLM 生成的结构化 JSON（如有）
    output_path     TEXT,                    -- 实际写入的文件路径
    llm_model       TEXT,                    -- 使用的 LLM 模型
    llm_tokens      INTEGER DEFAULT 0,      -- 消耗的 token 数
    window_start    TEXT,                    -- 数据窗口起始时间
    window_end      TEXT,                    -- 数据窗口结束时间
    memory_count    INTEGER DEFAULT 0,       -- 查询到的记忆条数
    duration_ms     INTEGER DEFAULT 0,       -- 执行耗时（毫秒）
    error_message   TEXT,                    -- 失败时的错误信息
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pipeline_runs_pipeline ON pipeline_runs(pipeline_id, schedule_id);
CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX idx_pipeline_runs_created ON pipeline_runs(created_at);
```

#### 3.4.2 不修改已有表

Pipeline Engine 作为新增模块，**不修改任何已有表的 Schema**。它只通过 `SELECT` 读取 `experiences`、`world_facts`、`observations`、`mental_models` 等表的数据。

---

### 3.5 Scheduler 扩展

#### 3.5.1 `registerTask` 需导出

当前 `registerTask()` 是 `scheduler/index.ts` 的**内部函数（无 export）**。Pipeline Engine 需要动态注册任务，有两种方案：

- **方案 A（推荐）**：新增 `registerPipelineTask()` 导出函数，内部调用 `registerTask()`
- **方案 B**：将 `registerTask()` 直接导出

```typescript
// 方案 A：新增导出函数（不动现有代码）
export function registerPipelineTask(
  pipelineId: string,
  scheduleId: string,
  cronExpr: string,
  handler: () => Promise<void>,
): void {
  const taskName = `pipeline:${pipelineId}:${scheduleId}`;
  registerTask(taskName, cronExpr, handler);
}
```

#### 3.5.2 启动补偿扩展

Pipeline 的 schedule 也需要支持启动补偿。在 `COMPENSATION_RULES` 中动态添加规则：

```typescript
// Pipeline Engine 启动时向 COMPENSATION_RULES 注入规则
function registerPipelineCompensation(pipelineId: string, scheduleId: string, maxStaleHours: number): void {
  COMPENSATION_RULES.push({
    taskName: `pipeline:${pipelineId}:${scheduleId}`,
    maxStaleHours,
    compensate: async () => {
      // 执行 Pipeline schedule
    },
    priority: 10,  // Pipeline 补偿优先级低于核心任务（dream/backup/gc）
  });
}
```

> **注意**：这要求 `COMPENSATION_RULES` 从 `const` 改为 `let` 或改用可变数组（当前已是 `const` 数组，`push` 可用）。

#### 3.5.3 SchedulerConfig 无需修改

Pipeline 的 cron 配置在 TOML 文件中自管理，不需要添加到 `SchedulerConfig` 接口。

---

### 3.6 Prompt 模板引擎

#### 3.6.1 模板加载

```typescript
interface PromptTemplate {
  name: string;
  content: string;           // 原始 Markdown 内容（去掉 frontmatter）
  output_schema: Record<string, string>;  // frontmatter 中的 output_schema
}

function loadPromptTemplate(name: string): PromptTemplate {
  const promptsDir = join(getConfig().storage.data_dir, 'prompts');
  const filePath = join(promptsDir, `${name}.md`);
  // 读取文件 → 解析 YAML frontmatter → 返回 PromptTemplate
}
```

#### 3.6.2 变量插值

```typescript
function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
    return variables[key] ?? `{{${key}}}`;  // 未匹配的变量保留原样
  });
}
```

#### 3.6.3 Fallback 生成

当 LLM 不可用或调用失败时，使用规则降级生成基础输出：

```typescript
function buildFallbackOutput(memories: string[], schedule: ScheduleConfig): string {
  let md = `# ${schedule.id} — ${new Date().toISOString().slice(0, 10)}\n\n`;
  md += `> 该报告由规则降级生成（LLM 不可用）\n\n`;
  md += `## 记忆摘要（共 ${memories.length} 条）\n\n`;
  for (const m of memories.slice(0, 10)) {
    md += `- ${m.slice(0, 200)}\n`;
  }
  return md;
}
```

---

### 3.7 输出持久化

#### 3.7.1 写磁盘

```typescript
function writeReportToDisk(outputPath: string, content: string): string {
  // outputPath 已经过变量插值，如 "reports/weekly/2026-W17.md"
  const fullPath = join(getConfig().storage.data_dir, outputPath);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}
```

**输出目录结构**：

```
~/.minimem/
├── reports/           ← Pipeline 输出目录
│   ├── daily/
│   │   └── 2026-04-27.md
│   ├── weekly/
│   │   └── 2026-W17.md
│   ├── monthly/
│   │   └── 2026-04.md
│   └── annual/
│       └── 2026.md
├── pipelines/         ← Pipeline 配置目录
│   └── work-summary.toml
├── prompts/           ← Prompt 模板目录
│   ├── daily-summary.md
│   ├── weekly-review.md
│   ├── monthly-summary.md
│   └── annual-summary.md
├── dreams/            ← 做梦报告（已有）
├── surfaces/          ← Surface Files（已有）
└── minimem.db         ← SQLite 数据库（已有）
```

#### 3.7.2 写 DB

每次执行结果写入 `pipeline_runs` 表（见 3.4.1）。

#### 3.7.3 Webhook 推送（可选）

```typescript
async function pushToWebhook(url: string, pipelineId: string, scheduleId: string, content: string): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pipeline_id: pipelineId,
      schedule_id: scheduleId,
      content,
      generated_at: new Date().toISOString(),
    }),
  });
}
```

---

### 3.8 REST API 扩展

在 `src/gateway/rest-api.ts` 中新增以下端点：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/pipelines` | 列出所有 Pipeline 及其状态 |
| `GET` | `/api/v1/pipelines/:id` | 获取单个 Pipeline 详情（含最近执行记录） |
| `POST` | `/api/v1/pipelines/:id/trigger` | 手动触发执行指定 Pipeline 的指定 schedule |
| `GET` | `/api/v1/pipelines/:id/runs` | 查询执行历史 |
| `GET` | `/api/v1/reports/:period` | 按周期查看最新报告内容（`daily`/`weekly`/`monthly`/`annual`） |
| `GET` | `/api/v1/reports/:period/:date` | 查看指定日期的报告 |

#### 3.8.1 手动触发 API

```typescript
// POST /api/v1/pipelines/:id/trigger
// Body: { "schedule_id": "weekly" }  // 可选，不传则触发所有 schedule
```

这允许用户在任意时间手动生成报告，不必等 cron 触发。

---

### 3.9 MCP 工具扩展

新增以下 MCP 工具，让 CodeBuddy 等 AI Agent 可以与 Pipeline Engine 交互：

| 工具名 | 说明 |
|--------|------|
| `list_pipelines` | 列出所有已注册的 Pipeline |
| `trigger_pipeline` | 手动触发某个 Pipeline 的 schedule |
| `get_pipeline_report` | 获取最近一次某 schedule 的输出报告 |
| `get_pipeline_runs` | 查询 Pipeline 执行历史 |

---

### 3.10 现有模块迁移策略

现有的 `daily-summary.ts` 和 `weekly-review.ts` **不立即删除**，采用渐进迁移：

#### Phase A：共存期

1. Pipeline Engine 上线后，创建 `work-summary.toml` 配置
2. Pipeline 的 daily schedule 与现有 `summary:daily` cron 任务并行运行
3. 对比输出质量，验证 Pipeline Engine 可靠性

#### Phase B：切换期

1. 在 `scheduler/index.ts` 中注释掉 `summary:daily` 的 `registerTask`
2. 由 Pipeline Engine 接管日报生成
3. 周报由 Pipeline Engine 直接接管（`weekly-review.ts` 从未被调度器调用）

#### Phase C：清理期

1. 删除 `src/modules/work/daily-summary.ts`
2. 删除 `src/modules/work/weekly-review.ts`
3. 相关 Prompt 迁移到 `~/.minimem/prompts/` 目录

> **注意**：Phase C 是可选的，保留原始模块也不影响系统运行。

---

## 4. 第一个 Pipeline 实例：工作智能总结

作为 Pipeline Engine 的首个用例，提供开箱即用的工作总结配置。

### 4.1 配置文件

```toml
# ~/.minimem/pipelines/work-summary.toml

[pipeline]
id = "work-summary"
name = "工作智能总结"
description = "自动生成工作日报、周报、月报、年报"
enabled = true

[pipeline.source]
domain = "work"
layers = ["L1", "L2", "L3"]

[[pipeline.schedules]]
id = "daily"
cron = "0 18 * * 1-5"
window = "today"
prompt_template = "daily-summary"
output_path = "reports/daily/{date}.md"
llm_tier = "medium"

[[pipeline.schedules]]
id = "weekly"
cron = "0 17 * * 5"
window = "7d"
prompt_template = "weekly-review"
output_path = "reports/weekly/{year}-W{week}.md"
depends_on = ["daily"]

[[pipeline.schedules]]
id = "monthly"
cron = "0 17 * * 5"
window = "30d"
prompt_template = "monthly-summary"
output_path = "reports/monthly/{year}-{month}.md"
depends_on = ["weekly"]
condition = "last_friday_of_month"

[[pipeline.schedules]]
id = "annual"
cron = "0 17 * * 5"
window = "365d"
prompt_template = "annual-summary"
output_path = "reports/annual/{year}.md"
depends_on = ["monthly"]
condition = "last_friday_of_december"

[pipeline.output]
save_to_db = true
save_to_disk = true
```

### 4.2 Prompt 模板

随 Pipeline Engine 一起提供 4 个内置模板：

| 模板文件 | 对应 Schedule | 来源 |
|----------|--------------|------|
| `daily-summary.md` | daily | 从 `llm/prompts.ts` 的 `dailySummaryPrompt()` 迁移 |
| `weekly-review.md` | weekly | 从 `llm/prompts.ts` 的 `weeklyReviewPrompt()` 迁移 |
| `monthly-summary.md` | monthly | 新写 |
| `annual-summary.md` | annual | 新写 |

---

## 5. 兼容性要求

| 场景 | 处理方式 |
|------|---------|
| 无 `pipelines/` 目录 | Pipeline Engine 正常启动，不注册任何任务，打印 INFO 日志 |
| TOML 解析失败 | 跳过该 Pipeline，打印 WARN 日志，不影响其他 Pipeline |
| Prompt 模板不存在 | 该 schedule 执行时使用规则降级 fallback |
| LLM 不可用 | 使用规则降级 fallback（同现有 daily-summary 模式） |
| 已有 `summary:daily` 调度 | Pipeline Engine 和旧调度共存，不冲突（用不同的任务名） |
| `depends_on` 指定的文件不存在 | 该变量为空字符串，LLM prompt 中对应位置留空 |

---

## 6. 验收标准

### 6.1 功能验收

- [ ] `~/.minimem/pipelines/` 目录下的 TOML 文件可被自动扫描和解析
- [ ] 每个 enabled 的 Pipeline 的每个 schedule 被注册为 cron 任务
- [ ] cron 触发后自动执行：查询记忆 → 加载模板 → 插值 → LLM 生成 → 输出
- [ ] `condition` 判定正确（`last_friday_of_month` 等）
- [ ] `depends_on` 正确读取前级 schedule 的输出文件并注入到 prompt 中
- [ ] `output_path` 变量插值正确（`{date}`、`{year}`、`{week}`、`{month}`）
- [ ] 报告正确写入磁盘文件
- [ ] 执行记录正确写入 `pipeline_runs` 表
- [ ] Webhook 推送功能正常（配置了 webhook URL 时）
- [ ] 手动触发 API `POST /api/v1/pipelines/:id/trigger` 正常工作
- [ ] `GET /api/v1/reports/:period` 返回正确的报告内容
- [ ] MCP 工具 `list_pipelines`、`trigger_pipeline`、`get_pipeline_report` 正常

### 6.2 降级验收

- [ ] LLM 不可用时，fallback 输出基础 Markdown 报告
- [ ] TOML 配置语法错误时，跳过该 Pipeline 不影响系统
- [ ] Prompt 模板缺失时，使用默认 fallback
- [ ] `depends_on` 文件不存在时，对应变量为空，不报错

### 6.3 可观测性验收

- [ ] 每次 Pipeline 执行在日志中记录：pipeline_id, schedule_id, memory_count, llm_tokens, duration_ms, status
- [ ] `pipeline_runs` 表可查询历史执行记录
- [ ] 失败时 `error_message` 字段记录详细错误原因

### 6.4 性能验收

- [ ] Pipeline Engine 扫描 + 注册阶段不超过 500ms（10 个 Pipeline 以下）
- [ ] 单次 schedule 执行（不含 LLM 延迟）不超过 1s
- [ ] Pipeline 任务与 Dream/GC 通过已有互斥锁机制避免并发冲突

### 6.5 开箱即用验收

- [ ] 首次安装后，运行 `minimem --init-pipelines` 自动创建 `work-summary.toml` + 4 个 prompt 模板
- [ ] 或提供 `config.default.toml` 中的 `[pipeline]` section 作为默认配置入口

---

## 7. 实施建议

### 7.1 分阶段实施

| 阶段 | 内容 | 工作量 | 前置依赖 |
|------|------|--------|---------|
| **Phase 1** | Pipeline Engine 核心框架：loader + executor + template + output + types | 2-3 天 | MINIMEM-001 ✅ |
| **Phase 2** | Scheduler 扩展：registerPipelineTask + 补偿规则注入 | 0.5 天 | Phase 1 |
| **Phase 3** | 内置 `work-summary.toml` + 4 个 prompt 模板 | 1 天 | Phase 2 |
| **Phase 4** | REST API + MCP 工具扩展 | 1 天 | Phase 3 |
| **Phase 5** | Condition 系统 + depends_on 依赖链 + webhook 推送 | 1 天 | Phase 3 |
| **Phase 6** | 文档 + 测试 + 旧模块迁移指南 | 1 天 | Phase 5 |

**总预估**：5-7 天

### 7.2 关键实现文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/pipeline/index.ts` | 🆕 新建 | Engine 入口：扫描、注册、启动 |
| `src/pipeline/loader.ts` | 🆕 新建 | TOML 解析 + Schema 校验 |
| `src/pipeline/executor.ts` | 🆕 新建 | Schedule 执行逻辑 |
| `src/pipeline/template.ts` | 🆕 新建 | Prompt 模板引擎 |
| `src/pipeline/conditions.ts` | 🆕 新建 | 条件判定函数 |
| `src/pipeline/output.ts` | 🆕 新建 | 输出持久化 |
| `src/pipeline/types.ts` | 🆕 新建 | 类型定义 |
| `src/scheduler/index.ts` | ✏️ 修改 | 新增 `registerPipelineTask()` 导出 + `COMPENSATION_RULES` 动态注入 |
| `src/store/database.ts` | ✏️ 修改 | 新增 `pipeline_runs` 表建表语句 |
| `src/gateway/rest-api.ts` | ✏️ 修改 | 新增 Pipeline 相关 API 端点 |
| `src/gateway/mcp-server.ts` | ✏️ 修改 | 新增 Pipeline MCP 工具 |
| `src/index.ts` | ✏️ 修改 | 启动时调用 `initPipelineEngine()` |

### 7.3 依赖库

| 库 | 用途 | 是否新增 |
|----|------|---------|
| `@iarna/toml` 或内置 TOML 解析 | 解析 Pipeline TOML 配置 | 可能新增（或手写简单解析器） |
| `node-cron` | 定时调度 | 已有 |
| `fs` / `path` | 文件读写 | 已有 |

> 建议优先使用轻量的 TOML 解析库（如 `smol-toml`，~5KB），避免引入过重的依赖。

### 7.4 风险点

| 风险 | 缓解措施 |
|------|---------|
| TOML 解析库引入新依赖 | 评估 `smol-toml`（零依赖、~5KB）或自写简单解析 |
| Pipeline 执行与 Dream 并发冲突 | 复用已有的 `acquireTaskLock` 互斥机制 |
| Prompt 模板注入攻击 | 模板文件只从受信任目录读取（`~/.minimem/prompts/`） |
| Pipeline 配置热更新 | 第一版不支持热更新，修改配置需重启。后续可加 file-watcher |
| `depends_on` 循环依赖 | loader 阶段做 DAG 拓扑排序检查，发现环路报错 |
| 月报/年报 LLM 上下文过长 | Prompt 模板中限制输入记忆条数 + LLM 输入截断保护（已有） |

---

## 8. 未来扩展方向（不在本期范围）

| 方向 | 说明 |
|------|------|
| **Pipeline 热更新** | file-watcher 监听 `pipelines/` 目录，配置变更自动重新注册 |
| **自定义 Condition 函数** | 允许用户在 TOML 中定义 JavaScript/TypeScript condition |
| **Pipeline 链式编排** | 支持 Pipeline 之间的依赖（Pipeline A 完成后触发 Pipeline B） |
| **多输出格式** | 支持 PDF、HTML、飞书文档等输出格式 |
| **Pipeline Marketplace** | 社区共享 Pipeline 模板（配置 + prompt 打包分享） |
| **交互式报告** | 生成后用户可以与报告对话（"展开这个观点"） |

---

## 9. 关联需求

| 需求编号 | 标题 | 关系 |
|---------|------|------|
| MINIMEM-001 | 领域隔离 | ✅ 已完成，Pipeline 的 `source.domain` 依赖此能力 |
| — | 个人工作智能总结系统 | 本需求的首个用例 |
| — | MiniMem REST 常驻部署 | Pipeline Engine 需要 MiniMem 常驻运行才能执行定时任务 |

---

## 附录 A：配置文件示例 — 学习笔记复盘

```toml
# ~/.minimem/pipelines/learning-review.toml

[pipeline]
id = "learning-review"
name = "学习笔记复盘"
description = "每周自动复盘学习内容，月度生成知识增长报告"
enabled = true

[pipeline.source]
domain = "learning"
layers = ["L1", "L2", "L3", "L4"]
tags_include = ["reading", "course", "study"]

[[pipeline.schedules]]
id = "weekly"
cron = "0 20 * * 0"
window = "7d"
prompt_template = "learning-weekly"
output_path = "reports/learning/weekly/{year}-W{week}.md"

[[pipeline.schedules]]
id = "monthly"
cron = "0 20 * * 0"
window = "30d"
prompt_template = "learning-monthly"
output_path = "reports/learning/monthly/{year}-{month}.md"
depends_on = ["weekly"]
condition = "last_day_of_month"

[pipeline.output]
save_to_disk = true
```

## 附录 B：配置文件示例 — 项目复盘

```toml
# ~/.minimem/pipelines/project-retro.toml

[pipeline]
id = "project-retro"
name = "项目经验萃取"
description = "项目结束后自动生成经验复盘报告"
enabled = false  # 默认关闭，手动触发

[pipeline.source]
domain = "work"
layers = ["L1", "L2", "L3", "L4"]
tags_include = ["project:minimem"]

[[pipeline.schedules]]
id = "retro"
cron = "0 0 1 1 *"  # cron 占位（实际由手动触发）
window = "all"
prompt_template = "project-retro"
output_path = "reports/retro/{pipeline_id}-{date}.md"
llm_tier = "heavy"
llm_temperature = 0.7

[pipeline.output]
save_to_db = true
save_to_disk = true
```
