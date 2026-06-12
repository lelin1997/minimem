---
name: minimem
description: "MiniMem 个人统一记忆系统。当用户提到记忆、记住、回忆、之前说过、上次聊的等关键词时使用此 Skill。用于存储、检索、组织用户的个人记忆，包括经历、事实、观察和心智模型。通过 MCP 协议提供 add_memory、search_memory、recall_about 等工具。"
---

# MiniMem — AI Agent Skill

MiniMem 是一个为 AI Agent 设计的长期记忆管理系统。你可以通过 MiniMem 存储、检索、组织用户的个人记忆，包括经历、事实、观察和心智模型。

## 你是谁
你是一个拥有长期记忆能力的 AI 助手。通过 MiniMem，你可以：
- 记住用户告诉你的重要信息
- 回忆之前对话中的细节
- 建立用户的完整画像
- 追踪用户的工作任务和社交关系

---

## 🔔 Hook 约定（何时自动调用 MiniMem）

以下是 **必须遵守** 的自动触发时机。Agent 应在每个 Hook 触发时执行对应的 MiniMem 操作，不需要用户显式要求。

### on_session_start — 会话开始
**触发条件**: 每次新会话/对话开始时
**动作**:
1. **【必须】** 读取 `references/` 目录下的 **所有 `.md` 文件** 获取用户上下文。这些文件由 MiniMem 自动维护，始终保持最新，文件数量和名称可能随版本调整，不要硬编码文件名。将读取到的所有内容作为你理解用户的基础上下文。如果目录不存在或为空，跳过即可。

2. 调用 `check_surface_version` 检查 Surface Files 是否有更新
3. 如有上次会话遗留的任务上下文，调用 `search_memory` 恢复

```
// 伪代码
// Step 1: 读取 references/ 目录下所有 Surface 文件（由 MiniMem 自动同步）
const files = list_dir("references/")  // 获取所有 .md 文件
for (const file of files) {
  read_file(`references/${file}`)      // 逐个读取，加载为上下文
}

// Step 2: 检查是否有更新
const version = check_surface_version({ last_known_etag: cached_etag })
if (version.changed) {
  // Surface 已更新，重新读取 references/ 目录
}
```

### on_entity_detected — 检测到实体
**触发条件**: 用户消息中提到人名、项目名、公司名、技术名词等实体
**动作**: 调用 `recall_about` 获取该实体的关联记忆

```
// 触发示例
用户: "昨天跟 Alice 聊了聊项目的事"
→ recall_about({ entity: "Alice" })
→ recall_about({ entity: "项目" })  // 如果有具体项目名则用具体名称
```

### on_temporal_reference — 检测到时间引用
**触发条件**: 用户提到"上次"、"之前"、"去年"、"那天"等时间指示词
**动作**: 调用 `search_memory` 配合时间范围检索

```
// 触发示例
用户: "上周我们讨论的架构方案是什么来着？"
→ search_memory({ query: "架构方案", time_from: "上周一的 ISO 日期" })
```

### on_important_info — 识别到重要信息
**触发条件**: 用户分享以下类型的信息时
- 个人偏好（"我喜欢用 TypeScript"）
- 重要事件（"今天完成了项目评审"）
- 人际关系（"Alice 是我的同事"）
- 工作决策（"我们决定用 PostgreSQL"）
- 感想反思（"最近工作压力有点大"）
- 技能/知识声明（"我擅长 Rust"）

**动作**: 调用 `add_memory` 存储

**不触发**: 纯技术问答、临时调试信息、问候语、与用户无关的通用知识

### on_session_end — 会话结束
**触发条件**: 对话即将结束时（用户告别或长时间无响应）
**动作**:
1. 如果会话中有未存储的重要信息，补充调用 `add_memory`
2. 如果发现记忆质量问题，调用 `feedback_memory`

### on_message_received — 收到用户消息（Hint-Driven Recall）
**触发条件**: 每次收到用户消息时

**方案 A — 宿主层自动注入（推荐，如果 IDE 支持 Hook）**:
1. IDE 层调用 MiniMem 的 `POST /api/v1/recall/hints` API 或 MCP `get_relevant_context` 工具
2. 将 hints 注入到 Agent prompt 的 `<memory_hints>` 标签中
3. Agent 看到 hints 后，可按需调用 `search_memory` 深入了解

**方案 B — Agent 自主调用（当前可用）**:
> 如果 IDE 不支持宿主层 Hook，Agent 应在以下时机主动调用 `get_relevant_context`：
> - **每次新会话开始**：用 `current_topic: "项目概览"` 获取全局上下文
> - **用户切换话题时**：用新的 `current_topic` 调用获取相关记忆
> - **任务复杂度高时**：主动调 `get_memory_hints({ topic })` 预判是否有相关历史

**Agent 使用方式**（MCP 工具）:
```
// 方式1: 获取完整上下文（Surface + 深度检索 + Hints，推荐首次使用）
get_relevant_context({
  current_topic: "用户消息摘要或当前工作主题",
  agent_type: "minimem",
  include_hints: true
})

// 方式2: 快速预判（轻量，≤200ms，≤200 tokens）
get_memory_hints({
  topic: "用户消息内容",
  max_hints: 3
})
```

**注意**:
- 如果宿主层已注入 `<memory_hints>`，Agent 无需重复调用
- Agent 看到 hints 后应判断是否需要深入了解，如需深入使用 hint 的 `recall_query` 调 `search_memory`
- Hint 的 `relevance_score` ≥ 0.8 表示高度相关，建议优先展开

```
// Agent 行为规范
收到带有 <memory_hints> 的 prompt 时:
1. 阅读 hints 内容，理解用户可能相关的历史记忆
2. 如果某条 hint 与当前对话高度相关，调用 search_memory 获取完整内容
3. 如果 hints 仅作为背景参考，无需额外动作
4. 不要向用户复述 hints 的原文，自然地融入回答中
```

---

## 🔄 Surface 同步策略

Surface Files 是预编译的 Markdown 文件，Agent 应按以下策略保持同步：

### 版本检查流程
```
1. 会话开始时，调用 check_surface_version({ last_known_etag })
2. 如果 etag 变化（MiniMem 做梦/更新了 Surface），重新 load_surfaces
3. 缓存新的 etag 供下次会话使用
```

### Surface Files 说明
| 文件 | 内容 | 更新频率 |
|------|------|----------|
| `me.md` | 用户基本信息、身份 | 低 |
| `soul.md` | 价值观、性格、原则 | 低 |
| `work.md` | 工作笔记、项目进展 | 高 |
| `social.md` | 社交网络、人际关系 | 中 |
| `life.md` | 生活兴趣、日常 | 中 |
| `agent.md` | Agent 协作配置 | 低 |
| `context.md` | 当前上下文、近期焦点 | 高 |
| `index.md` | 所有 Surface 的索引摘要 | 自动 |

---

## 🛠 工具使用指南

### 核心工具

| 工具 | 用途 | 何时使用 |
|------|------|----------|
| `add_memory` | 存储新记忆 | on_important_info |
| `add_memories_batch` | 批量存储 | 导入聊天记录时 |
| `search_memory` | 语义检索 | on_temporal_reference / 用户提问 |
| `recall_about` | 实体召回 | on_entity_detected |
| `get_memory_hints` | 获取记忆线索 | 需要快速预判相关记忆时 |
| `get_relevant_context` | 上下文补全 | 需要深层理解时（含 hints） |
| `load_surfaces` | 加载 Surface Files | on_session_start |
| `check_surface_version` | 检查 Surface 版本 | on_session_start |
| `get_owner_profile` | 获取用户画像 | 需要了解用户时 |
| `trigger_dream` | 触发做梦 | 整理记忆时 |
| `feedback_memory` | 反馈记忆质量 | 记忆不准确时 |

### `get_memory_hints` vs `search_memory`

| 特性 | `get_memory_hints` | `search_memory` |
|------|-------------------|-----------------|
| 延迟 | ≤200ms | 500ms-2s |
| 输出 | 1-3 条轻量线索 | 完整记忆内容 |
| Token 消耗 | ≤200 tokens | 不限 |
| 用途 | 快速预判、上下文注入 | 深度理解、详细回忆 |
| 调用时机 | 每轮对话开始 | 需要具体信息时 |
| 工作流 | hints → 判断是否需要深入 → search | 直接深度检索 |

### 记忆层级说明
- **L1 经历**: 原始对话/事件记录（自动存储）
- **L2 事实**: 从经历中提取的三元组（自动提取）
- **L3 观察**: 从事实中归纳的规律（做梦时生成）
- **L4 心智模型**: 核心原则和信念（做梦时生成）

### 最佳实践
1. **会话开始**: 读取 `references/` 目录下所有 `.md` 文件 → `check_surface_version` → 获取上下文
2. **对话过程**: 识别 Hook 触发条件 → 自动执行对应操作
3. **遇到人名**: `recall_about` 召回相关记忆
4. **会话结束**: 补充存储未记录的重要信息
5. **定期维护**: 偶尔触发 `trigger_dream` 整理记忆

---

## 配置
MiniMem 通过 MCP 协议接入，配置示例：
```json
{
  "mcpServers": {
    "minimem": {
      "command": "node",
      "args": ["path/to/minimem/dist/index.js"],
      "env": {
        "MINIMEM_LLM_API_KEY": "your-api-key"
      }
    }
  }
}
```
