# MiniMem Console — 需求文档

> MiniMem 的可观测性看板 + 基于记忆的自动化任务平台
>
> 定位：MiniMem 生态的"应用层"，消费 MiniMem REST API，提供可视化、操作和自动化能力。
>
> 版本：v0.1.0 | 作者：lelin | 日期：2026-04-27

---

## 一、项目定位与边界

### 是什么

MiniMem Console 是一个**独立的全栈 Web 应用**，作为 MiniMem 记忆引擎的控制台，提供三大核心能力：

1. **可观测性** — 透视 MiniMem 四层记忆的内部状态
2. **可操作性** — 直接管理记忆、触发系统操作
3. **自动化任务** — 基于记忆数据的定时加工（日报、周报、自定义任务等）

### 不是什么

- ❌ 不是 MiniMem 本体的一部分（零耦合，通过 REST API 通信）
- ❌ 不是聊天界面（你已经有 CodeBuddy / OpenClaw 等 Agent）
- ❌ 不替代 MiniMem 的任何核心功能（存、取、搜、Dream 仍由 MiniMem 完成）

### 架构关系

```
┌─────────────────────────────────────────────┐
│            minimem-console                   │
│                                              │
│  ┌────────────┐   ┌────────────────────────┐ │
│  │  前端 SPA   │   │   轻量后端 (Node.js)   │ │
│  │            │──▶│                        │ │
│  │  Dashboard  │   │  • API 代理转发        │ │
│  │  记忆浏览器  │   │  • 定时任务调度器       │ │
│  │  任务管理    │   │  • Pipeline 执行器     │ │
│  │  报告查看    │   │  • 报告存储            │ │
│  └────────────┘   └──────────┬─────────────┘ │
└──────────────────────────────┼───────────────┘
                               │ REST API
                               ▼
                    ┌─────────────────────┐
                    │    MiniMem 引擎      │
                    │  (不做任何改动)       │
                    │  http://127.0.0.1:6677 │
                    └─────────────────────┘
```

---

## 二、核心概念

### 2.1 MiniMem API 概览

Console 消费的 MiniMem REST API 端点（全部在 `/api/v1/` 下）：

| 分类 | 端点 | 方法 | 说明 |
|------|------|------|------|
| **记忆写入** | `/memory` | POST | 添加单条记忆 |
| | `/memory/batch` | POST | 批量添加 |
| **记忆检索** | `/memory/search` | GET | 语义混合搜索（query + top_k） |
| | `/memory/recall/:entity` | GET | 实体关联召回 |
| | `/memory/:id` | GET | 按 ID 获取 |
| | `/memory/list` | GET | 分页浏览（page + page_size） |
| **记忆管理** | `/memory/:id` | PUT | 更新记忆 |
| | `/memory/:id` | DELETE | 删除记忆（layer 参数） |
| | `/memory/forget` | POST | 遗忘主题 |
| **Surface** | `/surface` | GET | 批量加载（agent_type 参数） |
| | `/surface/:file` | GET | 获取单个 Surface File |
| **Owner** | `/owner/profile` | GET | 获取用户画像 |
| | `/owner/person/:name` | GET | 查找人设 |
| | `/persons` | GET | 列出所有人设 |
| | `/person` | POST/PUT/DELETE | 人设 CRUD |
| **系统** | `/health` | GET | 健康检查（含温度分布、告警） |
| | `/admin/stats` | GET | 各层记忆数量统计 |
| | `/admin/temperature` | GET | 温度分布 |
| | `/metrics` | GET | Prometheus 指标 |
| | `/version` | GET | 版本 + Surface etag |
| **Dream** | `/dream/trigger` | POST | 触发做梦（mode + phases） |
| **快照** | `/snapshot` | POST | 创建快照 |
| | `/snapshot/list` | GET | 列出快照 |
| | `/snapshot/diff` | GET | 快照差异 |
| **导入导出** | `/memory/export` | POST | 导出记忆 |
| | `/memory/import` | POST | 导入记忆 |

### 2.2 四层记忆模型

| 层级 | 名称 | 数据库表 | 说明 |
|------|------|----------|------|
| L1 | Experience（经历） | `experiences` | 原始记忆，只增不改 |
| L2 | WorldFact（事实） | `world_facts` | 三元组（主谓宾），从 L1 提取 |
| L3 | Observation（观察） | `observations` | 模式/趋势/偏好，从 L2 归纳 |
| L4 | MentalModel（心智模型） | `mental_models` | 原则/信念/价值观，从 L3 提炼 |

另有：
- **KnowledgePage**（知识页面）— L3 层的 Karpathy 编译产物
- **Inspiration**（灵感）— Dream Phase 3.5 产生的灵感洞察
- **Surface Files**（9 个 .md）— 面向 Agent 的结构化上下文文件

### 2.3 温度模型

每条记忆都有温度状态：`hot → warm → cool → cold → frozen`，基于访问频率和时间衰减。

### 2.4 自动化任务（Pipeline）

Console 内置的可视化流水线编排系统。每个 Pipeline 是一个 **DAG（有向无环图）**，由多个节点（Node）通过连线（Edge）组成。

| 概念 | 说明 |
|------|------|
| **Pipeline** | 一条完整的自动化流水线，可定时或手动触发 |
| **Node（节点）** | 流水线中的一个处理步骤，有类型、配置、输入/输出端口 |
| **Edge（连线）** | 节点之间的数据流向，从上游输出端口到下游输入端口 |
| **节点类型** | 6 大类：数据源 / 转换 / AI(LLM) / 输出 / 控制流 / MiniMem操作 |
| **模板引擎** | Handlebars 语法，所有文本字段可引用上游节点输出和全局变量 |
| **运行记录** | 每次运行记录每个节点的 input/output 快照，完整可追溯 |

---

## 三、功能模块

### 3.1 Dashboard（首页看板）

**目标**：一屏概览 MiniMem 的"认知状态"。

#### 展示内容

1. **四层记忆计数器**
   - 数据源：`GET /api/v1/admin/stats`
   - 展示：L1/L2/L3/L4 + KnowledgePages 的数量，卡片或环形图

2. **温度分布图**
   - 数据源：`GET /api/v1/admin/temperature`
   - 展示：hot/warm/cool/cold/frozen 的堆叠条形图或热力图

3. **健康状态指示器**
   - 数据源：`GET /api/v1/health`
   - 展示：healthy/warning/critical 状态灯 + 告警列表

4. **最近活动时间线**
   - 数据源：`GET /api/v1/memory/list?page=1&page_size=10`
   - 展示：最近 10 条记忆的时间、来源、摘要

5. **上次 Dream 信息**
   - 数据源：`GET /api/v1/version`（含 `last_dream_at`）
   - 展示：距上次做梦多久、快速触发按钮

6. **Pipeline 运行状态**
   - 数据源：Console 自身的任务调度器
   - 展示：各任务的上次运行时间、状态、下次计划

### 3.2 记忆浏览器

**目标**：分层浏览、筛选、查看记忆详情。

#### 功能

1. **分页列表**
   - 按层级 Tab 切换（L1/L2/L3/L4/Inspiration）
   - 支持排序（时间、重要性、温度）
   - 支持筛选（来源 source、内容类型 content_type、领域 domain、温度）

2. **记忆详情面板**
   - 点击展开记忆全文
   - 显示元信息：ID、来源、重要性、标签、参与者、领域、温度、创建/更新时间
   - L2 展示三元组结构（主谓宾）
   - L3 展示支持/反对的 L2 ID 列表 + 置信度历史
   - L4 展示优先级、作用域、是否激活

3. **搜索**
   - 搜索框，调用 `GET /api/v1/memory/search?query=xxx&top_k=20`
   - 展示搜索结果 + 分数 + 命中策略（semantic/fts/condition/graph）

4. **实体召回**
   - 输入人名/项目名等，调用 `GET /api/v1/memory/recall/:entity`
   - 展示关联记忆列表

### 3.3 记忆管理

**目标**：增删改记忆。

#### 功能

1. **手动写入记忆**
   - 表单：content（必填）、source、content_type、importance、tags、participants、domain
   - 调用 `POST /api/v1/memory`

2. **编辑记忆**
   - 修改内容、标签、重要性等字段
   - 调用 `PUT /api/v1/memory/:id`

3. **删除记忆**
   - 确认弹窗 + 层级选择
   - 调用 `DELETE /api/v1/memory/:id?layer=L1`

4. **遗忘主题**
   - 输入主题 → 先 dry_run 预览影响范围 → 确认后执行
   - 调用 `POST /api/v1/memory/forget`

### 3.4 Surface Files 预览

**目标**：查看 Agent 眼中的"你"。

#### 功能

1. **文件列表**
   - 9 个 Surface Files：me.md / soul.md / work.md / social.md / life.md / agent.md / context.md / index.md / insight.md
   - 展示每个文件的 token 数 / 预算 / 版本号 / 最后更新时间

2. **文件预览**
   - Markdown 渲染
   - 高亮超预算的部分

3. **总预算统计**
   - 展示总 token 使用 vs 10000 token 预算的进度条

### 3.5 Owner Profile & Person 管理

**目标**：查看和管理系统推断出的用户画像和人设。

#### 功能

1. **Owner Profile 查看**
   - 数据源：`GET /api/v1/owner/profile`
   - 展示分类 KV 结构（identity / preferences / personality 等）

2. **Person 列表**
   - 数据源：`GET /api/v1/persons`
   - 展示人名、别名、最后见面时间
   - 点击查看详情：性格、兴趣、观点、说话模式、关系网络

3. **Person CRUD**
   - 创建、编辑、删除人设
   - 调用 `POST/PUT/DELETE /api/v1/person`

### 3.6 Dream 管理

**目标**：查看做梦历史、手动触发。

#### 功能

1. **Dream 历史列表**
   - 从 Console 后端读取 MiniMem 的 `data/dreams/` 目录下的 .json/.md 文件
   - 按日期倒序展示

2. **Dream 报告详情**
   - Markdown 渲染做梦报告
   - 展示各阶段统计：巩固、梦境、清理、版本控制、灵感引擎

3. **手动触发 Dream**
   - 选择模式（daily/weekly）和阶段（1/2/3/4 可选）
   - 调用 `POST /api/v1/dream/trigger`
   - 展示运行进度和结果

### 3.7 灵感面板

**目标**：浏览、管理、评分灵感。

#### 功能

1. **灵感列表**
   - 数据源：MiniMem 的 `search_memory` 或直接走 Console 后端代理查询
   - 按状态筛选：spark / incubating / mature / acted / archived
   - 按领域筛选
   - 展示标题、假设、来源类型、信心度、新颖度、可行动性

2. **灵感详情**
   - 完整内容 + 假设
   - 孵化日志（每轮的新角度、是否深化、信心变化）
   - 来源记忆溯源（source_memory_ids 链接到记忆浏览器）

3. **操作**
   - 标记"已行动" + 记录行动结果
   - 评分（1-5）
   - 手动触发灵感引擎

### 3.8 自动化任务平台（Pipeline）⭐

**目标**：提供一个高自由度的**可视化流水线编排系统**，用户可以在 UI 上像搭积木一样组装多步处理流程。

这是 Console 最核心的独有功能。核心理念：**每个 Pipeline 是一个有向无环图（DAG），由多个"节点"通过"连线"组成。**

#### 3.8.1 核心概念

```
Pipeline = 一条完整的自动化流水线
  └── Node（节点）= 流水线中的一个处理步骤
       ├── 有明确的类型（数据源 / 转换 / LLM / 输出 / 控制流…）
       ├── 有输入端口（接收上游数据）和输出端口（传递给下游）
       └── 通过 Edge（连线）与其他节点相连
```

**类比**：如果你用过 n8n / Dify / LangFlow / Node-RED，就是那种感觉——但专门为"基于记忆的加工"做了深度定制。

#### 3.8.2 节点类型体系

Pipeline 的自由度来自丰富的节点类型。分为 6 大类：

##### ① 数据源节点（Source）— 从 MiniMem 取数据

| 节点类型 | 说明 | 参数 | 输出 |
|---------|------|------|------|
| `memory-search` | 语义搜索记忆 | query, top_k, time_from, time_to, domain, layer, source | `memories[]` |
| `memory-list` | 分页浏览记忆 | page, page_size, source, content_type, domain, layer | `memories[]` |
| `memory-recall` | 实体关联召回 | entity | `memories[]` |
| `surface-load` | 加载 Surface Files | agent_type, files[] (可选指定) | `surfaces{}` |
| `health-check` | 获取健康/统计数据 | — | `health{}` |
| `stats` | 获取各层统计 | — | `stats{}` |
| `temperature` | 获取温度分布 | — | `temperature{}` |
| `owner-profile` | 获取用户画像 | — | `profile{}` |
| `person-load` | 加载人设 | name (可选，不填则全部) | `persons[]` |
| `inspiration-load` | 加载灵感 | status, domain | `inspirations[]` |
| `static-text` | 静态文本输入 | text | `text` |
| `http-request` | 通用 HTTP 请求 | url, method, headers, body | `response{}` |
| `previous-run` | 引用本 Pipeline 上次运行的某节点输出 | node_id | 上次该节点的 output |

> **关键**：一个 Pipeline 可以有**多个**数据源节点。比如"取今天的记忆 + 取 Owner Profile + 取灵感"，三路并行输入。

##### ② 转换节点（Transform）— 对数据做变换/筛选/聚合

| 节点类型 | 说明 | 参数 | 输入→输出 |
|---------|------|------|----------|
| `filter` | 按条件过滤 | 条件表达式（如 `importance > 0.7`） | `items[]` → `items[]` |
| `sort` | 排序 | field, order (asc/desc) | `items[]` → `items[]` |
| `limit` | 截取前 N 条 | count | `items[]` → `items[]` |
| `group-by` | 按字段分组 | field | `items[]` → `groups{}` |
| `merge` | 合并多个输入 | mode: concat / zip / object | 多个输入 → 单个输出 |
| `template` | 文本模板渲染 | Handlebars 模板字符串 | `context{}` → `text` |
| `json-path` | 提取 JSON 子路径 | path (如 `$.memories[*].content`) | `any` → `any` |
| `split` | 将列表拆成单项逐个处理 | — | `items[]` → 逐个触发下游 |
| `javascript` | 自定义 JS 表达式 | 代码片段（沙箱执行） | `input` → `output` |
| `deduplicate` | 去重 | field (用于判断重复的字段) | `items[]` → `items[]` |

##### ③ LLM 节点（AI）— 调用大模型处理

| 节点类型 | 说明 | 参数 | 输入→输出 |
|---------|------|------|----------|
| `llm-chat` | 单轮 LLM 调用 | system_prompt, user_prompt（模板）, model, temperature, max_tokens | `context{}` → `text` |
| `llm-structured` | 结构化 LLM 输出 | 同上 + output_schema (JSON Schema) | `context{}` → `json{}` |
| `llm-judge` | LLM 做判断/打分 | 同上 + criteria | `context{}` → `score / boolean` |
| `llm-summarize` | 长文本摘要（自动分段） | max_chunk_size, strategy | `text` → `summary` |
| `llm-extract` | 从文本中提取结构化信息 | fields[] (要提取的字段定义) | `text` → `json{}` |

> **每个 LLM 节点都可以独立配置模型和参数**，一个 Pipeline 里可以用不同的模型做不同的事。

##### ④ 输出节点（Output）— 结果去哪里

| 节点类型 | 说明 | 参数 |
|---------|------|------|
| `output-file` | 写入本地文件 | path_template, format (md/json/txt/csv) |
| `output-minimem` | 写回 MiniMem | tags[], source, content_type, importance |
| `output-webhook` | 发送 HTTP 通知 | url, method, headers, body_template |
| `output-email` | 发送邮件 | to, subject_template, body_format |
| `output-variable` | 存为 Pipeline 变量 | variable_name（可被后续运行引用） |
| `output-console` | 仅保存到 Console 报告 | title_template |

> **一个 Pipeline 可以有多个输出节点**——生成报告的同时把关键发现写回 MiniMem 作为记忆，再发一条通知。

##### ⑤ 控制流节点（Control）

| 节点类型 | 说明 | 参数 |
|---------|------|------|
| `if-else` | 条件分支 | condition 表达式 → true 走一路，false 走另一路 |
| `switch` | 多路分支 | cases: { 条件 → 分支 }[] |
| `loop` | 循环处理列表中每一项 | 上游 `items[]` → 对每项执行子流程 |
| `parallel` | 并行执行多个分支 | 多个下游同时执行 |
| `wait-all` | 等待多个上游全部完成 | — |
| `retry` | 失败重试 | max_retries, delay_ms |
| `delay` | 延迟执行 | duration_ms |
| `error-handler` | 捕获上游错误 | fallback 值 或 备用分支 |

##### ⑥ MiniMem 专属操作节点（Action）

| 节点类型 | 说明 | 参数 |
|---------|------|------|
| `dream-trigger` | 触发 MiniMem Dream | mode, phases[] |
| `memory-write` | 写入记忆 | content_template, source, tags[], importance |
| `memory-forget` | 遗忘主题 | topic, dry_run |
| `snapshot-create` | 创建快照 | — |

#### 3.8.3 Pipeline 数据模型

```typescript
interface Pipeline {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tags: string[];                    // 分类标签

  // 调度
  schedule: {
    type: 'cron' | 'manual' | 'event';
    cron?: string;                   // type=cron 时的 Cron 表达式
    event?: string;                  // type=event 时监听的事件（预留）
  };

  // DAG 定义
  nodes: PipelineNode[];
  edges: PipelineEdge[];

  // 全局变量（所有节点都可以引用）
  variables: Record<string, string>;

  // 全局 LLM 默认配置（节点未指定时使用）
  default_llm: {
    model: string;
    temperature: number;
    max_tokens: number;
  };

  // 运行状态
  last_run_at: string | null;
  last_run_status: 'success' | 'partial' | 'failed' | 'running' | null;
  created_at: string;
  updated_at: string;
}

interface PipelineNode {
  id: string;                        // 节点唯一 ID（如 "src_1", "llm_2"）
  type: string;                      // 节点类型（如 "memory-search", "llm-chat"）
  label: string;                     // 用户可编辑的节点名称
  position: { x: number; y: number }; // 画布上的位置
  config: Record<string, unknown>;   // 节点参数（按类型不同而不同）
  
  // 端口定义（由类型决定，但允许用户添加自定义端口）
  inputs: PortDef[];                 // 输入端口
  outputs: PortDef[];                // 输出端口
}

interface PortDef {
  id: string;                        // 端口 ID（如 "out", "true", "false"）
  label: string;
  type: 'any' | 'text' | 'json' | 'memories' | 'boolean' | 'number';
}

interface PipelineEdge {
  id: string;
  source_node: string;               // 源节点 ID
  source_port: string;               // 源端口 ID
  target_node: string;               // 目标节点 ID
  target_port: string;               // 目标端口 ID
  // 可选：数据转换表达式
  transform?: string;                // 如 "$.content" 只取某个字段传递
}

// 运行记录
interface PipelineRun {
  id: string;
  pipeline_id: string;
  trigger: 'cron' | 'manual';
  status: 'running' | 'success' | 'partial' | 'failed';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;

  // 每个节点的执行记录
  node_runs: NodeRunRecord[];

  // 最终输出（所有 output 节点的聚合）
  outputs: {
    node_id: string;
    node_label: string;
    type: string;
    preview: string;               // 前 500 字
    full_content: string;
    file_path?: string;
  }[];

  error?: string;
}

interface NodeRunRecord {
  node_id: string;
  node_label: string;
  node_type: string;
  status: 'pending' | 'running' | 'success' | 'skipped' | 'failed';
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  
  // 节点的输入输出快照（调试用）
  input_snapshot: unknown;
  output_snapshot: unknown;
  error?: string;
  
  // LLM 节点额外信息
  llm_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    model: string;
  };
}
```

#### 3.8.4 模板引擎

所有文本类字段（Prompt、文件路径模板、通知正文等）都使用 **Handlebars** 语法，可引用：

| 变量来源 | 语法 | 示例 |
|---------|------|------|
| 上游节点输出 | `{{nodes.NODE_ID.output}}` | `{{nodes.src_1.output.memories}}` |
| 上游节点输出（简写） | `{{NODE_ID}}` | `{{src_1}}` — 取整个 output |
| Pipeline 全局变量 | `{{vars.VARIABLE_NAME}}` | `{{vars.project_name}}` |
| 内置变量 | `{{$date}}` `{{$time}}` `{{$datetime}}` `{{$run_id}}` | |
| 日期计算 | `{{$date_offset -7}}` | 7 天前的日期 |
| 运行上下文 | `{{$trigger}}` `{{$pipeline_name}}` | |

Handlebars helpers 预注册：

```handlebars
{{#each memories}}
- [{{this.importance}}] {{this.content}}
{{/each}}

{{#if (gt count 10)}}
共有 {{count}} 条记忆，以下是最重要的 10 条：
{{/if}}

{{json_pretty data}}           // JSON 美化
{{truncate text 500}}          // 截断
{{date_format date "YYYY-MM-DD"}}  // 日期格式化
{{join items ", "}}            // 数组拼接
{{markdown_table items}}       // 数组转 Markdown 表格
```

#### 3.8.5 可视化编辑器 UI

Pipeline 编辑器采用**画布 + 节点拖拽**的形式（基于 **React Flow** 库）：

```
┌──────────────────────────────────────────────────────────────────┐
│  Pipeline: 每日智能回顾                          [保存] [运行] [▶] │
├─────────┬────────────────────────────────────────────────────────┤
│         │                                                        │
│  节点面板 │              可视化画布（React Flow）                    │
│         │                                                        │
│ ▼ 数据源 │    ┌──────────┐     ┌──────────┐     ┌──────────┐     │
│  搜索记忆 │    │ 搜索今日  │────▶│  过滤    │────▶│  LLM     │     │
│  浏览记忆 │    │  记忆    │     │ 重要>0.5 │     │  总结    │     │
│  实体召回 │    └──────────┘     └──────────┘     └─────┬────┘     │
│  加载画像 │                                            │          │
│  ...     │    ┌──────────┐                       ┌─────▼────┐     │
│         │    │ 加载灵感  │──────────────────────▶│  合并    │     │
│ ▼ 转换   │    └──────────┘                       └─────┬────┘     │
│  过滤    │                                            │          │
│  排序    │                                      ┌─────▼────┐     │
│  合并    │                                      │  LLM     │     │
│  模板    │                                      │  生成报告 │     │
│  JS表达式│                                      └─────┬────┘     │
│  ...     │                                   ┌────────┼────────┐ │
│         │                              ┌─────▼──┐  ┌──▼─────┐  │ │
│ ▼ AI    │                              │写入文件│  │写回记忆│  │ │
│  LLM对话 │                              └────────┘  └────────┘  │ │
│  结构化  │                                                       │
│  摘要    │                                                       │
│  ...     │                                                       │
│         │                                                        │
│ ▼ 输出   │                                                        │
│  文件    │                                                        │
│  写回记忆 │                                                        │
│  Webhook │                                                        │
│  ...     │                                                        │
│         │                                                        │
│ ▼ 控制流 │                                                        │
│  条件分支 │                                                        │
│  循环    │                                                        │
│  并行    │                                                        │
│  ...     │                                                        │
├─────────┴────────────────────────────────────────────────────────┤
│  节点属性面板（选中节点时展开）                                      │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ [LLM 总结]  type: llm-chat                                  ││
│  │                                                              ││
│  │ System Prompt:                                               ││
│  │ ┌──────────────────────────────────────────────────────────┐ ││
│  │ │ 你是一位个人生产力分析师，擅长从碎片化的日常记录中提炼…   │ ││
│  │ └──────────────────────────────────────────────────────────┘ ││
│  │                                                              ││
│  │ User Prompt:                                                 ││
│  │ ┌──────────────────────────────────────────────────────────┐ ││
│  │ │ 以下是今天的 {{nodes.filter_1.output.length}} 条记忆：   │ ││
│  │ │ {{#each nodes.filter_1.output}}                          │ ││
│  │ │ - {{this.content}}                                       │ ││
│  │ │ {{/each}}                                                │ ││
│  │ └──────────────────────────────────────────────────────────┘ ││
│  │                                                              ││
│  │ Model: [qwen-plus ▼]  Temp: [0.7]  MaxTokens: [4096]       ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

**编辑器功能清单**：

1. **节点面板**（左侧）
   - 按分类折叠展示所有可用节点类型
   - 拖拽到画布创建节点
   - 搜索节点类型

2. **画布**（中央）
   - 拖拽移动节点
   - 拖拽端口创建连线
   - 缩放、平移
   - 框选多个节点
   - 复制/粘贴节点
   - 撤销/重做
   - 小地图导航（右下角）

3. **属性面板**（底部或右侧，选中节点时展开）
   - 根据节点类型动态渲染配置表单
   - Prompt 编辑器：语法高亮 + 变量自动补全 + 实时预览
   - 条件表达式编辑器：支持字段名自动补全
   - 文件路径模板编辑器：支持变量

4. **顶部工具栏**
   - 保存 / 另存为模板
   - 手动运行 / 试运行（dry-run，只执行不输出）
   - 运行历史
   - 导入/导出 Pipeline JSON
   - 调度配置（Cron 编辑器 + 人类可读预览）

5. **运行调试面板**（运行时出现）
   - 每个节点显示运行状态（灰色待运行 / 蓝色运行中 / 绿色成功 / 红色失败）
   - 点击节点查看该步的 input/output 快照
   - LLM 节点显示 token 用量
   - 实时日志流

#### 3.8.6 内置模板

Console 预置 Pipeline 模板（用户可一键创建，也可从零搭建）：

| 模板名 | 调度 | DAG 描述 | 
|--------|------|----------|
| **每日智能回顾** | `0 23 * * *` | 搜索今天记忆 → 过滤(重要性>0.5) → LLM总结 → 写文件 + 写回记忆 |
| **每周深度复盘** | `0 10 * * 1` | 搜索7天记忆 → 按domain分组 → 对每组LLM分析 → 合并 → LLM生成周报 → 写文件 |
| **月度成长报告** | `0 10 1 * *` | 搜索30天记忆 + 加载灵感 + 加载Owner Profile → 合并 → LLM生成月报 → 写文件 |
| **人物关系图谱** | 手动 | 加载所有Person → 对每人recall关联记忆 → LLM分析关系 → 结构化输出JSON |
| **项目决策追踪** | 手动 | 搜索(domain=项目名) → 排序(时间) → LLM提取决策点 → 结构化输出 → 写文件 |
| **灵感孵化器** | `0 9 * * *` | 加载灵感(status=incubating) → 对每条灵感搜索相关记忆 → LLM深化 → 写回记忆 |
| **健康巡检** | `0 */6 * * *` | 健康检查 + 温度分布 + 统计 → if(unhealthy) → webhook告警; else → 仅记录 |
| **知识卡片生成** | `0 22 * * *` | 搜索今天记忆 → LLM提取知识点 → 结构化输出(JSON) → 对每条写回记忆(tags=knowledge-card) |

#### 3.8.7 Pipeline 列表页 UI

```
┌──────────────────────────────────────────────────────────────────┐
│  Pipelines                                    [+ 新建] [从模板] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  🟢 每日智能回顾              每天 23:00    上次: 2h前 ✅  [编辑]│
│     5 节点 · 搜索→过滤→LLM→写文件+写回记忆                       │
│                                                                  │
│  🟢 健康巡检                  每 6 小时     上次: 30m前 ✅  [编辑]│
│     4 节点 · 健康检查→条件→告警/记录                              │
│                                                                  │
│  ⚪ 每周深度复盘              每周一 10:00  上次: 5天前 ✅  [编辑]│
│     7 节点 · 搜索→分组→循环LLM→合并→生成周报→写文件              │
│                                                                  │
│  🔴 月度成长报告              每月 1 号     上次: 失败 ❌  [编辑]│
│     6 节点 · 搜索+灵感+画像→合并→LLM→写文件     [查看错误]      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

#### 3.8.8 运行历史 & 调试

每次 Pipeline 运行都记录**每个节点**的执行详情，提供完整可追溯性：

```
┌──────────────────────────────────────────────────────────────────┐
│  运行 #42 — 每日智能回顾 — 2026-04-27 23:00                     │
│  状态: ✅ 成功  耗时: 12.3s  触发: cron                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  节点执行时间线：                                                 │
│                                                                  │
│  ✅ src_1 (搜索今日记忆)      0.8s   取到 47 条                  │
│  ✅ filter_1 (过滤重要记忆)   0.01s  47→23 条                    │
│  ✅ llm_1 (LLM 总结)         8.2s   1,247 + 892 tokens          │
│  ✅ out_1 (写入文件)          0.1s   reports/2026-04-27.md       │
│  ✅ out_2 (写回 MiniMem)     0.5s   写入 1 条记忆               │
│                                                                  │
│  ─── 点击任意节点查看 input/output 快照 ───                      │
│                                                                  │
│  📄 输出预览：                                                    │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ # 2026-04-27 每日回顾                                       ││
│  │                                                              ││
│  │ ## 今日关键事件                                              ││
│  │ 1. 完成了 MiniMem Console 需求文档设计…                     ││
│  │ 2. …                                                        ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

## 四、技术架构

### 4.1 技术栈

| 层 | 技术选型 | 理由 |
|----|---------|------|
| 前端框架 | **React 18** + TypeScript | 生态成熟、组件丰富 |
| UI 组件库 | **Shadcn/UI** + Tailwind CSS | 现代、可定制、轻量 |
| 流程画布 | **React Flow** (@xyflow/react) | 成熟的 DAG 可视化编辑库，拖拽+连线+缩放 |
| 状态管理 | **TanStack Query** | 专为 API 数据设计，缓存/刷新/乐观更新 |
| 路由 | **React Router v7** | 标准选择 |
| Markdown | **react-markdown** + rehype | Surface Files / 报告渲染 |
| 代码编辑 | **CodeMirror 6** | Prompt 编辑器 + JS 表达式编辑器 |
| 图表 | **Recharts** 或 **Chart.js** | Dashboard 可视化 |
| 后端框架 | **Hono** (Node.js) | 与 MiniMem 一致，轻量高性能 |
| 定时调度 | **node-cron** | 轻量、无外部依赖 |
| 模板引擎 | **Handlebars** | Pipeline 中所有文本模板的渲染 |
| LLM 调用 | **OpenAI SDK** (兼容模式) | 调 MiniMem 同一个 LLM（百炼 DashScope） |
| 数据存储 | **SQLite** (better-sqlite3) | 存储 Pipeline 配置、运行记录、报告 |
| 构建工具 | **Vite** | 快速开发体验 |
| 包管理 | **pnpm** | 磁盘高效 |

### 4.2 目录结构

```
minimem-console/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
│
├── server/                    # 后端
│   ├── index.ts               # 入口，启动 Hono server
│   ├── config.ts              # 配置加载（TOML）
│   ├── db.ts                  # SQLite 初始化
│   ├── routes/
│   │   ├── proxy.ts           # MiniMem API 代理转发
│   │   ├── pipeline.ts        # Pipeline CRUD + 手动触发 + 导入导出
│   │   ├── runs.ts            # 运行记录查询
│   │   ├── templates.ts       # 模板管理
│   │   ├── node-types.ts      # 节点类型 schema 查询
│   │   ├── reports.ts         # 报告查询
│   │   └── dream-files.ts     # Dream 报告文件读取
│   ├── engine/                # DAG 执行引擎
│   │   ├── dag.ts             # DAG 构建 + 拓扑排序
│   │   ├── runner.ts          # Pipeline 运行器（按拓扑序执行）
│   │   ├── context.ts         # 运行上下文管理
│   │   └── template.ts        # Handlebars 模板引擎 + helpers
│   ├── executors/             # 节点执行器（每种节点类型一个文件）
│   │   ├── index.ts           # 执行器注册表
│   │   ├── sources/           # 数据源节点
│   │   │   ├── memory-search.ts
│   │   │   ├── memory-list.ts
│   │   │   ├── memory-recall.ts
│   │   │   ├── surface-load.ts
│   │   │   ├── health-check.ts
│   │   │   ├── http-request.ts
│   │   │   └── static-text.ts
│   │   ├── transforms/        # 转换节点
│   │   │   ├── filter.ts
│   │   │   ├── sort.ts
│   │   │   ├── merge.ts
│   │   │   ├── template.ts
│   │   │   ├── javascript.ts
│   │   │   └── json-path.ts
│   │   ├── ai/                # LLM 节点
│   │   │   ├── llm-chat.ts
│   │   │   ├── llm-structured.ts
│   │   │   └── llm-summarize.ts
│   │   ├── outputs/           # 输出节点
│   │   │   ├── output-file.ts
│   │   │   ├── output-minimem.ts
│   │   │   ├── output-webhook.ts
│   │   │   └── output-console.ts
│   │   ├── controls/          # 控制流节点
│   │   │   ├── if-else.ts
│   │   │   ├── loop.ts
│   │   │   ├── parallel.ts
│   │   │   └── error-handler.ts
│   │   └── actions/           # MiniMem 操作节点
│   │       ├── dream-trigger.ts
│   │       ├── memory-write.ts
│   │       └── snapshot-create.ts
│   ├── scheduler/
│   │   └── index.ts           # node-cron 调度器
│   ├── llm/
│   │   └── client.ts          # LLM 调用封装
│   └── store/
│       ├── schema.ts          # Console 自己的表定义
│       ├── pipelines.ts       # Pipeline CRUD
│       ├── runs.ts            # 运行记录 CRUD
│       └── templates.ts       # 模板 CRUD
│
├── src/                       # 前端
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/
│   │   ├── client.ts          # API 客户端封装
│   │   ├── minimem.ts         # MiniMem API 类型 + hooks
│   │   └── pipeline.ts        # Pipeline API hooks
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── MemoryBrowser.tsx
│   │   ├── MemoryDetail.tsx
│   │   ├── SurfaceFiles.tsx
│   │   ├── OwnerProfile.tsx
│   │   ├── Persons.tsx
│   │   ├── DreamHistory.tsx
│   │   ├── Inspirations.tsx
│   │   ├── PipelineList.tsx
│   │   ├── PipelineEditor.tsx
│   │   ├── PipelineRuns.tsx
│   │   └── ReportViewer.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── Layout.tsx
│   │   ├── memory/
│   │   │   ├── MemoryCard.tsx
│   │   │   ├── MemoryTable.tsx
│   │   │   ├── SearchBox.tsx
│   │   │   └── LayerTabs.tsx
│   │   ├── dashboard/
│   │   │   ├── StatsCard.tsx
│   │   │   ├── TemperatureChart.tsx
│   │   │   ├── HealthIndicator.tsx
│   │   │   └── ActivityTimeline.tsx
│   │   ├── pipeline/
│   │   │   ├── Canvas.tsx           # React Flow 画布容器
│   │   │   ├── NodePalette.tsx      # 左侧节点面板（拖拽源）
│   │   │   ├── NodeRenderer.tsx     # 统一节点渲染器（根据类型分发）
│   │   │   ├── nodes/              # 各类型节点的画布外观
│   │   │   │   ├── SourceNode.tsx
│   │   │   │   ├── TransformNode.tsx
│   │   │   │   ├── AINode.tsx
│   │   │   │   ├── OutputNode.tsx
│   │   │   │   ├── ControlNode.tsx
│   │   │   │   └── ActionNode.tsx
│   │   │   ├── ConfigPanel.tsx      # 右侧/底部属性面板
│   │   │   ├── configs/            # 各节点类型的配置表单
│   │   │   │   ├── MemorySearchConfig.tsx
│   │   │   │   ├── LLMChatConfig.tsx
│   │   │   │   ├── FilterConfig.tsx
│   │   │   │   ├── OutputFileConfig.tsx
│   │   │   │   └── ...
│   │   │   ├── PromptEditor.tsx     # Prompt 编辑器（语法高亮+变量补全）
│   │   │   ├── CronInput.tsx        # Cron 编辑器 + 人类可读预览
│   │   │   ├── VariableEditor.tsx   # 全局变量编辑器
│   │   │   ├── RunTimeline.tsx      # 运行时节点状态时间线
│   │   │   ├── NodeDebugPanel.tsx   # 节点 input/output 快照查看器
│   │   │   ├── PipelineCard.tsx     # 列表页的 Pipeline 卡片
│   │   │   └── RunStatus.tsx
│   │   └── common/
│   │       ├── MarkdownPreview.tsx
│   │       ├── JsonViewer.tsx
│   │       ├── ConfirmDialog.tsx
│   │       └── LoadingSpinner.tsx
│   └── lib/
│       ├── utils.ts
│       └── constants.ts
│
├── config.default.toml        # 默认配置
└── README.md
```

### 4.3 配置文件

```toml
# minimem-console/config.default.toml

[server]
host = "127.0.0.1"
port = 3080

[minimem]
base_url = "http://127.0.0.1:6677"
# 如果 MiniMem 开启了 JWT 认证，需要配置 token
api_token_env = "MINIMEM_API_TOKEN"   # 环境变量名

[llm]
# Console 自己的 LLM 配置（用于 Pipeline 执行）
provider = "openai-compatible"
base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
api_key_env = "MINIMEM_LLM_API_KEY"
model = "qwen-plus"
temperature = 0.7
max_tokens = 4096

[storage]
data_dir = "~/.minimem-console"       # Console 自己的数据目录

[pipeline]
# Pipeline 输出的默认目录
output_dir = "~/.minimem-console/reports"
```

### 4.4 Console 自身数据库 Schema

Console 用独立的 SQLite 存储任务配置和运行记录（不与 MiniMem 共享数据库）：

```sql
-- Pipeline 定义
CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  tags TEXT NOT NULL DEFAULT '[]',              -- JSON: string[]
  schedule_type TEXT NOT NULL DEFAULT 'cron',   -- 'cron' | 'manual' | 'event'
  schedule_cron TEXT,                           -- Cron 表达式
  schedule_event TEXT,                          -- 事件名（预留）
  nodes TEXT NOT NULL DEFAULT '[]',             -- JSON: PipelineNode[]
  edges TEXT NOT NULL DEFAULT '[]',             -- JSON: PipelineEdge[]
  variables TEXT NOT NULL DEFAULT '{}',         -- JSON: Record<string, string>
  default_llm TEXT NOT NULL DEFAULT '{}',       -- JSON: { model, temperature, max_tokens }
  last_run_at TEXT,
  last_run_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pipeline 运行记录
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'manual',        -- 'cron' | 'manual'
  status TEXT NOT NULL DEFAULT 'running',         -- 'running' | 'success' | 'partial' | 'failed'
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  duration_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline ON pipeline_runs(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created ON pipeline_runs(created_at DESC);

-- 节点运行记录（每个节点每次运行一条）
CREATE TABLE IF NOT EXISTS node_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,                          -- Pipeline 内的节点 ID
  node_label TEXT NOT NULL DEFAULT '',
  node_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',          -- 'pending' | 'running' | 'success' | 'skipped' | 'failed'
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  input_snapshot TEXT,                             -- JSON: 节点输入数据快照
  output_snapshot TEXT,                            -- JSON: 节点输出数据快照
  error TEXT,
  llm_usage TEXT,                                  -- JSON: { prompt_tokens, completion_tokens, model }
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_node_runs_run ON node_runs(run_id);

-- Pipeline 输出记录（每个 output 节点产生一条）
CREATE TABLE IF NOT EXISTS pipeline_outputs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_label TEXT NOT NULL DEFAULT '',
  output_type TEXT NOT NULL,                       -- 'file' | 'minimem' | 'webhook' | 'console' | ...
  preview TEXT NOT NULL DEFAULT '',                -- 前 500 字
  full_content TEXT NOT NULL DEFAULT '',
  file_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pipeline_outputs_run ON pipeline_outputs(run_id);

-- 内置模板
CREATE TABLE IF NOT EXISTS pipeline_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  schedule_type TEXT NOT NULL DEFAULT 'cron',
  schedule_cron TEXT,
  nodes TEXT NOT NULL DEFAULT '[]',
  edges TEXT NOT NULL DEFAULT '[]',
  variables TEXT NOT NULL DEFAULT '{}',
  default_llm TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 4.5 后端 API 设计

Console 后端暴露的 API（前端直接调用）：

```
# ── MiniMem 代理 ──
# 将前端请求透明转发给 MiniMem，解决 CORS + 统一认证
GET/POST/PUT/DELETE  /proxy/api/v1/*

# ── Pipeline 管理 ──
GET     /api/pipelines                   # Pipeline 列表
POST    /api/pipelines                   # 创建 Pipeline
GET     /api/pipelines/:id               # Pipeline 详情（含完整 nodes/edges）
PUT     /api/pipelines/:id               # 更新 Pipeline（保存画布）
DELETE  /api/pipelines/:id               # 删除 Pipeline
POST    /api/pipelines/:id/run           # 手动触发运行
POST    /api/pipelines/:id/toggle        # 启停切换
POST    /api/pipelines/:id/dry-run       # 试运行（执行但不输出）
POST    /api/pipelines/:id/duplicate     # 复制 Pipeline
POST    /api/pipelines/import            # 导入 Pipeline JSON
GET     /api/pipelines/:id/export        # 导出 Pipeline JSON

# ── Pipeline 运行记录 ──
GET     /api/pipelines/:id/runs          # 某 Pipeline 的运行历史
GET     /api/runs/:id                    # 运行详情（含节点执行记录）
GET     /api/runs/:id/nodes              # 某次运行所有节点的执行记录
GET     /api/runs/:id/nodes/:nodeId      # 某次运行中某个节点的 input/output 快照
GET     /api/runs/:id/outputs            # 某次运行的所有输出

# ── 模板 ──
GET     /api/templates                   # 内置模板列表
GET     /api/templates/:id               # 模板详情
POST    /api/pipelines/from-template/:id # 从模板创建 Pipeline

# ── 节点类型 ──
GET     /api/node-types                  # 获取所有可用节点类型及其 schema（前端渲染用）

# ── Dream 报告 ──
GET     /api/dreams                      # Dream 报告列表
GET     /api/dreams/:id                  # Dream 报告详情

# ── Pipeline 报告 ──
GET     /api/reports                     # 所有 Pipeline 输出报告
GET     /api/reports/:id                 # 报告详情
```

---

## 五、Pipeline DAG 执行引擎

### 5.1 执行流程

```
触发（cron / 手动 / dry-run）
    │
    ▼
┌─────────────────────────────────────┐
│  Step 1: 加载 Pipeline 定义         │
│  从 SQLite 读取 nodes + edges       │
│  构建 DAG 拓扑（邻接表）            │
│  计算拓扑排序（确定执行顺序）        │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│  Step 2: 初始化运行上下文            │
│  创建 pipeline_runs 记录            │
│  初始化 context = {                 │
│    nodes: {},     // 各节点输出      │
│    vars: {...},   // 全局变量        │
│    $date, $time, $run_id ...        │
│  }                                  │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│  Step 3: 按拓扑序逐层执行           │
│                                     │
│  for each layer in topo_layers:     │
│    并行执行该层所有就绪节点：        │
│                                     │
│    ┌─────────────────────────────┐  │
│    │  3a. 收集输入                │  │
│    │  从 context.nodes 中取上游   │  │
│    │  节点的输出，按 edge 映射    │  │
│    │  到当前节点的输入端口         │  │
│    ├─────────────────────────────┤  │
│    │  3b. 执行节点                │  │
│    │  根据 node.type 调用对应     │  │
│    │  executor：                  │  │
│    │  • Source → 调 MiniMem API  │  │
│    │  • Transform → 数据变换     │  │
│    │  • LLM → 调大模型           │  │
│    │  • Output → 写文件/API/DB   │  │
│    │  • Control → 分支/循环逻辑  │  │
│    │  • Action → 调 MiniMem 操作 │  │
│    ├─────────────────────────────┤  │
│    │  3c. 存储输出                │  │
│    │  context.nodes[id] = output │  │
│    │  写入 node_runs 表          │  │
│    │  （含 input/output 快照）    │  │
│    └─────────────────────────────┘  │
│                                     │
│  控制流节点特殊处理：               │
│  • if-else: 根据条件决定哪些       │
│    下游节点被执行/跳过              │
│  • loop: 对列表每项重复执行        │
│    子图，收集所有输出              │
│  • parallel: 同层并发              │
│  • wait-all: 等待所有上游          │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│  Step 4: 完成                       │
│  • 汇总所有 output 节点的产出       │
│  • 更新 pipeline_runs 状态          │
│  • 更新 pipeline.last_run_*         │
│  • dry-run 模式：不执行 output 节点 │
└─────────────────────────────────────┘
```

### 5.2 DAG 执行引擎设计要点

1. **拓扑排序保证顺序**：先执行无依赖的节点（数据源），再执行依赖它们的节点（转换/LLM），最后执行输出节点
2. **同层并行**：同一拓扑层级的节点没有依赖关系，可以并发执行（Promise.allSettled）
3. **错误隔离**：单个节点失败不影响其他无关分支；有 `error-handler` 节点时走降级逻辑
4. **上下文传递**：所有节点输出存在统一的 `context.nodes[nodeId]` 中，下游节点通过 Handlebars 模板引用
5. **循环展开**：`loop` 节点会把子图复制 N 份（N = 列表长度），每份注入不同的 `item`，最终收集为数组
6. **dry-run 模式**：所有节点正常执行，但 Output 节点只记录"将会输出什么"，不实际写入

### 5.3 节点执行器架构

```typescript
// 每种节点类型对应一个 executor
interface NodeExecutor {
  type: string;
  execute(
    config: Record<string, unknown>,
    inputs: Record<string, unknown>,  // 按输入端口名 → 上游数据
    context: PipelineContext
  ): Promise<Record<string, unknown>>;  // 按输出端口名 → 输出数据
}

// 注册表模式，方便扩展
const executors = new Map<string, NodeExecutor>();
executors.set('memory-search', new MemorySearchExecutor());
executors.set('llm-chat', new LLMChatExecutor());
executors.set('filter', new FilterExecutor());
// ... 注册所有节点类型

// 执行引擎调用
const executor = executors.get(node.type);
const output = await executor.execute(node.config, inputs, context);
```

这种插件式架构让新增节点类型只需：**①实现 executor ②注册到 map ③前端加一个配置面板**——无需改动引擎代码。

---

## 六、非功能需求

### 6.1 安全

- Console 后端代理 MiniMem API 时，自动附加 JWT Token（如果 MiniMem 开启了认证）
- Console 自身的 Web UI 在本地运行，默认不需要登录（单人使用）
- 如果未来需要远程访问，可加简单的 Basic Auth

### 6.2 性能

- Dashboard 数据通过 TanStack Query 缓存，避免频繁请求
- Pipeline 执行是异步的，不阻塞 UI
- 报告列表做分页，不一次加载全部

### 6.3 可靠性

- Pipeline 执行失败不影响其他任务
- 每次运行都有记录，可追溯
- 定时调度器重启后自动恢复（从 SQLite 读取任务列表 + 上次运行时间）

### 6.4 可扩展性

- 新增节点类型只需：① 实现 `NodeExecutor` 接口 ② 注册到执行器 Map ③ 前端加一个配置面板组件
- 节点类型定义通过 `GET /api/node-types` 动态下发，前端根据 schema 自动渲染
- Pipeline 定义是纯 JSON（nodes + edges），可以导入/导出/版本控制
- 后续可加：自定义节点类型（用户编写 JS executor）、社区模板市场

---

## 七、MVP 范围与分期

### Phase 1: MVP（预计 5-7 天）

- [ ] 项目搭建（Vite + React + Hono + SQLite）
- [ ] MiniMem API 代理层
- [ ] Dashboard（统计 + 温度 + 健康 + 最近记忆）
- [ ] 记忆浏览器（分页 + 搜索 + 详情）
- [ ] Surface Files 预览
- [ ] Pipeline DAG 引擎（拓扑排序 + 按序执行 + 上下文传递）
- [ ] Pipeline 画布编辑器基础版（React Flow + 拖拽创建节点 + 连线）
- [ ] 核心节点实现：memory-search / filter / llm-chat / merge / output-file / output-console
- [ ] 内置"每日智能回顾"模板
- [ ] 运行记录 + 节点级调试面板 + 报告查看
- [ ] Cron 调度器

### Phase 2: 节点丰富 + 功能完善（预计 5-7 天）

- [ ] 更多数据源节点：memory-list / recall / surface / owner / person / inspiration
- [ ] 更多转换节点：sort / limit / group-by / template / javascript / json-path
- [ ] 更多 LLM 节点：llm-structured / llm-summarize / llm-extract
- [ ] 更多输出节点：output-minimem / output-webhook / output-email
- [ ] 控制流节点：if-else / loop / parallel / error-handler
- [ ] MiniMem 操作节点：dream-trigger / memory-write / snapshot-create
- [ ] 记忆管理（增删改 + 遗忘）
- [ ] Owner Profile / Person 管理
- [ ] Dream 管理（历史 + 触发）
- [ ] 灵感面板
- [ ] 更多内置模板（周报、月报、健康巡检、灵感孵化器）

### Phase 3: 体验优化 + 高级功能

- [ ] 暗色主题
- [ ] Prompt 编辑器升级：CodeMirror + 变量自动补全 + 实时预览
- [ ] Pipeline 导入/导出/版本管理
- [ ] dry-run 模式
- [ ] Pipeline 运行日志实时流式展示（SSE）
- [ ] 图表丰富化（温度变化趋势、记忆增长曲线等）
- [ ] Pipeline 模板市场（导入社区模板）
- [ ] 自定义节点类型（用户编写 JS executor）

---

## 八、开发注意事项

1. **MiniMem 零改动原则**：Console 不修改 MiniMem 任何代码。所有交互通过 REST API。
2. **LLM 复用**：Console 使用与 MiniMem 相同的 LLM 服务（DashScope），只是自己调用，不经过 MiniMem。
3. **数据隔离**：Console 有自己的 SQLite 数据库（`~/.minimem-console/console.db`），不碰 MiniMem 的 `~/.minimem/` 目录。
4. **Dream 报告读取**：Console 后端需要读取 MiniMem 的 `data/dreams/` 目录（只读），这需要配置 MiniMem 的 `data_dir` 路径。
5. **CORS**：前端只跟 Console 后端通信（同源），Console 后端代理转发给 MiniMem，不存在 CORS 问题。
