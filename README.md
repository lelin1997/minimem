<p align="center">
  <img src="https://img.shields.io/badge/status-beta-orange" alt="Status">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-blue" alt="Node">
</p>

# 🧠 MiniMem

**个人统一记忆系统 — AI Agent 的中央记忆服务**

MiniMem 为 AI Agent 提供持久化、结构化、可检索的记忆能力。采用 **L1→L4 四层记忆金字塔** 模型，通过 **Dream Engine（做梦引擎）** 在夜间自动将零散记忆蒸馏为结构化知识。

---

## ✨ 核心特性

- **🧩 L1-L4 四层记忆** — 从原始经历到心智模型，层层蒸馏压缩
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
│  │  Phase 1: 审计 → Phase 2: 编译 →            │    │
│  │  Phase 3: 做梦 → Phase 4: 清理              │    │
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
- pnpm（推荐）或 npm

### 安装

```bash
git clone https://github.com/your-org/minimem.git
cd minimem/minimem

# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 LLM API Key 和 JWT Secret

# 构建
pnpm build

# 启动（REST API 模式）
pnpm start

# 或开发模式
pnpm dev
```

### 启动选项

```bash
# REST API 模式（默认，端口 6677）
pnpm start

# MCP Server 模式（stdio，供 Claude Desktop 等使用）
node dist/index.js --mcp

# MCP HTTP 模式（端口 6678）
MINIMEM_MCP_PORT=6678 node dist/index.js --mcp-http

# 开发/测试模式（禁用认证，仅监听 localhost）
pnpm dev --insecure
```

### 配置 Claude Desktop

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

## 📡 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/memory` | 添加记忆 |
| GET | `/api/v1/memory/search` | 搜索记忆 |
| GET | `/api/v1/health` | 健康检查 |
| GET | `/api/v1/admin/stats` | 系统统计 |

MCP 工具列表通过 MCP 协议自动暴露，包括 `add_memory`、`search_memory`、`get_relevant_context` 等。

---

## 🎮 Console

MiniMem Console 是一个独立的 Web 管理界面，提供：

- 📊 仪表盘 — 系统概览与统计
- 🧠 记忆浏览器 — 搜索、浏览、编辑记忆
- 📄 知识页面 — 查看 Karpathy Compile 编译结果
- 👤 用户画像 — Owner Profile 管理
- 🔄 Pipeline Editor — 可视化数据流水线编排

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
├── minimem/                  # 核心引擎
│   ├── src/
│   │   ├── core/             # 记忆处理核心
│   │   ├── gateway/          # REST API + MCP Server
│   │   ├── llm/              # LLM 客户端
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

## 🧪 测试

```bash
cd minimem
pnpm test          # 运行所有测试
pnpm test:watch    # 监听模式
pnpm typecheck     # 类型检查
pnpm lint          # 代码规范检查
```

---

## 📄 许可证

MIT © MiniMem Contributors

---

## 🙏 致谢

- [Andrej Karpathy](https://karpathy.ai/) — LLM 知识编译的理念启发
- [Hono](https://hono.dev/) — 轻量 Web 框架
- [Model Context Protocol](https://modelcontextprotocol.io/) — AI Agent 互操作标准
