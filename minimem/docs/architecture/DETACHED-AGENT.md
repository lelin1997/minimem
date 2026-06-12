# 分离式 Agent 架构（Detached Agent Architecture）

> 本文档描述一种将 AI Agent 的认知能力拆解为独立服务的架构范式。
> 与 AGENT-SOUL.md（思辨）互补，本文聚焦于**工程设计**：怎么拆、怎么连、怎么落地。

---

## 1. 架构概述

### 1.1 核心理念

**单体 Agent 把所有认知能力耦合在一个进程里；分离式 Agent 把每种认知能力拆成独立服务，通过标准协议编排。**

```
单体模式 (Monolithic Agent):
┌────────────────────────────────────────────┐
│  [感知] [记忆] [规划] [执行] [安全] [学习]  │
│            一个进程，一份代码               │
└────────────────────────────────────────────┘

分离模式 (Detached Agent):
┌──────────────┐
│  Agent Core  │  ← 薄编排层，唯一的"主进程"
│  (意图循环)   │
└──────┬───────┘
       │ MCP / gRPC / HTTP
  ┌────┼────┬────┬────┬────┬────┬────┐
  ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼
 Mem  Per  Plan Iden Tool Guard Lrn  Soc
```

### 1.2 设计原则

| 原则 | 说明 |
|---|---|
| **单一职责** | 每个服务只做一件事，做到极致 |
| **协议优先** | 服务间通过标准协议通信，不依赖具体实现 |
| **可替换性** | 任何模块都可以被另一个符合同一协议的实现替换 |
| **渐进增强** | Agent 从最小集合（Core + 1~2 个模块）起步，按需接入更多模块 |
| **本地优先** | 模块默认跑在本地（同机 IPC），性能敏感；云端部署是可选项 |

### 1.3 与微服务的区别

分离式 Agent **不是**传统微服务架构的照搬：

| 维度 | 微服务 | 分离式 Agent |
|---|---|---|
| 通信模式 | 请求-响应为主 | 混合：同步查询 + 异步事件 + 流式推送 |
| 状态 | 尽量无状态 | 各模块有自己的持久状态（记忆库、知识图谱、学习模型） |
| 编排方 | API Gateway / 服务网格 | Agent Core（有"意志"的编排者） |
| 调用时序 | 确定性的 API 调用链 | 不确定的——Core 根据 LLM 推理结果动态决定调用谁 |
| 核心挑战 | 分布式一致性 | 认知一致性（各模块对同一用户的理解要一致） |

---

## 2. 系统拓扑

### 2.1 完整拓扑

```
                         ┌─────────────┐
                         │   用户/客户端 │
                         └──────┬──────┘
                                │
                    ┌───────────▼───────────┐
                    │      Agent Core       │
                    │                       │
                    │  · 意图循环            │
                    │  · 状态机              │
                    │  · 上下文编织          │
                    │  · 意图裁决            │
                    │  · 反馈闭环            │
                    │  · LLM 调用           │
                    └───┬──┬──┬──┬──┬──┬────┘
                        │  │  │  │  │  │
          ┌─────────────┘  │  │  │  │  └─────────────┐
          ▼                ▼  │  ▼  ▼                ▼
   ┌────────────┐  ┌──────────┐│┌──────────┐  ┌────────────┐
   │  Memory    │  │Perception│││ Identity │  │  Social    │
   │  记忆服务   │  │ 感知服务  │││ 人格服务  │  │ 社交服务   │
   │            │  │          │││          │  │            │
   │ · 存储/检索 │  │ · NER    │││ · 人设管理│  │ · Agent 通信│
   │ · 巩固/遗忘 │  │ · 意图   │││ · 语气   │  │ · 能力发现  │
   │ · 做梦     │  │ · 情感   │││ · 价值观  │  │ · 任务委托  │
   │ · 知识图谱  │  │ · 多模态 │││          │  │            │
   │            │  │          │││          │  │            │
   │ [MiniMem]  │  │ [待建]   │││ [待建]   │  │ [待建]     │
   └────────────┘  └──────────┘│└──────────┘  └────────────┘
                               │
                    ┌──────────▼──────────┐
                    │                     │
              ┌─────▼─────┐        ┌──────▼─────┐
              │ Planner   │        │ Guardrail  │
              │ 规划服务    │        │ 安全服务    │
              │            │        │            │
              │ · 任务分解  │        │ · 注入检测  │
              │ · 依赖分析  │        │ · PII 脱敏  │
              │ · 回溯重规划│        │ · 权限控制  │
              │ · 资源估算  │        │ · 审计日志  │
              │            │        │            │
              │ [待建]     │        │ [待建]     │
              └────────────┘        └────────────┘

              ┌────────────┐        ┌────────────┐
              │ Toolbelt   │        │ Learner    │
              │ 工具注册表  │        │ 学习服务    │
              │            │        │            │
              │ · 工具发现  │        │ · 反馈收集  │
              │ · 调用编排  │        │ · 模式发现  │
              │ · 结果归一化│        │ · Prompt优化│
              │ · 鉴权     │        │ · 偏好学习  │
              │            │        │            │
              │ [MCP 生态] │        │ [待建]     │
              └────────────┘        └────────────┘
```

### 2.2 最小可行拓扑（MVP）

并非所有模块都必须存在。最小可行的分离式 Agent 只需要：

```
┌─────────────┐
│ Agent Core  │  ← 意图循环 + LLM 调用
│             │
│  ┌────────┐ │
│  │内置兜底 │ │  ← 当外部模块不可用时的降级方案
│  └────────┘ │
└──────┬──────┘
       │
  ┌────▼────┐
  │ Memory  │  ← 唯一必须的外部模块
  │(MiniMem)│     没有记忆的 Agent 等于每次重新开始
  └─────────┘
```

**渐进增强路径**：

```
Level 0: Core + Memory                      → 能记住用户，但对话质量一般
Level 1: + Guardrail                         → 有安全边界
Level 2: + Identity                          → 有人设和语气一致性
Level 3: + Planner                           → 能处理复杂多步任务
Level 4: + Perception                        → 能理解多模态输入
Level 5: + Learner                           → 能从经验中自我优化
Level 6: + Toolbelt + Social                 → 能使用工具、与其他 Agent 协作
```

---

## 3. 通信协议

### 3.1 为什么选 MCP

MCP（Model Context Protocol）是当前最适合分离式 Agent 架构的协议：

| MCP 特性 | 对分离式架构的价值 |
|---|---|
| Tool 抽象 | 每个模块暴露的能力天然是 Tool |
| Resource 抽象 | Surface Files、知识图谱等可以作为 Resource 暴露 |
| stdio / SSE 传输 | 本地模块用 stdio（零网络开销），远程模块用 SSE |
| 生态兼容 | 用户的其他 MCP Server 可以无缝接入 Toolbelt |
| 客户端广泛 | Claude、CodeBuddy、Cursor 等都支持 MCP Client |

### 3.2 三种通信模式

分离式架构中，模块间通信不只是简单的请求-响应：

**模式 1：同步查询（Query）**

```
Core → Memory: search_memory("用户昨天提到的项目名")
Core ← Memory: [{id: "...", content: "...", score: 0.92}]
```

适用于：检索记忆、查询身份、获取安全策略。时延敏感，需要快。

**模式 2：异步事件（Event）**

```
Core → Memory: add_memory("用户说他下周要出差")    // fire-and-forget
Core → Learner: feedback("用户说回答很好", {useful: true})
```

适用于：写入记忆、记录反馈、触发学习。不阻塞主流程。

**模式 3：后台任务（Background Job）**

```
Scheduler → Memory: trigger_dream()      // 凌晨 3 点
Scheduler → Learner: run_optimization()  // 每周日
Scheduler → Guardrail: audit_report()    // 每月 1 号
```

适用于：做梦、GC、模型优化、合规审计。完全离线，Agent Core 不参与。

### 3.3 模块发现与注册

Agent Core 启动时，如何知道哪些模块可用？

```toml
# agent.toml — Agent 配置文件

[core]
llm_provider = "anthropic"
llm_model = "claude-sonnet"

[modules.memory]
type = "mcp"
transport = "stdio"
command = "minimem"
args = ["--mode", "mcp"]
required = true              # 必需模块，启动失败则 Agent 不启动

[modules.guardrail]
type = "mcp"
transport = "sse"
url = "http://localhost:8081/mcp"
required = false             # 可选模块，不可用时走内置兜底

[modules.identity]
type = "mcp"
transport = "stdio"
command = "mini-identity"
required = false

[modules.planner]
type = "builtin"             # 内置实现，不走外部进程
required = false
```

---

## 4. Agent Core 设计

### 4.1 意图循环（Intent Loop）

Agent Core 的核心是一个无限循环：

```
┌────────────────────────────────────────────────┐
│                 Intent Loop                     │
│                                                 │
│  1. PERCEIVE                                    │
│     ├─ 接收用户输入                              │
│     ├─ 调用 Perception 模块（如果有）             │
│     └─ 得到结构化的意图表示                       │
│                                                 │
│  2. RECALL                                      │
│     ├─ 调用 Memory 模块获取相关记忆              │
│     ├─ 调用 Identity 模块获取人设约束             │
│     └─ 调用 Guardrail 模块获取安全边界            │
│                                                 │
│  3. REASON                                      │
│     ├─ 编织上下文（Context Weaving）              │
│     ├─ 调用 LLM 进行推理                         │
│     └─ 如果需要多步骤 → 调用 Planner 模块        │
│                                                 │
│  4. ACT                                         │
│     ├─ 执行 LLM 决定的动作                       │
│     ├─ 通过 Toolbelt 调用外部工具（如果需要）      │
│     └─ 生成用户回复                               │
│                                                 │
│  5. REFLECT                                     │
│     ├─ 评估执行结果                               │
│     ├─ 通知 Memory 存储新记忆                     │
│     ├─ 通知 Learner 记录反馈                      │
│     └─ 判断是否需要继续循环                        │
│                                                 │
│  → 回到 1                                        │
└────────────────────────────────────────────────┘
```

### 4.2 上下文编织（Context Weaving）

这是 Agent Core 最核心的"手艺"——从各个模块收集信息，编织成一个高质量的 LLM prompt：

```
┌─ System Prompt ──────────────────────────────┐
│                                               │
│  [来自 Identity] 你是一个 ... 的助手           │
│  [来自 Guardrail] 你不能 ... / 你必须 ...     │
│                                               │
├─ Context ────────────────────────────────────┤
│                                               │
│  [来自 Memory] 用户相关记忆:                   │
│    - 用户是 SRE 工程师                        │
│    - 上周提到在做 K8s 迁移                     │
│    - 偏好简洁回答                              │
│                                               │
│  [来自 Perception] 当前意图分析:               │
│    - 意图: 技术咨询                            │
│    - 情感: 中性                                │
│    - 实体: [K8s, 监控, Prometheus]             │
│                                               │
│  [来自 Planner] 当前计划状态:                  │
│    - 步骤 3/5: 正在配置告警规则                 │
│                                               │
├─ User Message ───────────────────────────────┤
│                                               │
│  用户: Prometheus 的 recording rules 怎么写？  │
│                                               │
└───────────────────────────────────────────────┘
```

**编织策略是 Agent 的核心差异化**——同样的记忆和感知结果，不同的编织策略会产出截然不同的对话体验。

### 4.3 降级策略

当某个外部模块不可用时，Core 需要有兜底方案：

| 模块不可用 | 降级策略 |
|---|---|
| Memory | **致命**——无法降级，Agent 拒绝启动 |
| Perception | 跳过感知预处理，直接把原始输入传给 LLM |
| Planner | 让 LLM 自己在 prompt 里做简单规划（单次推理） |
| Identity | 使用默认人设（通用助手） |
| Toolbelt | 禁用工具调用，只做纯对话 |
| Guardrail | 使用内置的基础安全规则（硬编码） |
| Learner | 禁用学习，每次都用初始策略 |
| Social | 禁用多 Agent 协作，作为独立个体运行 |

---

## 5. 模块间依赖关系

模块并非完全独立的——它们之间存在有向依赖：

```
              Guardrail
             ↗         ↘
   Perception → Core ← Identity
             ↘    ↕    ↗
              Memory ← Learner
             ↗    ↕
      Toolbelt  Planner
                  ↕
               Social
```

### 5.1 依赖规则

| 关系 | 说明 |
|---|---|
| Core → 所有模块 | Core 是唯一的编排者，可以调用任何模块 |
| Planner → Memory | 规划需要历史经验（"上次这么做失败了"） |
| Learner → Memory | 学习需要从记忆中提取模式 |
| Memory → Perception | 记忆写入时需要 NER、重要性评分等感知能力 |
| **模块 → 模块** | **原则上禁止模块间直接调用，必须经过 Core 路由** |

### 5.2 为什么禁止模块间直接调用

如果允许 Planner 直接调用 Memory，会导致：
1. 调用链不可追踪（Core 不知道发生了什么）
2. 循环依赖风险（Memory 的检索策略依赖 Planner 的分析）
3. 安全绕过（跳过了 Guardrail 的检查）

**例外**：Memory 内部调用 Perception 做 NER 是允许的——这是模块内部的实现细节，不是模块间依赖。MiniMem 已经这样做了。

---

## 6. 工程挑战与对策

### 6.1 延迟问题

**挑战**：每次对话要调用 3~5 个外部模块，延迟叠加。

**对策**：
- **并行调用**：PERCEIVE 阶段的 Memory + Perception + Identity 可以并行
- **本地优先**：默认 stdio 传输（同机 IPC），延迟 < 1ms
- **预加载**：对话开始时预取 Surface Files 和常用记忆
- **缓存**：Identity 和 Guardrail 的结果可以会话级缓存

```
串行: Perception(50ms) → Memory(80ms) → Identity(30ms) → LLM(2000ms)
并行: max(Perception, Memory, Identity)(80ms) → LLM(2000ms)

节省: 80ms vs 160ms（相对 LLM 的 2000ms，影响可控）
```

### 6.2 认知一致性

**挑战**：各模块对同一用户的理解可能不一致。Memory 说用户是初学者，Learner 说用户已经很熟练了。

**对策**：
- **Memory 是 Single Source of Truth**——其他模块的"认知"最终要写回 Memory
- **Learner 的产出经过 Core 审核后才更新 Memory**，不直接改
- **版本快照**——定期快照记忆状态，出现不一致时可以 diff 对比

### 6.3 错误传播

**挑战**：一个模块挂了，会不会拖垮整个 Agent？

**对策**：
- **熔断器**：模块连续失败 N 次后自动熔断，切换到降级方案
- **超时控制**：每个模块调用有独立超时（Memory 200ms，Planner 5s）
- **隔离进程**：每个模块是独立进程，crash 不影响 Core

### 6.4 配置复杂性

**挑战**：用户需要配置 N 个独立服务，门槛太高。

**对策**：
- **一键启动脚本**：`agent start` 自动拉起所有配置好的模块
- **内置默认**：开箱即用只需要 Core + Memory，其他渐进增强
- **Skill 封装**：像 MiniMem 的 SKILL.md 一样，把复杂配置封装成一个 Skill

---

## 7. 与现有架构的对比

| 维度 | LangChain / LlamaIndex | AutoGPT / OpenClaw | 分离式架构 |
|---|---|---|---|
| 记忆 | 内置 VectorStore | 内置文件存储 | 外部 Memory Server |
| 规划 | Chain / Agent Executor | 内置 task manager | 外部 Planner Server |
| 工具 | Tool class（代码级） | Plugin 系统 | MCP 协议（进程级） |
| 安全 | 回调 / 中间件 | 内置检查 | 外部 Guardrail Server |
| 扩展方式 | 写 Python 代码 | 写 Plugin | 启动一个 MCP Server |
| 模块替换 | 换一个类 | 换一个 Plugin | 换一个进程 |
| 最小单元 | 一个 Chain | 一个 Agent 实例 | Core + 1 个模块 |

---

## 8. MiniMem 在分离式架构中的位置

MiniMem 是分离式架构的**第一个实践验证**：

```
验证了什么：
✅ 记忆可以完全从 Agent 中独立出来
✅ MCP 协议足以支撑模块间通信
✅ 独立模块可以有自己的后台任务（做梦、GC）
✅ 单一职责做到极致比通用模块更有价值

暴露了什么问题：
⚠️ 不是所有 Agent 都适合接入（有设计主张 → 有适用边界）
⚠️ 模块间的依赖关系需要仔细设计（Memory 内部用了 Perception）
⚠️ 独立 ≠ 通用，需要明确定位（见 POSITIONING.md）
```

---

## 9. 演进路线图

### Phase 0（当前）— Memory 独立

- [x] MiniMem 作为独立 MCP Server 运行
- [x] 验证分离式架构的可行性

### Phase 1 — Agent Core 原型

- [ ] 实现最小意图循环（Perceive → Recall → Reason → Act → Reflect）
- [ ] 支持模块发现与注册（agent.toml）
- [ ] 实现降级策略
- [ ] 验证：Core + MiniMem 的最小可行 Agent

### Phase 2 — 第二个独立模块

- [ ] 候选：Planner 或 Guardrail（视需求优先级）
- [ ] 定义模块间通信的标准模式（Query / Event / Background Job）
- [ ] 验证两个外部模块的协调

### Phase 3 — 生态验证

- [ ] 接入真实 Agent 场景（CodeBuddy、个人助理等）
- [ ] 收集模块组合模式的反馈
- [ ] 评估是否需要抽象统一的模块协议

---

## 10. 相关文档

- [AGENT-SOUL.md](./AGENT-SOUL.md) — Agent 灵魂论：拆完之后还剩什么（哲学思辨）
- [POSITIONING.md](./POSITIONING.md) — MiniMem 定位论：通用性 vs 专精性
- [ARCHITECTURE.md](./ARCHITECTURE.md) — MiniMem 系统架构
- [DESIGN.md](./DESIGN.md) — MiniMem 设计理念

---

*文档创建于 2026-04-10，源于 MiniMem 项目架构讨论。*
*这是一份前瞻性的架构探索文档，不代表当前实现。*
