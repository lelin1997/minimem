<p align="center">
  <img src="https://img.shields.io/badge/status-beta-orange" alt="Status">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-blue" alt="Node">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue" alt="TypeScript">
</p>

# 🧠 MiniMem

**个人统一记忆系统 — AI Agent 的中央记忆服务**

MiniMem 为 AI Agent 提供持久化、结构化、可检索的记忆能力。采用 **L1→L4 四层记忆金字塔** 模型，通过 **Dream Engine（做梦引擎）** 在夜间自动将零散记忆蒸馏为结构化知识。

> 📖 [English README](./README.md)

---

## ✨ 核心特性

- **🧩 L1→L4 四层记忆** — 从原始经历到心智模型，层层蒸馏压缩
- **🌙 Dream Engine** — 4 阶段夜间流水线：审计→编译(Karpathy Compile)→做梦→清理
- **📝 Karpathy Compile** — LLM 驱动的知识编译，自动生成带双向链接的知识页面
- **🔗 MCP 协议** — 原生支持 Model Context Protocol（stdio + Streamable HTTP）
- **🧭 向量检索** — 内存 HNSW 索引 + FTS5 全文搜索 + 条件索引
- **📦 Surface Files** — Agent 可读的 Markdown 文件（me/soul/work/social/life）
- **💡 灵感引擎** — 跨域记忆碰撞，自动产生创意火花
- **🔄 版本控制** — 快照 + 分支 + 回滚，安全可追溯
- **🌡️ 温度衰减** — Ebbinghaus 遗忘曲线 + 分级压缩
- **🔐 多租户** — JWT 认证 + 客户端权限分级 + 领域隔离

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────┐
│                    MiniMem                           │
│                                                     │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────┐ │
│  │  L1     │→│  L2      │→│  L3      │→│  L4  │ │
│  │  经历   │  │  事实    │  │  观察/   │  │ 心智 │ │
│  │         │  │  (三元组) │  │  知识页  │  │ 模型 │ │
│  └─────────┘  └──────────┘  └──────────┘  └──────┘ │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │           Dream Engine (夜间)               │    │
│  │  P1: 审计 → P2: 编译 → P3: 做梦 → P4: 清理 │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ REST API │  │ MCP Srv  │  │ MiniMem Console  │  │
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
pnpm install
cp .env.example .env  # 编辑填入 LLM API Key 和 JWT Secret
pnpm build
pnpm start
```

### 运行模式

```bash
pnpm start                                          # REST API 模式（端口 6677）
node dist/index.js --mcp                            # MCP stdio 模式
MINIMEM_MCP_PORT=6678 node dist/index.js --mcp-http # MCP HTTP 模式
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

---

## 🎮 控制台

```bash
cd minimem-console
pnpm install
cp .env.example .env
pnpm dev
```

提供：仪表盘、记忆浏览器、知识页面、用户画像、Pipeline 编辑器等。

---

## 📁 项目结构

```
minimem/
├── minimem/                  # 核心引擎（31.5K 行）
│   ├── src/
│   │   ├── core/             # 记忆处理核心
│   │   ├── gateway/          # REST API + MCP Server
│   │   ├── llm/              # LLM 客户端（三级模型分层）
│   │   ├── modules/dream/    # Dream Engine
│   │   ├── recall/           # 检索与召回
│   │   ├── store/            # 数据库与索引
│   │   ├── surface/          # Surface Files
│   │   └── version/          # 版本控制
│   └── tests/                # 44 个测试文件
└── minimem-console/           # Web 管理控制台
    ├── src/                   # React 前端
    └── server/                # Console 后端
```

---

## 📄 许可证

MIT © MiniMem Contributors

## 🙏 致谢

- [Andrej Karpathy](https://karpathy.ai/) — LLM 知识编译的理念启发
- [Hono](https://hono.dev/) — 轻量 Web 框架
- [Model Context Protocol](https://modelcontextprotocol.io/) — AI Agent 互操作标准
