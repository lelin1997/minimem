<p align="center">
  <img src="https://img.shields.io/badge/status-beta-orange" alt="Status">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-blue" alt="Node">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue" alt="TypeScript">
</p>

# 🧠 MiniMem

**单机自托管的个人记忆系统 — AI Agent 的中央记忆**

MiniMem 为 AI Agent 提供持久化、结构化、可检索的记忆能力。面向**单机自托管**场景（sqlite + 127.0.0.1 + 单 API token），采用 **L1→L4 四层记忆金字塔** 模型，通过 **Dream Engine（做梦引擎）** 在夜间自动将零散经历蒸馏为结构化知识。多租户 / JWT / 域隔离已降级到 v0.3+，见 roadmap。

> 📖 [English README](./README.md)

---

## ✨ 核心特性

- **🧩 L1→L4 记忆金字塔** — 从原始经历到心智模型，层层蒸馏压缩，抽象度逐层递增
- **🌙 Dream Engine** — 4 阶段夜间流水线：审计 → 编译 (Knowledge Compile) → 做梦 → 清理
- **📝 Knowledge Compile** — LLM 驱动的知识合成：自动生成带双向链接、版本历史的知识页面
- **🔗 MCP 协议** — 原生支持 Model Context Protocol（stdio + Streamable HTTP）
- **🧭 向量检索** — 内存 HNSW 索引 + FTS5 全文搜索 + 条件索引
- **📦 Surface Files** — Agent 可读的 Markdown 文件（me/soul/work/social/life 等画像）
- **💡 Inspiration Engine** *(实验性)* — 跨域记忆碰撞，产生创意火花
- **🔄 版本控制** — 快照 + 分支 + 回滚，记忆演化安全可追溯
- **🌡️ 温度衰减** — 分级压缩，支持可配置衰减模型（linear / logarithmic / ebbinghaus）

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────┐
│                    MiniMem                           │
│                                                     │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────┐ │
│  │  L1     │→│  L2      │→│  L3      │→│  L4  │ │
│  │  经历   │  │  事实    │  │ 观察/    │  │ 心智 │ │
│  │         │  │ (三元组) │  │ 知识页   │  │ 模型 │ │
│  └─────────┘  └──────────┘  └──────────┘  └──────┘ │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │           Dream Engine (夜间)               │    │
│  │  P1: 审计 → P2: 编译 → P3: 做梦 → P4: 清理 │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ REST API │  │ MCP 服务 │  │ MiniMem Console  │  │
│  │ (Hono)   │  │ (stdio/  │  │ (React SPA)      │  │
│  │          │  │  HTTP)   │  │                  │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 前置要求
- Node.js >= 20.0.0
- pnpm（推荐）

### 安装运行

```bash
git clone https://github.com/lelin1997/minimem.git
cd minimem/minimem

# 安装依赖
pnpm install

# 配置（推荐用交互式向导）
pnpm dev -- init
# 或手动：
cp .env.example .env  # 编辑填入 LLM API Key
pnpm build
pnpm start
```

### 运行模式

```bash
pnpm start                                          # REST API 模式（默认，端口 6677）
node dist/index.js --mcp                            # MCP stdio 模式（接入 Claude Desktop 等）
MINIMEM_MCP_PORT=6678 node dist/index.js --mcp-http # MCP HTTP 模式（端口 6678）
```

### 接入 Claude Desktop

```json
{
  "mcpServers": {
    "minimem": {
      "command": "node",
      "args": ["/path/to/minimem/dist/index.js", "--mcp"]
    }
  }
}
```

### Docker 一键启动

```bash
docker compose up -d   # 根目录 docker-compose.yml，含持久化 volume + healthcheck
```

---

## 🎮 控制台

MiniMem Console 是独立的 Web 仪表盘，提供：

- 📊 仪表盘 — 系统概览与统计
- 🧠 记忆浏览器 — 搜索、浏览、编辑记忆
- 📄 知识页面 — 查看 Knowledge Compile 产物
- 👤 用户画像 — 管理 Agent 身份
- 🔄 Pipeline 编辑器 — 可视化数据流编排

```bash
cd minimem-console
pnpm install
cp .env.example .env
pnpm dev
```

---

## 📁 项目结构

```
minimem/
├── minimem/                  # 核心引擎（~31K 行）
│   ├── src/
│   │   ├── core/             # 记忆处理核心
│   │   ├── gateway/          # REST API + MCP Server
│   │   ├── llm/              # LLM 客户端（三级模型分层）
│   │   ├── modules/dream/    # Dream Engine
│   │   ├── recall/           # 检索与召回
│   │   ├── store/            # 数据库与索引
│   │   ├── surface/          # Surface Files
│   │   └── version/          # 版本控制
│   └── tests/                # 测试（unit / integration / e2e 三层）
├── minimem-console/           # Web 管理控制台
│   ├── src/                   # React 前端
│   └── server/                # Console 后端
├── docker-compose.yml         # 一键启动
└── CHANGELOG.md
```

---

## 🧪 测试

```bash
cd minimem
pnpm test:unit          # 单元测试（无 LLM 依赖，CI 强制跑）
pnpm test:integration   # 集成测试（mock LLM，CI 强制跑）
pnpm test:e2e           # 端到端测试（需真实 LLM API Key）
pnpm typecheck          # 类型检查
```

---

## 📡 API

通过 MCP 协议暴露的工具：`add_memory`、`search_memory`、`get_relevant_context`、`recall_about`、`list_memories`、`generate_daily_summary`、`trigger_dream` 等。

---

## 📄 许可证

MIT © MiniMem Contributors

---

## 🙏 致谢

- [Andrej Karpathy](https://karpathy.ai/) — LLM 知识编译的理念启发（注：MiniMem 的 "Knowledge Compile" 为独立实现，受 Karpathy LLM Wiki 思路启发，无关联也未受背书）
- [Hono](https://hono.dev/) — 轻量 Web 框架
- [Model Context Protocol](https://modelcontextprotocol.io/) — AI Agent 互操作标准
