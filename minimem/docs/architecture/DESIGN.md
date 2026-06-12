# MiniMem — 个人统一记忆系统设计方案 v3

> **你的记忆，一个中心，所有 AI 共享。**
>
> MiniMem 是一个**以你为中心的统一记忆服务**，而非某个 AI 工具的附属品。
> 它作为独立的中央记忆服务器运行，通过 **MCP 协议**（AI 时代的 USB-C）
> 让 CodeBuddy、OpenClaw、以及未来任何 AI Agent 都能即插即用地读写你的记忆。
>
> 融合认知科学、2026 前沿开源记忆框架与类人做梦机制。
> 支持工作管理、社交记忆、人设构建、版本控制回溯与智能检索。

---

## 〇、设计演进说明

### v2 → v3 核心升级：从独立系统到统一记忆服务

> **v3 的核心哲学转变**：记忆属于你，不属于任何一个 AI 客户端。

v2 设计了一个强大但**独立封闭**的记忆系统。v3 解决了最关键的架构问题——**统一性与可接入性**，以及**可持续性**：

| 问题 | v2 的状态 | v3 的解决方案 |
|------|----------|-------------|
| CodeBuddy 如何使用？ | ❌ 未设计接入方式 | ✅ MCP Server — CodeBuddy 原生支持 MCP 协议 |
| OpenClaw 如何使用？ | ❌ 仅作为数据源 | ✅ REST API + MCP — 双通道接入 |
| 新的 AI Agent 如何接入？ | ❌ 无法接入 | ✅ MCP / REST / TypeScript SDK — 三种接入方式 |
| 记忆碎片化？ | ❌ 各处各的记忆 | ✅ 中央服务 — 所有 Agent 读写同一个记忆库 |
| 人设一致性？ | ❌ 每个 Agent 各自理解你 | ✅ 统一 Owner Profile — 所有 Agent 看到同一个"你" |
| 记忆归属？ | ⚠️ 未明确 | ✅ Owner = 你，Client = AI Agent，权限分级 |
| 🆕 记忆垃圾堆积？ | ❌ 无清理机制 | ✅ 五级温度模型 + 四种 GC 策略 + 渐进压缩 |
| 🆕 上下文爆炸？ | ❌ 直接灌入全部记忆 | ✅ Surface Files — 8 个极简文件，总预算 ≤ 10K tokens |
| 🆕 Agent 涌入失控？ | ❌ 无流控 | ✅ 入口流控 + 质量门控 + 来源信誉系统 |

**新增核心参考框架：**

| 框架/协议 | 核心贡献 | 融入位置 |
|-----------|---------|---------|
| **MCP** (Anthropic, 2024.11) | AI 工具标准化接入协议，10000+ 生态 | 统一接入层 → §三 |
| **SuperMemory MCP** (2025) | 跨 AI 平台记忆共享实践 | 接入架构参考 |
| **多Agent记忆架构** (UCSD, 2026.03) | 共享/分布式/混合三种模式分析 | 租户模型设计 |
| **HMO** (上海AI Lab, 2026.04) | 分层记忆编排，已集成到 OpenClaw + Claude Code | 分层缓存策略 |
| **🆕 Harness Engineering** (OpenAI, 2026) | AGENTS.md 应是目录表而非百科全书，≤100 行 | 表层文件系统 → §六 |
| **🆕 CLAUDE.md 机制** (Anthropic, 2026) | 上下文预算控制，/compact 压缩，50-200 行限制 | 上下文预算 → §六 |
| **🆕 MemGPT/Letta** (2025) | 虚拟上下文管理，记忆分页换入换出 | 冷热分离 → §七 |
| **🆕 AI Agent Memory 综述** (2025.12) | 统一分类体系、自主记忆进化、垃圾回收 | 记忆生命周期 → §七 |

### v1 → v2 核心升级（保留）

v2 在 v1 基础上，深度融合了 2025-2026 年以下 5 个前沿开源框架的核心理念：

| 框架 | 核心贡献 | 融入位置 |
|------|---------|---------|
| **Hindsight** (vectorize-io, 2025.12) | 四层结构化记忆网络 + TEMPR 四路混合检索（91% LongMemEval 准确率） | 记忆分层重构 → §八 |
| **Memoria** (MatrixOrigin, GTC 2026) | Git 式版本控制（快照/分支/合并/回滚）+ Copy-on-Write 引擎 | 新增版本控制层 → §九 |
| **DeepSeek Engram** (2026.01) | 条件记忆 O(1) 查找 + 稀疏激活 | 检索引擎增强 → §十 |
| **腾讯 Locas** (2026.02) | 侧挂记忆压缩（0.02% 额外参数，20 万字级） | 长文本记忆压缩 → §十 |
| **MemSifter** (2026.03) | 先思考再检索 + 轻量代理模型卸载 | 智能检索策略 → §十 |

同时保留 v1 的核心参考：MemoryOS、Mem0、AutoDream、Generative Agents、MLMF、认知科学。

---

## 一、需求场景分析

| 场景 | 核心能力 | 关键特征 | 接入方式 | 主要借鉴 |
|------|---------|---------|---------|---------|
| **CodeBuddy 编程助手** | 工作记忆 + 编码偏好 + 项目上下文 | IDE 内嵌使用、代码风格记忆、决策记录 | **MCP Server** | MCP 官方 Memory |
| **OpenClaw 社交聊天** | 对话摘要 + 记忆提取 + 人设丰富 | 多人对话、关系图谱、性格画像 | **REST API** | Hindsight、Locas |
| **日常工作管理** | 记忆存储 + 总结回顾 + 优先级规划 | 每日/每周维度、任务追踪 | **CLI + REST** | Memoria 版本控制 |
| **做梦机制** | 记忆整合 + 创造性联想 + 选择性遗忘 | 离线处理、情感权重、模式发现 | **内部调度** | AutoDream、Engram |
| **智能检索** | 精准回忆 + 关联扩展 + 低延迟 | 上下文感知、多策略并行 | **MCP + REST** | MemSifter、TEMPR |
| **🆕 第三方 AI Agent** | 接入记忆 + 贡献记忆 + 人设获取 | 标准协议、权限控制、审计追踪 | **MCP / REST / SDK** | SuperMemory、Mem0 |
| **🆕 人设 & 人格一致性** | 统一自我认知 + 跨平台一致表现 | 所有 Agent 看到同一个"你" | **Owner Profile API** | HMO |

---

## 二、架构总览

> **核心理念转变**：MiniMem 不是一个"嵌入到某个 App 的模块"，
> 而是一个**独立运行的中央记忆服务**，所有 AI Agent 作为客户端接入。

### 2.1 系统定位

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         你（Memory Owner）                               │
│                    所有记忆的唯一所有者                                    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
    ┌───────────────────────────┼───────────────────────────┐
    │                           │                           │
    ▼                           ▼                           ▼
┌─────────┐             ┌─────────────┐             ┌──────────────┐
│CodeBuddy│             │  OpenClaw   │             │ 未来 Agent X │
│  (IDE)  │             │  (社交App)  │             │  (任何AI)    │
│         │             │             │             │              │
│ MCP协议 │             │ REST API    │             │ MCP/REST/SDK │
└────┬────┘             └──────┬──────┘             └──────┬───────┘
     │                         │                           │
     └─────────────────────────┼───────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   MiniMem Gateway   │
                    │   ─────────────     │
                    │   · MCP Server      │  ← AI Agent 标准接入
                    │   · REST API        │  ← HTTP 通用接入
                    │   · TypeScript SDK  │  ← 代码级集成
                    │   · CLI             │  ← 命令行交互
                    │   · Auth & 权限控制  │
                    │   · 审计日志         │
                    └──────────┬──────────┘
                               │
                ┌──────────────▼──────────────┐
                │    MiniMem Core Engine       │
                │    (统一记忆引擎)             │
                └──────────────┬──────────────┘
                               │
                        ┌──────▼──────┐
                        │  统一存储层  │
                        └─────────────┘
```

### 2.2 内部分层架构

借鉴 **Hindsight** 四层结构 + **Memoria** 版本控制 + **MemSifter** 智能检索 + **Mem0** 选择性记忆 + **AutoDream** 做梦巩固 + **MCP** 标准接入 + **Surface Files** 上下文窗口优化 + 认知科学多重记忆理论：

```
┌───────────────────────────────────────────────────────────────────────┐
│                    MiniMem Memory System v3                           │
│                  「统一中央记忆服务」                                   │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │              🔌 Unified Access Layer（统一接入层）               │ │
│  │                                                                 │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │ │
│  │  │ MCP      │ │ REST     │ │ TS SDK   │ │ CLI      │          │ │
│  │  │ Server   │ │ API      │ │          │ │          │          │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │ │
│  │  + Owner Profile API  + Client Auth  + Rate Limit + Audit     │ │
│  └──────────────────────────────┬──────────────────────────────────┘ │
│                                 │                                     │
│  ┌──────────────────────────────▼──────────────────────────────────┐ │
│  │          📄 Surface Files Layer（表层文件系统）🆕               │ │
│  │                                                                 │ │
│  │  ┌──────┐┌──────┐┌──────┐┌───────┐┌──────┐┌──────┐┌────────┐ │ │
│  │  │me.md ││soul  ││work  ││social ││life  ││agent ││context │ │ │
│  │  │800t  ││.md   ││.md   ││.md    ││.md   ││.md   ││.md     │ │ │
│  │  │      ││1200t ││1500t ││1200t  ││1000t ││1000t ││1500t   │ │ │
│  │  └──────┘└──────┘└──────┘└───────┘└──────┘└──────┘└────────┘ │ │
│  │  总预算 ≤ 10K tokens · 按 Agent 类型裁剪 · 自动维护更新       │ │
│  └──────────────────────────────┬──────────────────────────────────┘ │
│                                 │                                     │
│  ┌──────────────────────────────▼──────────────────────────────────┐ │
│  │            📋 Business Modules（业务模块层）                     │ │
│  │                                                                 │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │ │
│  │  │ 工作助理  │  │ 社交记忆  │  │ 做梦引擎  │  │ Owner Profile │  │ │
│  │  │ Module   │  │ Module   │  │ Module   │  │ （人设中心）   │  │ │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │ │
│  └───────┼──────────────┼──────────────┼───────────────┼──────────┘ │
│          │              │              │               │             │
│  ┌───────▼──────────────▼──────────────▼───────────────▼───────────┐│
│  │              ⑤ Smart Retrieval Engine (MemSifter 式)            ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  ││
│  │  │ 语义检索  │ │ 关键词BM25│ │ 图遍历   │ │ 时间范围         │  ││
│  │  │ (Vector) │ │ (BM25)   │ │ (Graph)  │ │ (Temporal)       │  ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  ││
│  │  + Proxy Model 预筛选 (MemSifter)  + O(1) 条件触发 (Engram)   ││
│  └──────────────────────────────┬────────────────────────────────────┘│
│                                 │                                     │
│  ┌──────────────────────────────▼────────────────────────────────────┐│
│  │                   Memory Core Engine                              ││
│  │  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────┐       ││
│  │  │ 感知层       │ │ 加工层       │ │ 巩固层               │       ││
│  │  │ Perception  │ │ Processing  │ │ Consolidation        │       ││
│  │  │             │ │ + Locas压缩  │ │ (Dream Engine)       │       ││
│  │  └──────┬──────┘ └──────┬──────┘ └──────────┬───────────┘       ││
│  └─────────┼───────────────┼───────────────────┼────────────────────┘│
│            │               │                   │                      │
│  ┌─────────▼───────────────▼───────────────────▼────────────────────┐│
│  │        🔄 Memory Lifecycle Manager（记忆生命周期管理）🆕         ││
│  │                                                                   ││
│  │  🔥Hot → 🌡️Warm → 🌤️Cool → 🧊Cold → 🪦Frozen → ☠️Dead         ││
│  │  + 温度模型  + GC 策略  + 压缩管线  + 入口流控  + 健康监控      ││
│  └──────────────────────────────┬────────────────────────────────────┘│
│                                 │                                     │
│  ┌──────────────────────────────▼────────────────────────────────────┐│
│  │           ④ Version Control Layer (Memoria 式)                    ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           ││
│  │  │ Snapshot │ │ Branch   │ │ Diff     │ │ Rollback │           ││
│  │  │ 快照     │ │ 分支     │ │ 差异对比  │ │ 回滚     │           ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘           ││
│  └──────────────────────────────┬────────────────────────────────────┘│
│                                 │                                     │
│  ┌──────────────────────────────▼────────────────────────────────────┐│
│  │           Memory Store (Hindsight 四层结构)                        ││
│  │                                                                   ││
│  │  ┌─────────────┐  ┌─────────────┐  优先级: 高                    ││
│  │  │ L4 心智模型   │  │ L3 归纳观察  │  ←── 策划摘要 + 自动整合     ││
│  │  │ Mental Model │  │ Observations │                               ││
│  │  └─────────────┘  └─────────────┘                                ││
│  │  ┌─────────────┐  ┌─────────────┐  优先级: 低                    ││
│  │  │ L2 世界事实   │  │ L1 亲身经历  │  ←── 客观事实 + 交互记录     ││
│  │  │ World Facts  │  │ Experiences  │                               ││
│  │  └─────────────┘  └─────────────┘                                ││
│  │                                                                   ││
│  │  ┌─────────────────────┐  ┌──────────────────────────────┐       ││
│  │  │ 向量存储 (Embedding) │  │ 知识图谱 (Graph)             │       ││
│  │  └─────────────────────┘  └──────────────────────────────┘       ││
│  └───────────────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────────┘
```

---

## 三、统一接入层设计（v3 新增核心）

> **核心原则**：MiniMem 是一个**服务**，不是一个**库**。
> 它独立运行，通过标准协议对外暴露能力，任何 AI Agent 都是它的"客户端"。

### 3.1 为什么选择 MCP 作为主要接入协议？

| 维度 | MCP | 自定义 REST API | gRPC |
|------|-----|----------------|------|
| **AI Agent 生态** | ✅ 10000+ 服务器，CodeBuddy/Claude/Cursor 原生支持 | ⚠️ 需要每个 Agent 单独适配 | ❌ AI Agent 生态几乎不支持 |
| **接入成本** | ✅ 改一个配置文件即可 | ⚠️ 需要写 Agent 插件 | ❌ 需要代码生成 + 编译 |
| **标准化** | ✅ Anthropic 捐赠给 Linux Foundation，成为行业标准 | ❌ 私有协议 | ✅ 但 AI 领域不通用 |
| **工具发现** | ✅ 自动发现可用工具 | ❌ 需要文档对接 | ⚠️ 反射有但不友好 |
| **传输方式** | ✅ stdio（本地）+ HTTP+SSE（远程） | ✅ HTTP | ✅ HTTP/2 |

**结论**：MCP 是 AI Agent 世界的 USB-C，选择 MCP 等于自动兼容所有主流 AI 工具链。

### 3.2 四种接入方式

```
                    ┌─────────────────────────────────┐
                    │        MiniMem Gateway           │
                    ├─────────────────────────────────┤
                    │                                 │
                    │  ① MCP Server (stdio / HTTP)    │ ← AI Agent 首选
                    │  ② REST API (HTTP/JSON)         │ ← Web App / 移动端
                    │  ③ TypeScript SDK               │ ← Node.js 项目直接集成
                    │  ④ CLI                           │ ← 命令行 / 脚本 / cron
                    │                                 │
                    │  ┌─────────────────────────┐    │
                    │  │  Unified Core Interface  │    │ ← 四种方式共享同一内核
                    │  └─────────────────────────┘    │
                    └─────────────────────────────────┘
```

### 3.3 MCP Server 工具定义

MiniMem 作为 MCP Server 暴露以下工具（Tools），任何 MCP 兼容的 AI Agent 都可以直接调用：

```typescript
// ═══════════════════════════════════════
// MiniMem MCP Tools 定义
// ═══════════════════════════════════════

// 📝 记忆写入类
const mcpTools = {
  
  // ──── 基础记忆操作 ────
  
  /** 添加一条新记忆（自动分类到 L1-L4） */
  add_memory: {
    params: {
      content: string,         // 记忆内容
      source: string,          // 来源标识: "codebuddy" | "openclaw" | "agent_x" | ...
      content_type?: string,   // "conversation" | "event" | "reflection" | "decision"
      importance?: number,     // 0-1，不提供则自动评估
      tags?: string[],         // 自定义标签
      participants?: string[], // 相关人物
      context?: string,        // 当前上下文（帮助理解记忆）
    },
    returns: { memory_id: string, layer: 'L1' | 'L2' | 'L3' | 'L4' }
  },
  
  /** 批量添加记忆（如导入一天的聊天记录） */
  add_memories_batch: {
    params: {
      memories: Array<{
        content: string,
        source: string,
        timestamp?: string,    // ISO 8601，不提供则用当前时间
        content_type?: string,
        tags?: string[],
      }>,
    },
    returns: { added: number, memory_ids: string[] }
  },
  
  // ──── 智能检索 ────
  
  /** 搜索记忆（自动使用 TEMPR + MemSifter + Engram 三重引擎） */
  search_memory: {
    params: {
      query: string,           // 自然语言查询
      top_k?: number,          // 返回数量，默认 5
      time_range?: {           // 时间范围过滤
        from?: string,
        to?: string,
      },
      layers?: ('L1' | 'L2' | 'L3' | 'L4')[], // 指定层级
      sources?: string[],      // 指定来源过滤
      tags?: string[],         // 标签过滤
    },
    returns: { results: SearchResult[], total: number }
  },
  
  /** 获取某个实体/人物的所有相关记忆 */
  recall_about: {
    params: {
      entity: string,          // 人名、项目名、话题等
      include_related?: boolean, // 是否包含关联实体
      depth?: number,          // 图遍历深度，默认 2
    },
    returns: { facts: WorldFact[], observations: Observation[], relations: Relation[] }
  },
  
  // ──── Owner Profile（人设 & 人格中心）────
  
  /** 获取 Owner 的完整画像（所有 Agent 看到同一个"你"） */
  get_owner_profile: {
    params: {
      scope?: string,          // "full" | "work" | "social" | "coding"
    },
    returns: OwnerProfile
  },
  
  /** 获取 Owner 对特定话题的偏好/观点 */
  get_owner_preference: {
    params: {
      topic: string,           // "编程语言" | "工作风格" | "社交偏好" | ...
    },
    returns: { preferences: Preference[], confidence: number }
  },
  
  // ──── 人物画像 ────
  
  /** 获取某个人的画像 */
  get_person_profile: {
    params: {
      name: string,
    },
    returns: PersonProfile | null
  },
  
  // ──── 上下文增强 ────
  
  /** 为当前对话注入相关记忆上下文 */
  get_relevant_context: {
    params: {
      current_conversation: string,  // 当前对话内容
      max_tokens?: number,           // 上下文 token 限制
    },
    returns: {
      owner_profile_summary: string,  // Owner 的关键人设
      relevant_memories: string,      // 相关记忆摘要
      relevant_facts: string,         // 相关事实
      relevant_people: string,        // 涉及人物的画像
    }
  },
  
  // ──── 做梦 & 总结 ────
  
  /** 触发做梦（通常定时执行，也可手动） */
  trigger_dream: {
    params: {
      scope?: 'daily' | 'weekly' | 'deep',
    },
    returns: DreamReport
  },
  
  /** 获取今日/本周总结 */
  get_summary: {
    params: {
      period: 'today' | 'this_week' | 'this_month',
      focus?: string,          // "work" | "social" | "all"
    },
    returns: { summary: string, highlights: string[], insights: string[] }
  },
  
  // ──── 版本控制 ────
  
  /** 创建记忆快照 */
  create_snapshot: {
    params: { label?: string },
    returns: SnapshotRef
  },
  
  /** 对比两个时间点的记忆变化 */
  diff_memory: {
    params: {
      from_snapshot?: string,   // 快照ID 或 "yesterday" | "last_week"
      to_snapshot?: string,     // 默认当前
    },
    returns: MemoryDiff
  },
};
```

### 3.4 REST API 设计

REST API 与 MCP Tools 一一对应，用于非 MCP 环境（如 OpenClaw 后端、Web UI）：

```
POST   /api/v1/memory              → add_memory
POST   /api/v1/memory/batch        → add_memories_batch
GET    /api/v1/memory/search       → search_memory
GET    /api/v1/memory/recall/:entity → recall_about
GET    /api/v1/owner/profile       → get_owner_profile
GET    /api/v1/owner/preference    → get_owner_preference
GET    /api/v1/person/:name        → get_person_profile
POST   /api/v1/context/relevant    → get_relevant_context
POST   /api/v1/dream/trigger       → trigger_dream
GET    /api/v1/summary/:period     → get_summary
POST   /api/v1/snapshot            → create_snapshot
GET    /api/v1/snapshot/diff       → diff_memory

// 认证
POST   /api/v1/auth/token          → 获取访问令牌
GET    /api/v1/auth/clients        → 查看已注册的客户端

// 管理
GET    /api/v1/admin/stats         → 记忆统计
GET    /api/v1/admin/audit         → 审计日志
```

### 3.5 TypeScript SDK

```typescript
import { MiniMemClient } from '@minimem/sdk';

// 初始化客户端
const mem = new MiniMemClient({
  endpoint: 'http://localhost:3210',  // 或远程地址
  clientId: 'my-custom-agent',
  clientSecret: '...',
});

// 写入记忆
await mem.addMemory({
  content: '今天和 Alice 讨论了项目架构，决定用 Rust 重写后端',
  source: 'my-agent',
  tags: ['architecture', 'decision'],
  participants: ['Alice'],
});

// 搜索记忆
const results = await mem.searchMemory('Alice 最近在做什么');

// 获取 Owner 画像
const profile = await mem.getOwnerProfile({ scope: 'coding' });

// 获取对话上下文增强
const context = await mem.getRelevantContext({
  currentConversation: '帮我写一个 React 组件',
});
```

---

## 四、多客户端接入方案（v3 新增核心）

### 4.1 CodeBuddy 接入方案

> **接入方式**：MCP Server（CodeBuddy 原生支持 MCP）
> **配置成本**：改一个配置文件，零代码

#### 配置方法

在 CodeBuddy 的 MCP 配置中添加 MiniMem Server：

```json
// CodeBuddy MCP 配置
{
  "mcpServers": {
    "minimem": {
      "command": "npx",
      "args": ["-y", "@minimem/mcp-server"],
      "env": {
        "MINIMEM_DATA_DIR": "~/.minimem",
        "MINIMEM_OWNER": "your-name"
      }
    }
  }
}
```

或者如果 MiniMem 作为独立服务运行（推荐）：

```json
{
  "mcpServers": {
    "minimem": {
      "type": "http",
      "url": "http://localhost:3210/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

#### CodeBuddy 中的使用效果

配置完成后，CodeBuddy 在与你对话时会自动：

```
1. 对话开始 → 调用 get_relevant_context
   "Remembering... 我知道你偏好 TypeScript + Bun，
    上次你在做 MiniMem 项目，使用 SQLite 存储..."

2. 你做了一个技术决策 → 自动调用 add_memory
   source: "codebuddy", content_type: "decision"
   "用户决定在 MiniMem 中使用 Qdrant 而不是 ChromaDB"

3. 你提到了一个人 → 调用 recall_about
   "Alice 是你的同事，主要做前端，最近在学 Vue..."

4. 日终 → 调用 get_summary
   "今天你主要在做 MiniMem 的接入层设计..."
```

### 4.2 OpenClaw 接入方案

> **接入方式**：REST API（OpenClaw 后端直接调用）
> **数据流向**：双向 — 既向 MiniMem 贡献聊天记忆，又从 MiniMem 获取人设

```
┌──────────────────────────────────────────────────────────────┐
│                        OpenClaw                               │
│                                                              │
│  群聊消息 ──→ 聊天总结器 ──→ POST /api/v1/memory/batch       │
│                            （每日批量写入聊天摘要到 MiniMem）   │
│                                                              │
│  AI 回复 ←── 上下文注入 ←── GET /api/v1/context/relevant     │
│                            （从 MiniMem 获取人设 + 相关记忆）  │
│                                                              │
│  人设展示 ←── 人设卡片  ←── GET /api/v1/person/:name         │
│                            （从 MiniMem 获取人物画像）         │
│                                                              │
│  关系图 ←──  关系展示   ←── GET /api/v1/memory/recall/:entity │
│                            （从 MiniMem 获取关系网络）         │
└──────────────────────────────────────────────────────────────┘
```

#### OpenClaw 集成代码示例

```typescript
// OpenClaw 后端 — 每日聊天摘要同步到 MiniMem
async function syncDailyChatToMiniMem(chatMessages: Message[]) {
  const mem = new MiniMemClient({ endpoint: MINIMEM_URL, clientId: 'openclaw' });
  
  // 批量写入今日聊天
  await mem.addMemoriesBatch(chatMessages.map(msg => ({
    content: `${msg.sender}: ${msg.content}`,
    source: 'openclaw',
    timestamp: msg.timestamp,
    content_type: 'conversation',
    tags: [msg.channel],
    participants: [msg.sender],
  })));
}

// OpenClaw AI 回复前 — 注入记忆上下文
async function enrichAIContext(currentChat: string): Promise<string> {
  const mem = new MiniMemClient({ endpoint: MINIMEM_URL, clientId: 'openclaw' });
  
  const ctx = await mem.getRelevantContext({
    currentConversation: currentChat,
    maxTokens: 2000,
  });
  
  return `
    [Owner 人设] ${ctx.owner_profile_summary}
    [相关记忆] ${ctx.relevant_memories}
    [涉及人物] ${ctx.relevant_people}
    
    [当前对话]
    ${currentChat}
  `;
}
```

### 4.3 自定义 AI Agent 接入方案

> **接入方式**：MCP Server 或 REST API 或 TypeScript SDK
> **设计目标**：5 分钟内完成接入

#### 方式一：MCP 接入（推荐，适合 AI 编码助手、聊天机器人等）

```json
// 任何支持 MCP 的 AI Agent 只需添加此配置
{
  "mcpServers": {
    "minimem": {
      "type": "http",
      "url": "http://localhost:3210/mcp"
    }
  }
}
```

接入后，AI Agent 自动获得以下能力：
- `add_memory` — 贡献新记忆
- `search_memory` — 搜索历史记忆
- `get_owner_profile` — 了解 Owner 是谁（人设/人格/偏好）
- `get_relevant_context` — 获取对话相关的记忆上下文
- `recall_about` — 了解某个人/某个话题

#### 方式二：REST API 接入（适合 Web App、移动端、Python/Go 等非 TS 项目）

```python
# Python Agent 接入示例
import requests

MINIMEM_URL = "http://localhost:3210/api/v1"

# 写入记忆
requests.post(f"{MINIMEM_URL}/memory", json={
    "content": "用户说他更喜欢 dark mode",
    "source": "my-python-agent",
    "content_type": "preference",
})

# 搜索记忆
results = requests.get(f"{MINIMEM_URL}/memory/search", params={
    "query": "用户的界面偏好",
}).json()

# 获取 Owner 画像
profile = requests.get(f"{MINIMEM_URL}/owner/profile").json()
```

#### 方式三：TypeScript SDK（适合 Node.js/Bun 项目直接集成）

见 §3.5 的代码示例。

### 4.4 记忆贡献协议

> 每个 Agent 在向 MiniMem 贡献记忆时，必须遵循统一的贡献协议

```typescript
interface MemoryContribution {
  // 必填
  content: string;              // 记忆内容
  source: string;               // 客户端标识（全局唯一）
  
  // 推荐
  content_type: ContentType;    // 内容类型
  timestamp: string;            // ISO 8601
  
  // 可选
  importance: number;           // 0-1，不填则自动评估
  tags: string[];
  participants: string[];
  context: string;              // 当时的上下文
  
  // 自动填充（客户端不需要关心）
  // client_id: 自动从 auth 获取
  // layer: 自动分类
  // condition_keys: 自动提取
  // embedding: 自动生成
}

type ContentType = 
  | 'conversation'   // 对话
  | 'decision'       // 决策
  | 'reflection'     // 反思
  | 'event'          // 事件
  | 'preference'     // 偏好
  | 'learning'       // 学习
  | 'observation'    // 观察
  | 'dream_insight'; // 做梦洞察
```

---

## 五、记忆归属与租户模型（v3 新增核心）

### 5.1 Owner-Client 模型

> **核心原则**：记忆属于 Owner（你），而非 Client（AI Agent）。
> 所有 Agent 都是你记忆的"读者 + 贡献者"，但你是唯一的"所有者"。

```
                    ┌─────────────┐
                    │   Owner     │
                    │   (你)      │
                    │             │
                    │  · 唯一所有者│
                    │  · 完全控制权│
                    │  · 删除权   │
                    │  · 导出权   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
    │ Client A  │   │ Client B  │   │ Client C  │
    │ CodeBuddy │   │ OpenClaw  │   │ Agent X   │
    │           │   │           │   │           │
    │ 权限:     │   │ 权限:     │   │ 权限:     │
    │ · 读全部   │   │ · 读全部   │   │ · 读限定  │
    │ · 写标记源 │   │ · 写标记源 │   │ · 写标记源│
    │ · 不可删除 │   │ · 不可删除 │   │ · 不可删除│
    └───────────┘   └───────────┘   └───────────┘
```

### 5.2 权限模型

```typescript
interface ClientPermission {
  client_id: string;           // 全局唯一，如 "codebuddy", "openclaw"
  client_name: string;         // 显示名
  
  permissions: {
    // 读权限
    read_layers: ('L1' | 'L2' | 'L3' | 'L4')[]; // 可读的记忆层级
    read_scopes: string[];     // 可读的范围，如 ["work", "social", "all"]
    read_sources: string[];    // 可读的来源，["*"] 表示全部
    
    // 写权限
    can_write: boolean;        // 能否写入新记忆
    write_source_tag: string;  // 写入时的来源标记（强制携带）
    
    // 特殊权限
    can_trigger_dream: boolean;  // 能否触发做梦
    can_create_snapshot: boolean;// 能否创建快照
    can_read_audit: boolean;     // 能否查看审计日志
  };
  
  rate_limit: {
    reads_per_minute: number;
    writes_per_minute: number;
  };
  
  created_at: Date;
  last_active: Date;
}

// 预设权限模板
const permissionTemplates = {
  // 完全信任的客户端（自己开发的）
  trusted: {
    read_layers: ['L1', 'L2', 'L3', 'L4'],
    read_scopes: ['all'],
    read_sources: ['*'],
    can_write: true,
    can_trigger_dream: true,
    can_create_snapshot: true,
    can_read_audit: true,
  },
  
  // 标准客户端（第三方 Agent）
  standard: {
    read_layers: ['L2', 'L3', 'L4'],  // 不暴露原始对话（L1）
    read_scopes: ['all'],
    read_sources: ['*'],
    can_write: true,
    can_trigger_dream: false,
    can_create_snapshot: false,
    can_read_audit: false,
  },
  
  // 只读客户端
  readonly: {
    read_layers: ['L3', 'L4'],  // 只看观察和心智模型
    read_scopes: ['all'],
    read_sources: ['*'],
    can_write: false,
    can_trigger_dream: false,
    can_create_snapshot: false,
    can_read_audit: false,
  },
};
```

### 5.3 Owner Profile — 统一人设中心

> 这是实现"所有 Agent 看到同一个你"的核心。

```typescript
interface OwnerProfile {
  // ═══ 基础身份 ═══
  identity: {
    name: string;
    aliases: string[];          // 其他名字/昵称
    bio: string;                // 一句话自我介绍
    locale: string;             // "zh-CN"
    timezone: string;           // "Asia/Shanghai"
  };
  
  // ═══ 人格特质 ═══
  personality: {
    traits: string[];           // ["理性", "好奇", "追求效率"]
    communication_style: string;// "直接高效，偏好结构化表达"
    thinking_style: string;     // "系统性思考，喜欢从第一性原理出发"
    values: string[];           // ["技术卓越", "持续学习", "开源精神"]
  };
  
  // ═══ 工作画像 ═══
  work: {
    role: string;               // "全栈工程师"
    focus_areas: string[];      // ["AI Agent", "记忆系统", "前端架构"]
    tech_stack: {
      languages: string[];      // ["TypeScript", "Rust", "Python"]
      frameworks: string[];     // ["React", "Bun", "SQLite"]
      tools: string[];          // ["CodeBuddy", "Git", "Docker"]
    };
    coding_preferences: {
      style: string;            // "函数式优先，类型安全"
      naming: string;           // "camelCase for vars, PascalCase for types"
      documentation: string;    // "代码即文档，关键处加注释"
    };
    work_patterns: string[];    // ["早起型", "深度工作偏好上午", "周末学习新技术"]
  };
  
  // ═══ 社交画像 ═══
  social: {
    circle: string[];           // 主要社交圈标签
    interaction_style: string;  // "热心分享，喜欢深度讨论"
    topics_of_interest: string[];
  };
  
  // ═══ 偏好系统 ═══
  preferences: {
    topic: string;
    preference: string;
    confidence: number;
    evidence_count: number;     // 支撑此偏好的记忆数量
    last_updated: Date;
  }[];
  
  // ═══ 活跃的心智模型（L4 最高优先级） ═══
  active_mental_models: MentalModel[];
  
  // ═══ 元数据 ═══
  version: number;              // Profile 版本号
  last_updated: Date;
  update_sources: string[];     // 哪些 Agent 贡献了此画像
}
```

#### Owner Profile 如何被各 Agent 使用

```
┌─────────────────────────────────────────────────────────────────┐
│                    Owner Profile 使用矩阵                        │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                  │
│  CodeBuddy   │  读取: work.tech_stack, work.coding_preferences  │
│              │  效果: "我知道你用 TypeScript + Bun，偏好函数式"   │
│              │  贡献: 更新 work.focus_areas, 新增 decisions      │
│              │                                                  │
│  OpenClaw    │  读取: social, personality, preferences           │
│              │  效果: "你在群里的风格是直接高效的技术讨论"         │
│              │  贡献: 更新 social.topics, 人物关系图谱            │
│              │                                                  │
│  Agent X     │  读取: identity, personality, preferences         │
│              │  效果: "你更偏好结构化的回答，不喜欢啰嗦"          │
│              │  贡献: 新的 preference 数据                       │
│              │                                                  │
│  做梦引擎    │  读取: 全部                                       │
│              │  效果: 整合所有 Agent 的贡献，更新 Profile         │
│              │  贡献: 归纳新的 personality traits, 发现新 pattern │
│              │                                                  │
└──────────────┴──────────────────────────────────────────────────┘
```

### 5.4 记忆来源追踪 & 审计

每条记忆都携带完整的来源信息，永远知道"这条记忆是谁贡献的"：

```typescript
interface MemoryProvenance {
  memory_id: string;
  
  // 谁写入的
  contributed_by: {
    client_id: string;         // "codebuddy" | "openclaw" | "agent_x"
    client_name: string;
    timestamp: Date;
  };
  
  // 被谁读取过
  accessed_by: {
    client_id: string;
    timestamp: Date;
    purpose: string;           // "search" | "context" | "dream"
  }[];
  
  // 演进历史
  evolution: {
    original_layer: string;    // 最初写入的层级
    current_layer: string;     // 当前层级（可能被做梦引擎提升）
    promoted_by?: string;      // 谁触发了提升
    merged_from?: string[];    // 是否由多条记忆合并而来
  };
}
```

### 5.5 一致性保障

> **核心挑战**：多个 Agent 同时读写，如何保持记忆一致性？

```typescript
// 一致性策略
const consistencyPolicy = {
  // 读一致性：每个 Agent 看到的记忆状态是最新的
  read_consistency: 'strong',   // SQLite WAL 模式保证
  
  // 写冲突解决
  write_conflict: {
    // 同一事实被两个 Agent 不同描述
    strategy: 'last_write_wins_with_audit',
    // 保留两个版本，标记冲突，做梦时解决
    dream_resolution: true,
  },
  
  // Owner Profile 更新策略
  profile_update: {
    // 只有做梦引擎和 Owner 手动才能修改核心人格
    core_personality: 'dream_or_manual_only',
    // 偏好可以被任何 Agent 更新（低权重）
    preferences: 'any_client_with_low_confidence',
    // 工作画像允许 CodeBuddy 直接更新
    work_profile: 'trusted_clients_only',
  },
};
```

---

## 六、表层文件系统 — Surface Files（v3 新增核心）

> **核心哲学**：记忆系统的深度应该无限，但暴露给 AI 的"窗口"必须极简。
>
> 借鉴 OpenAI Harness Engineering "AGENTS.md 应该是目录表而非百科全书"
> 和 Claude Code "CLAUDE.md 控制在 50-200 行"的原则——
> **Surface Files 是记忆海洋上的几块浮板，每块浮板不超过一屏。**

### 6.1 为什么需要 Surface Files？

当多个 Agent 接入 MiniMem 后，记忆系统会快速积累数以万计的记忆条目。
但 LLM 的上下文窗口是**有限的**（4K-200K tokens），直接灌入海量记忆 = 灾难：

| 问题 | 不做 Surface Files | 有 Surface Files |
|------|-------------------|-----------------|
| Agent 启动速度 | ❌ 每次加载上万条记忆，慢 | ✅ 加载 5-8 个小文件，毫秒级 |
| 上下文占用 | ❌ 记忆占满窗口，无法工作 | ✅ 严格预算，留足工作空间 |
| 信息质量 | ❌ 垃圾和精华混在一起 | ✅ 只有浓缩的高价值信息 |
| 跨 Agent 一致性 | ❌ 每个 Agent 检索到不同子集 | ✅ 所有 Agent 看到同一组文件 |
| 人类可读性 | ❌ 数据库不可读 | ✅ Markdown 文件，直接阅读编辑 |
| 维护成本 | ❌ 记忆越多越混乱 | ✅ 自动压缩 + 智能裁剪 |

### 6.2 Surface Files 设计总览

```
~/.minimem/surfaces/
├── me.md           ← 我是谁（身份、人格、核心价值观）
├── soul.md         ← 灵魂画像（深层特质、思维模式、人生信条）
├── work.md         ← 工作画像（技术栈、项目、编码风格、职业目标）
├── social.md       ← 社交画像（重要人物、关系网络、社交风格）
├── life.md         ← 生活画像（兴趣爱好、日常习惯、健康、计划）
├── agent.md        ← Agent 行为规范（如何对待我、沟通偏好、禁忌）
├── context.md      ← 当前上下文（近期焦点、活跃任务、最近事件）
└── index.md        ← 目录索引（所有文件概述 + 深层记忆检索入口）
```

### 6.3 各文件详细定义

#### 📌 `me.md` — 我是谁（核心身份，最高优先级）

> **角色**：所有 Agent 首先读取的文件，定义"你是谁"
> **预算**：≤ 800 tokens（~40 行 Markdown）
> **更新频率**：极低（仅重大人生变化时更新）

```markdown
# Me

## 基础
- 名字: 乐林
- 时区: Asia/Shanghai
- 语言: 中文为主，英文流利

## 核心身份
- 全栈工程师，专注 AI Agent 与记忆系统
- 独立开发者，追求技术卓越与产品美感

## 价值观
- 技术应该服务于人，而非相反
- 简洁 > 复杂，实用 > 理论
- 持续学习，永远好奇

## 沟通偏好
- 直接高效，不要寒暄
- 偏好结构化输出（表格、列表）
- 讨厌啰嗦和无意义的客套
```

#### 🔮 `soul.md` — 灵魂画像（深层人格，做梦引擎维护）

> **角色**：捕捉"不会变的你"——思维方式、直觉模式、深层信念
> **预算**：≤ 1200 tokens（~60 行）
> **更新频率**：低（做梦引擎每周更新，需人工审阅重大变更）

```markdown
# Soul

## 思维模式
- 系统性思考，习惯从第一性原理出发
- 决策偏理性，但直觉也很准
- 喜欢类比推理，用熟悉的领域理解新概念

## 人格特质
- INTJ 倾向：战略型思考者
- 高效率驱动，讨厌重复劳动
- 完美主义但能接受 80/20 法则

## 深层偏好
- 工具选择: 偏好一个工具做好一件事（Unix 哲学）
- 学习方式: 先全局理解架构，再深入细节
- 创造模式: 深夜灵感型 + 晨间执行型

## 信念
- 好的架构设计能减少 80% 的后续问题
- 代码是给人读的，顺便给机器执行
```

#### 💼 `work.md` — 工作画像（Agent 日常参考最多的文件）

> **角色**：CodeBuddy 等编程 Agent 的核心参考
> **预算**：≤ 1500 tokens（~80 行）
> **更新频率**：中（项目变更、技术栈变化时更新）

```markdown
# Work

## 技术栈
- 主力: TypeScript, Rust, Python
- 前端: React, Next.js, Tailwind
- 后端: Bun/Node.js, Hono, SQLite
- AI: LLM API, MCP, Embedding, RAG
- 工具: CodeBuddy, Git, Docker

## 编码风格
- 函数式优先，最小化 class 使用
- 类型安全: 严格 TypeScript，zod 校验
- 命名: camelCase 变量, PascalCase 类型
- 注释: 代码即文档，关键处加 why-not-what

## 活跃项目
- **MiniMem**: 个人统一记忆系统（核心项目）
  - 阶段: 设计完成 → 即将开发
  - 技术: TypeScript + Bun + SQLite + MCP
- **OpenClaw**: 社交 AI 应用
  - 角色: 主要开发者

## 工作模式
- 深度工作: 上午 9-12 点效率最高
- 偏好: 先设计后编码，文档驱动开发
- 代码审查: 关注架构合理性而非格式

## 近期决策 (↻ 自动维护)
- [2026-04-07] MiniMem 采用 MCP 作为主接入协议
- [2026-04-07] 记忆归属模型: Owner-Client 分离
```

#### 👥 `social.md` — 社交画像（OpenClaw 等社交 Agent 的核心参考）

> **角色**：社交场景下"认识谁、关系如何"的速查表
> **预算**：≤ 1200 tokens（~60 行）
> **更新频率**：中（新认识重要的人、关系变化时更新）

```markdown
# Social

## 社交风格
- 讨论风格: 直接，偏好深度技术讨论
- 乐于分享: 技术经验、开源项目、工具推荐
- 不擅长/不喜欢: 无营养闲聊、八卦

## 核心圈子
- **Alice**: 同事/朋友，前端工程师，最近在学 Vue
  - 关系: 密切，经常讨论技术
  - 特征: 直率，技术好奇心强
- **Bob**: 合作伙伴，后端架构师
  - 关系: 工作伙伴
  - 特征: 稳重，偏保守技术选型

## 关注话题
- AI Agent 开发, 记忆系统, MCP 协议
- 开源生态, 独立开发, 产品设计

## 社交网络 (→ 详细画像见深层记忆)
- 常用平台: [按需填充]
- 活跃社群: [按需填充]
```

#### 🌿 `life.md` — 生活画像

> **角色**：非工作场景的 Agent 参考（健康、兴趣、计划等）
> **预算**：≤ 1000 tokens（~50 行）
> **更新频率**：中（生活状态变化时更新）

```markdown
# Life

## 兴趣爱好
- 技术: AI/机器学习, 系统设计, 开源
- 阅读: 科幻, 哲学, 技术博客
- [其他: 按需填充]

## 日常习惯
- 早起型，深度工作集中在上午
- 咖啡爱好者
- [按需填充]

## 健康 (可选)
- [用户自行决定是否记录]

## 近期计划 (↻ 自动维护)
- MiniMem v3 开发启动
- [按需填充]

## 人生目标 (长期)
- 构建有影响力的开源 AI 工具
- [按需填充]
```

#### 🤖 `agent.md` — Agent 行为规范（如何与我交互）

> **角色**：指导所有 Agent "如何对待我"，类似 CLAUDE.md 的角色
> **预算**：≤ 1000 tokens（~50 行）
> **更新频率**：低（免疫系统式——Agent 犯错一次，加一条规则）

```markdown
# Agent 行为规范

## 沟通规则
- 用中文回答，技术术语可用英文
- 结构化输出: 表格 > 列表 > 段落
- 不要寒暄，直奔主题
- 不确定的事情要说明，不要编造

## 代码规则
- 优先修改现有文件，不要重写
- 新代码必须有类型定义
- 遵循项目现有风格（见 work.md）

## 禁忌
- 不要过度解释显而易见的事情
- 不要在没被要求时重构大量代码
- 不要假设我不懂技术细节

## 偏好
- 给方案时先给结论，再给推理过程
- 遇到多种方案时，推荐一个并说明理由
- 代码修改尽量最小化影响范围
```

#### ⚡ `context.md` — 当前上下文（唯一的高频更新文件）

> **角色**："此刻的我"——近期焦点、活跃任务、最近发生了什么
> **预算**：≤ 1500 tokens（~80 行）
> **更新频率**：高（每次会话结束/每日做梦时更新）
> **特殊**：这是唯一频繁变化的 Surface File

```markdown
# 当前上下文

## 最后更新: 2026-04-07T11:30+08:00

## 🔥 当前焦点
- MiniMem v3 设计文档完善中
  - 刚完成: 统一接入层、记忆归属模型
  - 进行中: 表层文件系统、记忆生命周期管理
  - 下一步: 开始编码实现

## 📋 活跃任务
1. [进行中] MiniMem DESIGN.md v3 完善
2. [待开始] MiniMem 项目初始化 + Phase 1 开发
3. [待定] OpenClaw 集成规划

## 📰 最近事件 (7 天内)
- [04-07] 设计了 Surface Files 和记忆生命周期管理
- [04-07] 确定了 MCP 作为主接入协议
- [04-07] 设计了 Owner-Client 记忆归属模型

## 💡 待处理想法
- 考虑 MiniMem 是否需要 Web UI
- 探索本地小模型做 MemSifter 代理

## 🔗 相关深层记忆
- → search_memory("MiniMem 设计决策")
- → search_memory("近期工作进展")
```

#### 📑 `index.md` — 目录索引（Surface Files 的"目录表"）

> **角色**：所有文件的索引 + 深层记忆的检索入口
> **预算**：≤ 500 tokens（~25 行）
> **更新频率**：极低（仅文件结构变化时更新）

```markdown
# MiniMem Surface Files 索引

## 文件清单
| 文件 | 职责 | 预算 | 更新频率 |
|------|------|------|---------|
| me.md | 核心身份 | 800 tok | 极低 |
| soul.md | 灵魂画像 | 1200 tok | 低 |
| work.md | 工作画像 | 1500 tok | 中 |
| social.md | 社交画像 | 1200 tok | 中 |
| life.md | 生活画像 | 1000 tok | 中 |
| agent.md | Agent 规范 | 1000 tok | 低 |
| context.md | 当前上下文 | 1500 tok | 高 |

## 总预算: ≤ 8200 tokens（所有文件加载）

## 深层记忆检索
当 Surface Files 信息不够时，使用 MCP 工具检索:
- `search_memory(query)` → 全文检索深层记忆
- `recall_about(entity)` → 获取实体详细信息
- `get_relevant_context(conversation)` → 对话上下文增强
```

### 6.4 上下文预算控制机制（Context Budget）

> **核心原则**：Surface Files 的总占用永远不能超过 LLM 上下文窗口的 **15%**。
> 以 200K token 窗口为例，Surface Files 预算上限 = **30K tokens**。
> 但我们追求更激进的目标：**≤ 10K tokens**（5%），为工作留足 95% 空间。

```typescript
interface ContextBudget {
  // ═══ 全局预算 ═══
  total_budget_tokens: number;         // 总预算上限，默认 10000 tokens
  
  // ═══ 各文件预算分配 ═══
  file_budgets: {
    'me.md':      800,                 // 核心身份
    'soul.md':    1200,                // 灵魂画像
    'work.md':    1500,                // 工作画像
    'social.md':  1200,                // 社交画像
    'life.md':    1000,                // 生活画像
    'agent.md':   1000,                // Agent 规范
    'context.md': 1500,                // 当前上下文
    'index.md':   500,                 // 目录索引
  };
  // 合计: 8700 tokens，留 1300 tokens 余量
  
  // ═══ 预算策略 ═══
  strategy: {
    // 当文件超出预算时的处理方式
    on_budget_exceeded: 'compress' | 'truncate' | 'alert';
    
    // 按 Agent 类型裁剪（不是所有 Agent 需要所有文件）
    agent_profiles: {
      // CodeBuddy: 需要 me + work + agent + context（工作场景）
      'codebuddy':  ['me.md', 'work.md', 'agent.md', 'context.md'],
      // OpenClaw: 需要 me + soul + social + context（社交场景）
      'openclaw':   ['me.md', 'soul.md', 'social.md', 'context.md'],
      // 通用 Agent: 加载全部
      'default':    ['me.md', 'soul.md', 'work.md', 'social.md', 
                     'life.md', 'agent.md', 'context.md', 'index.md'],
    };
    
    // 预算紧急模式（上下文窗口很小的模型）
    compact_mode: {
      enabled_when: 'context_window < 32000',
      // 紧凑模式下只加载最核心文件
      core_files: ['me.md', 'agent.md', 'context.md'],
      // 预算压缩到 3000 tokens
      compact_budget: 3000,
    };
  };
}
```

### 6.5 Surface Files 与深层记忆的关系

```
┌──────────────────────────────────────────────────────────────┐
│              Surface Files（表层 · 上下文窗口内）              │
│                                                              │
│  ┌─────┐ ┌──────┐ ┌──────┐ ┌───────┐ ┌──────┐ ┌──────────┐│
│  │me.md│ │soul  │ │work  │ │social │ │life  │ │context.md││
│  │     │ │.md   │ │.md   │ │.md    │ │.md   │ │          ││
│  │800t │ │1200t │ │1500t │ │1200t  │ │1000t │ │1500t     ││
│  └──┬──┘ └──┬───┘ └──┬───┘ └──┬────┘ └──┬───┘ └────┬─────┘│
│     │       │       │       │       │          │      │
│ ════╪═══════╪═══════╪═══════╪═══════╪══════════╪══════╪═══ │
│     │       │       │       │       │          │      │    │
│     ▼       ▼       ▼       ▼       ▼          ▼      │    │
│  ┌──────────────────────────────────────────────┐     │    │
│  │         Deep Memory（深层 · 按需检索）         │     │    │
│  │                                              │     │    │
│  │  L4 心智模型 ← soul.md 来源                   │     │    │
│  │  L3 归纳观察 ← work.md/social.md 来源         │     │    │
│  │  L2 世界事实 ← 所有文件的证据链                │     │    │
│  │  L1 亲身经历 ← context.md 引用                │     │    │
│  │                                              │     │    │
│  │  向量索引 ──→ search_memory() 按需检索         │◀────┘    │
│  │  知识图谱 ──→ recall_about() 按需检索          │          │
│  └──────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────┘

数据流向:
  📥 深层 → 表层: 做梦引擎/加工层 自动提炼精华写入 Surface Files
  📤 表层 → 深层: Surface Files 中的引用 → 按需触发深层检索
  🔄 自动维护: 做梦引擎每日/每周自动更新 Surface Files
```

### 6.6 Surface Files 自动维护引擎

> Surface Files 不是静态文件——它们由系统自动维护，始终反映记忆的最新精华。

```typescript
interface SurfaceFileEngine {
  // ═══ 自动更新触发器 ═══
  triggers: {
    // context.md: 每次会话结束后更新
    on_session_end:   ['context.md'];
    // work.md: 技术决策、项目变更时更新
    on_work_change:   ['work.md', 'context.md'];
    // social.md: 新认识重要的人、关系变化时更新
    on_social_change: ['social.md'];
    // soul.md, me.md: 仅做梦引擎周期性更新
    on_weekly_dream:  ['soul.md', 'me.md', 'life.md'];
    // 全部: 每日做梦后检查一遍
    on_daily_dream:   ['context.md', 'work.md'];
  };
  
  // ═══ 更新流程 ═══
  async updateFile(fileName: SurfaceFileName): Promise<void> {
    // 1. 读取当前文件内容
    const current = await readSurfaceFile(fileName);
    
    // 2. 从深层记忆检索新信息
    const newInfo = await queryRelevantMemories(fileName);
    
    // 3. LLM 智能合并（保持格式、精简、不超预算）
    const updated = await llm.merge({
      current,
      newInfo,
      budget: FILE_BUDGETS[fileName],
      instructions: `
        保持 Markdown 格式不变。
        只更新有变化的部分。
        严格控制在 ${FILE_BUDGETS[fileName]} tokens 以内。
        优先保留高重要性、高频访问的信息。
        移除过时或低价值的内容。
      `,
    });
    
    // 4. 预算检查
    const tokens = countTokens(updated);
    if (tokens > FILE_BUDGETS[fileName]) {
      // 触发压缩
      return await compressFile(fileName, updated);
    }
    
    // 5. 写入（带版本追踪）
    await writeSurfaceFile(fileName, updated);
  };
  
  // ═══ 压缩机制 ═══
  async compressFile(
    fileName: SurfaceFileName, 
    content: string
  ): Promise<void> {
    const compressed = await llm.compress({
      content,
      budget: FILE_BUDGETS[fileName],
      strategy: 'preserve_structure_drop_details',
      instructions: `
        文件超出预算。请压缩:
        1. 保留所有 ## 标题结构
        2. 合并相似条目
        3. 移除最久未被检索引用的内容
        4. 将详细描述替换为一句话摘要
        5. 被移除的内容会保留在深层记忆中，不会丢失
      `,
    });
    
    await writeSurfaceFile(fileName, compressed);
  };
}
```

### 6.7 Agent 加载策略

> 不同 Agent 不需要加载全部文件——按场景裁剪，最小化上下文占用。

```
┌──────────────────────────────────────────────────────────────┐
│                  Agent 文件加载矩阵                           │
├──────────┬──────┬──────┬──────┬───────┬──────┬──────┬───────┤
│          │me.md │soul  │work  │social │life  │agent │context│
│          │      │.md   │.md   │.md    │.md   │.md   │.md    │
├──────────┼──────┼──────┼──────┼───────┼──────┼──────┼───────┤
│CodeBuddy │  ✅  │  ○   │  ✅  │  ○    │  ○   │  ✅  │  ✅   │
│          │      │      │      │       │      │      │       │
│OpenClaw  │  ✅  │  ✅  │  ○   │  ✅   │  ○   │  ✅  │  ✅   │
│          │      │      │      │       │      │      │       │
│日常助理  │  ✅  │  ○   │  ✅  │  ○    │  ✅  │  ✅  │  ✅   │
│          │      │      │      │       │      │      │       │
│全功能    │  ✅  │  ✅  │  ✅  │  ✅   │  ✅  │  ✅  │  ✅   │
│Agent     │      │      │      │       │      │      │       │
├──────────┼──────┴──────┴──────┴───────┴──────┴──────┴───────┤
│Token用量 │ ~4800t(精简)  ←──────────→  ~8700t(全量)         │
└──────────┴──────────────────────────────────────────────────┘

✅ = 必须加载    ○ = 按需加载（检索到相关内容时才加载）
```

### 6.8 Surface Files 与 MCP 工具集成

在 MCP Tools 中新增 Surface Files 相关工具：

```typescript
const surfaceTools = {
  /** 获取指定 Surface File 内容（Agent 启动时调用） */
  get_surface_file: {
    params: {
      file: SurfaceFileName,       // "me.md" | "work.md" | ...
    },
    returns: { content: string, tokens: number, last_updated: string }
  },
  
  /** 批量获取 Surface Files（按 Agent 类型自动裁剪） */
  load_surfaces: {
    params: {
      agent_type?: string,         // "codebuddy" | "openclaw" | "default"
      compact?: boolean,           // 紧凑模式（小窗口模型用）
    },
    returns: { 
      files: Record<string, string>,  // 文件名 → 内容
      total_tokens: number,
      loaded_files: string[],
    }
  },
  
  /** 向 Surface File 建议更新（Agent 发现新的重要信息时） */
  suggest_surface_update: {
    params: {
      file: SurfaceFileName,
      suggestion: string,          // 建议添加/修改的内容
      reason: string,              // 为什么重要
      importance: number,          // 0-1
    },
    returns: { queued: boolean, will_apply_at: string }
    // 注意: 不会立即修改文件，而是排队等待做梦引擎审核后统一更新
  },
};
```

### 6.9 设计原则总结

| 原则 | 实践 | 来源 |
|------|------|------|
| **越简单越好** | 每个文件 ≤ 80 行，总量 ≤ 10K tokens | OpenAI Harness Engineering |
| **目录表而非百科全书** | Surface Files 是索引，深层记忆是内容 | AGENTS.md 最佳实践 |
| **免疫系统式增长** | Agent 犯错一次，加一条规则 | Mitchell Hashimoto / Ghostty |
| **按场景裁剪** | 不同 Agent 加载不同文件子集 | Claude Code CLAUDE.md 层级 |
| **预算硬限制** | 超预算自动压缩，绝不溢出 | Claude Code Context Budget |
| **自动维护** | 做梦引擎定期更新，无需人工操作 | AutoDream |
| **人类可读** | 纯 Markdown，随时可以手动编辑 | Git 友好原则 |
| **深层不丢失** | 被压缩移除的内容保留在深层记忆 | Locas 渐进压缩 |

---

## 七、记忆生命周期管理 — Memory Lifecycle（v3 新增核心）

> **核心问题**：当 10 个 Agent 每天各贡献 100 条记忆，一个月就是 30,000 条。
> 一年就是 360,000 条。不清理 = 灾难。
>
> **设计哲学**：像人类大脑一样——绝大多数记忆会自然遗忘，
> 只有真正重要的才会被巩固为长期记忆。
> **不是所有记忆都值得永远保留。**

### 7.1 记忆温度模型（Hot / Warm / Cold / Frozen / Dead）

借鉴数据库冷热分离 + 认知科学遗忘理论，将记忆分为五个温度等级：

```
温度轴
  │
  │  🔥 Hot    (即时记忆)    ← 当前会话 + 最近 24h
  │  🌡️ Warm   (活跃记忆)    ← 近 7 天，频繁访问
  │  🌤️ Cool   (常规记忆)    ← 7-30 天，偶尔访问
  │  🧊 Cold   (冷藏记忆)    ← 30-90 天，已压缩摘要
  │  🪦 Frozen (归档记忆)    ← 90 天+，深度压缩，仅保留元数据
  │  ☠️ Dead   (已遗忘)      ← 被清理，仅保留统计痕迹
  ▼
  时间轴 ──────────────────────────────────────────→
```

```typescript
type MemoryTemperature = 'hot' | 'warm' | 'cool' | 'cold' | 'frozen' | 'dead';

interface MemoryLifecycle {
  temperature: MemoryTemperature;
  
  // 温度计算因子
  factors: {
    age_hours: number;             // 记忆年龄
    access_count: number;          // 被检索次数
    last_accessed_hours: number;   // 距上次访问
    importance: number;            // 初始重要性评分
    referenced_by_surface: boolean; // 是否被 Surface File 引用
    layer: 'L1' | 'L2' | 'L3' | 'L4'; // 记忆层级
    dream_reinforced: boolean;     // 是否被做梦引擎强化过
  };
  
  // 存储策略
  storage: {
    hot:    'full_content + embedding + index';
    warm:   'full_content + embedding + index';
    cool:   'full_content + embedding (compressed index)';
    cold:   'summary_only + key_facts + embedding';
    frozen: 'metadata + one_line_summary';
    dead:   'statistics_only (count, date_range)';
  };
}
```

### 7.2 温度计算公式

```typescript
function calculateTemperature(memory: MemoryEntry): MemoryTemperature {
  const ageHours = hoursSince(memory.created_at);
  const lastAccessHours = hoursSince(memory.last_accessed);
  const accessRate = memory.access_count / Math.max(ageHours / 24, 1);
  
  // ═══ 永不降温条件 ═══
  // L4 心智模型永远 hot
  if (memory.layer === 'L4' && memory.is_active) return 'hot';
  // 被 Surface File 引用的永远 ≥ warm
  if (memory.referenced_by_surface) return accessRate > 0.5 ? 'hot' : 'warm';
  // 用户手动置顶的永远 ≥ warm
  if (memory.pinned) return 'warm';
  // 重要性极高的永远 ≥ cool
  if (memory.importance >= 0.9) return lastAccessHours < 168 ? 'warm' : 'cool';
  
  // ═══ 温度衰减公式 ═══
  // 基础温度分 = 100（满分）
  let score = 100;
  
  // 时间衰减（最大的降温因子）
  score -= Math.min(60, ageHours / 24 * 2);      // 每天 -2 分，30 天到 0
  
  // 访问频率加温
  score += Math.min(30, accessRate * 10);          // 高频访问可回温
  
  // 最近访问加温
  if (lastAccessHours < 24) score += 20;
  else if (lastAccessHours < 168) score += 10;
  
  // 重要性加温
  score += memory.importance * 15;
  
  // 做梦强化加温
  if (memory.dream_reinforced) score += 10;
  
  // 层级加温（高层记忆更稳定）
  const layerBonus = { L1: 0, L2: 5, L3: 10, L4: 20 };
  score += layerBonus[memory.layer];
  
  // ═══ 映射到温度 ═══
  if (score >= 80) return 'hot';
  if (score >= 60) return 'warm';
  if (score >= 40) return 'cool';
  if (score >= 20) return 'cold';
  if (score >= 5)  return 'frozen';
  return 'dead';
}
```

### 7.3 温度转换与存储策略

> **⚠️ 重要概念澄清：温度（Temperature）与层级（Layer）是正交维度**
>
> - **层级（L1→L4）** 描述记忆的 **抽象程度**：L1 是原始经历，L4 是高度抽象的心智模型
> - **温度（Hot→Frozen）** 描述记忆的 **活跃程度**：Hot 是最近频繁访问的，Frozen 是长期未访问的
> - **两者互相独立**：一条 L1 经历可以是 Hot 的（刚刚写入），也可以是 Frozen 的（半年没被访问）
> - **L4 不等于 Frozen**：L4 心智模型通常是 Hot 的（因为每次查询规划都会加载 L4）
> - **每条记忆同时拥有一个层级和一个温度**
>
> 温度影响的是 **存储策略和 GC 优先级**（Frozen 记忆会被优先压缩/清理），
> 而层级影响的是 **检索权重和做梦晋升路径**（L4 > L3 > L2 > L1）。

> **Score 下限行为说明（Issue-20）**
>
> 温度分数通过 `MAX(0, score - decay)` 计算，**不会低于 0**。
> 当 score = 0 时，记忆处于 Frozen 状态。这些 score=0 的记忆会持续堆积在 Frozen 层，
> 直到 GC 根据存储配额清理它们（先压缩，后删除最低价值的）。
> 这是设计意图：Frozen 层作为删除前的最后缓冲区，给用户保留最后的找回机会。

```
┌────────────────────────────────────────────────────────────────┐
│               记忆温度转换流程                                   │
│                                                                │
│  📥 新记忆写入                                                  │
│      │                                                         │
│      ▼                                                         │
│  🔥 Hot ──[24h+ 且无访问]──→ 🌡️ Warm                           │
│      │                           │                              │
│      │                    [7天+ 且低频访问]                       │
│      │                           │                              │
│      │                           ▼                              │
│      │                      🌤️ Cool                             │
│      │                           │                              │
│      │                    [30天+ 触发压缩]                       │
│      │                           │                              │
│      │                           ▼                              │
│      │                      🧊 Cold ─── 原文 → 摘要             │
│      │                           │      (保留 key_facts)        │
│      │                    [90天+ 深度压缩]                       │
│      │                           │                              │
│      │                           ▼                              │
│      │                      🪦 Frozen ── 摘要 → 元数据          │
│      │                           │      (一行描述 + 统计)       │
│      │                    [365天+ 且从未被引用]                   │
│      │                           │                              │
│      │                           ▼                              │
│      │                      ☠️ Dead ──── 物理删除                │
│      │                                  (仅保留统计痕迹)        │
│      │                                                         │
│  ⬆️ 回温路径:                                                   │
│  · 被检索命中 → 温度 +20                                        │
│  · 被做梦引擎强化 → 温度 +15                                    │
│  · 被 Surface File 引用 → 强制 ≥ warm                          │
│  · 用户手动置顶 → 强制 ≥ warm                                   │
│  · 被新记忆关联 → 温度 +10                                      │
└────────────────────────────────────────────────────────────────┘
```

### 7.4 垃圾回收器（Memory GC）

> 做梦引擎的 Phase 4（清醒）就是 GC 的主要执行点，但也有独立的 GC 调度。

```typescript
interface MemoryGarbageCollector {
  // ═══ GC 策略 ═══
  policies: {
    // 策略 1: 重复记忆合并
    deduplication: {
      enabled: true,
      // 余弦相似度 > 0.92 的记忆视为重复
      similarity_threshold: 0.92,
      // 保留重要性更高的那条，另一条标记为 merged
      merge_strategy: 'keep_higher_importance',
      // 执行频率: 每日做梦时
      schedule: 'daily_dream',
    },
    
    // 策略 2: 过时记忆清理
    staleness: {
      enabled: true,
      // L1 经历: 压缩但不删除（证据链需要）
      l1_max_full_age_days: 30,
      l1_max_summary_age_days: 180,
      l1_archive_after_days: 365,
      // L2 事实: 过时事实标记失效
      l2_check_validity: true,     // 定期检查 valid_until
      // L3 观察: 无支撑证据的观察降级
      l3_min_supporting_facts: 2,  // 少于 2 条支撑 → 降级
      // L4 模型: 仅用户或做梦引擎可清理
      l4_auto_clean: false,
    },
    
    // 策略 3: 噪音过滤
    noise_filter: {
      enabled: true,
      // 低重要性 + 从未被访问 + 超过 14 天 = 噪音
      conditions: {
        importance_below: 0.2,
        access_count: 0,
        age_days_above: 14,
      },
      // 噪音记忆直接跳到 cold
      action: 'fast_track_to_cold',
    },
    
    // 策略 4: 存储配额
    storage_quota: {
      enabled: true,
      // 各温度层的记忆数量上限
      limits: {
        hot:    500,               // 最多 500 条热记忆
        warm:   2000,              // 最多 2000 条温记忆
        cool:   10000,             // 最多 10000 条常规记忆
        cold:   50000,             // 最多 50000 条冷记忆
        frozen: 200000,            // 最多 200000 条归档记忆
      },
      // 超额时触发降温
      on_exceeded: 'force_cool_down_lowest_score',
    },
    
    // 策略 5: 来源质量评估
    source_quality: {
      enabled: true,
      // 追踪各 Agent 贡献记忆的质量
      // 低质量来源的记忆自动降低初始重要性
      quality_tracking: true,
      // 质量评估维度: 是否被检索命中、是否被引用、是否引发观察
      metrics: ['hit_rate', 'reference_count', 'observation_generated'],
    },
  };
  
  // ═══ GC 执行调度 ═══
  schedule: {
    // 轻量 GC: 每 6 小时
    light:  '0 */6 * * *',   // 温度重算 + 噪音过滤
    // 标准 GC: 每日做梦时
    normal: 'daily_dream',    // + 重复合并 + 过时清理
    // 深度 GC: 每周做梦时
    deep:   'weekly_dream',   // + 存储配额检查 + 来源质量评估
    // 紧急 GC: 存储超过 80% 配额时
    emergency: 'on_storage_80_percent',
  };
}
```

### 7.5 记忆压缩管线（Compaction Pipeline）

> 不是简单的删除，而是**渐进式压缩**——信息的精华永远保留。

```
原始记忆 (Full)
│ "2026-04-07 和 Alice 在 CodeBuddy 讨论了 MiniMem 的接入层设计，
│  她建议用 MCP 协议，我同意了。还聊了她最近在学 Vue 3 的 Composition API，
│  她觉得比 Options API 好很多。我们还吐槽了一下公司的 Jenkins CI 太慢了。"
│
│ [30天后 → Cool → Cold]
▼
摘要 (Summary)
│ "与 Alice 讨论: MiniMem 接入层用 MCP 协议(已决策); Alice 在学 Vue 3"
│
│ [90天后 → Cold → Frozen]
▼
关键事实 (Key Facts)
│ → (Alice, 建议, MiniMem 用 MCP) [决策]
│ → (Alice, 正在学习, Vue 3 Composition API) [事实]
│
│ [365天后 → Frozen → Dead (如果从未被引用)]
▼
统计痕迹 (Statistics Only)
  → {date: "2026-04-07", participants: ["Alice"], topics: ["MiniMem", "Vue"], deleted: true}
```

```typescript
interface CompactionPipeline {
  // Level 0: Full Content（完整内容）
  // 新记忆写入时的原始状态
  
  // Level 1: Summary（摘要压缩）
  // 触发条件: 温度降至 cold
  async summarize(memory: MemoryEntry): Promise<string> {
    return await llm.call({
      prompt: `将以下内容压缩为一句话摘要，保留关键信息:
        - 保留: 人名、决策、事实、数字
        - 丢弃: 语气词、重复表达、闲聊
        原文: ${memory.content}`,
      max_tokens: 100,
    });
  }
  
  // Level 2: Key Facts（关键事实提取）
  // 触发条件: 温度降至 frozen
  async extractKeyFacts(memory: MemoryEntry): Promise<WorldFact[]> {
    // 提取事实三元组，写入 L2 世界事实层
    // 原始内容可以删除，事实永存
    return await llm.extractFacts(memory.content);
  }
  
  // Level 3: Statistics Only（统计痕迹）
  // 触发条件: 温度降至 dead
  // 物理删除内容，仅保留统计元数据
  async reduce(memory: MemoryEntry): Promise<MemoryTombstone> {
    return {
      id: memory.id,
      date: memory.created_at,
      source: memory.source,
      participants: memory.participants,
      topics: memory.tags,
      layer: memory.layer,
      deleted_at: new Date(),
      reason: 'lifecycle_gc',
    };
  }
}
```

### 7.6 Surface Files 与记忆生命周期的联动

> Surface Files 是记忆生命周期的**锚点**——被引用的记忆不会死。

```typescript
const lifecycleSurfaceIntegration = {
  // 规则 1: Surface File 引用 = 免死金牌
  rule_surface_reference: {
    description: '被任何 Surface File 引用的记忆，温度永远 ≥ warm',
    implementation: 'surface_file_parser 定期扫描所有 Surface Files，' +
                    '提取引用的记忆 ID/实体名，标记 referenced_by_surface = true',
  },
  
  // 规则 2: 做梦引擎更新 Surface Files 时，附带清理
  rule_dream_update: {
    description: '做梦引擎更新 Surface File 时，同时清理文件中过时的引用',
    implementation: '对比 Surface File 中的信息与当前记忆状态，' +
                    '移除已经 dead 的记忆引用，补充新的高价值记忆',
  },
  
  // 规则 3: context.md 自动过期
  rule_context_expiry: {
    description: 'context.md 中的"最近事件"超过 7 天自动移除',
    implementation: '每日做梦时检查 context.md 中的日期标记，' +
                    '超过 7 天的事件移到深层记忆，从 context.md 中删除',
  },
  
  // 规则 4: work.md 决策历史滚动
  rule_work_decisions: {
    description: 'work.md 中的"近期决策"最多保留 10 条',
    implementation: '超过 10 条时，最旧的决策移到深层记忆，' +
                    '仅在 Surface File 中保留最近 10 条',
  },
};
```

### 7.7 记忆健康监控仪表盘

```typescript
interface MemoryHealthMetrics {
  // ═══ 容量指标 ═══
  capacity: {
    total_memories: number;
    by_temperature: Record<MemoryTemperature, number>;
    by_layer: Record<string, number>;
    by_source: Record<string, number>;
    storage_size_mb: number;
    growth_rate_per_day: number;        // 每日增长率
    estimated_days_to_quota: number;    // 预计多久达到配额
  };
  
  // ═══ 质量指标 ═══
  quality: {
    avg_importance: number;             // 平均重要性
    search_hit_rate: number;            // 检索命中率
    noise_ratio: number;                // 噪音比例
    duplication_ratio: number;          // 重复比例
    staleness_ratio: number;            // 过时比例
    source_quality_scores: Record<string, number>; // 各来源质量评分
  };
  
  // ═══ Surface Files 指标 ═══
  surface: {
    total_tokens: number;               // Surface Files 总 token 数
    budget_utilization: number;          // 预算使用率 (%)
    freshness: Record<string, Date>;    // 各文件最后更新时间
    stale_files: string[];              // 超过预期更新周期的文件
  };
  
  // ═══ GC 指标 ═══
  gc: {
    last_gc_time: Date;
    last_gc_type: 'light' | 'normal' | 'deep';
    memories_cleaned: number;
    memories_compressed: number;
    space_freed_mb: number;
    next_gc_scheduled: Date;
  };
  
  // ═══ 告警 ═══
  alerts: {
    // 存储告警
    storage_above_80: boolean;
    // 增长告警
    growth_rate_abnormal: boolean;       // 某个 Agent 大量灌入垃圾记忆
    // 质量告警
    noise_above_30_percent: boolean;
    // Surface Files 告警
    surface_budget_exceeded: boolean;
    surface_stale_7_days: boolean;
  };
}
```

### 7.8 多 Agent 涌入防护（Ingest Rate Control）

> 防止某个 Agent 失控灌入大量垃圾记忆。

```typescript
interface IngestRateControl {
  // ═══ 入口流控 ═══
  rate_limits: {
    // 全局: 每分钟最多写入 60 条
    global_writes_per_minute: 60,
    // 单 Agent: 每分钟最多写入 20 条
    per_client_writes_per_minute: 20,
    // 批量导入: 单次最多 500 条
    batch_max_size: 500,
  };
  
  // ═══ 质量门控 ═══
  quality_gate: {
    // 写入前快速评估
    pre_write_check: {
      // 最小内容长度 (过短的记忆通常是噪音)
      min_content_length: 20,
      // 最大内容长度 (过长的应该分段)
      max_content_length: 5000,
      // 重复检测: 写入前检查是否和近 100 条记忆重复
      dedup_check_window: 100,
      dedup_similarity_threshold: 0.85,
    },
    
    // 写入后异步评估
    post_write_eval: {
      // LLM 评估记忆价值 (低成本代理模型)
      importance_evaluation: true,
      // 自动分类到正确的层级
      auto_layer_classification: true,
      // 自动提取条件键
      auto_condition_key_extraction: true,
    },
  };
  
  // ═══ 来源信誉系统 ═══
  source_reputation: {
    // 追踪每个 Agent 的记忆质量
    metrics: {
      total_contributed: number,
      avg_importance: number,
      search_hit_rate: number,          // 贡献的记忆被检索命中的比率
      observation_generated_rate: number,// 贡献的记忆产生了 L3 观察的比率
      gc_cleaned_rate: number,          // 贡献的记忆被 GC 清理的比率
    },
    
    // 信誉惩罚
    penalty: {
      // GC 清理率 > 50% → 降低该 Agent 贡献记忆的初始重要性
      high_gc_rate_threshold: 0.5,
      importance_penalty: 0.3,          // 初始重要性 ×0.3
      
      // GC 清理率 > 80% → 触发告警，建议 Owner 审查
      critical_gc_rate_threshold: 0.8,
      action: 'alert_owner',
    },
  };
}
```

### 7.9 设计原则总结

| 原则 | 实践 | 来源 |
|------|------|------|
| **记忆会自然遗忘** | 五级温度模型，渐进降温 | 认知科学 · 艾宾浩斯遗忘曲线 |
| **精华永远保留** | 压缩而非删除，事实三元组永存 | Locas 渐进压缩 |
| **重要的不会死** | Surface File 引用 = 免死金牌 | 自有设计 |
| **垃圾及时清理** | 四种 GC 策略 + 三种调度频率 | 数据库 GC 最佳实践 |
| **入口把关** | 流控 + 质量门控 + 信誉系统 | API Gateway 模式 |
| **可观测** | 健康监控仪表盘 + 告警 | 运维最佳实践 |
| **冷热分离** | Hot→Warm→Cool→Cold→Frozen→Dead | 数据库冷热分离 |
| **按需检索** | Surface Files 只是索引，深层记忆按需调取 | MemGPT 虚拟上下文管理 |

---

## 八、记忆分层详解（Hindsight 四层结构 + 认知科学融合）

v1 采用认知科学的 4 分类（工作/情景/语义/程序），v2 保留此分类作为**功能维度**，
同时引入 Hindsight 的四层结构作为**抽象维度**，两个维度正交组合：

```
                    ┌─────────────────────────────────────────────────┐
                    │           抽象层级（Hindsight 启发）             │
                    │                                                 │
                    │   L4 心智模型    ← 人工策划的高层摘要/指导原则   │
                    │   L3 归纳观察    ← LLM 从事实中自动归纳的模式   │
                    │   L2 世界事实    ← 客观事实、数据点              │
                    │   L1 亲身经历    ← 原始交互记录、对话日志        │
                    └─────────────────────────────────────────────────┘
                    
功能类型（认知科学）:
  ├─ 工作记忆   → 仅存在于 L1（即时，TTL 过期）
  ├─ 情景记忆   → L1 + L2（保留完整上下文 + 提取事实）
  ├─ 语义记忆   → L2 + L3（事实 → 归纳出知识）
  └─ 程序记忆   → L3 + L4（观察到模式 → 策划为规则）
```

### 6.1 L1 亲身经历层 (Experiences)

> 对应 Hindsight "Agent Experiences" — 未加工的原始记录

- **内容**：原始对话、操作日志、截图、文件
- **来源**：工作对话、OpenClaw 聊天、会议录音转文字
- **特点**：只增不改，作为证据链的最终来源
- **存储**：SQLite + 本地文件（大量数据用 Locas 压缩）

```typescript
interface ExperienceRecord {
  id: string;
  raw_content: string;         // 原始内容
  content_type: 'conversation' | 'document' | 'event' | 'screenshot';
  source: 'work' | 'openclaw' | 'manual' | 'dream';
  timestamp: Date;
  session_id: string;
  participants?: string[];
  
  // Locas 式压缩元数据
  compression: {
    is_compressed: boolean;
    original_tokens: number;
    compressed_tokens: number;
    compression_method: 'locas_mlp' | 'locas_glu' | 'summary' | 'none';
  };
  
  // 向量索引
  embedding_id?: string;
  
  // 版本控制（Memoria 式）
  version: {
    snapshot_id: string;       // 所属快照
    branch: string;            // 所属分支（默认 'main'）
  };
}
```

### 6.2 L2 世界事实层 (World Facts)

> 对应 Hindsight "World Facts" — 从经历中提取的客观事实

- **内容**：实体属性、关系三元组、时间事件
- **来源**：LLM 从 L1 自动提取
- **特点**：可更新，带证据追溯

```typescript
interface WorldFact {
  id: string;
  
  // 三元组表示
  subject: string;             // "Alice"
  predicate: string;           // "works_at"
  object: string;              // "Google"
  
  // 元数据
  confidence: number;          // 0-1
  category: 'person_fact' | 'work_fact' | 'preference' | 'event' | 'relationship';
  temporal?: {
    valid_from?: Date;         // 事实生效时间
    valid_until?: Date;        // 事实失效时间（null = 当前有效）
  };
  
  // 证据追溯（Hindsight 核心特性）
  evidence: {
    experience_ids: string[];  // 来源 L1 记录
    extraction_method: string; // 提取方式
    extracted_at: Date;
  };
  
  // Engram 式条件索引（O(1) 查找）
  condition_keys: string[];    // 条件触发键，如 ["person:alice", "company:google"]
  
  created_at: Date;
  updated_at: Date;
}
```

### 6.3 L3 归纳观察层 (Observations)

> 对应 Hindsight "Observations" — 从事实中自动整合的模式和洞察

- **内容**：模式识别、趋势分析、关联发现
- **来源**：LLM 从 L2 事实自动归纳（做梦引擎也会产生）
- **特点**：随新证据持续演进

```typescript
interface Observation {
  id: string;
  description: string;         // "Alice 正在从 React 转向 Vue，最近三次对话都提到了 Vue"
  observation_type: 'pattern' | 'trend' | 'correlation' | 'anomaly' | 'preference_shift';
  
  // 演进追踪（Hindsight 核心）
  evolution: {
    supporting_facts: string[];   // 支持此观察的 L2 事实 ID
    contradicting_facts: string[];// 反对此观察的 L2 事实 ID
    confidence_history: {         // 置信度变化轨迹
      date: Date;
      confidence: number;
      reason: string;
    }[];
  };
  
  // 应用场景
  applicable_to: string[];     // 哪些场景可以用到此观察
  actionable: boolean;         // 是否可直接行动
  suggested_action?: string;
  
  // 来源标记
  source: 'auto_induction' | 'dream_insight' | 'manual';
  
  confidence: number;
  created_at: Date;
  updated_at: Date;
}
```

### 6.4 L4 心智模型层 (Mental Models)

> 对应 Hindsight "Mental Models" — 最高优先级的策划摘要

- **内容**：用户手动策划 + 系统提议的高层指导原则
- **来源**：用户手写 + 从 L3 观察中晋升
- **特点**：最高检索优先级，直接影响系统行为

```typescript
interface MentalModel {
  id: string;
  title: string;               // "我的工作原则"
  content: string;             // 完整内容
  
  model_type: 'principle' | 'preference' | 'workflow' | 'persona_rule' | 'priority_rule';
  
  // 优先级控制
  priority: number;            // 1-10，越高越优先
  scope: string[];             // 适用范围 ["work", "openclaw", "all"]
  
  // 来源追踪
  origin: 'user_curated' | 'system_proposed' | 'dream_promoted';
  based_on_observations?: string[];  // 基于哪些 L3 观察
  
  // 生命周期
  is_active: boolean;
  review_date?: Date;          // 下次复审日期
  
  created_at: Date;
  updated_at: Date;
}
```

### 6.5 传统功能类型保留（与四层正交）

**工作记忆**、**程序记忆** 作为功能视角的补充：

```typescript
// 工作记忆 — 即时上下文缓存（L1 的临时子集）
interface WorkingMemory {
  id: string;
  content: string;
  timestamp: Date;
  context: {
    source: 'work' | 'openclaw' | 'dream';
    session_id: string;
  };
  attention_weight: number;    // 0-1
  ttl: number;                 // 秒，自动过期
}

// 程序记忆 — 如何做事（横跨 L3 观察 + L4 模型）
interface ProceduralMemory {
  id: string;
  name: string;
  trigger: string;             // 触发条件描述
  trigger_conditions: string[];// Engram 式条件键
  procedure: string;           // 执行步骤
  success_rate: number;
  last_used: Date;
  usage_count: number;
  observation_refs: string[];  // 关联的 L3 观察
}
```

---

## 九、版本控制层（Memoria 式 "Git for Memory"）

> 核心理念：记忆不是一成不变的，它会演进。需要像代码一样可追溯、可回滚。

### 7.1 为什么需要记忆版本控制？

| 场景 | 没有版本控制 | 有版本控制 |
|------|------------|-----------|
| 人设被错误更新 | 无法恢复，信息永久丢失 | 回滚到上一个正确版本 |
| 做梦引擎合并了不该合并的记忆 | 只能手动修复 | 查看 diff，精确回滚 |
| 想对比"上周的我"和"这周的我" | 无法实现 | 快照对比，看到成长轨迹 |
| 实验性地修改工作规划策略 | 改了就改了，怕搞砸 | 开个分支实验，好了再合并 |

### 7.2 核心操作

```typescript
interface MemoryVersionControl {
  // 快照：捕获当前记忆状态
  snapshot(label?: string): SnapshotRef;
  
  // 分支：创建独立的记忆实验空间
  branch(name: string, from?: SnapshotRef): BranchRef;
  
  // 差异对比：查看两个状态之间的变化
  diff(a: SnapshotRef, b: SnapshotRef): MemoryDiff;
  
  // 合并：将分支的改动合并回主线
  merge(source: BranchRef, target?: BranchRef): MergeResult;
  
  // 回滚：恢复到之前的状态
  rollback(to: SnapshotRef): void;
  
  // 时间旅行：查看任意历史时间点的记忆状态
  timeTravel(timestamp: Date): MemorySnapshot;
  
  // 审计日志：查看所有变更历史
  auditLog(filter?: AuditFilter): ChangeRecord[];
}
```

```typescript
interface SnapshotRef {
  id: string;
  label?: string;
  timestamp: Date;
  branch: string;
  
  stats: {
    total_memories: number;
    facts_count: number;
    observations_count: number;
    profiles_count: number;
  };
  
  // 自动快照触发条件
  trigger: 'scheduled' | 'before_dream' | 'before_merge' | 'manual' | 'milestone';
}

interface MemoryDiff {
  added: MemoryEntry[];
  modified: { before: MemoryEntry; after: MemoryEntry; }[];
  deleted: MemoryEntry[];
  
  summary: string;           // LLM 生成的变化摘要
  significance: number;      // 0-1，变化显著程度
}
```

### 7.3 自动快照策略

```typescript
const autoSnapshotRules = {
  before_dream:     true,     // 做梦前自动快照（安全网）
  after_dream:      true,     // 做梦后自动快照（记录成果）
  daily:            true,     // 每日定时快照
  weekly:           true,     // 每周快照（里程碑）
  before_bulk_import: true,   // 大批量导入前
  on_conflict_resolution: true, // 冲突解决前后
};
```

### 7.4 分支使用场景

```
main ─────●────●────●────●────●───→ (稳定主线)
           \        ↑
            \      merge
             \      │
dream/0407 ──●──●──● (做梦引擎的实验分支)
               ↓
           如果做梦效果不好，
           丢弃分支即可
           
main ─────●────●──────────●───→
           \               ↑
            \            merge
             \             │
experiment ───●──●──●──●──● (新的优先级排序策略实验)
```

---

## 十、智能检索引擎（TEMPR + MemSifter + Engram 三重增强）

> v1 只有简单的向量检索，v2 引入三个核心增强

### 8.1 TEMPR 四路并行检索（借鉴 Hindsight）

Hindsight 的 TEMPR 检索在 LongMemEval 上达到 91% 准确率，远超单一向量检索。
我们适配实现四路并行：

```
               用户查询
                 │
    ┌────────────┼────────────┬────────────┐
    ▼            ▼            ▼            ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ 语义    │ │ 关键词  │ │ 图遍历  │ │ 时间    │
│ Vector │ │ BM25   │ │ Graph  │ │ Temporal│
│ Search │ │ Search │ │ Walk   │ │ Range  │
└───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘
    │          │          │          │
    └──────────┼──────────┼──────────┘
               ▼
        ┌──────────────┐
        │  Fusion &     │
        │  Reranking    │  ← LLM-based 重排序
        └──────┬───────┘
               ▼
          Top-K 结果
```

```typescript
interface TEMPRSearchEngine {
  // 语义检索：概念相似、改写匹配
  semanticSearch(query: string, topK: number): SearchResult[];
  
  // 关键词检索：人名、技术术语、精确匹配
  keywordSearch(query: string, topK: number): SearchResult[];
  
  // 图遍历：相关实体、间接连接
  graphWalk(entity: string, hops: number): SearchResult[];
  
  // 时间范围："上周"、"去年三月"、"最近三天"
  temporalSearch(timeRange: TimeRange, filter?: string): SearchResult[];
  
  // 融合检索
  hybridSearch(query: string, options?: SearchOptions): SearchResult[];
}

interface SearchOptions {
  strategies: ('semantic' | 'keyword' | 'graph' | 'temporal')[];
  weights?: Record<string, number>;  // 各策略权重
  topK: number;
  rerank: boolean;                   // 是否使用 LLM 重排序
  layer_priority: ('L4' | 'L3' | 'L2' | 'L1')[]; // Hindsight 层级优先级
}
```

### 8.2 MemSifter "先思考再检索"机制

> 核心思想：不是用户问什么就直接搜什么，而是先分析需求，再精准检索

传统检索：`用户问题 → 直接搜索 → 返回结果`
MemSifter 式：`用户问题 → 代理分析意图 → 规划检索策略 → 精准搜索 → 整合结果`

```typescript
interface MemSifterPipeline {
  // Phase 1: 思考 — 用小模型分析查询意图
  think(query: string): RetrievalPlan;
  
  // Phase 2: 规划 — 确定检索策略和关键词
  plan(analysis: RetrievalPlan): RetrievalActions[];
  
  // Phase 3: 执行 — 执行精准检索
  execute(actions: RetrievalActions[]): RawResults;
  
  // Phase 4: 整合 — 将检索结果与当前任务结合
  integrate(results: RawResults, context: string): FinalAnswer;
}

interface RetrievalPlan {
  // 代理模型的分析结果
  query_intent: string;            // "用户想知道 Alice 最近的技术栈变化"
  required_info: string[];         // ["Alice 的历史技术栈", "最近的技术讨论"]
  suggested_strategies: string[];  // ["temporal: 最近30天", "entity: Alice"]
  skip_retrieval: boolean;         // 如果 L4 心智模型已有答案，跳过检索
  
  // 代理模型可以是更轻量的本地模型（降低成本）
  proxy_model: 'qwen-turbo' | 'local-7b';
  confidence: number;
}
```

### 8.3 Engram 式条件触发索引

> 核心思想：为高频查询模式建立 O(1) 的直接映射，跳过搜索

```typescript
interface ConditionalMemoryIndex {
  // 条件键 → 记忆集合的直接映射
  // 例如: "person:alice" → [fact1, fact2, obs1, ...]
  //       "topic:vue"    → [fact3, obs2, ...]
  //       "date:2026-04" → [exp1, exp2, ...]
  
  conditionMap: Map<string, MemoryRef[]>;
  
  // O(1) 查找
  lookup(conditionKey: string): MemoryRef[];
  
  // 多条件交集
  lookupIntersection(keys: string[]): MemoryRef[];
  
  // 自动索引维护
  onMemoryAdded(memory: MemoryEntry): void;   // 新记忆时自动提取条件键
  onMemoryUpdated(memory: MemoryEntry): void;
  onMemoryDeleted(id: string): void;
  
  // 条件键自动提取（LLM + 规则）
  extractConditionKeys(content: string): string[];
}
```

**条件键的自动提取规则：**

```
原始内容: "Alice 说她最近在学 Rust，准备用来重写后端服务"

自动提取的条件键:
  ├─ person:alice
  ├─ tech:rust
  ├─ activity:learning
  ├─ domain:backend
  └─ intent:rewrite

查询 "Alice 最近在学什么？" 
  → 条件键匹配: person:alice + activity:learning
  → O(1) 直接返回相关记忆，无需向量搜索
```

### 8.4 Locas 式记忆压缩

> 核心思想：长期积累的大量原始记忆需要压缩，否则存储和检索成本爆炸

```typescript
interface MemoryCompressor {
  // 分级压缩策略
  compress(memory: ExperienceRecord, level: CompressionLevel): CompressedMemory;
  
  // 按需解压
  decompress(compressed: CompressedMemory): ExperienceRecord;
  
  // 自动压缩调度（基于记忆年龄和重要性）
  scheduleCompression(): CompressionPlan;
}

type CompressionLevel = 
  | 'none'           // L1 近期记忆，保持原始
  | 'summary'        // 生成摘要，保留关键信息（类似 Locas-MLP）
  | 'key_facts'      // 仅保留提取的事实三元组
  | 'archived';      // 深度压缩，仅保留元数据 + 极简摘要

// 压缩规则
const compressionPolicy = {
  age_0_7d:   'none',          // 最近 7 天：不压缩
  age_7_30d:  'summary',       // 7-30 天：生成摘要
  age_30_90d: 'key_facts',     // 1-3 个月：仅保留事实
  age_90d_plus: 'archived',    // 3 个月以上：深度压缩
  
  // 例外：高重要性记忆永不压缩
  importance_override: 0.8,    // 重要性 > 0.8 的记忆不压缩
  pinned: true,                // 被标记为"钉住"的记忆不压缩
};
```

---

## 十一、核心引擎设计

### 9.1 感知层 (Perception Layer)

负责接收各种来源的原始数据，写入 L1 亲身经历层：

```
输入源:
  ├─ 工作对话 (手动输入 / IDE 集成)
  ├─ OpenClaw 聊天记录 (API / 文件导入)
  ├─ 会议纪要
  └─ 日记 / 反思

处理流水线:
  ├─ 文本清洗 & 分段
  ├─ 实体识别 (NER) → 自动生成 Engram 条件键
  ├─ 情感分析
  ├─ 重要性评分
  ├─ 向量嵌入生成
  ├─ 写入 L1 (ExperienceRecord)
  └─ 触发 Locas 压缩评估（大文本自动压缩）
```

### 9.2 加工层 (Processing Layer)

从 L1 经历中提取 L2 事实 + L3 观察：

#### 9.2.1 L1 → L2：事实提取
```
经历记录 → LLM 提取 → 事实三元组 (Subject-Predicate-Object)
                     → 带时间戳的事件
                     → 情感倾向
                     → 决策记录
                     → 自动生成条件键索引
```

#### 9.2.2 L2 → L3：模式归纳
```
累积事实 → LLM 归纳 → 行为模式识别（"Alice 连续三次提到 Vue"）
                     → 趋势发现（"最近话题逐渐偏向 AI"）
                     → 关联挖掘（"每次 deadline 前都倾向于加班"）
                     → 演进追踪（观察的置信度随新证据更新）
```

#### 9.2.3 L3 → L4：心智模型提议
```
稳定观察 → 系统提议 → 候选心智模型（需用户确认或做梦引擎晋升）
                     → "根据近 3 个月的观察，建议将此作为工作原则"
```

#### 9.2.4 人设构建（OpenClaw 场景专用）
```
聊天记录 → 提取发言模式 → 性格特征推断（写入 L2 事实）
                        → 兴趣偏好提取（写入 L2 事实）
                        → 社交关系图谱（写入 L2 事实）
                        → 说话风格总结（写入 L3 观察）
                        → 价值观倾向（写入 L3 观察）
                        → 人设综合画像（写入 L4 心智模型）
```

### 9.3 巩固层 (Consolidation Layer) — 做梦引擎

这是系统最核心也最创新的部分，详见第十一节。

---

## 十二、场景模块设计

### 10.1 工作助理模块

#### 功能清单

| 功能 | 说明 |
|------|------|
| **每日记忆** | 自动记录当天工作内容、决策、进展 |
| **每日总结** | 下班时生成当日工作摘要 |
| **每周回顾** | 周末生成本周回顾 + 下周规划建议 |
| **优先级排序** | 基于历史记忆推断任务紧急/重要度 |
| **决策追踪** | 记录重要决策及其后续结果 |
| **知识沉淀** | 从工作中提取可复用的知识和经验 |

#### 每日工作流

```
07:00  ┌─ 晨会准备：检索昨日记忆 + 今日待办
       │
09-18  ├─ 持续记忆：记录工作事件、对话、决策
       │
18:00  ├─ 日终总结：
       │   ├─ 生成当日摘要
       │   ├─ 更新任务状态
       │   ├─ 标记未完成项
       │   └─ 提取关键学习点
       │
22:00  └─ 做梦巩固（见第十三节）
```

#### 每周工作流

```
周日晚  ┌─ 周回顾：
        │   ├─ 汇总本周所有日总结
        │   ├─ 识别主要成就 & 挑战
        │   ├─ 分析时间分配模式
        │   └─ 提炼经验教训
        │
        └─ 周规划：
            ├─ 基于未完成任务 + 新需求
            ├─ 艾森豪威尔矩阵排序
            ├─ 参考历史相似周的安排
            └─ 生成下周 TODO List
```

#### 优先级评估模型

```typescript
interface TaskPriority {
  task_id: string;
  title: string;
  
  // 四象限评估
  urgency: number;      // 0-10，时间紧迫度
  importance: number;   // 0-10，战略价值
  effort: number;       // 0-10，所需精力
  dependency: string[]; // 前置依赖任务
  
  // 从记忆中推断
  historical_delay_risk: number;  // 基于历史相似任务的延期概率
  context_relevance: number;      // 与本周工作主线的相关度
  
  // 最终得分
  priority_score: number;
  recommended_slot: 'morning' | 'afternoon' | 'evening';
}
```

---

### 10.2 OpenClaw 社交记忆模块

#### 功能清单

| 功能 | 说明 |
|------|------|
| **每日聊天总结** | 自动提取当日聊天亮点、话题流转 |
| **记忆提取** | 从对话中提取关键信息、观点、事件 |
| **人设画像** | 为每个常见对话者构建和丰富人设 |
| **关系图谱** | 追踪人物之间的关系和互动模式 |
| **话题追踪** | 热点话题识别、讨论脉络梳理 |
| **情感分析** | 群组氛围、个人情绪变化追踪 |

#### 人设构建模型

```typescript
interface PersonProfile {
  id: string;
  name: string;
  aliases: string[];        // 昵称、马甲
  
  // 基础画像
  personality: {
    traits: string[];       // ["幽默", "理性", "技术宅"]
    mbti_guess?: string;    // 推测的 MBTI
    communication_style: string;  // "直接犀利" | "温和委婉" | ...
  };
  
  // 兴趣图谱
  interests: {
    topic: string;
    frequency: number;      // 提及频率
    sentiment: number;      // -1 到 1，态度倾向
    last_mentioned: Date;
  }[];
  
  // 观点库
  opinions: {
    topic: string;
    stance: string;         // 观点摘要
    confidence: number;     // 确信度
    evidence: string[];     // 来源对话 ID
  }[];
  
  // 社交关系
  relationships: {
    person_id: string;
    type: 'friend' | 'colleague' | 'acquaintance';
    closeness: number;      // 0-1
    interaction_count: number;
  }[];
  
  // 说话风格
  speech_patterns: {
    catchphrases: string[];      // 口头禅
    emoji_favorites: string[];   // 常用表情
    response_speed: 'fast' | 'moderate' | 'slow';
    message_length: 'short' | 'medium' | 'long';
  };
  
  // 时间线
  memorable_moments: {
    date: Date;
    description: string;
    significance: number;
  }[];
  
  last_updated: Date;
}
```

#### 每日聊天总结流程

```
1. 收集当日全部 OpenClaw 聊天记录
                │
2. 分段 & 话题聚类
   ├─ 识别不同话题的讨论段落
   └─ 标注参与者和时间
                │
3. 逐话题摘要
   ├─ 话题：什么
   ├─ 参与者：谁参与了
   ├─ 关键观点：说了什么
   ├─ 结论/共识：达成了什么
   └─ 未解决问题：还有什么待定
                │
4. 记忆提取
   ├─ 更新人设画像
   ├─ 提取新知识/事实
   ├─ 更新关系图谱
   └─ 标记有趣/重要的瞬间
                │
5. 生成日报
   ├─ 今日聊天概览（一段话）
   ├─ 热点话题 Top 3
   ├─ 有趣瞬间
   └─ 人设更新摘要
```

---

## 十三、做梦机制 (Dream Engine) 🌙

### 11.1 设计理念

参考人类睡眠的记忆巩固机制、Claude Code AutoDream、以及新增的版本控制集成：

| 人类睡眠阶段 | 对应的系统行为 | 新增增强 |
|-------------|--------------|---------|
| **NREM Stage 1-2（浅睡眠）** | 记忆审计：扫描当天新增记忆，标记重要性 | + **Engram 条件索引重建** |
| **NREM Stage 3（深度睡眠/慢波睡眠）** | 记忆巩固：L1→L2→L3 层级提升 | + **Memoria 快照保护** |
| **REM（快速眼动/做梦）** | 创造性联想：跨领域链接记忆 | + **TEMPR 图遍历发现隐藏关联** |
| **自然遗忘** | 选择性遗忘 + Locas 压缩降级 | + **Locas 渐进压缩** |

### 11.2 做梦流程（增强版）

```
            ┌────────────────────────────────────┐
            │          Dream Trigger              │
            │  (定时触发 / 空闲触发 / 手动触发)    │
            └──────────────┬─────────────────────┘
                           │
                ┌──────────▼──────────┐
                │  Pre-Dream Safety   │
                │  ─────────────      │
                │  · Memoria 快照     │  ← 做梦前自动备份！
                │  · 创建 dream 分支  │
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │   Phase 1: 浅睡眠    │
                │   Memory Audit      │
                │   ─────────────     │
                │   · 扫描今日新增记忆  │
                │   · 评估重要性权重    │
                │   · 重建 Engram 索引 │  ← 新增
                │   · 标记待处理项      │
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │   Phase 2: 深度睡眠  │
                │   Consolidation     │
                │   ─────────────     │
                │   · L1→L2 事实提取   │  ← 层级提升
                │   · L2→L3 模式归纳   │  ← 层级提升
                │   · 碎片记忆合并     │
                │   · 冲突记忆解决     │
                │   · Locas 压缩老记忆 │  ← 新增
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │   Phase 3: REM 做梦  │
                │   Creative Linking  │
                │   ─────────────     │
                │   · 跨场景记忆关联   │
                │   · TEMPR 图遍历    │  ← 新增：发现隐藏关联
                │   · 模式 & 洞察发现  │
                │   · 情感记忆处理     │
                │   · 生成"梦境叙事"  │
                │   · 优质洞察→L3/L4  │  ← 新增：自动晋升
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │   Phase 4: 清醒      │
                │   Cleanup & Report  │
                │   ─────────────     │
                │   · 执行选择性遗忘   │
                │   · 更新全部索引     │
                │   · Memoria diff    │  ← 新增：对比做梦前后变化
                │   · 合并 dream 分支  │  ← 新增：确认后合并到 main
                │   · 生成做梦报告     │
                └─────────────────────┘
```

### 11.3 各阶段详细设计

#### Phase 1: 浅睡眠 — 记忆审计

```typescript
interface MemoryAuditResult {
  total_new_memories: number;
  by_source: Record<string, number>;
  
  // 分级结果
  critical: MemoryRef[];    // 必须巩固
  important: MemoryRef[];   // 应该巩固
  routine: MemoryRef[];     // 可以保留
  trivial: MemoryRef[];     // 候选遗忘
  
  // 检测到的问题
  conflicts: MemoryConflict[];   // 矛盾记忆
  duplicates: MemoryPair[];      // 重复记忆
  outdated: MemoryRef[];         // 过时记忆
}
```

#### Phase 2: 深度睡眠 — 记忆巩固

```typescript
interface ConsolidationActions {
  // 强化：提升重要记忆的权重和可访问性
  reinforced: {
    memory_id: string;
    old_importance: number;
    new_importance: number;
    reason: string;
  }[];
  
  // 合并：将碎片信息合成完整记忆
  merged: {
    source_ids: string[];
    merged_memory: EpisodicMemory | SemanticMemory;
    reason: string;
  }[];
  
  // 提升：从情景记忆中提炼语义记忆
  elevated: {
    source_episodes: string[];
    new_semantic: SemanticMemory;
    reason: string;
  }[];
  
  // 冲突解决
  resolved: {
    conflicting_ids: string[];
    resolution: string;
    kept: string;
    deprecated: string[];
  }[];
}
```

#### Phase 3: REM 做梦 — 创造性联想 ✨

这是最有趣的部分！模拟人类做梦的"随机激活+联想"机制：

```typescript
interface DreamSession {
  id: string;
  timestamp: Date;
  duration_minutes: number;
  
  // 梦境叙事（LLM 生成）
  narrative: string;
  
  // 发现的新连接
  new_connections: {
    memory_a: string;      // 记忆 A
    memory_b: string;      // 记忆 B
    connection_type: string; // "类比" | "因果" | "互补" | "矛盾"
    insight: string;       // 发现的洞察
    novelty: number;       // 0-1，新颖程度
  }[];
  
  // 涌现的模式
  patterns: {
    description: string;
    supporting_memories: string[];
    confidence: number;
    actionable: boolean;
    suggested_action?: string;
  }[];
  
  // 情感处理结果
  emotional_processing: {
    processed_emotions: string[];
    resolution: string;
  };
}
```

**REM 做梦的具体算法（v2 增强版）：**

```
1. 随机种子选择
   从今日记忆中随机抽取 3-5 个"种子记忆"
   
2. 向量空间漫游（保留 v1）
   对每个种子，在向量空间中找到距离适中的记忆
   目标：cosine similarity 在 0.3-0.7 之间的"有趣距离"
   
3. 图遍历发现（新增 — TEMPR 启发）
   对每个种子，在知识图谱中做 2-3 跳遍历
   发现通过实体关系间接连接但从未被关联的记忆对
   例如: Alice→Google→Mountain View→Bob（原来 Alice 和 Bob 在同一个城市！）
   
4. 跨层联想（新增 — Hindsight 启发）
   将 L1 的原始经历与 L3 的已有观察配对
   检查是否有新的经历能补充/修正/挑战已有观察
   
5. LLM 联想
   将随机组合的记忆对交给 LLM，要求：
   "这两段记忆之间有什么有趣的联系？"
   "它们组合在一起能产生什么新的洞察？"
   "这个发现对用户的工作/社交有什么启发？"
   
6. 梦境叙事生成
   将所有联想结果编织成一个连贯的"梦境故事"
   
7. 洞察提取 & 层级晋升（新增）
   高置信度洞察 → 写入 L3 观察
   稳定的 L3 观察 → 提议晋升为 L4 心智模型
   标记置信度和新颖度
```

#### Phase 4: 清醒 — 清理与报告

```typescript
interface DreamReport {
  date: Date;
  
  // 巩固统计（增强版）
  consolidation: {
    memories_reinforced: number;
    memories_merged: number;
    l1_to_l2_extracted: number;   // 新增：经历→事实
    l2_to_l3_induced: number;     // 新增：事实→观察
    l3_to_l4_proposed: number;    // 新增：观察→心智模型（候选）
    conflicts_resolved: number;
  };
  
  // 做梦成果
  dream: {
    narrative_summary: string;
    top_insights: string[];
    new_connections: number;
    graph_discoveries: number;    // 新增：图遍历发现的连接
    patterns_found: number;
  };
  
  // 遗忘 & 压缩统计（Locas 集成）
  forgetting: {
    memories_weakened: number;
    memories_compressed: number;  // 新增：Locas 压缩的记忆
    compression_ratio: string;   // 新增："压缩了 15MB → 2MB"
    memories_archived: number;
    memories_deleted: number;
  };
  
  // 版本控制（Memoria 集成）
  version_control: {
    pre_dream_snapshot: string;  // 做梦前快照 ID
    post_dream_snapshot: string; // 做梦后快照 ID
    diff_summary: string;        // LLM 生成的变化摘要
    auto_merged: boolean;        // 是否自动合并到 main
  };
  
  // 建议
  morning_briefing: string;
}
```

---

## 十四、技术选型

### 12.1 技术栈

| 层次 | 技术 | 理由 |
|------|------|------|
| **语言** | TypeScript | 与现有工作流一致，类型安全 |
| **运行时** | Node.js / Bun | 高性能，生态丰富 |
| **🆕 MCP 框架** | @modelcontextprotocol/sdk | MCP Server 官方 SDK，标准接入 |
| **🆕 REST 框架** | Hono | 轻量高性能，同时支持 Bun 和 Node.js |
| **🆕 认证** | JWT (jsonwebtoken) | 客户端 Token 认证 |
| **LLM (主)** | 阿里云百炼 (qwen-plus) / OpenAI | 摘要、提取、联想、生成 |
| **LLM (代理)** | qwen-turbo / 本地 7B 模型 | MemSifter 式预筛选（低成本） |
| **向量存储** | Qdrant (本地) 或 ChromaDB | 语义检索，TEMPR 语义路 |
| **全文检索** | SQLite FTS5 + BM25 | TEMPR 关键词路 |
| **关系图谱** | SQLite + 自定义图层 | TEMPR 图遍历路 + 人物关系 |
| **结构化存储** | SQLite (better-sqlite3) | 元数据、索引、版本快照 |
| **版本控制** | 自实现 Copy-on-Write（Memoria 启发） | 快照/分支/回滚 |
| **条件索引** | 内存 HashMap + SQLite 持久化 | Engram 式 O(1) 查找 |
| **文件存储** | 本地 Markdown / JSON | 人类可读，Git 友好 |
| **定时任务** | node-cron / 系统 crontab | 定时做梦、定时总结 |
| **Embedding** | text-embedding-v3 (阿里云) | 向量嵌入 |

### 12.2 项目结构（v3 增强版）

```
minimem/
├── package.json
├── tsconfig.json
├── README.md
├── DESIGN.md                    # 本文件
│
├── src/
│   ├── index.ts                 # 入口（启动所有服务）
│   │
│   ├── gateway/                 # 🆕 统一接入层
│   │   ├── mcp-server.ts        # 🆕 MCP Server 实现（核心！）
│   │   ├── mcp-tools.ts         # 🆕 MCP Tools 定义 & 处理器
│   │   ├── rest-api.ts          # 🆕 REST API（Express/Hono）
│   │   ├── rest-routes.ts       # 🆕 REST 路由定义
│   │   ├── auth.ts              # 🆕 客户端认证 & Token 管理
│   │   ├── permissions.ts       # 🆕 权限控制
│   │   ├── rate-limiter.ts      # 🆕 速率限制
│   │   └── audit.ts             # 🆕 接入审计日志
│   │
│   ├── owner/                   # 🆕 Owner Profile 中心
│   │   ├── owner-profile.ts     # 🆕 Owner 画像管理
│   │   ├── profile-builder.ts   # 🆕 画像自动构建（从记忆提炼）
│   │   ├── preference-engine.ts # 🆕 偏好推断引擎
│   │   └── consistency.ts       # 🆕 多 Agent 一致性保障
│   │
│   ├── surface/                  # 🆕 表层文件系统
│   │   ├── surface-engine.ts     # 🆕 Surface Files 自动维护引擎
│   │   ├── budget-manager.ts     # 🆕 上下文预算控制
│   │   ├── file-compressor.ts    # 🆕 文件压缩（超预算时触发）
│   │   ├── agent-loader.ts       # 🆕 按 Agent 类型裁剪加载
│   │   └── templates/            # 🆕 Surface Files 模板
│   │       ├── me.md
│   │       ├── soul.md
│   │       ├── work.md
│   │       ├── social.md
│   │       ├── life.md
│   │       ├── agent.md
│   │       ├── context.md
│   │       └── index.md
│   │
│   ├── lifecycle/                # 🆕 记忆生命周期管理
│   │   ├── temperature.ts        # 🆕 温度计算引擎
│   │   ├── gc.ts                 # 🆕 垃圾回收器（4 种策略）
│   │   ├── compaction.ts         # 🆕 压缩管线（渐进式压缩）
│   │   ├── ingest-control.ts     # 🆕 入口流控 & 质量门控
│   │   ├── source-reputation.ts  # 🆕 来源信誉系统
│   │   └── health-monitor.ts     # 🆕 记忆健康监控仪表盘
│   │
│   ├── core/                    # 核心引擎
│   │   ├── memory-engine.ts     # 记忆引擎主类
│   │   ├── perception.ts        # 感知层
│   │   ├── processing.ts        # 加工层（L1→L2→L3→L4 流水线）
│   │   └── consolidation.ts     # 巩固层
│   │
│   ├── store/                   # 存储层（Hindsight 四层）
│   │   ├── experience-store.ts  # L1 亲身经历
│   │   ├── fact-store.ts        # L2 世界事实
│   │   ├── observation-store.ts # L3 归纳观察
│   │   ├── mental-model-store.ts# L4 心智模型
│   │   ├── working-memory.ts    # 工作记忆（临时）
│   │   ├── procedural-store.ts  # 程序记忆
│   │   ├── vector-store.ts      # 向量存储
│   │   └── graph-store.ts       # 知识图谱
│   │
│   ├── version/                 # 版本控制层（Memoria 式）
│   │   ├── snapshot.ts          # 快照管理
│   │   ├── branch.ts            # 分支管理
│   │   ├── diff.ts              # 差异对比
│   │   ├── merge.ts             # 合并策略
│   │   ├── rollback.ts          # 回滚操作
│   │   └── audit-log.ts         # 审计日志
│   │
│   ├── retrieval/               # 智能检索引擎
│   │   ├── tempr-engine.ts      # TEMPR 四路并行检索
│   │   ├── semantic-search.ts   # 语义检索
│   │   ├── keyword-search.ts    # BM25 关键词检索
│   │   ├── graph-walk.ts        # 图遍历检索
│   │   ├── temporal-search.ts   # 时间范围检索
│   │   ├── memsifter.ts         # MemSifter 先思考再检索
│   │   ├── condition-index.ts   # Engram 条件触发索引
│   │   ├── reranker.ts          # 结果重排序
│   │   └── compressor.ts        # Locas 式记忆压缩
│   │
│   ├── modules/                 # 业务模块
│   │   ├── work/                # 工作助理
│   │   │   ├── daily-logger.ts
│   │   │   ├── daily-summary.ts
│   │   │   ├── weekly-review.ts
│   │   │   └── priority.ts
│   │   │
│   │   ├── social/              # 社交记忆 (OpenClaw)
│   │   │   ├── chat-ingester.ts
│   │   │   ├── chat-summary.ts
│   │   │   ├── person-profile.ts
│   │   │   ├── relationship.ts
│   │   │   └── topic-tracker.ts
│   │   │
│   │   └── dream/               # 做梦引擎
│   │       ├── dream-engine.ts  # 做梦主流程
│   │       ├── auditor.ts       # Phase 1: 记忆审计
│   │       ├── consolidator.ts  # Phase 2: 记忆巩固 + 层级提升
│   │       ├── rem-dreamer.ts   # Phase 3: REM 联想 + 图遍历
│   │       ├── forgetter.ts     # Phase 4: 选择性遗忘 + 压缩
│   │       └── dream-report.ts  # 做梦报告 + 版本 diff
│   │
│   ├── llm/                     # LLM 集成
│   │   ├── client.ts            # LLM 客户端（主模型）
│   │   ├── proxy-client.ts      # 代理模型客户端（MemSifter 用）
│   │   ├── prompts/
│   │   │   ├── summarize.ts
│   │   │   ├── extract.ts
│   │   │   ├── dream.ts
│   │   │   ├── profile.ts
│   │   │   ├── induction.ts     # L2→L3 归纳提示词
│   │   │   └── retrieval-plan.ts# MemSifter 检索规划提示词
│   │   └── embeddings.ts
│   │
│   ├── scheduler/
│   │   ├── cron.ts
│   │   └── triggers.ts
│   │
│   └── sdk/                     # 🆕 TypeScript SDK
│       ├── client.ts            # 🆕 MiniMemClient 类
│       ├── types.ts             # 🆕 公共类型定义
│       └── index.ts             # 🆕 SDK 入口
│
├── data/
│   ├── db/                      # SQLite 数据库
│   ├── vectors/                 # 向量索引
│   ├── snapshots/               # 版本快照（Memoria）
│   ├── surfaces/                # 🆕 Surface Files（Markdown）
│   ├── exports/
│   └── dreams/                  # 做梦日志（Markdown）
│
├── packages/                    # 🆕 可发布的子包
│   ├── mcp-server/              # 🆕 @minimem/mcp-server（npm 包）
│   └── sdk/                     # 🆕 @minimem/sdk（npm 包）
│
└── tests/
    ├── gateway/                 # 🆕 接入层测试
    ├── owner/                   # 🆕 Owner Profile 测试
    ├── surface/                 # 🆕 Surface Files 测试
    ├── lifecycle/               # 🆕 记忆生命周期测试
    ├── core/
    ├── retrieval/               # 检索引擎测试
    ├── version/                 # 版本控制测试
    ├── modules/
    └── dream/
```

---

## 十五、数据模型 (SQLite Schema)

```sql
-- ═══════════════════════════════════════
-- 🆕 客户端注册 & 权限（v3 统一接入）
-- ═══════════════════════════════════════
CREATE TABLE clients (
    id TEXT PRIMARY KEY,              -- 全局唯一客户端 ID，如 "codebuddy"
    name TEXT NOT NULL,               -- 显示名
    client_secret_hash TEXT,          -- 密钥哈希
    
    -- 权限
    read_layers TEXT DEFAULT '["L1","L2","L3","L4"]',  -- JSON array
    read_scopes TEXT DEFAULT '["all"]',
    can_write BOOLEAN DEFAULT 1,
    can_trigger_dream BOOLEAN DEFAULT 0,
    can_create_snapshot BOOLEAN DEFAULT 0,
    can_read_audit BOOLEAN DEFAULT 0,
    
    -- 速率限制
    reads_per_minute INTEGER DEFAULT 60,
    writes_per_minute INTEGER DEFAULT 30,
    
    -- 统计
    total_reads INTEGER DEFAULT 0,
    total_writes INTEGER DEFAULT 0,
    last_active DATETIME,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 🆕 Owner Profile（人设中心）
CREATE TABLE owner_profile (
    key TEXT PRIMARY KEY,             -- 如 "identity.name", "work.tech_stack"
    value TEXT NOT NULL,              -- JSON 值
    category TEXT NOT NULL,           -- "identity" | "personality" | "work" | "social" | "preference"
    confidence REAL DEFAULT 1.0,
    evidence_count INTEGER DEFAULT 0,
    contributed_by TEXT,              -- 最后更新的客户端 ID
    version INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 🆕 接入审计日志
CREATE TABLE access_log (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    action TEXT NOT NULL,             -- "read" | "write" | "search" | "dream" | "snapshot"
    tool_name TEXT,                   -- MCP 工具名 / REST 端点
    params_summary TEXT,              -- 参数摘要（非完整参数，保护隐私）
    result_count INTEGER,             -- 返回结果数
    latency_ms INTEGER,              -- 响应时间
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_access_log_client ON access_log(client_id);
CREATE INDEX idx_access_log_time ON access_log(created_at);

-- ═══════════════════════════════════════
-- L1 亲身经历层
-- ═══════════════════════════════════════
CREATE TABLE experiences (
    id TEXT PRIMARY KEY,
    raw_content TEXT NOT NULL,
    content_type TEXT NOT NULL,       -- 'conversation' | 'document' | 'event' | 'screenshot'
    source TEXT NOT NULL,             -- 'work' | 'openclaw' | 'manual' | 'dream'
    timestamp DATETIME NOT NULL,
    session_id TEXT,
    participants TEXT,                -- JSON array
    
    -- Locas 压缩
    is_compressed BOOLEAN DEFAULT 0,
    original_tokens INTEGER,
    compressed_tokens INTEGER,
    compression_method TEXT,          -- 'locas_mlp' | 'summary' | 'none'
    compressed_content TEXT,          -- 压缩后内容
    
    -- 向量
    embedding_id TEXT,
    
    -- 版本控制
    snapshot_id TEXT,
    branch TEXT DEFAULT 'main',
    
    -- 元数据
    importance REAL DEFAULT 0.5,
    emotion_valence REAL DEFAULT 0,
    access_count INTEGER DEFAULT 0,
    last_accessed DATETIME,
    is_archived BOOLEAN DEFAULT 0,
    tags TEXT,                        -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════
-- L2 世界事实层
-- ═══════════════════════════════════════
CREATE TABLE world_facts (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    category TEXT NOT NULL,           -- 'person_fact' | 'work_fact' | 'preference' | 'event' | 'relationship'
    
    -- 时间有效性
    valid_from DATETIME,
    valid_until DATETIME,
    
    -- 证据追溯（Hindsight 核心）
    evidence_experience_ids TEXT,     -- JSON array of L1 IDs
    extraction_method TEXT,
    extracted_at DATETIME,
    
    -- Engram 条件索引
    condition_keys TEXT,              -- JSON array, e.g. ["person:alice", "tech:rust"]
    
    -- 版本控制
    snapshot_id TEXT,
    branch TEXT DEFAULT 'main',
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════
-- L3 归纳观察层
-- ═══════════════════════════════════════
CREATE TABLE observations (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    observation_type TEXT NOT NULL,    -- 'pattern' | 'trend' | 'correlation' | 'anomaly' | 'preference_shift'
    
    -- 演进追踪
    supporting_fact_ids TEXT,          -- JSON array
    contradicting_fact_ids TEXT,       -- JSON array
    confidence_history TEXT,           -- JSON array of {date, confidence, reason}
    
    -- 应用
    applicable_to TEXT,               -- JSON array
    actionable BOOLEAN DEFAULT 0,
    suggested_action TEXT,
    
    -- 来源
    source TEXT DEFAULT 'auto_induction', -- 'auto_induction' | 'dream_insight' | 'manual'
    
    confidence REAL DEFAULT 0.5,
    condition_keys TEXT,              -- Engram 条件索引
    snapshot_id TEXT,
    branch TEXT DEFAULT 'main',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════
-- L4 心智模型层
-- ═══════════════════════════════════════
CREATE TABLE mental_models (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    model_type TEXT NOT NULL,         -- 'principle' | 'preference' | 'workflow' | 'persona_rule' | 'priority_rule'
    
    priority INTEGER DEFAULT 5,       -- 1-10
    scope TEXT,                       -- JSON array, e.g. ["work", "openclaw", "all"]
    
    origin TEXT DEFAULT 'user_curated', -- 'user_curated' | 'system_proposed' | 'dream_promoted'
    based_on_observations TEXT,       -- JSON array of L3 IDs
    
    is_active BOOLEAN DEFAULT 1,
    review_date DATETIME,
    
    snapshot_id TEXT,
    branch TEXT DEFAULT 'main',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════
-- 人设画像（OpenClaw 专用）
-- ═══════════════════════════════════════
CREATE TABLE person_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    aliases TEXT,
    personality TEXT,                 -- JSON
    interests TEXT,                   -- JSON array
    opinions TEXT,                    -- JSON array
    speech_patterns TEXT,             -- JSON
    relationships TEXT,               -- JSON array
    memorable_moments TEXT,           -- JSON array
    snapshot_id TEXT,
    branch TEXT DEFAULT 'main',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════
-- 版本控制（Memoria 式）
-- ═══════════════════════════════════════
CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    label TEXT,
    branch TEXT DEFAULT 'main',
    timestamp DATETIME NOT NULL,
    trigger TEXT NOT NULL,            -- 'scheduled' | 'before_dream' | 'manual' | 'milestone'
    
    stats_total INTEGER,
    stats_facts INTEGER,
    stats_observations INTEGER,
    stats_profiles INTEGER,
    
    parent_snapshot_id TEXT,          -- 链式追溯
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE branches (
    name TEXT PRIMARY KEY,
    created_from_snapshot TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    merged_at DATETIME,
    is_active BOOLEAN DEFAULT 1
);

CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,             -- 'create' | 'update' | 'delete' | 'merge' | 'rollback'
    target_type TEXT NOT NULL,        -- 'experience' | 'fact' | 'observation' | 'model' | 'profile'
    target_id TEXT NOT NULL,
    before_value TEXT,                -- JSON
    after_value TEXT,                 -- JSON
    triggered_by TEXT,                -- 'user' | 'system' | 'dream' | 'import'
    branch TEXT DEFAULT 'main',
    snapshot_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════
-- Engram 条件索引
-- ═══════════════════════════════════════
CREATE TABLE condition_index (
    condition_key TEXT NOT NULL,       -- e.g. "person:alice"
    memory_type TEXT NOT NULL,         -- 'fact' | 'observation' | 'model' | 'experience'
    memory_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (condition_key, memory_type, memory_id)
);

CREATE INDEX idx_condition_key ON condition_index(condition_key);

-- ═══════════════════════════════════════
-- 做梦日志 & 工作任务 & 关联图
-- ═══════════════════════════════════════
CREATE TABLE dream_logs (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    phase TEXT NOT NULL,
    narrative TEXT,
    insights TEXT,                    -- JSON array
    new_connections INTEGER DEFAULT 0,
    graph_discoveries INTEGER DEFAULT 0,
    patterns_found INTEGER DEFAULT 0,
    l1_to_l2 INTEGER DEFAULT 0,
    l2_to_l3 INTEGER DEFAULT 0,
    l3_to_l4 INTEGER DEFAULT 0,
    memories_compressed INTEGER DEFAULT 0,
    pre_snapshot_id TEXT,
    post_snapshot_id TEXT,
    diff_summary TEXT,
    report TEXT,                      -- JSON
    duration_seconds INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE work_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    urgency REAL DEFAULT 5,
    importance REAL DEFAULT 5,
    effort REAL DEFAULT 5,
    priority_score REAL,
    due_date DATETIME,
    completed_at DATETIME,
    tags TEXT,
    linked_memories TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE memory_links (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    link_type TEXT NOT NULL,
    weight REAL DEFAULT 0.5,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_id, target_id, link_type)
);

-- 全文搜索（TEMPR BM25 路）
CREATE VIRTUAL TABLE memory_fts USING fts5(
    memory_id, memory_type, content, summary, tags, condition_keys
);

-- ═══════════════════════════════════════
-- 🆕 Surface Files 管理
-- ═══════════════════════════════════════
CREATE TABLE surface_files (
    file_name TEXT PRIMARY KEY,           -- "me.md" | "soul.md" | ...
    content TEXT NOT NULL,                -- Markdown 内容
    token_count INTEGER NOT NULL,         -- 当前 token 数
    budget_tokens INTEGER NOT NULL,       -- 预算上限
    category TEXT NOT NULL,               -- "identity" | "personality" | "work" | ...
    update_frequency TEXT NOT NULL,       -- "极低" | "低" | "中" | "高"
    last_updated DATETIME NOT NULL,
    last_updated_by TEXT,                 -- 谁触发了更新: "dream" | "session" | "manual"
    version INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Surface Files 更新历史
CREATE TABLE surface_file_history (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    content TEXT NOT NULL,                -- 历史版本内容
    token_count INTEGER,
    updated_by TEXT,                      -- "dream_engine" | "session_end" | "manual"
    change_summary TEXT,                  -- 变更摘要
    version INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_surface_history_file ON surface_file_history(file_name);

-- Surface Files 更新建议队列
CREATE TABLE surface_update_queue (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    suggestion TEXT NOT NULL,             -- 建议内容
    reason TEXT NOT NULL,
    importance REAL DEFAULT 0.5,
    suggested_by TEXT NOT NULL,           -- 来源 Agent ID
    status TEXT DEFAULT 'pending',        -- "pending" | "applied" | "rejected"
    processed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════
-- 🆕 记忆生命周期管理
-- ═══════════════════════════════════════

-- 记忆温度追踪（附加到所有记忆条目）
CREATE TABLE memory_temperature (
    memory_id TEXT NOT NULL,
    memory_type TEXT NOT NULL,            -- "experience" | "fact" | "observation" | "model"
    temperature TEXT NOT NULL,            -- "hot" | "warm" | "cool" | "cold" | "frozen" | "dead"
    score REAL NOT NULL,                  -- 温度分数 0-100
    
    -- 温度因子快照
    age_hours REAL,
    access_count INTEGER DEFAULT 0,
    last_accessed_hours REAL,
    importance REAL DEFAULT 0.5,
    referenced_by_surface BOOLEAN DEFAULT 0,
    dream_reinforced BOOLEAN DEFAULT 0,
    pinned BOOLEAN DEFAULT 0,
    
    -- 压缩状态
    compression_level TEXT DEFAULT 'none',-- "none" | "summary" | "key_facts" | "statistics"
    compressed_at DATETIME,
    
    last_calculated DATETIME NOT NULL,
    PRIMARY KEY (memory_id, memory_type)
);

CREATE INDEX idx_temperature ON memory_temperature(temperature);
CREATE INDEX idx_temperature_score ON memory_temperature(score);

-- 记忆墓碑（Dead 记忆的统计痕迹）
CREATE TABLE memory_tombstones (
    id TEXT PRIMARY KEY,
    original_type TEXT NOT NULL,          -- 原始类型
    original_layer TEXT,                  -- 原始层级
    original_source TEXT,                 -- 原始来源
    date_range_start DATETIME,
    date_range_end DATETIME,
    participants TEXT,                    -- JSON array
    topics TEXT,                          -- JSON array
    reason TEXT NOT NULL,                 -- "lifecycle_gc" | "manual" | "merge"
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- GC 执行日志
CREATE TABLE gc_log (
    id TEXT PRIMARY KEY,
    gc_type TEXT NOT NULL,                -- "light" | "normal" | "deep" | "emergency"
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    
    -- 统计
    memories_scanned INTEGER DEFAULT 0,
    temperature_updated INTEGER DEFAULT 0,
    duplicates_merged INTEGER DEFAULT 0,
    noise_filtered INTEGER DEFAULT 0,
    compressed INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    space_freed_bytes INTEGER DEFAULT 0,
    
    -- 配额状态
    hot_count INTEGER,
    warm_count INTEGER,
    cool_count INTEGER,
    cold_count INTEGER,
    frozen_count INTEGER,
    
    report TEXT                           -- JSON 详细报告
);

-- 来源信誉评分
CREATE TABLE source_reputation (
    client_id TEXT PRIMARY KEY,
    total_contributed INTEGER DEFAULT 0,
    avg_importance REAL DEFAULT 0.5,
    search_hit_rate REAL DEFAULT 0,
    observation_generated_rate REAL DEFAULT 0,
    gc_cleaned_rate REAL DEFAULT 0,
    reputation_score REAL DEFAULT 0.5,    -- 0-1，综合信誉
    importance_penalty REAL DEFAULT 1.0,  -- 新记忆重要性乘数
    last_evaluated DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 十六、调度策略

### 16.1 自动调度

```typescript
const schedules = {
  // 每日
  daily_work_summary:   '0 18 * * 1-5',  // 工作日 18:00
  daily_chat_summary:   '0 23 * * *',     // 每天 23:00
  daily_dream:          '0 3 * * *',      // 每天凌晨 3:00（模拟深度睡眠）
  
  // 每周
  weekly_review:        '0 20 * * 0',     // 周日 20:00
  weekly_deep_dream:    '0 4 * * 0',      // 周日凌晨 4:00（深度做梦）
  
  // 持续
  memory_decay:         '0 */6 * * *',    // 每 6 小时执行遗忘曲线衰减
  
  // 🆕 Surface Files 维护
  surface_context_update: 'on_session_end',   // 每次会话结束更新 context.md
  surface_daily_refresh:  '0 4 * * *',        // 做梦后自动刷新 Surface Files
  surface_weekly_deep:    '0 5 * * 0',        // 每周深度更新 soul.md/me.md
  
  // 🆕 记忆生命周期 GC
  gc_light:             '0 */6 * * *',    // 每 6 小时: 温度重算 + 噪音过滤
  gc_normal:            '0 4 * * *',      // 每日做梦时: + 重复合并 + 过时清理
  gc_deep:              '0 5 * * 0',      // 每周做梦时: + 配额检查 + 信誉评估
  gc_emergency:         'on_storage_80%',  // 存储超 80% 时紧急 GC
};
```

### 16.2 触发条件

```typescript
const triggers = {
  // 被动触发
  on_new_chat_batch:    '收到新的聊天记录时',
  on_work_event:        '记录工作事件时',
  
  // 主动触发
  on_user_query:        '用户主动查询记忆时',
  on_dream_request:     '用户请求"做一个梦"时',
  
  // 版本控制触发（v2 新增）
  on_bulk_import:       '大批量导入前自动快照',
  on_conflict:          '冲突解决前自动快照',
  
  // 压缩触发（v2 新增）
  on_storage_threshold: '存储超过阈值时触发 Locas 压缩',
  
  // 🆕 Surface Files 触发
  on_session_end:       '会话结束时更新 context.md',
  on_work_decision:     '技术决策时更新 work.md',
  on_new_person:        '认识新的重要人物时更新 social.md',
  on_surface_budget_exceeded: '文件超预算时触发压缩',
  
  // 🆕 记忆生命周期触发
  on_gc_quota_exceeded: '某温度层超过配额时触发降温',
  on_high_noise_ratio:  '噪音比例 > 30% 时触发过滤',
  on_source_low_quality:'某 Agent 垃圾率 > 50% 时触发告警',
};
```

---

## 十七、遗忘曲线模型

基于艾宾浩斯遗忘曲线，但加入了个性化调整：

```typescript
function calculateRetention(memory: EpisodicMemory): number {
  const hoursSinceCreation = (Date.now() - memory.timestamp.getTime()) / 3600000;
  const hoursSinceAccess = (Date.now() - memory.last_accessed.getTime()) / 3600000;
  
  // 基础遗忘曲线: R = e^(-t/S)
  // S = stability，越大记忆越稳定
  const baseStability = 24; // 小时
  
  // 个性化调整因子
  const importanceBoost = memory.importance * 5;          // 重要记忆更稳定
  const accessBoost = Math.log(memory.access_count + 1) * 3; // 多次回忆更稳定
  const emotionBoost = Math.abs(memory.emotions?.[0]?.intensity || 0) * 2; // 情感记忆更稳定
  
  const stability = baseStability + importanceBoost + accessBoost + emotionBoost;
  
  const retention = Math.exp(-hoursSinceAccess / stability);
  
  return Math.max(0, Math.min(1, retention));
}
```

---

## 十八、开发路线图

### Phase 1: 基础框架 + 四层存储 + 统一接入（第 1-3 周）
- [ ] 项目初始化、依赖安装
- [ ] SQLite 数据库初始化（四层表结构 + 客户端注册表）
- [ ] L1 经历层 CRUD
- [ ] L2 事实层 CRUD + 证据追溯
- [ ] LLM 客户端集成（阿里云百炼 主模型 + 代理模型）
- [ ] 向量嵌入生成 & 存储
- [ ] **🆕 MCP Server 基础实现（add_memory, search_memory, recall_about）**
- [ ] **🆕 REST API 基础框架（Express/Hono）**
- [ ] **🆕 客户端认证 & 权限控制**
- [ ] CLI 基础命令

### Phase 2: Owner Profile & 人设中心（第 4 周）
- [ ] **🆕 Owner Profile 数据模型 & CRUD**
- [ ] **🆕 get_owner_profile / get_owner_preference MCP 工具**
- [ ] **🆕 Profile 自动构建（从 L2/L3 记忆中提炼）**
- [ ] **🆕 Profile 版本管理（防止人设被意外修改）**

### Phase 3: Surface Files 表层文件系统（第 5 周）🆕
- [ ] **🆕 Surface Files 数据模型 & CRUD**
- [ ] **🆕 8 个模板文件初始化（me/soul/work/social/life/agent/context/index）**
- [ ] **🆕 上下文预算管理器（Budget Manager）**
- [ ] **🆕 按 Agent 类型裁剪加载器（Agent Loader）**
- [ ] **🆕 文件超预算自动压缩（File Compressor）**
- [ ] **🆕 load_surfaces / get_surface_file / suggest_surface_update MCP 工具**
- [ ] **🆕 Surface Files 更新建议队列**

### Phase 4: 记忆生命周期管理（第 6 周）🆕
- [ ] **🆕 温度计算引擎（5 级温度模型）**
- [ ] **🆕 垃圾回收器（重复合并/过时清理/噪音过滤/配额控制）**
- [ ] **🆕 压缩管线（Full → Summary → Key Facts → Statistics）**
- [ ] **🆕 入口流控 & 质量门控**
- [ ] **🆕 来源信誉系统**
- [ ] **🆕 记忆健康监控仪表盘**
- [ ] **🆕 GC 调度集成（light/normal/deep/emergency）**

### Phase 5: 智能检索引擎（第 7 周）
- [ ] 语义检索（向量）
- [ ] 关键词检索（BM25 / FTS5）
- [ ] 图遍历检索
- [ ] 时间范围检索
- [ ] TEMPR 融合 + 重排序
- [ ] Engram 条件索引（O(1) 查找）
- [ ] MemSifter 先思考再检索流水线
- [ ] **🆕 get_relevant_context MCP 工具（上下文增强）**

### Phase 6: 版本控制层（第 8 周）
- [ ] 快照（Snapshot）
- [ ] 分支（Branch）
- [ ] 差异对比（Diff）+ LLM 摘要
- [ ] 合并（Merge）
- [ ] 回滚（Rollback）
- [ ] 审计日志
- [ ] 自动快照策略

### Phase 7: 工作助理 + CodeBuddy 集成（第 9-10 周）
- [ ] 日常记忆录入（写入 L1 + 自动提取 L2）
- [ ] 每日总结生成
- [ ] 每周回顾 & 规划
- [ ] 优先级排序引擎
- [ ] 定时任务调度
- [ ] **🆕 CodeBuddy MCP 接入测试 & 优化**
- [ ] **🆕 CodeBuddy 工作记忆自动同步**
- [ ] **🆕 做梦引擎自动更新 Surface Files（work.md/context.md）**

### Phase 8: 社交记忆 + OpenClaw 集成（第 11-12 周）
- [ ] OpenClaw 聊天导入器
- [ ] 每日聊天总结
- [ ] 人设画像构建 & 更新（L2 事实 + L3 观察）
- [ ] 关系图谱维护
- [ ] 话题追踪
- [ ] **🆕 OpenClaw REST API 集成测试**
- [ ] **🆕 双向数据流验证（贡献记忆 + 获取人设）**
- [ ] **🆕 做梦引擎自动更新 Surface Files（social.md）**

### Phase 9: 做梦引擎（第 13-14 周）
- [ ] Phase 1: 记忆审计 + Engram 索引重建
- [ ] Phase 2: 记忆巩固 + L1→L2→L3 层级提升
- [ ] Phase 3: REM 创造性联想 + 图遍历发现
- [ ] Phase 4: 选择性遗忘 + Locas 压缩
- [ ] Memoria 快照保护集成（做梦前后快照 + diff）
- [ ] 做梦报告生成
- [ ] 遗忘曲线实现
- [ ] **🆕 做梦引擎整合多 Agent 贡献的记忆**
- [ ] **🆕 做梦后自动更新 Owner Profile**
- [ ] **🆕 做梦后自动更新 Surface Files（me.md/soul.md/life.md）**
- [ ] **🆕 做梦引擎触发 GC（normal + deep）**

### Phase 10: 完善 & 生态（第 15-18 周）
- [ ] **🆕 TypeScript SDK 封装 & 发布 npm**
- [ ] **🆕 MCP Server npm 包发布**
- [ ] **🆕 第三方 Agent 接入文档 & 示例**
- [ ] Locas 渐进压缩策略完善
- [ ] REST API 完善
- [ ] **🆕 Surface Files 自动维护引擎全流程联调**
- [ ] **🆕 记忆生命周期端到端压测（模拟 10 Agent × 30 天）**
- [ ] **🆕 健康监控仪表盘 Web UI**
- [ ] Web UI（可选 — 记忆浏览器 + Owner Profile 编辑器 + Surface Files 编辑器）
- [ ] 性能优化（检索延迟、压缩效率、GC 效率）
- [ ] 记忆导出 & 备份
- [ ] 文档完善

---

## 十九、参考资料

| 来源 | 核心贡献 | 论文/链接 |
|------|---------|----------|
| **MCP** (Anthropic, 2024.11) | AI Agent 标准接入协议 | modelcontextprotocol.io |
| **MCP Memory Server** (官方参考) | 知识图谱式记忆 MCP Server 实现 | github.com/modelcontextprotocol/servers |
| **SuperMemory MCP** (2025) | 跨 AI 平台统一记忆实践 | supermemory.com |
| **Multi-Agent Memory** (UCSD, 2026.03) | 共享/分布式/混合记忆架构分析 | arXiv:2603.10062 |
| **HMO** (上海AI Lab, 2026.04) | 分层记忆编排，集成 OpenClaw + Claude Code | arXiv:2604.01670 |
| **Mem0 多Agent记忆** (2026.03) | 生产级多Agent记忆架构模式 | mem0.ai/blog/multi-agent-memory-systems |
| **Hindsight** (vectorize-io, 2025.12) | 四层结构化记忆 + TEMPR 四路检索（91% 准确率） | arXiv:2512.12818 |
| **Memoria** (MatrixOrigin, GTC 2026) | Git 式版本控制（快照/分支/回滚）| github.com/matrixorigin/Memoria |
| **DeepSeek Engram** (2026.01) | 条件记忆 O(1) 查找 + 稀疏激活 | arXiv:2601.07372 |
| **腾讯 Locas** (2026.02) | 侧挂记忆压缩（0.02% 参数，20 万字） | arXiv:2602.05085 |
| **MemSifter** (2026.03) | 先思考再检索 + 代理模型卸载 | arXiv:2603.03379 |
| **MemoryOS** (EMNLP 2025) | 分层存储架构（短/中/长期） | arXiv:2506.06326 |
| **Mem0** (2025-2026) | 选择性记忆提取、图增强、多范围模型 | mem0.ai |
| **AutoDream** (Claude Code) | 做梦机制的修剪/合并/刷新三阶段 | - |
| **Generative Agents** (Stanford) | 记忆流 + 反思 + 规划 | arXiv:2304.03442 |
| **MLMF** | 工作记忆/情景记忆/语义记忆分层 | arXiv:2603.29194 |
| **认知科学** | 艾宾浩斯遗忘曲线、多重记忆理论 | - |
| **Nature Neuroscience** | 慢波睡眠 + REM 的记忆巩固机制 | doi:10.1038/s41593-019-0467-3 |
| **🆕 Harness Engineering** (OpenAI, 2026) | AGENTS.md 简洁原则：目录表而非百科全书 | openai.com/harness-engineering |
| **🆕 CLAUDE.md 最佳实践** (Anthropic, 2026) | 上下文预算控制、/compact 机制、50-200行限制 | docs.anthropic.com/claude-code |
| **🆕 MemGPT/Letta** (2025) | 虚拟上下文管理、记忆分页换入换出 | memgpt.ai |
| **🆕 AI Agent Memory 综述** (2025.12) | 统一分类体系、冷热分离、自主记忆进化 | arXiv 综述 |

---

## 二十、版本升级对照

### v2 → v3 核心升级

| 维度 | v2 设计 | v3 增强 | 借鉴来源 |
|------|--------|--------|---------|
| **系统定位** | 独立封闭系统 | **统一中央记忆服务** — 所有 AI Agent 的记忆中心 | SuperMemory、Mem0 |
| **接入协议** | ❌ 无标准接入 | ✅ **MCP Server** + REST API + SDK + CLI — 四种接入方式 | MCP 官方标准 |
| **CodeBuddy 集成** | ❌ 未设计 | ✅ **MCP 原生接入** — 改配置文件即用 | MCP Memory Server |
| **OpenClaw 集成** | 仅作为数据源 | ✅ **REST API 双向集成** — 贡献记忆 + 获取人设 | Mem0 多范围模型 |
| **第三方 Agent** | ❌ 无法接入 | ✅ **即插即用** — MCP/REST/SDK 三选一 | MCP 生态 |
| **记忆归属** | ⚠️ 未明确 | ✅ **Owner-Client 模型** — 你是唯一所有者 | 多Agent记忆论文 |
| **人设一致性** | ❌ 各 Agent 各自理解 | ✅ **Owner Profile 中心** — 所有 Agent 看到同一个"你" | HMO |
| **🆕 上下文管理** | ❌ 直接灌入全部记忆 | ✅ **Surface Files** — 8 个极简 Markdown 文件，总预算 ≤ 10K tokens | Harness Eng + CLAUDE.md |
| **🆕 记忆垃圾回收** | ❌ 无清理机制 | ✅ **Memory GC** — 五级温度模型 + 四种 GC 策略 + 渐进式压缩 | 数据库 GC + 认知科学 |
| **🆕 涌入防护** | ❌ 无流控 | ✅ **Ingest Rate Control** — 流控 + 质量门控 + 来源信誉系统 | API Gateway 模式 |
| **🆕 冷热分离** | ❌ 所有记忆同等对待 | ✅ **五级温度** — Hot→Warm→Cool→Cold→Frozen→Dead | 数据库冷热分离 |
| **权限控制** | ❌ 无 | ✅ **分级权限** — trusted/standard/readonly 三档 | Mem0 多维范围 |
| **审计追踪** | 基础审计日志 | ✅ **完整来源追踪** — 每条记忆知道谁贡献、谁读取 | 综合 |
| **数据模型** | 13 张表 | **22+ 张表**（+Surface Files 3张 + Lifecycle 4张 + 信誉 1张） | 综合 |
| **开发周期** | 12 周 | **18 周**（新增 Surface Files + Lifecycle + 压测 4 个阶段） | - |

### v1 → v2 核心升级（保留）

| 维度 | v1 设计 | v2 增强 | 借鉴来源 |
|------|--------|--------|---------|
| **记忆分层** | 认知科学 4 分类（工作/情景/语义/程序） | + Hindsight 四层抽象（经历→事实→观察→心智模型），两维正交 | Hindsight |
| **版本控制** | ❌ 无 | ✅ 快照/分支/diff/合并/回滚，做梦前自动保护 | Memoria |
| **检索引擎** | 简单向量搜索 | TEMPR 四路并行 + MemSifter 先思考再检索 + Engram O(1) 条件触发 | Hindsight + MemSifter + Engram |
| **记忆压缩** | ❌ 无 | ✅ Locas 式渐进压缩（按年龄 + 重要性分级） | Locas |
| **证据追溯** | 简单 evidence[] | 完整证据链：L1 经历 → L2 事实 → L3 观察 → L4 模型 | Hindsight |
| **做梦引擎** | 4 阶段基础版 | + 版本快照保护 + 图遍历发现 + 层级晋升 + 压缩集成 | 综合 |
| **数据模型** | 5 张表 | 13 张表（四层 + 版本 + 索引 + 审计），v3 扩展到 22+ 张 | 综合 |
| **开发周期** | 10 周 | 12 周（新增检索引擎 + 版本控制 2 个阶段） | - |

---

> **设计原则**：
> 1. 🧠 **记住重要的** — Hindsight 四层结构确保信息逐层提炼
> 2. 🗑️ **遗忘无关的** — 五级温度模型 + 四种 GC 策略 + 渐进压缩
> 3. 💡 **发现隐藏的联系** — REM 做梦 + TEMPR 图遍历
> 4. ⏪ **可追溯可回滚** — Memoria 版本控制，永远有后悔药
> 5. 🔍 **检索要聪明** — MemSifter 先想再找 + Engram O(1) 直达
> 6. 🧬 **像人类大脑一样运作** — 四层抽象 × 做梦巩固 × 自然遗忘
> 7. 🔌 **一个中心，所有 AI 共享** — MCP Server 统一接入，任何 Agent 即插即用
> 8. 👤 **记忆属于你** — Owner-Client 模型，你是唯一所有者，Agent 是贡献者
> 9. 🎭 **一个你，到处一致** — Owner Profile 中心，所有 Agent 看到同一个"你"
> 10. 🌐 **开放生态** — MCP + REST + SDK，5 分钟接入任何新 Agent
> 11. 📄 **表面极简，深层无限** — Surface Files ≤ 10K tokens，深层记忆按需检索
> 12. 🔥 **冷热分离，自动清理** — Hot→Frozen 五级温度，GC 自动回收垃圾记忆
> 13. 🚧 **入口把关，拒绝垃圾** — 流控 + 质量门控 + 来源信誉，防止记忆涌入失控
> 14. 📏 **预算硬限制** — 上下文预算不可突破，超标即压缩，为工作留足 95% 空间
> 15. 🔐 **静态加密，传输安全** — 记忆库 SQLCipher 加密 + REST/MCP 强制 TLS，防止数据泄露
> 16. 🧹 **被遗忘权** — 用户说"忘掉 X"，系统级联清除 L1→L4 + 向量 + 图谱 + Surface Files + 快照
> 17. 💰 **成本可控** — LLM 调用批处理 + 缓存 + 降级策略，无 LLM 时仍可基本运行
> 18. ✏️ **记忆可纠错** — 用户可修正、标注、反馈每条记忆，闭环改进提取质量
> 19. 🚀 **零记忆不冷场** — 引导式初始化，5 分钟从空白到有用记忆

---

## 十一、补充设计：9 大缺失维度

> **反思方法**：以 ReAct 模式，从用户旅程、安全隐私、多设备、LLM 依赖、可观测性、用户控制权、MCP 工具完整性、错误处理、配置管理 9 个维度进行系统性查漏补缺。

---

### 11.1 冷启动 & 引导式初始化（Onboarding）

#### 问题

全新用户安装后，Surface Files 空、Owner Profile 空、向量库空。系统在前几次对话中等于失忆状态，体验极差。

#### 设计方案

```
冷启动检测 → 引导式问卷 → 自动填充 → 可选导入 → 首次做梦
```

**Phase 1: 冷启动检测**
```typescript
interface ColdStartDetector {
  // 启动时自动检测
  isColdStart(): boolean; // memories_count === 0 && surface_files_empty
  getColdStartPhase(): 'empty' | 'seeding' | 'warming' | 'ready';
}
```

判定条件：
- `empty`：L1 记忆 < 5 条 且 Owner Profile 为空
- `seeding`：正在执行引导流程
- `warming`：有基础记忆但 L3/L4 尚未形成（未执行过做梦）
- `ready`：至少完成一次做梦，Surface Files 非空

**Phase 2: 引导式问卷（MCP Tool）**

新增工具 `start_onboarding`：

```typescript
// MCP Tool: start_onboarding
// 返回一组引导性问题，Agent 可用来询问用户
interface OnboardingQuestions {
  basic: [
    "你希望我怎么称呼你？",
    "你目前的主要工作/角色是什么？",
    "你有什么兴趣爱好？"
  ];
  work: [
    "你目前在做什么项目？",
    "你常用的技术栈是什么？",
    "你的工作风格偏好？（详细文档 vs 快速迭代）"
  ];
  preferences: [
    "你喜欢什么样的沟通风格？（简洁 vs 详细）",
    "有什么特别的偏好或禁忌？"
  ];
}
```

**Phase 3: 自动填充**

根据问卷回答自动生成：
- `owner_profile.md` — 基础人设
- `work.md` — 当前项目概况
- `preferences.md` — 偏好设定

**Phase 4: 可选数据导入**

```typescript
// MCP Tool: import_memories
interface ImportMemoriesParams {
  source: 'json' | 'markdown' | 'chat_history';
  data: string; // 文件路径或内容
  options: {
    dedup: boolean;         // 去重
    extractFacts: boolean;  // 自动提取事实到 L2
    dryRun: boolean;        // 试运行，不实际写入
  };
}
```

支持导入格式：
- **JSON**：标准记忆格式（从其他 MiniMem 实例导出）
- **Markdown**：自由文本，LLM 提取结构化记忆
- **Chat History**：从聊天记录中提取关键信息

**Phase 5: 首次做梦**

导入完成后自动触发一次轻量做梦（仅 Phase 1-2），快速生成 L2 事实和初步 Surface Files。

#### 冷启动期间的特殊行为

| 行为 | 冷启动期间 | 正常期间 |
|------|-----------|---------|
| `get_relevant_context` | 返回引导提示而非空结果 | 正常返回记忆 |
| Surface Files | 包含"待填充"模板 | 正常内容 |
| 做梦频率 | 每 20 条新记忆触发一次 | 按正常调度 |
| 质量门控 | 降低阈值（0.2→0.1）多存少弃 | 正常阈值 |

---

### 11.2 数据安全 & 隐私保护

#### 问题

MiniMem 存储用户最私密的信息——人格、社交关系、工作决策、生活习惯。当前设计仅有认证机制，没有数据加密和隐私保护。

#### 11.2.1 静态加密（At-Rest Encryption）

**SQLite 数据库加密**：使用 SQLCipher 替代标准 SQLite

```typescript
interface EncryptionConfig {
  enabled: boolean;           // 是否启用加密
  provider: 'sqlcipher' | 'none';
  keyDerivation: {
    method: 'pbkdf2';        // 密钥派生
    iterations: 256000;       // PBKDF2 迭代次数
    salt: string;             // 随机盐值
  };
  keyStorage: 'keychain' | 'env' | 'prompt';
  // keychain: macOS Keychain / Linux Secret Service / Windows Credential Manager
  // env: 从环境变量 MINIMEM_ENCRYPTION_KEY 读取
  // prompt: 每次启动时交互式输入
}
```

**Surface Files 加密**：可选加密存储

```typescript
interface SurfaceFileEncryption {
  enabled: boolean;
  // Surface Files 默认明文（方便手动编辑）
  // 可选启用加密，此时手动编辑需通过 CLI 工具
  encryptedFields: string[]; // 仅加密敏感字段
}
```

#### 11.2.2 敏感信息检测 & 自动脱敏（PII Detection）

在记忆写入流水线中增加 PII 检测阶段：

```
原始记忆 → PII Scanner → [脱敏/标记/拒绝] → 正常写入流水线
```

```typescript
interface PIIDetector {
  // 在 ingest pipeline 中，quality_gate 之后执行
  patterns: {
    // 基于正则的快速检测（不需要 LLM）
    credit_card: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;
    phone: /\b1[3-9]\d{9}\b/; // 中国手机号
    id_card: /\b\d{17}[\dXx]\b/; // 身份证号
    email: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/;
    api_key: /\b(sk-|ak-|AKIA)[A-Za-z0-9]{20,}\b/;
    password: /password\s*[:=]\s*\S+/i;
  };
  
  actions: {
    // 检测到 PII 后的处理策略
    credit_card: 'mask';     // 4532 **** **** 1234
    phone: 'mask';           // 138****5678
    id_card: 'reject';       // 拒绝存储
    email: 'keep';           // 邮箱通常需要保留
    api_key: 'mask';         // sk-****...****abcd
    password: 'reject';      // 拒绝存储
  };
}
```

PII 策略可配置：
- `mask`：替换为掩码后存储
- `reject`：拒绝写入，返回警告
- `keep`：保留原文（如邮箱、姓名）
- `flag`：标记为敏感但保留（加密存储优先级提升）

#### 11.2.3 传输安全

```typescript
interface TransportSecurity {
  rest: {
    tls: {
      enabled: boolean;         // 默认 true
      minVersion: 'TLSv1.2';
      cert: string;             // 证书路径
      key: string;              // 私钥路径
      selfSigned: boolean;      // 开发环境允许自签名
    };
    cors: {
      origins: string[];        // 允许的来源
      credentials: boolean;
    };
  };
  mcp: {
    // stdio 模式：无需传输加密（进程间通信）
    // http+sse 模式：必须 TLS
    httpSse: {
      tlsRequired: true;
    };
  };
}
```

#### 11.2.4 敏感信息分级存储

```sql
-- 记忆敏感级别
ALTER TABLE l1_experiences ADD COLUMN sensitivity_level TEXT DEFAULT 'normal';
-- normal: 普通记忆
-- sensitive: 包含个人信息（加密存储优先）
-- highly_sensitive: 包含密码、密钥等（强制加密 + 短 TTL）

-- 敏感记忆的自动过期
-- highly_sensitive 记忆默认 7 天后自动进入 GC 候选
```

---

### 11.3 主动遗忘权 & 级联删除

#### 问题

用户说"忘掉所有关于 X 的记忆"时，需要级联清理 L1→L2→L3→L4、Surface Files、向量索引、知识图谱、快照中的引用。这是非常复杂的操作，当前完全未设计。

#### 设计方案

**新增 MCP 工具：`forget_about`**

```typescript
// MCP Tool: forget_about
interface ForgetAboutParams {
  target: string;           // "关于 X" — 自然语言描述
  scope: 'exact' | 'related' | 'all_traces';
  // exact: 仅删除直接提到 X 的记忆
  // related: 删除直接 + 强关联的记忆
  // all_traces: 彻底清除所有痕迹（包括快照中的引用）
  dryRun: boolean;          // 先预览将被删除的内容
  confirm: boolean;         // 二次确认（all_traces 强制要求）
}

interface ForgetResult {
  affected: {
    l1_experiences: number;
    l2_facts: number;
    l3_observations: number;
    l4_models: number;
    surface_files: string[];  // 被修改的 Surface File 列表
    vector_entries: number;
    graph_edges: number;
    snapshot_references: number;
  };
  status: 'previewed' | 'completed' | 'requires_confirmation';
}
```

**级联删除流程**：

```
forget_about("Bob") 
  → Step 1: 语义搜索所有层中涉及 "Bob" 的记忆 (向量 + 关键词 + 图谱)
  → Step 2: 构建影响图谱（哪些高层记忆依赖被删记忆）
  → Step 3: dryRun — 展示将被影响的所有条目
  → Step 4: confirm — 用户确认
  → Step 5: 开启事务
    → 5a: 删除 L1 经历
    → 5b: 删除 L2 事实 + 断开 evidence_chain 引用
    → 5c: 重新评估 L3 观察（如果所有支撑事实被删，标记废弃）
    → 5d: 重新评估 L4 模型（如果关键观察被删，降低置信度/标记废弃）
    → 5e: 从 Surface Files 中移除相关段落
    → 5f: 从向量索引中删除对应条目
    → 5g: 从知识图谱中删除相关节点和边
    → 5h: 在快照中标记已删除引用（不删快照本身，但标记为 "redacted"）
  → Step 6: 提交事务
  → Step 7: 记录审计日志（记录删除操作本身，但不记录删除内容）
```

**新增 MCP 工具：`delete_memory`**

```typescript
// 精确删除单条记忆
interface DeleteMemoryParams {
  memory_id: string;
  cascade: boolean;  // 是否级联删除引用此记忆的高层条目
}
```

---

### 11.4 LLM 成本控制 & 降级策略

#### 问题

系统大量依赖 LLM：事实提取、模式归纳、做梦引擎、Surface Files 维护、GC 压缩、MemSifter、重排序。如果不做成本控制，API 费用会失控；如果 LLM 不可用，系统陷入瘫痪。

#### 11.4.1 成本估算模型

```typescript
interface CostEstimate {
  // 按日均 100 条新记忆估算（单用户）
  daily: {
    ingest: {
      factExtraction: '100 calls × ~500 tokens = 50K tokens/day',
      qualityGate: '100 calls × ~200 tokens = 20K tokens/day',
      piiDetection: '0 tokens (regex-based)',
    };
    dreaming: {
      frequency: '每日 1 次',
      phase1_consolidation: '~50 calls × ~800 tokens = 40K tokens',
      phase2_pattern: '~20 calls × ~1200 tokens = 24K tokens',
      phase3_pruning: '~10 calls × ~600 tokens = 6K tokens',
      surfaceUpdate: '~8 calls × ~2000 tokens = 16K tokens',
    };
    retrieval: {
      memSifter: '~50 queries × ~800 tokens = 40K tokens',
      reranking: '~50 queries × ~400 tokens = 20K tokens',
    };
    gc: {
      frequency: '每周 1 次',
      dailyAverage: '~5K tokens',
    };
    total: '~221K tokens/day ≈ 6.6M tokens/month',
    // 以 qwen-plus 计价：约 ¥2.5/day ≈ ¥75/month
    // 以 gpt-4o-mini 计价：约 $0.10/day ≈ $3/month
    // 以 claude-3.5-sonnet 计价：约 $0.66/day ≈ $20/month
  };
}
```

#### 11.4.2 成本优化策略

**批处理（Batching）**：

```typescript
interface LLMBatchConfig {
  factExtraction: {
    // 不要每条记忆单独调一次 LLM，攒够 N 条后批量处理
    batchSize: 10;            // 每 10 条新记忆一批
    maxWaitTime: '5m';        // 最多等 5 分钟
    // 批量 prompt: "从以下 10 条记忆中提取所有事实..."
  };
  dreaming: {
    // 做梦本身已经是批处理
    maxMemoriesPerPhase: 200;  // 单次做梦处理上限
  };
}
```

**缓存（Caching）**：

```typescript
interface LLMCacheConfig {
  enabled: true;
  strategy: {
    // 语义相似查询缓存：相似度 > 0.95 直接返回缓存结果
    semanticCache: {
      enabled: true;
      similarityThreshold: 0.95;
      ttl: '24h';
    };
    // MemSifter 查询计划缓存
    queryPlanCache: {
      enabled: true;
      ttl: '1h';       // 查询计划缓存 1 小时
    };
  };
  storage: 'sqlite';   // 缓存存在 SQLite 中
  maxSize: '50MB';
}
```

**去重（Deduplication）**：

```typescript
interface LLMDedupConfig {
  // 短时间内相同/相似的 LLM 请求合并
  windowSize: '30s';
  similarityThreshold: 0.9;
  // 例如：30 秒内收到 3 条关于同一话题的记忆，合并为 1 次 LLM 调用
}
```

#### 11.4.3 无 LLM 降级模式（Degraded Mode）

```typescript
interface DegradedModeConfig {
  // 触发条件
  triggers: {
    apiKeyMissing: true;     // 未配置 API Key
    apiKeyExhausted: true;   // 额度用完
    networkError: true;      // 网络不可用
    costLimitReached: true;  // 达到预设花费上限
  };
  
  // 降级后各模块行为
  behavior: {
    ingest: {
      // 仅存储原始记忆到 L1，跳过事实提取
      factExtraction: 'skip → queue_for_later';
      qualityGate: 'accept_all';  // 全部接受
    };
    retrieval: {
      // 退化为关键词搜索 + 向量搜索（向量索引仍可用）
      memSifter: 'disabled → fallback_to_keyword';
      reranking: 'disabled → return_raw_scores';
    };
    dreaming: {
      // 完全暂停，积压到 LLM 恢复后补做
      status: 'paused';
      queuedMemories: 'persist_to_disk';
    };
    gc: {
      // 仅执行基于规则的 GC（温度衰减、TTL 过期），跳过 LLM 判断
      ruleBasedOnly: true;
    };
    surfaceFiles: {
      // 不更新，保持最后一个有效版本
      status: 'frozen';
    };
  };
  
  // 花费限制
  costLimit: {
    daily: number;   // 每日花费上限（美元）
    monthly: number; // 每月花费上限
    alert: number;   // 达到百分比时告警（如 80%）
  };
}
```

#### 11.4.4 LLM 模型分级调度

```typescript
interface ModelTiering {
  // 不同任务使用不同级别的模型，平衡质量和成本
  tiers: {
    heavy: {
      // 高质量任务：做梦 Phase 2（模式发现）、L4 心智模型更新
      models: ['claude-3.5-sonnet', 'gpt-4o', 'qwen-max'];
      fallback: 'medium';
    };
    medium: {
      // 标准任务：事实提取、MemSifter 查询计划
      models: ['gpt-4o-mini', 'qwen-plus', 'claude-3.5-haiku'];
      fallback: 'light';
    };
    light: {
      // 轻量任务：质量门控、简单分类、重排序
      models: ['qwen-turbo', 'gpt-3.5-turbo', 'local-7b'];
      fallback: 'rule_based';  // 退化为基于规则
    };
    rule_based: {
      // 无 LLM：基于规则/启发式
      models: [];  // 不需要 LLM
    };
  };
}
```

---

### 11.5 记忆纠错 & 用户反馈闭环

#### 问题

LLM 提取的事实可能出错（L2），做梦引擎归纳的观察可能偏差（L3），用户无法发现和纠正这些错误，也无法对检索结果进行反馈。

#### 新增 MCP 工具

```typescript
// 1. 修正记忆
// MCP Tool: update_memory
interface UpdateMemoryParams {
  memory_id: string;
  layer: 'L1' | 'L2' | 'L3' | 'L4';
  updates: {
    content?: string;         // 修正内容
    confidence?: number;      // 调整置信度
    tags?: string[];          // 修改标签
    importance?: number;      // 调整重要性
  };
  reason: string;             // 修正原因（记入审计日志）
}

// 2. 按 ID 获取记忆详情
// MCP Tool: get_memory_by_id
interface GetMemoryByIdParams {
  memory_id: string;
  include_evidence_chain: boolean;  // 是否包含证据链
  include_history: boolean;         // 是否包含修改历史
}

// 3. 分页浏览记忆
// MCP Tool: list_memories
interface ListMemoriesParams {
  layer?: 'L1' | 'L2' | 'L3' | 'L4';
  category?: string;
  temperature?: 'hot' | 'warm' | 'cool' | 'cold' | 'frozen';
  sort_by: 'created_at' | 'updated_at' | 'importance' | 'temperature';
  order: 'asc' | 'desc';
  page: number;
  page_size: number;          // 默认 20，最大 100
}

// 4. 置顶/取消置顶
// MCP Tool: pin_memory
interface PinMemoryParams {
  memory_id: string;
  pinned: boolean;
  // pinned 的记忆：温度永远 >= warm，不会被 GC 降级
}

// 5. 记忆反馈（闭环改进）
// MCP Tool: feedback_memory
interface FeedbackMemoryParams {
  memory_id: string;
  feedback: 'useful' | 'not_useful' | 'incorrect' | 'outdated';
  context?: string;           // 在什么场景下给出的反馈
}
```

#### 反馈闭环机制

```
用户反馈 → 调整温度/置信度 → 影响未来检索排名
                            → 做梦引擎纳入反馈数据
                            → 周期性统计反馈率，优化提取 prompt
```

```typescript
interface FeedbackLoop {
  // 反馈对记忆的影响
  effects: {
    useful: {
      temperature: '+0.1';     // 升温
      searchBoost: 1.2;        // 检索权重提升 20%
    };
    not_useful: {
      temperature: '-0.05';    // 轻微降温
      searchBoost: 0.8;        // 检索权重降低 20%
    };
    incorrect: {
      confidence: '-0.3';      // 大幅降低置信度
      flagForReview: true;     // 标记待审核
      // 做梦时 LLM 会重新评估此记忆
    };
    outdated: {
      temperature: '-0.2';     // 明显降温
      // 触发 LLM 检查是否有更新版本
    };
  };
  
  // 周期性统计
  analytics: {
    // 每周做梦时统计反馈数据
    incorrectRate: number;     // 错误率
    // 如果错误率 > 15%，自动优化事实提取 prompt
    promptOptimizationThreshold: 0.15;
  };
}
```

---

### 11.6 多设备同步 & 远程部署

#### 问题

当前架构是单机 SQLite。用户可能在公司电脑、家里电脑上都想访问记忆。

#### 11.6.1 部署模式

```typescript
type DeploymentMode = 
  | 'local'       // 默认：本地 SQLite，单机使用
  | 'self-hosted'  // 自托管：Docker/NAS/VPS 部署
  | 'cloud';       // 云端 SaaS：注册即用，多设备，平台运维（详见 § 11.6.3）

interface DeploymentConfig {
  mode: DeploymentMode;
  
  local: {
    dataDir: '~/.minimem';
    port: 3737;
  };
  
  selfHosted: {
    // Docker 部署
    docker: {
      image: 'minimem/server:latest';
      volumes: ['/data/minimem:/app/data'];
      ports: ['3737:3737'];
      environment: {
        MINIMEM_ENCRYPTION_KEY: 'from-secret';
        MINIMEM_LLM_API_KEY: 'from-secret';
      };
    };
    // 反向代理配置
    reverseProxy: {
      nginx: 'example config';
      caddy: 'example config';
    };
  };
}
```

#### 11.6.2 多设备同步策略（路线图 v3.1+）

> 注意：v3.0 仅实现本地模式，多设备同步为 v3.1+ 路线图功能。

```typescript
interface SyncStrategy {
  // 方案 A（推荐）：中央服务器模式
  // 用户在 NAS/VPS 上运行 MiniMem Server，所有设备通过 REST/MCP 连接
  centralServer: {
    approach: 'single-source-of-truth';
    pros: '无冲突、实时同步、架构简单';
    cons: '需要服务器、离线不可用';
  };
  
  // 方案 B：离线 + 同步模式（复杂，v3.2+ 考虑）
  offlineSync: {
    approach: 'CRDT-based';   // 基于 CRDT 的无冲突合并
    localQueue: {
      // 离线时记忆写入本地队列
      storage: 'local-sqlite';
      maxQueueSize: 1000;
    };
    sync: {
      // 上线后自动同步
      conflictResolution: 'last-write-wins + manual-review';
      fullSyncInterval: '24h';
      incrementalSync: 'on-reconnect';
    };
  };
}
```

#### 11.6.3 云端 SaaS 部署模式（路线图 v4.0）🆕

> **产品决策**：MiniMem 采用"两条腿走路"策略——Local 模式（隐私优先，开发者/极客）和 Cloud 模式（零部署，普通用户）并行。先做好 Local，打磨核心引擎，再上 Cloud。

##### 设计目标

将 MiniMem 部署为云端 SaaS 服务，用户只需注册账号 + 获取 API Key，任意设备上的任意 Agent 即可接入，无需本地安装任何东西。

```
任意设备上的任意 Agent
        │
        │ MCP / REST / SDK（标准协议不变）
        ▼
┌──────────────────────────────────────────────────┐
│          MiniMem Cloud (SaaS)                     │
│                                                   │
│  ┌───────────────────────────────────────────┐   │
│  │  Gateway 接入层                            │   │
│  │  OAuth2 / API Key · 多租户路由 · TLS      │   │
│  └─────────────────┬─────────────────────────┘   │
│                    │                              │
│  ┌─────────────────▼─────────────────────────┐   │
│  │  Core Engine（与 Local 模式共用同一套代码）  │   │
│  │  感知 · 加工 · 做梦 · GC · 检索 · Surface  │   │
│  └─────────────────┬─────────────────────────┘   │
│                    │                              │
│  ┌─────────────────▼─────────────────────────┐   │
│  │  存储抽象层 (Storage Abstraction)           │   │
│  │  ┌─────────┐  ┌──────────┐  ┌───────────┐ │   │
│  │  │PostgreSQL│  │ Qdrant   │  │ 对象存储   │ │   │
│  │  │+pgvector │  │ Cloud    │  │ (S3/COS)  │ │   │
│  │  └─────────┘  └──────────┘  └───────────┘ │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  ┌───────────────────────────────────────────┐   │
│  │  平台服务                                   │   │
│  │  计费 · 用量统计 · LLM Token 池 · 监控告警 │   │
│  └───────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

##### 架构核心：存储抽象层

Cloud 模式的关键改造是引入 **存储抽象层**，让 Core Engine 不直接依赖 SQLite：

```typescript
// 存储抽象接口（Local 和 Cloud 各有一套实现）
interface StorageProvider {
  // 记忆 CRUD（对应 L1-L4 四张表）
  experiences: MemoryStore<Experience>;
  worldFacts: MemoryStore<WorldFact>;
  observations: MemoryStore<Observation>;
  mentalModels: MemoryStore<MentalModel>;
  knowledgePages: KnowledgePageStore;
  
  // 向量存储
  vectors: VectorStore;
  
  // 图存储
  graph: GraphStore;
  
  // 事务支持
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}

// Local 实现
class SqliteStorageProvider implements StorageProvider {
  // 当前的 better-sqlite3 实现，不变
}

// Cloud 实现
class PostgresStorageProvider implements StorageProvider {
  // PostgreSQL + pgvector
  // 每个查询自动注入 tenant_id
}
```

##### 多租户隔离

```typescript
interface TenantIsolation {
  strategy: 'shared-db-shared-schema';  // 同库同表，tenant_id 隔离
  // 所有表增加 tenant_id 列
  // 所有查询自动注入 WHERE tenant_id = ?
  // Row-Level Security (PostgreSQL RLS) 作为兜底
  
  tenantId: string;  // UUID，注册时生成
  
  // 租户配额
  quotas: {
    maxMemories: 100_000;       // 最大记忆数
    maxStorageMB: 500;          // 存储上限
    llmTokensPerDay: 100_000;   // 每日 LLM Token 额度
    requestsPerMinute: 60;      // API 限流
  };
}
```

##### 认证升级

```typescript
// Local 模式：可选 JWT（默认关闭）
// Cloud 模式：强制认证
interface CloudAuth {
  // 用户注册/登录
  registration: 'email + password' | 'OAuth2 (GitHub/Google)';
  
  // Agent 接入
  apiKey: {
    // 每个用户可创建多个 API Key
    format: 'mm_live_xxxxxxxxxxxx';  // mm_live_ 前缀
    permissions: 'trusted' | 'standard' | 'readonly';
    rateLimit: number;  // 单 Key 限流
  };
  
  // MCP 接入配置（用户视角）
  mcpConfig: {
    // 用户只需要这么配：
    // {
    //   "mcpServers": {
    //     "minimem": {
    //       "url": "https://api.minimem.io/mcp",
    //       "headers": { "Authorization": "Bearer mm_live_xxx" }
    //     }
    //   }
    // }
  };
}
```

##### 计费模型

```typescript
interface BillingModel {
  // 免费层
  free: {
    memories: 5_000;
    llmTokensPerDay: 10_000;
    dreamsPerDay: 1;
    retention: '30 days inactive = archive';
  };
  
  // Pro
  pro: {
    price: '¥29/月 or $4.9/月';
    memories: 100_000;
    llmTokensPerDay: 100_000;
    dreamsPerDay: 'unlimited';
    features: ['自定义 LLM', '导出', '优先做梦', 'Webhook'];
  };
  
  // 计量维度
  metrics: {
    memoryCount: '记忆条数';
    llmTokens: 'LLM 消耗 tokens（做梦 + 检索 + 编译）';
    storageSize: '存储空间 MB';
    apiCalls: 'API 调用次数';
  };
}
```

##### 数据安全（Cloud 模式特有）

```typescript
interface CloudSecurity {
  // 传输加密
  transport: 'TLS 1.3 mandatory';
  
  // 存储加密
  encryption: {
    atRest: 'AES-256-GCM';         // 数据库级加密
    perTenant: 'tenant-specific key derived from master key';
  };
  
  // 隐私合规
  compliance: {
    gdpr: {
      dataExport: 'GET /api/v1/account/export → 完整数据包';
      dataDelete: 'DELETE /api/v1/account → 30 天内彻底删除';
      dataDpa: '数据处理协议';
    };
    dataResidency: 'cn-shanghai | us-west | eu-frankfurt';
  };
  
  // 零知识选项（Pro 功能）
  zeroKnowledge: {
    // 客户端加密：记忆内容在客户端加密后上传
    // 服务端只看到密文，无法解密
    // 代价：无法做语义检索，只能关键词/ID 检索
    clientSideEncryption: boolean;
  };
}
```

##### Local ↔ Cloud 双模式切换

```typescript
// 用户可以随时在 Local 和 Cloud 之间迁移
interface ModeMigration {
  // Local → Cloud：上传
  localToCloud: {
    command: 'minimem migrate --to cloud --endpoint https://api.minimem.io';
    process: [
      '1. 导出本地 SQLite 为 JSON',
      '2. 通过 REST API 批量上传',
      '3. 验证数据完整性（hash 对比）',
      '4. 切换 config.toml mode = "cloud"',
    ];
  };
  
  // Cloud → Local：下载
  cloudToLocal: {
    command: 'minimem migrate --to local';
    process: [
      '1. 调用 /api/v1/account/export 下载完整数据',
      '2. 导入到本地 SQLite',
      '3. 重建向量索引',
      '4. 切换 config.toml mode = "local"',
    ];
  };
}
```

##### 两条腿走路：实施路线图

```
Phase 1（当前）: Local 模式
├── 核心引擎打磨完毕 ✅
├── MCP + REST + SDK 接口稳定 ✅
└── 目标：引擎质量达标，接口不再大改

Phase 2: 存储抽象层
├── 引入 StorageProvider 接口
├── 将现有 SQLite 实现包装为 SqliteStorageProvider
├── 确保所有模块通过抽象层访问数据
└── 目标：Core Engine 与存储解耦

Phase 3: Self-Hosted 增强
├── Docker 镜像发布
├── 认证强制化
├── TLS 支持
└── 目标：用户可在自己服务器上安全运行

Phase 4: Cloud (SaaS)
├── PostgresStorageProvider 实现
├── 多租户 + RLS
├── 注册/登录/API Key 管理面板
├── 计费系统
├── 部署到云（Fly.io / Railway / 腾讯云）
├── 监控/告警/SLA
└── 目标：注册即用，零部署

Phase 5: 高级功能
├── 离线缓存 + CRDT 同步（Local + Cloud 混合）
├── 零知识加密选项
├── Webhook / 事件推送
├── 团队共享记忆空间
└── 目标：企业级
```

#### 11.6.4 Docker Compose 参考

```yaml
# docker-compose.yml
version: '3.8'
services:
  minimem:
    image: minimem/server:latest
    restart: unless-stopped
    ports:
      - "3737:3737"
    volumes:
      - minimem-data:/app/data
    environment:
      - MINIMEM_ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - MINIMEM_LLM_PROVIDER=openai
      - MINIMEM_LLM_API_KEY=${LLM_API_KEY}
      - MINIMEM_LLM_MODEL=gpt-4o-mini
      - MINIMEM_AUTH_JWT_SECRET=${JWT_SECRET}
      - MINIMEM_LOG_LEVEL=info
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3737/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  minimem-data:
    driver: local
```

---

### 11.7 错误处理 & 事务性保障

#### 问题

做梦引擎、GC、级联删除等操作涉及多步修改，如果中途崩溃，数据可能处于不一致状态。

#### 11.7.1 事务设计

```typescript
interface TransactionStrategy {
  // SQLite 事务
  database: {
    // 所有多步操作必须在事务中执行
    walMode: true;            // 启用 WAL 模式（并发读写）
    busyTimeout: 5000;        // 锁等待超时 5s
    journalSizeLimit: '64MB'; // WAL 文件大小限制
  };
  
  // 做梦引擎事务
  dreaming: {
    // 每个 Phase 是一个事务
    phaseTransactions: true;
    // Phase 间有检查点
    checkpoints: {
      afterPhase1: 'commit-phase1-results';
      afterPhase2: 'commit-phase2-results';
      afterPhase3: 'commit-phase3-results';
    };
    // 崩溃恢复：从最后一个检查点继续
    recovery: 'resume-from-last-checkpoint';
  };
  
  // GC 事务
  gc: {
    // GC 操作分批执行，每批一个事务
    batchSize: 50;
    // 如果中断，下次 GC 从未处理的记忆继续
    resumable: true;
  };
}
```

#### 11.7.2 幂等操作设计

```typescript
interface IdempotencyDesign {
  // 所有写入操作带 idempotency_key
  // 重复提交同一 key 不会产生副作用
  addMemory: {
    idempotencyKey: 'hash(client_id + content + timestamp)';
    behavior: 'return-existing-if-duplicate';
  };
  
  dreaming: {
    // 每次做梦有唯一 dream_session_id
    sessionId: 'uuid';
    // 如果同一 session_id 重复触发，检查进度并继续
    behavior: 'resume-or-skip';
  };
  
  gc: {
    // 每次 GC 有唯一 gc_run_id
    runId: 'uuid';
    behavior: 'resume-or-skip';
  };
}
```

#### 11.7.3 崩溃恢复流程

```
启动时检查:
  1. 检查 WAL 文件 → 自动回滚未提交事务
  2. 检查做梦中间状态 → 有未完成的 dream_session? → 从检查点恢复
  3. 检查 GC 中间状态 → 有未完成的 gc_run? → 继续执行
  4. 检查 forget_about 中间状态 → 有未完成的级联删除? → 继续或回滚
  5. 验证数据一致性 → L2.evidence_chain 引用的 L1 是否存在? → 修复悬空引用
```

```typescript
interface StartupRecovery {
  checks: [
    'wal_recovery',           // WAL 自动恢复
    'dream_session_recovery', // 做梦恢复
    'gc_run_recovery',        // GC 恢复
    'cascade_delete_recovery',// 级联删除恢复
    'referential_integrity',  // 引用完整性检查
    'vector_index_sync',      // 向量索引与 SQLite 同步检查
  ];
  
  // 完整性检查发现问题时
  onIntegrityError: {
    danglingReference: 'remove-reference';     // 移除悬空引用
    orphanedVector: 'delete-vector-entry';     // 删除孤立向量
    missingVector: 'reindex-from-sqlite';      // 从 SQLite 重建向量
  };
}
```

---

### 11.8 可观测性 & 链路追踪

#### 问题

系统复杂度高（四层 + 做梦 + GC + Surface + 版本控制 + 多 Agent），出问题难以调试。

#### 11.8.1 链路追踪（Tracing）

```typescript
interface TracingDesign {
  // 每条记忆的完整生命周期可追踪
  memoryLifecycleTrace: {
    traceId: string;          // 全局唯一追踪 ID
    spans: [
      { name: 'ingest', phase: 'received', timestamp: Date },
      { name: 'ingest', phase: 'quality_gate', result: 'pass', timestamp: Date },
      { name: 'ingest', phase: 'pii_scan', result: 'clean', timestamp: Date },
      { name: 'ingest', phase: 'stored_l1', memoryId: string, timestamp: Date },
      { name: 'dreaming', phase: 'promoted_to_l2', factId: string, dreamSessionId: string, timestamp: Date },
      { name: 'dreaming', phase: 'promoted_to_l3', observationId: string, timestamp: Date },
      { name: 'retrieval', phase: 'searched', queryId: string, rank: number, timestamp: Date },
      { name: 'feedback', phase: 'marked_useful', timestamp: Date },
      { name: 'gc', phase: 'temperature_decay', from: 'warm', to: 'cool', timestamp: Date },
      { name: 'gc', phase: 'compressed', timestamp: Date },
      { name: 'gc', phase: 'archived', timestamp: Date },
    ];
  };
  
  // 存储方式
  storage: {
    table: 'memory_traces';
    retention: '90d';          // 追踪日志保留 90 天
    // 可选导出到外部系统
    exportTo?: 'opentelemetry' | 'json-file';
  };
}
```

```sql
-- 追踪日志表
CREATE TABLE memory_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,       -- 全局追踪 ID
  memory_id TEXT,               -- 关联的记忆 ID
  span_name TEXT NOT NULL,      -- 'ingest' | 'dreaming' | 'retrieval' | 'gc' | 'feedback'
  phase TEXT NOT NULL,           -- 阶段名
  result TEXT,                   -- 结果
  metadata JSON,                 -- 额外元数据
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- 索引
  INDEX idx_trace_id (trace_id),
  INDEX idx_memory_id (memory_id),
  INDEX idx_timestamp (timestamp)
);
```

#### 11.8.2 健康监控 API

```typescript
// MCP Tool: get_memory_health
interface MemoryHealthResult {
  overview: {
    totalMemories: { l1: number, l2: number, l3: number, l4: number };
    temperatureDistribution: Record<TemperatureLevel, number>;
    storageUsage: { sqlite: string, vectors: string, surfaceFiles: string };
  };
  
  health: {
    status: 'healthy' | 'degraded' | 'critical';
    issues: string[];
    // 例如: "L1 积压 500+ 条未处理", "GC 上次执行失败", "向量索引不同步"
  };
  
  performance: {
    avgIngestLatency: string;
    avgSearchLatency: string;
    llmCallsToday: number;
    llmCostToday: string;
    lastDreamTime: Date;
    lastGcTime: Date;
  };
  
  warnings: string[];
  // 例如: "LLM 花费已达每日限额 80%", "磁盘空间不足 1GB"
}
```

#### 11.8.3 结构化日志

```typescript
interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'pretty';      // 生产用 json，开发用 pretty
  output: {
    console: boolean;
    file: {
      enabled: boolean;
      path: '~/.minimem/logs/';
      rotation: {
        maxSize: '10MB';
        maxFiles: 10;
        compress: true;
      };
    };
  };
  
  // 模块级别日志控制
  modules: {
    ingest: 'info';
    dreaming: 'info';
    retrieval: 'info';
    gc: 'info';
    surface: 'info';
    auth: 'warn';
    trace: 'debug';               // 追踪日志默认 debug 级别
  };
}
```

---

### 11.9 统一配置管理

#### 问题

大量可调参数散落在各模块设计中，缺乏统一的配置体系。

#### 配置文件设计

```toml
# ~/.minimem/config.toml — MiniMem 统一配置文件

[server]
host = "127.0.0.1"
port = 3737
mode = "local"                    # local | self-hosted | cloud

[auth]
enabled = true
jwt_secret_env = "MINIMEM_JWT_SECRET"  # 从环境变量读取
token_expiry = "7d"

[encryption]
enabled = false                    # 默认关闭，用户按需开启
provider = "sqlcipher"
key_storage = "keychain"           # keychain | env | prompt

[llm]
provider = "openai"                # openai | dashscope | ollama | custom
api_key_env = "MINIMEM_LLM_API_KEY"
base_url = ""                      # 自定义 API 地址
models.heavy = "gpt-4o"
models.medium = "gpt-4o-mini"
models.light = "gpt-3.5-turbo"
cost_limit.daily = 1.0             # 美元
cost_limit.monthly = 20.0
cost_limit.alert_percent = 80

[llm.batch]
fact_extraction_batch_size = 10
max_wait_time = "5m"

[llm.cache]
enabled = true
semantic_threshold = 0.95
ttl = "24h"
max_size = "50MB"

[llm.degraded_mode]
auto_enable = true                 # LLM 不可用时自动降级
queue_for_later = true             # 降级期间积压任务

[ingest]
rate_limit.max_per_minute = 30
rate_limit.max_per_hour = 500
quality_gate.min_score = 0.3
pii_detection.enabled = true
pii_detection.actions.credit_card = "mask"
pii_detection.actions.api_key = "mask"
pii_detection.actions.password = "reject"

[dreaming]
schedule = "daily"                 # daily | every_N_hours | manual
auto_trigger_threshold = 50        # 新记忆数达到阈值自动触发
max_memories_per_session = 500

[gc]
schedule = "weekly"                # weekly | daily | manual
temperature_decay_interval = "24h"
compression_threshold = "cold"
archive_threshold = "frozen"

[surface]
budget_tokens = 10000
files = ["owner_profile", "work", "preferences", "social", "active_threads", "decisions", "learnings", "calendar"]

[storage]
data_dir = "~/.minimem"
sqlite.wal_mode = true
sqlite.busy_timeout = 5000
vector.provider = "local"          # local | qdrant | custom
log.level = "info"
log.format = "json"
log.max_size = "10MB"
log.max_files = 10

[onboarding]
auto_detect = true                 # 自动检测冷启动
cold_start_quality_threshold = 0.1 # 冷启动期间降低质量门槛
cold_start_dream_trigger = 20     # 冷启动期间 20 条记忆即触发做梦

[tracing]
enabled = true
retention = "90d"
export = "none"                    # none | opentelemetry | json-file
```

#### 配置优先级

```
命令行参数 > 环境变量 > ~/.minimem/config.toml > 内置默认值
```

```typescript
interface ConfigPrecedence {
  // 示例：端口配置
  // 1. CLI: --port 3738
  // 2. ENV: MINIMEM_PORT=3738
  // 3. config.toml: server.port = 3738
  // 4. 默认值: 3737
  
  // 运行时热更新（不需要重启）
  hotReloadable: [
    'llm.cost_limit',
    'ingest.rate_limit',
    'gc.schedule',
    'dreaming.schedule',
    'storage.log.level',
  ];
  
  // 需要重启才能生效
  requiresRestart: [
    'server.port',
    'encryption.enabled',
    'storage.data_dir',
  ];
}
```

---

### 11.10 主动记忆推送（Proactive Memory）

#### 问题

当前记忆系统完全被动——只有被查询才响应。缺少"主动联想"能力。

#### 设计方案

**Proactive Memory Engine（PME）**：在 Agent 对话上下文中，主动检测是否有相关记忆值得推送。

```typescript
interface ProactiveMemoryEngine {
  // 触发时机：Agent 调用 get_relevant_context 时顺带执行
  // 不额外增加 MCP 调用，嵌入到现有检索流程中
  
  triggers: {
    // 1. 话题触发：检测到当前对话涉及某个人/项目/主题
    topicMatch: {
      // 从 knowledge_graph 中查找关联记忆
      // 例如：检测到"Bob"，主动推送"上次和 Bob 讨论 X 未决"
      enabled: true;
      maxSuggestions: 3;
    };
    
    // 2. 时间触发：基于日历和历史模式
    timeBased: {
      // 例如：每周一自动推送"上周未完成的工作线程"
      enabled: true;
      patterns: [
        { type: 'weekly_review', day: 'monday', content: 'unresolved_threads' },
        { type: 'before_meeting', lookAhead: '30m', content: 'meeting_context' },
      ];
    };
    
    // 3. 未决事项触发
    unresolvedItems: {
      // Surface File active_threads.md 中 status=open 的线程
      // 超过 N 天未更新时主动提醒
      enabled: true;
      staleDays: 7;
    };
  };
  
  // 推送方式
  delivery: {
    // 方式 A（推荐）：嵌入到 get_relevant_context 结果中
    // 在返回的 Surface Files 末尾追加 "💡 主动提醒" 区域
    inlineWithContext: {
      section: '💡 Proactive Reminders';
      maxTokens: 500;  // 不超过预算
    };
    
    // 方式 B（可选）：独立的 MCP Resource 通知
    mcpNotification: {
      // Agent 可以订阅 proactive_reminders resource
      resourceUri: 'minimem://proactive/reminders';
      pollInterval: '5m';
    };
  };
}
```

**get_relevant_context 返回结构增强**：

```typescript
interface RelevantContextResult {
  // 现有字段
  surfaceFiles: string;       // Surface Files 内容
  deepMemories: Memory[];     // 深层检索结果
  
  // 新增字段
  proactiveReminders?: {
    reminders: Array<{
      type: 'topic' | 'time' | 'unresolved';
      content: string;         // "上次和 Bob 讨论的 API 设计还没结论"
      relatedMemoryId: string;
      priority: 'high' | 'medium' | 'low';
    }>;
    totalTokens: number;       // 确保不超预算
  };
}
```

---

### 11.11 Surface Files 手动编辑冲突处理

#### 问题

设计说 Surface Files 是 Markdown 可以手动编辑，但如果用户手动编辑了 `work.md`，同时做梦引擎也在自动更新，可能互相覆盖。

#### 设计方案

```typescript
interface SurfaceFileConflictResolution {
  // 检测机制：基于文件 hash + 最后修改时间
  detection: {
    beforeWrite: {
      // 做梦引擎写入前检查文件 hash
      // 如果 hash 与上次已知值不同，说明被手动编辑过
      checkHash: true;
      checkMtime: true;
    };
  };
  
  // 冲突处理策略
  strategy: 'user-wins-with-merge';
  // user-wins: 用户手动编辑优先，做梦引擎放弃本次更新
  // system-wins: 做梦引擎覆盖（不推荐）
  // user-wins-with-merge（推荐）: 保留用户编辑 + 合并做梦引擎的新增内容
  
  mergeProcess: {
    // 1. 检测到冲突
    // 2. 三方合并（base版本 + 用户版本 + 做梦版本）
    // 3. 如果自动合并失败，保存用户版本，做梦结果存入待审核队列
    autoMerge: {
      strategy: 'section-level';  // 按 Markdown 段落级别合并
      // 用户新增的段落：保留
      // 做梦引擎新增的段落：追加
      // 同一段落都修改了：保留用户版本，做梦版本存入 pending
    };
    onConflict: {
      preserveUserVersion: true;
      saveDreamVersion: 'pending_review';  // 存入待审核
      notifyAgent: true;                   // 下次 Agent 调用时通知
    };
  };
  
  // 版本追踪
  versioning: {
    // 每次修改（无论手动或自动）都记录版本
    // 利用现有 surface_file_versions 表
    maxVersions: 50;
    diffAvailable: true;
  };
}
```

---

### 11.12 记忆导出 & 可移植性

#### 问题

路线图提到"记忆导出 & 备份"但没有详细设计。用户需要能够导出完整记忆用于备份、迁移或切换系统。

#### 新增 MCP 工具

```typescript
// MCP Tool: export_memories
interface ExportMemoriesParams {
  format: 'json' | 'markdown' | 'sqlite-dump';
  scope: 'all' | 'layer' | 'category' | 'date_range';
  filters?: {
    layers?: ('L1' | 'L2' | 'L3' | 'L4')[];
    categories?: string[];
    dateRange?: { from: Date, to: Date };
    temperature?: TemperatureLevel[];
  };
  includeMetadata: boolean;     // 包含时间戳、来源、温度等元数据
  includeSurfaceFiles: boolean; // 包含 Surface Files
  includeOwnerProfile: boolean; // 包含 Owner Profile
  outputPath?: string;          // 导出文件路径（默认 ~/.minimem/exports/）
}

interface ExportResult {
  filePath: string;
  format: string;
  stats: {
    l1Count: number;
    l2Count: number;
    l3Count: number;
    l4Count: number;
    surfaceFilesCount: number;
    totalSize: string;
  };
  checksum: string;              // SHA-256 校验和
}
```

#### 导出格式

**JSON 格式**（完整结构化，适合导入其他 MiniMem 实例）：
```json
{
  "version": "3.0",
  "exportedAt": "2026-04-07T12:00:00Z",
  "checksum": "sha256:...",
  "ownerProfile": { ... },
  "surfaceFiles": { ... },
  "memories": {
    "l1": [ ... ],
    "l2": [ ... ],
    "l3": [ ... ],
    "l4": [ ... ]
  },
  "knowledgeGraph": {
    "nodes": [ ... ],
    "edges": [ ... ]
  }
}
```

**Markdown 格式**（人类可读，适合归档）：
```markdown
# MiniMem 记忆导出
> 导出时间: 2026-04-07
> 记忆总数: 1234

## Owner Profile
...

## 重要事实 (L2)
### 工作
- **事实**: TypeScript 是主要开发语言 (置信度: 0.95)
  - 来源: 2026-01-15 与 CodeBuddy 的对话
...

## 关键观察 (L3)
...
```

**SQLite Dump**（完整数据库备份）：
```typescript
// 直接复制 SQLite 文件（安全地，使用 VACUUM INTO 或 .backup）
// 适合完整迁移
```

#### 自动备份

```toml
# config.toml
[backup]
enabled = true
schedule = "weekly"             # daily | weekly | manual
retention = 4                   # 保留最近 4 个备份
format = "sqlite-dump"
output_dir = "~/.minimem/backups/"
compress = true                 # gzip 压缩
encrypt = true                  # 使用加密密钥加密备份文件
```

---

### 补充设计总结

| # | 维度 | 优先级 | 实现阶段 | 核心能力 |
|---|------|--------|---------|---------|
| 1 | 🚀 冷启动 & Onboarding | P0 | Phase 1 | 引导问卷 + 自动填充 + 数据导入 |
| 2 | 🔐 数据安全 & 隐私 | P0 | Phase 1-2 | SQLCipher 加密 + PII 检测 + TLS |
| 3 | 🗑️ 遗忘权 & 级联删除 | P0 | Phase 2 | forget_about + delete_memory + 级联清理 |
| 4 | 💰 LLM 成本控制 | P0 | Phase 1 | 批处理 + 缓存 + 降级模式 + 模型分级 |
| 5 | ✏️ 记忆纠错 & 反馈 | P1 | Phase 2 | update/pin/feedback 工具 + 闭环改进 |
| 6 | 📱 多设备 & 云端部署 | P1 | Phase 2-4 | 存储抽象层 + Docker + Cloud SaaS（两条腿走路） |
| 7 | 💥 错误处理 & 事务 | P0 | Phase 1 | WAL + 检查点 + 幂等 + 崩溃恢复 |
| 8 | 🔍 可观测性 & 追踪 | P1 | Phase 2 | 链路追踪 + 健康 API + 结构化日志 |
| 9 | ⚙️ 统一配置管理 | P0 | Phase 1 | config.toml + 环境变量 + 热更新 |
| 10 | 📢 主动记忆推送 | P2 | Phase 3+ | 话题/时间/未决事项触发 + 嵌入上下文 |
| 11 | 📝 Surface Files 冲突 | P1 | Phase 2 | 三方合并 + 用户优先 + 版本追踪 |
| 12 | 📦 记忆导出 & 备份 | P1 | Phase 2 | JSON/MD/SQLite 导出 + 自动备份 |
| 13 | 🧩 Skill 上层接入 | P1 | Phase 2 | Skill prompt 指导 + MCP 底座 + 多平台适配 |

---

## 十二、双层接入架构：MCP 底座 + Skill 上层

> **核心洞察**：MCP Tools 只给工具，Skill 还教 Agent 怎么用。27 个工具摆在那里，Agent 不知道什么时候该用哪个——Skill 解决这个问题。

### 12.1 架构总览

```
┌───────────────────────────────────────────────────┐
│                  接入层（面向 Agent）                │
│                                                    │
│  ┌──────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Skill 接入    │  │ MCP 接入  │  │ REST / SDK  │ │
│  │ (CodeBuddy)  │  │ (Claude   │  │ (自定义      │ │
│  │              │  │  Desktop  │  │  Agent)      │ │
│  │ prompt 指导   │  │  等)      │  │              │ │
│  │ + 工作流编排  │  │           │  │              │ │
│  │ + MCP Tools  │  │ MCP Tools │  │ HTTP API    │ │
│  └──────┬───────┘  └─────┬─────┘  └──────┬───────┘ │
│         │                │               │          │
│         ▼                ▼               ▼          │
│  ┌─────────────────────────────────────────────┐   │
│  │           MiniMem MCP Server（底座）          │   │
│  │           27 个标准化工具接口                   │   │
│  └─────────────────────────────────────────────┘   │
│                        │                            │
│                        ▼                            │
│  ┌─────────────────────────────────────────────┐   │
│  │           MiniMem Core Engine                │   │
│  │    四层记忆 + 做梦 + GC + Surface Files       │   │
│  └─────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────┘
```

### 12.2 各接入方式对比

| 维度 | Skill 接入 | MCP 接入 | REST API | TypeScript SDK |
|------|-----------|---------|----------|---------------|
| **体验等级** | ⭐⭐⭐⭐⭐ 最佳 | ⭐⭐⭐ 标准 | ⭐⭐ 基础 | ⭐⭐⭐⭐ 良好 |
| **Agent 使用质量** | Skill prompt 指导，质量稳定 | 靠 Agent 自己推理 | 完全自由 | 类型安全 |
| **工作流编排** | 预定义最佳实践 | Agent 自由发挥 | 开发者自定义 | 开发者自定义 |
| **接入成本** | 安装 Skill 即用 | 改配置文件 | HTTP 调用 | npm install |
| **适合谁** | CodeBuddy 等支持 Skill 的平台 | Claude Desktop、Cursor 等 MCP 客户端 | 任何能发 HTTP 的程序 | Node.js/TS 项目 |
| **通用性** | 限支持 Skill 格式的平台 | MCP 行业标准，广泛支持 | 最通用 | Node.js 生态 |

### 12.3 Skill 定义：manifest.json

```json
{
  "name": "minimem",
  "version": "3.0.0",
  "displayName": "MiniMem — 个人记忆系统",
  "description": "让 AI 真正记住你。自动记忆管理、智能检索、人设一致性、记忆版本控制。",
  "author": "MiniMem",
  "license": "MIT",
  
  "trustLevel": "trusted",
  
  "capabilities": {
    "memory_management": "读写用户长期记忆",
    "owner_profile": "维护统一用户画像",
    "context_retrieval": "智能检索相关记忆",
    "lifecycle_management": "记忆做梦/GC/版本控制"
  },
  
  "mcpServer": {
    "command": "minimem",
    "args": ["serve", "--mcp"],
    "transport": "stdio"
  },
  
  "tools": [
    {
      "name": "get_relevant_context",
      "description": "获取当前对话的相关上下文（Surface Files + 深层检索）",
      "priority": "high",
      "usage": "每次对话开始时调用"
    },
    {
      "name": "add_memory",
      "description": "存储一条新记忆",
      "priority": "high",
      "usage": "用户提到新事实/偏好/决定时调用"
    },
    {
      "name": "search_memory",
      "description": "搜索记忆库",
      "priority": "medium",
      "usage": "需要精确搜索特定记忆时调用"
    },
    {
      "name": "recall_about",
      "description": "回忆关于某人/某事的所有记忆",
      "priority": "medium",
      "usage": "对话涉及特定人物或话题时调用"
    },
    {
      "name": "forget_about",
      "description": "遗忘关于某事的所有记忆",
      "priority": "medium",
      "usage": "用户要求忘记某事时调用"
    },
    {
      "name": "suggest_surface_update",
      "description": "建议更新 Surface File",
      "priority": "low",
      "usage": "对话结束时，如有重要信息变更调用"
    },
    {
      "name": "feedback_memory",
      "description": "对记忆进行反馈",
      "priority": "low",
      "usage": "检索到的记忆被使用或纠正时调用"
    }
  ],
  
  "promptFile": "SKILL.md"
}
```

### 12.4 Skill Prompt：SKILL.md

```markdown
# MiniMem — 个人记忆系统

## 你正在使用什么

MiniMem 是用户的**中央记忆服务**。它帮你记住用户的一切——工作、偏好、人际关系、
决策历史、学习笔记。你不是唯一使用 MiniMem 的 Agent，但所有 Agent 看到的是
同一个用户画像。

## 核心原则

1. **记住重要的，忽略闲聊** — 不是每句话都值得记。只存有价值的信息。
2. **先读再写** — 对话开始先获取上下文，避免重复存储已有记忆。
3. **用户是主人** — 用户说"忘掉"就忘掉，说"这不对"就纠正。

---

## 工作流

### 🟢 对话开始（必做）

每次新对话开始时，**第一步**就调用 `get_relevant_context`：

```
get_relevant_context({
  current_context: "用户当前话题的简要描述",
  max_tokens: 8000
})
```

返回的内容包括：
- **Surface Files**：用户的精简画像（人设、工作、偏好等）
- **深层记忆**：与当前话题相关的具体记忆
- **主动提醒**：系统检测到的值得关注的信息

把这些作为对话的背景知识，但**不要逐条复述给用户**。

### 🔵 对话过程中（按需）

**检测到以下信号时，调用 `add_memory`**：

| 信号 | 示例 | category | importance |
|------|------|----------|-----------|
| 用户表达偏好 | "我喜欢简洁的代码风格" | preference | 0.7 |
| 用户做了决定 | "我们用 PostgreSQL 而不是 MySQL" | decision | 0.8 |
| 用户提到新事实 | "我下周要去北京出差" | event | 0.6 |
| 重要工作进展 | "登录模块已经完成了" | work | 0.7 |
| 用户纠正你 | "不对，我说的是 React 不是 Vue" | correction | 0.9 |
| 用户提到人物关系 | "Bob 是我的技术负责人" | social | 0.6 |

**不要存储的**：
- ❌ 闲聊寒暄（"你好"、"谢谢"）
- ❌ 临时性技术问题（"这个报错怎么修"）
- ❌ 你自己的回复内容
- ❌ 已经存在的记忆（先搜索再存储）

**存储格式**：

```
add_memory({
  content: "用户决定项目使用 PostgreSQL 替代 MySQL，原因是需要 JSONB 支持",
  category: "decision",
  importance: 0.8,
  tags: ["tech-stack", "database", "项目名"],
  source_context: "与 CodeBuddy 讨论数据库选型"
})
```

**需要回忆特定话题时**：

```
// 精确回忆某人或某事
recall_about({ topic: "Bob", max_results: 10 })

// 语义搜索
search_memory({ query: "数据库选型的讨论", limit: 5 })
```

**用户要求忘记时**：

```
// 用户说："忘掉关于那个项目的所有事"
forget_about({
  target: "XX项目",
  scope: "related",    // 删除直接 + 关联记忆
  dryRun: true         // 先预览！
})
// 确认后再 dryRun: false 执行
```

**发现记忆有误时**：

```
// 用户说："不对，我用的是 MacBook Pro 不是 Air"
feedback_memory({
  memory_id: "...",
  feedback: "incorrect",
  context: "用户纠正了电脑型号"
})
// 然后存储正确版本
add_memory({
  content: "用户使用 MacBook Pro",
  category: "fact",
  importance: 0.6
})
```

### 🟡 对话结束时（建议）

如果本次对话涉及了重要信息变更，调用 `suggest_surface_update`：

```
suggest_surface_update({
  file: "work",
  suggestion: "新增：用户启动了 MiniMem 项目，技术栈为 TypeScript + SQLite",
  reason: "用户在对话中确认了新项目信息"
})
```

### 🔴 首次使用（自动检测）

如果 `get_relevant_context` 返回的 Surface Files 为空或只有模板内容，
说明这是新用户。调用 `start_onboarding` 进入引导流程：

```
start_onboarding()
```

然后根据返回的问题，**自然地**在对话中询问用户（不要一次全问完）。

---

## 注意事项

1. **频率控制** — 一次对话中 `add_memory` 通常不超过 5-8 次。
   不要每句话都存。
2. **去重意识** — 存储前想一想"这个信息是不是已经记过了"。
   不确定就先 `search_memory` 查一下。
3. **隐私尊重** — 不要存储密码、API Key、身份证号等敏感信息。
   系统有 PII 检测，但你作为第一道防线应该主动过滤。
4. **自然融入** — 记忆操作在后台进行，不要跟用户说
   "我已经把这条存入记忆了"。默默做好就行。
5. **错误容忍** — 如果 MiniMem 服务不可用，正常继续对话，
   不要报错给用户。记忆是增强功能，不是核心依赖。
```

### 12.5 各平台接入配置

#### CodeBuddy（Skill 方式 — 推荐）

```
# 安装 Skill
将 minimem-skill/ 目录放入 CodeBuddy 的 skills 目录

# 目录结构
minimem-skill/
├── manifest.json     # Skill 定义
├── SKILL.md          # Prompt 指南
└── README.md         # 说明文档
```

Skill 内部通过 `mcpServer` 字段自动启动 MiniMem MCP Server，用户无需额外配置 MCP。

#### Claude Desktop（MCP 方式）

```json
// ~/.claude/claude_desktop_config.json
{
  "mcpServers": {
    "minimem": {
      "command": "npx",
      "args": ["-y", "minimem", "serve", "--mcp"],
      "env": {
        "MINIMEM_LLM_API_KEY": "your-api-key"
      }
    }
  }
}
```

> 注意：纯 MCP 接入没有 Skill prompt 指导，Agent 的记忆使用质量取决于 Agent 自身能力。

#### Cursor / Windsurf（MCP 方式）

```json
// .cursor/mcp.json 或类似配置
{
  "mcpServers": {
    "minimem": {
      "command": "minimem",
      "args": ["serve", "--mcp"],
      "transport": "stdio"
    }
  }
}
```

#### 自定义 Agent（REST API）

```typescript
import { MiniMemClient } from 'minimem-sdk';

const mem = new MiniMemClient({
  baseUrl: 'https://localhost:3737',
  apiKey: 'your-jwt-token',
  clientId: 'my-custom-agent',
  trustLevel: 'standard'
});

// 获取上下文
const ctx = await mem.getRelevantContext({
  currentContext: '用户在讨论数据库设计'
});

// 存储记忆
await mem.addMemory({
  content: '用户偏好使用 PostgreSQL',
  category: 'preference',
  importance: 0.7
});
```

#### 自定义 Agent（REST API — 原始 HTTP）

```bash
# 获取上下文
curl -X POST https://localhost:3737/api/v1/context \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"current_context": "数据库设计讨论", "max_tokens": 8000}'

# 存储记忆
curl -X POST https://localhost:3737/api/v1/memories \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"content": "用户偏好 PostgreSQL", "category": "preference", "importance": 0.7}'
```

### 12.6 Skill vs MCP 的效果差异预期

```
场景：用户说 "我下周要去北京出差，帮我准备一下"

┌─ Skill 接入的 Agent ──────────────────────────────┐
│ 1. (已在对话开始调用 get_relevant_context)          │
│ 2. 检测到"出差"→ recall_about("北京")              │
│    → 发现上次去北京的记录、常住酒店偏好              │
│ 3. add_memory("下周北京出差", event, 0.7)           │
│ 4. 结合记忆给出准备建议（含上次经验）                │
│ 5. suggest_surface_update("calendar", "下周北京出差")│
└───────────────────────────────────────────────────┘

┌─ 纯 MCP 接入的 Agent ────────────────────────────┐
│ 1. (可能忘记调 get_relevant_context)               │
│ 2. 可能直接回答，没有调用任何记忆工具               │
│ 3. 或者调了 search_memory 但搜索词不够好            │
│ 4. 给出的建议缺少个性化（不知道用户的酒店偏好）      │
│ 5. 可能忘记存储这条信息                             │
└───────────────────────────────────────────────────┘
```

**预期效果差异**：

| 指标 | Skill 接入 | 纯 MCP 接入 |
|------|-----------|------------|
| 记忆存储覆盖率 | ~85%（关键信息基本不漏） | ~40%（看 Agent 心情） |
| 检索质量 | 高（知道用什么工具、怎么搜） | 中等（可能用错工具） |
| 人设一致性 | 高（每次都读 Surface Files） | 低（可能忘记读） |
| 用户体验 | 自然流畅 | 时好时坏 |

---

## 十四、Karpathy 编译范式融合 — 从"提取归纳"到"编译互联"

> **参考来源**：Andrej Karpathy "LLM Knowledge Base" 范式 (2026.04)
>
> **核心洞察**：记忆整理的本质不是"索引"，而是"编译"——LLM 作为长期运行的研究图书管理员，
> 将碎片信息主动编译为结构化、互联的知识页面，并通过 Lint 机制持续自我修复。

### 14.1 Karpathy 范式概述

Karpathy 于 2026 年 4 月提出 "LLM Knowledge Base" / "LLM Wiki" 统一范式，核心主张：

1. **LLM 是编译器，不是搜索引擎**：不做 RAG 式的"切块→嵌入→检索"，而是 LLM 读完原始资料后**主动重写**为结构化 Wiki 页面
2. **Markdown 为真实源**：知识以人类可读的 Markdown 存储，每条知识可追溯到具体文件
3. **显式互联**：概念间通过**反向链接**（`[[related]]`）建立显式连接，而非依赖向量语义相似度
4. **索引文件作入口**：一个紧凑的 `INDEX.md`，每个概念一行摘要，LLM 先读索引再按需深入
5. **Lint 自我修复**：定期健康检查——找矛盾、补缺口、建新链接、修过时内容

**Karpathy 的 4 阶段流水线**：

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│  1. Ingest      │    │  2. Compile      │    │  3. Query       │    │  4. Lint         │
│  ─────────      │───▶│  ─────────       │───▶│  ─────────      │───▶│  ─────────       │
│  原始资料 → raw/ │    │  LLM 编译为      │    │  通过索引导航    │    │  健康检查:       │
│  只追加不修改    │    │  Wiki 页面 +     │    │  Wiki 回答问题   │    │  找矛盾/补缺口   │
│                 │    │  索引 + 反向链接   │    │  答案写回 Wiki   │    │  建新链接/修过时  │
└─────────────────┘    └──────────────────┘    └─────────────────┘    └──────────────────┘
                                                                              │
                                                                              ▼
                                                                      回到 Compile，
                                                                      Wiki 持续演进
```

### 14.2 与 MiniMem Dream Engine 的结构对应

Karpathy 的 4 阶段与我们的 Dream Engine 4 Phase 存在精确的结构对应：

| Karpathy 阶段 | MiniMem Dream Phase | 共同本质 |
|--------------|---------------------|---------|
| **Ingest** → `raw/` 目录 | L1 Experiences（原始对话/事件写入） | 原始材料的无损保留，只追加不修改 |
| **Compile** → 撰写 Wiki 页面 | **Phase 2: Consolidation**（L1→L2→L3 层级提升） | LLM 主动将碎片信息编译为结构化知识 |
| **Lint** → 健康检查 | **Phase 1: Audit** + **Phase 4: Cleanup** | 扫描不一致、补缺口、清理过时 |
| **Query** → 查 Wiki 答问题 | Surface Files + MemSifter 检索 | 结构化知识的高效访问 |

**MiniMem 独有的超越**（Karpathy 范式没有但我们有的）：

| 能力 | MiniMem 实现 | Karpathy 范式 |
|------|-------------|-------------|
| **创造性联想** | Phase 3: REM 做梦 — 跨域关联、模式发现 | ❌ 无显式创造阶段 |
| **多层信任** | L4 Mental Models — 最高优先级策划原则 | ❌ Wiki 页面是平等的 |
| **主动遗忘** | 五级温度模型 + GC | ❌ 只做修复，不做遗忘 |
| **版本安全** | Memoria Git-style 快照/回滚 | ⚠️ 依赖外部 Git |
| **多 Agent 并发** | SQLite WAL + 权限分级 + 流控 | ❌ 单用户文件系统 |

### 14.3 融合策略：选择性吸收

**核心原则：吸收思想精髓，保持技术选型独立。**

#### ✅ 融合的（思想层面）

| Karpathy 思想 | 融入方式 | 影响模块 |
|--------------|---------|---------|
| "编译"替代"索引" | Dream Phase 2 从"提取+归纳"升级为"编译+互联" | Dream Engine |
| 知识页面 + 反向链接 | L3 从散点 Observation → **Knowledge Page**（概念页面） | Store (L3) |
| INDEX 索引文件 | Surface `index.md` 增加知识页面索引区 | Surface Files |
| Lint 健康检查 | Phase 1 增加知识页面完整性检查 | Dream Engine |
| Schema 模式层 | 映射到 L4 Mental Models 作为"编译规则" | L4 |
| 查询结果回写 | Dream insights 自动成为新知识页面 | Dream Phase 3 |

#### ❌ 不融合的（技术层面）

| Karpathy 选择 | 我们的选择 | 原因 |
|--------------|-----------|------|
| 纯 Markdown 文件系统 | SQLite + Surface Files | 多 Agent 并发写入，文件锁太脆弱 |
| 抛弃向量搜索 | 向量 + 全文 + 图 + Engram 四路 | 我们的规模会远超 100 篇文章 |
| 不用 RAG | MemSifter 智能检索 | 我们不只是个人 Wiki，是完整记忆系统 |
| 无遗忘机制 | 五级温度 + GC | 记忆会无限膨胀，必须有遗忘 |
| 无版本控制 | Memoria Git-style | 做梦引擎可能出错，需要回滚保护 |
| 上下文窗口装下整个索引 | Surface Files 预算 ≤ 10K tokens | 不能假设无限上下文 |

### 14.4 核心升级：L3 知识页面（Knowledge Pages）

#### 14.4.1 设计理念

当前 L3 Observations 是一条条独立的记录。融入 Karpathy 编译思想后，L3 增加 **Knowledge Page** 概念——将同一实体/概念的所有观察编织为一个结构化的知识页面：

```
当前 L3（散点模式）:
  observation_001: "Alice 正在从 React 转向 Vue"
  observation_002: "Alice 在 Google 工作"
  observation_003: "Alice 最近在学 Rust"
  → 三条独立记录，关联靠 tag/entity 松散连接

升级后 L3（知识页面模式）:
  knowledge_page: "alice"
  ┌──────────────────────────────────────────────────┐
  │  # Alice                                          │
  │                                                    │
  │  ## 基本信息                                        │
  │  - Google 软件工程师                                │
  │    (证据: L2#fact_012, L2#fact_045)                 │
  │                                                    │
  │  ## 技术栈演进                                      │
  │  - React → Vue (趋势，3 次对话提到)                  │
  │    (证据: L1#exp_023, L1#exp_056, L1#exp_078)       │
  │  - 近期兴趣: Rust (新兴，证据较少)                    │
  │    (证据: L1#exp_091)                               │
  │                                                    │
  │  ## 关联                                            │
  │  - [[Bob]] — 同在 Mountain View                     │
  │  - [[Project-X]] — 共同参与的项目                    │
  │  - [[Vue-Migration]] — 相关技术话题                  │
  │                                                    │
  │  ## 元数据                                          │
  │  - 首次提及: 2026-01-15                              │
  │  - 最后更新: 2026-04-07                              │
  │  - 置信度: 0.87                                      │
  │  - 来源覆盖: 5 次 L1 经历, 3 条 L2 事实              │
  └──────────────────────────────────────────────────┘
```

#### 14.4.2 数据结构

```typescript
interface KnowledgePage {
  id: string;
  slug: string;                    // URL 友好的标识，如 "alice", "vue-migration"
  title: string;                   // 页面标题
  page_type: 'person' | 'topic' | 'project' | 'place' | 'concept' | 'event_series';

  // 结构化内容（Markdown 格式，带反向链接语法）
  content: string;                 // 完整内容，含 [[backlink]] 语法

  // 反向链接（显式互联 — Karpathy 核心）
  outgoing_links: string[];        // 本页面链接到的其他 Knowledge Page slug
  incoming_links: string[];        // 链接到本页面的其他 Knowledge Page slug（自动维护）

  // 证据链（保持 Hindsight 特性）
  evidence: {
    l1_experience_ids: string[];   // 支撑此页面的原始经历
    l2_fact_ids: string[];         // 支撑此页面的事实
    observation_ids: string[];     // 关联的独立观察（兼容现有 L3）
  };

  // 编译元数据
  compile_metadata: {
    first_compiled: Date;          // 首次编译时间
    last_compiled: Date;           // 最近一次编译时间
    compile_count: number;         // 被编译过多少次
    last_lint: Date;               // 最近一次 Lint 检查
    lint_status: 'healthy' | 'needs_update' | 'stale' | 'conflicted';
    staleness_score: number;       // 0-1，越高越需要更新
  };

  // 与现有系统兼容
  confidence: number;
  temperature: number;
  created_at: Date;
  updated_at: Date;
}
```

#### 14.4.3 与现有 L3 Observations 的共存关系

Knowledge Page 不替代 Observations，而是**一个更高级的组织形式**：

```
Observations（现有，保留）:
  → 单条散点观察，适合简单模式/趋势
  → 例: "用户最近偏好深色主题"

Knowledge Pages（新增）:
  → 结构化概念页面，适合围绕实体/主题的复杂知识
  → 例: 关于 "Alice" 的完整知识页面

关系:
  Observation 可以被吸收进 Knowledge Page
  Knowledge Page 的子段落可以引用 Observation
  做梦引擎在编译时决定: 独立观察 or 编入知识页面
```

### 14.5 Dream Engine Phase 2 升级："编译器模式"

#### 14.5.1 原有流程 vs 升级后流程

```
原有 Phase 2 (Consolidation):
  ┌─────────────┐
  │ 扫描新 L1    │
  │     │        │
  │     ▼        │
  │ 提取 L2 事实 │
  │     │        │
  │     ▼        │
  │ 归纳 L3 观察 │
  │     │        │
  │     ▼        │
  │ 碎片合并     │
  │ 冲突解决     │
  └─────────────┘

升级后 Phase 2 (Compile):
  ┌──────────────────────────────────────────────────────────────┐
  │ Step 1: 提取 L2 事实（保持不变）                               │
  │     │                                                         │
  │     ▼                                                         │
  │ Step 2: 读取 Knowledge Pages INDEX                             │
  │     │   (紧凑索引: 每个页面一行摘要 + 最后更新时间)               │
  │     │                                                         │
  │     ▼                                                         │
  │ Step 3: 编译决策（LLM 判断）                                    │
  │     ├─ 新实体/概念 → 创建新 Knowledge Page                      │
  │     ├─ 已有页面需更新 → 增量追加（不是重写！）                    │
  │     ├─ 简单模式 → 创建独立 Observation（保持现有路径）            │
  │     └─ 多页面关联 → 更新反向链接                                │
  │     │                                                         │
  │     ▼                                                         │
  │ Step 4: 执行编译                                               │
  │     ├─ 创建/更新 Knowledge Pages（含 [[backlink]] 语法）        │
  │     ├─ 维护反向链接（双向同步）                                  │
  │     └─ 更新 INDEX（每页一行摘要）                                │
  │     │                                                         │
  │     ▼                                                         │
  │ Step 5: 冲突检测                                               │
  │     ├─ 新事实与已有页面内容矛盾 → 标记，不自动覆盖               │
  │     └─ 生成 conflict_report，等待下次 Lint 或人工处理            │
  └──────────────────────────────────────────────────────────────┘
```

#### 14.5.2 编译决策的 Prompt 模板

```typescript
const COMPILE_DECISION_PROMPT = `
你是 MiniMem 的知识编译器。你的任务是将新提取的事实整合到知识库中。

## 当前知识页面索引
{index_content}

## 新提取的事实
{new_facts}

## 你需要决定:
1. 哪些事实应该创建新的 Knowledge Page？（判断标准: 是一个重要实体/概念/主题，且没有现有页面覆盖）
2. 哪些事实应该追加到现有页面？（指出页面 slug 和追加位置）
3. 哪些事实只需创建独立 Observation？（简单趋势/偏好，不值得独立页面）
4. 需要新增哪些反向链接？（A 页面提到了 B 页面的内容）
5. 有无冲突？（新事实与已有页面内容矛盾）

## 输出格式 (JSON):
{
  "create_pages": [{ "slug": "...", "title": "...", "page_type": "...", "initial_content": "..." }],
  "update_pages": [{ "slug": "...", "append_section": "...", "append_content": "...", "reason": "..." }],
  "create_observations": [{ "description": "...", "type": "...", "evidence": [...] }],
  "add_backlinks": [{ "from_slug": "...", "to_slug": "...", "context": "..." }],
  "conflicts": [{ "page_slug": "...", "existing_claim": "...", "new_claim": "...", "evidence": [...] }]
}
`;
```

### 14.6 Dream Phase 1 升级：增加知识页面 Lint

在原有的 Memory Audit 基础上，增加 Knowledge Page 健康检查：

```typescript
interface KnowledgePageLintResult {
  // ── 原有审计项（保持不变）──
  total_new_memories: number;
  by_source: Record<string, number>;
  critical: MemoryRef[];
  important: MemoryRef[];
  routine: MemoryRef[];
  trivial: MemoryRef[];
  conflicts: MemoryConflict[];
  duplicates: MemoryPair[];
  outdated: MemoryRef[];

  // ── 新增: Knowledge Page Lint ──
  page_lint: {
    // 过时页面: 最后编译时间 > 7 天且有新证据
    stale_pages: {
      slug: string;
      last_compiled: Date;
      new_evidence_count: number;
    }[];

    // 孤立页面: 无反向链接（入链为 0）
    orphan_pages: {
      slug: string;
      title: string;
      suggestion: string;  // 建议链接到哪些页面
    }[];

    // 矛盾页面: 内容与新事实冲突
    conflicted_pages: {
      slug: string;
      conflict_description: string;
      new_evidence: string[];
    }[];

    // 缺失页面: 在多个 L1/L2 中出现但尚无 Knowledge Page 的实体
    missing_pages: {
      entity: string;
      mention_count: number;
      source_memories: string[];
      suggested_page_type: string;
    }[];

    // 索引健康
    index_status: {
      total_pages: number;
      pages_in_index: number;
      missing_from_index: string[];  // 有页面但索引中没有
      stale_summaries: string[];     // 索引摘要与页面内容不一致
    };
  };
}
```

### 14.7 Surface Files index.md 升级：增加知识索引区

现有 `index.md` 作为"目录索引 + 深层记忆检索入口"。融合 Karpathy 的 INDEX 概念后，增加 **Knowledge Pages Index** 区域：

```markdown
# 📋 MiniMem 索引

## Surface Files 目录
- [me.md](me.md) — 你是谁（基本信息、性格、兴趣）
- [soul.md](soul.md) — 灵魂画像（深层人格）
- [work.md](work.md) — 工作状态（当前任务、偏好）
- [social.md](social.md) — 社交速查（常用联系人）
- [life.md](life.md) — 生活状态（日程、健康、家庭）
- [agent.md](agent.md) — Agent 行为指南
- [context.md](context.md) — 当前上下文（最近话题）

## 知识页面索引 ← 新增！Karpathy INDEX 概念
> 每个概念一行摘要。LLM 先读此索引，再决定深入哪个页面。
> 按最近更新排序。总预算: ≤ 2K tokens (index.md 总预算 1500 tok 的一部分)

### 人物
- **alice** — Google 软工，React→Vue 转型中，学 Rust (更新: 04-07)
- **bob** — Mountain View，后端架构师，Alice 同事 (更新: 04-05)

### 项目
- **project-x** — Alice 和 Bob 的协作项目，Vue + Go (更新: 04-06)

### 技术话题
- **vue-migration** — React→Vue 迁移路径，最佳实践 (更新: 04-07)
- **rust-learning** — Rust 学习资源和路径 (更新: 04-03)

## 深层记忆检索
- `search_memory(query)` → 全文检索深层记忆
- `recall_about(entity)` → 获取某实体全部关联记忆
```

**索引自动维护规则**：
- **何时更新**：每次 Dream Phase 2 编译后自动更新
- **格式约束**：每行 ≤ 80 字符，总条目数不超过 50（超出则只保留最活跃的）
- **排序**：按最近更新时间降序
- **预算控制**：知识索引区占 index.md 总预算（1500 tokens）的 40%，即 ≤ 600 tokens

### 14.8 查询结果回写机制

Karpathy 范式的一个精妙设计：**每次有价值的查询结果都会写回 Wiki，形成知识复利。**

对应到 MiniMem：

```typescript
interface QueryWriteback {
  // 触发条件: 检索结果中产生了新的跨域洞察
  trigger: 'cross_domain_insight' | 'novel_connection' | 'user_confirmed_useful';

  // 写回目标
  action:
    | { type: 'append_to_page'; slug: string; content: string }  // 追加到现有知识页面
    | { type: 'create_observation'; observation: Observation }     // 创建新观察
    | { type: 'queue_for_dream'; insight: string };               // 排队等做梦时编译

  // 不立即写入 Knowledge Page，而是放入 compile_queue
  // 在下一次 Dream Phase 2 时由编译器统一处理
  // 这避免了查询时的副作用和并发冲突
}
```

**工作流程**：

```
用户查询 → MemSifter 检索 → 返回结果
                                │
                                ├─ 结果中发现跨域连接？
                                │   → 记录到 compile_queue
                                │   → 下次做梦时编译进 Knowledge Page
                                │
                                ├─ 用户反馈 "useful"？
                                │   → 强化相关记忆温度
                                │   → 如果涉及新模式，记录到 compile_queue
                                │
                                └─ 普通结果
                                    → 不做额外操作
```

### 14.9 融合后的完整记忆架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                     L1 Experiences (= Karpathy raw/)                   │
│  原始经历，只追加不修改。做梦引擎的输入原料。                              │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
                    Dream Engine Phase 2: COMPILE ← 核心升级！
                                │
                 ┌──────────────┼──────────────┐
                 │              │              │
           ┌─────▼─────┐  ┌────▼────────┐  ┌──▼──────────────────────┐
           │ L2 Facts   │  │ L3 Observ.  │  │ L3 Knowledge Pages     │
           │ 事实碎片    │  │ 散点观察     │  │ ← 新增！                │
           │ 条件索引    │  │ (简单模式)   │  │ · 概念页面 + 反向链接   │
           │            │  │             │  │ · 证据追溯 → L1/L2     │
           │            │  │             │  │ · INDEX 紧凑索引       │
           └────────────┘  └─────────────┘  │ · Lint 健康状态         │
                                            └───────────┬────────────┘
                                                        │
                                       Dream Engine Phase 3: REM
                                       创造性联想 + 跨页面模式发现
                                                        │
                                            ┌───────────▼────────────┐
                                            │ L4 Mental Models        │
                                            │ · 最高优先级策划原则      │
                                            │ · = Karpathy Schema 层  │
                                            │ · 指导编译器行为         │
                                            └───────────┬────────────┘
                                                        │
                                            ┌───────────▼────────────┐
                                            │ Surface Files (输出层)  │
                                            │ · index.md 含知识索引    │
                                            │ · 总预算 ≤ 10K tokens   │
                                            │ · = Karpathy INDEX.md   │
                                            └────────────────────────┘
```

### 14.10 新增存储

#### 14.10.1 knowledge_pages 表

```sql
CREATE TABLE knowledge_pages (
  id            TEXT PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,     -- URL 友好标识
  title         TEXT NOT NULL,
  page_type     TEXT NOT NULL,            -- person/topic/project/place/concept/event_series
  content       TEXT NOT NULL,            -- Markdown 内容，含 [[backlink]] 语法

  -- 编译元数据
  first_compiled  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_compiled   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  compile_count   INTEGER NOT NULL DEFAULT 1,
  last_lint       DATETIME,
  lint_status     TEXT NOT NULL DEFAULT 'healthy',  -- healthy/needs_update/stale/conflicted
  staleness_score REAL NOT NULL DEFAULT 0.0,

  -- 通用字段
  confidence      REAL NOT NULL DEFAULT 0.5,
  embedding_id    TEXT,                   -- 向量索引（页面摘要的 embedding）
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- 版本控制
  snapshot_id     TEXT,
  branch          TEXT NOT NULL DEFAULT 'main'
);

CREATE INDEX idx_kp_slug ON knowledge_pages(slug);
CREATE INDEX idx_kp_type ON knowledge_pages(page_type);
CREATE INDEX idx_kp_lint ON knowledge_pages(lint_status);
CREATE INDEX idx_kp_staleness ON knowledge_pages(staleness_score DESC);
```

#### 14.10.2 knowledge_page_links 表（反向链接）

```sql
CREATE TABLE knowledge_page_links (
  id            TEXT PRIMARY KEY,
  from_page_id  TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  to_page_id    TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  link_context  TEXT,                     -- 链接上下文（在什么语境下链接的）
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(from_page_id, to_page_id)       -- 同方向不重复
);

CREATE INDEX idx_kpl_from ON knowledge_page_links(from_page_id);
CREATE INDEX idx_kpl_to ON knowledge_page_links(to_page_id);  -- 查反向链接
```

#### 14.10.3 knowledge_page_evidence 表（证据链）

```sql
CREATE TABLE knowledge_page_evidence (
  id              TEXT PRIMARY KEY,
  page_id         TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  evidence_type   TEXT NOT NULL,           -- l1_experience / l2_fact / l3_observation
  evidence_id     TEXT NOT NULL,           -- 引用的记忆 ID
  section_hint    TEXT,                    -- 该证据支撑页面的哪个段落
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(page_id, evidence_type, evidence_id)
);

CREATE INDEX idx_kpe_page ON knowledge_page_evidence(page_id);
CREATE INDEX idx_kpe_evidence ON knowledge_page_evidence(evidence_type, evidence_id);
```

#### 14.10.4 compile_queue 表（编译队列）

```sql
CREATE TABLE compile_queue (
  id              TEXT PRIMARY KEY,
  source_type     TEXT NOT NULL,           -- new_fact / query_insight / feedback / lint_finding
  source_id       TEXT,                    -- 来源记忆 ID
  content         TEXT NOT NULL,           -- 待编译的内容
  target_page     TEXT,                    -- 建议的目标页面 slug（可为空）
  priority        INTEGER NOT NULL DEFAULT 5,  -- 1-10
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending / compiled / skipped
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  compiled_at     DATETIME
);

CREATE INDEX idx_cq_status ON compile_queue(status, priority DESC);
```

### 14.11 设计原则补充

在原有 15 条设计原则（§一）基础上新增：

> **#20 编译优于索引**（Karpathy 编译范式）
> 深层记忆整理不是给碎片打标签，而是让 LLM 把碎片重新编写为结构化、互联的知识。
> 知识页面是"编译产物"，索引是"编译器的导航表"。
>
> **#21 知识复利**（Karpathy 查询回写）
> 每一次有价值的查询都应该让知识库变得更好——新洞察排队等待编译，
> 而不是用完即弃。系统的知识密度应该随时间单调递增。

### 14.12 对其他模块的影响汇总

| 受影响模块 | 变更内容 |
|-----------|---------|
| **Dream Engine Phase 1** | 增加 Knowledge Page Lint 检查 |
| **Dream Engine Phase 2** | 从 Consolidation 升级为 Compile 模式 |
| **Dream Engine Phase 3** | REM 联想新增"跨 Knowledge Page 模式发现" |
| **Store (L3 层)** | 新增 `knowledge_pages` + `knowledge_page_links` + `knowledge_page_evidence` 表 |
| **Store (队列)** | 新增 `compile_queue` 表 |
| **Surface Files** | `index.md` 增加知识页面索引区 |
| **Retrieval** | 检索时考虑 Knowledge Page（整页返回 or 段落级返回） |
| **MemSifter** | 查询规划器增加 Knowledge Page 路径 |
| **Lifecycle** | Knowledge Page 也参与温度管理和 GC |
| **Version Control** | Knowledge Page 变更纳入快照和 Diff |
