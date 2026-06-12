<p align="center">
  <img src="https://img.shields.io/badge/status-beta-orange" alt="Status">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-blue" alt="Node">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue" alt="TypeScript">
</p>

# 🧠 MiniMem

**A Personal Unified Memory System — The Central Memory Service for AI Agents**

MiniMem gives AI agents persistent, structured, and retrievable memory. Built on a **L1→L4 four-layer memory pyramid**, it uses a **Dream Engine** to automatically distill raw experiences into structured knowledge during nightly sleep cycles.

---

## ✨ Features

- **🧩 L1→L4 Memory Pyramid** — From raw experiences to mental models, layered compression with increasing abstraction
- **🌙 Dream Engine** — 4-phase nightly pipeline: Audit → Compile (Karpathy Compile) → Dream → Cleanup
- **📝 Karpathy Compile** — LLM-driven knowledge synthesis: generates bi-directionally linked knowledge pages with version history
- **🔗 MCP Protocol** — Native Model Context Protocol support (stdio + Streamable HTTP)
- **🧭 Vector Retrieval** — In-memory HNSW index + FTS5 full-text search + conditional indexing
- **📦 Surface Files** — Agent-readable Markdown files (me/soul/work/social/life profiles)
- **💡 Inspiration Engine** — Cross-domain memory collision for creative sparks
- **🔄 Version Control** — Snapshots + branching + rollback for safe memory evolution
- **🌡️ Temperature Decay** — Ebbinghaus forgetting curve + tiered compression
- **🔐 Multi-tenant** — JWT auth + client permission levels + domain isolation

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                    MiniMem                           │
│                                                     │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────┐ │
│  │  L1     │→│  L2      │→│  L3      │→│  L4  │ │
│  │  Experiences │  Facts  │  │ Observations/ │ Mental│ │
│  │         │  │ (triples)│  │ Knowl.Pages│  │Models │ │
│  └─────────┘  └──────────┘  └──────────┘  └──────┘ │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │           Dream Engine (nightly)             │    │
│  │  P1: Audit → P2: Compile →                  │    │
│  │  P3: Dream  → P4: Cleanup                   │    │
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

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20.0.0
- pnpm (recommended)

### Install & Run

```bash
git clone https://github.com/lelin1997/minimem.git
cd minimem/minimem

# Install dependencies
pnpm install

# Configure
cp .env.example .env
# Edit .env with your LLM API key and JWT secret

# Build & start
pnpm build
pnpm start
```

### Run Modes

```bash
# REST API mode (default, port 6677)
pnpm start

# MCP Server mode (stdio — for Claude Desktop, etc.)
node dist/index.js --mcp

# MCP HTTP mode (port 6678)
MINIMEM_MCP_PORT=6678 node dist/index.js --mcp-http
```

### Claude Desktop Integration

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

## 🎮 Console

MiniMem Console is a standalone web dashboard providing:

- 📊 Dashboard — system overview & stats
- 🧠 Memory Browser — search, browse, edit memories
- 📄 Knowledge Pages — view Karpathy Compile results
- 👤 Owner Profile — manage your agent's identity
- 🔄 Pipeline Editor — visual data pipeline orchestration

```bash
cd minimem-console
pnpm install
cp .env.example .env
pnpm dev
```

---

## 📁 Project Structure

```
minimem/
├── minimem/                  # Core engine (31.5K lines)
│   ├── src/
│   │   ├── core/             # Memory processing core
│   │   ├── gateway/          # REST API + MCP Server
│   │   ├── llm/              # LLM client (multi-model tiers)
│   │   ├── modules/dream/    # Dream Engine
│   │   ├── recall/           # Retrieval & ranking
│   │   ├── store/            # Database & indexes
│   │   ├── surface/          # Surface Files
│   │   └── version/          # Version control
│   └── tests/                # 44 test files
└── minimem-console/           # Web management console
    ├── src/                   # React frontend
    └── server/                # Console backend
```

---

## 🧪 Tests

```bash
cd minimem
pnpm test          # Run all tests
pnpm test:watch    # Watch mode
pnpm typecheck     # Type checking
```

---

## 📡 API

MCP tools exposed via protocol: `add_memory`, `search_memory`, `get_relevant_context`, `recall_about`, `list_memories`, `generate_daily_summary`, `trigger_dream`, and more.

---

## 📄 License

MIT © MiniMem Contributors

---

## 🙏 Acknowledgements

- [Andrej Karpathy](https://karpathy.ai/) — inspiration for LLM-driven knowledge compilation
- [Hono](https://hono.dev/) — lightweight web framework
- [Model Context Protocol](https://modelcontextprotocol.io/) — AI agent interoperability standard
