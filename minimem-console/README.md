# MiniMem Console

> MiniMem 的可观测性看板 + 基于记忆的自动化任务平台

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器（前端 + 后端同时启动）
pnpm dev

# 仅启动前端
pnpm dev:client

# 仅启动后端
pnpm dev:server
```

前端：`http://localhost:5173`
后端：`http://localhost:3080`

## 配置

复制 `config.default.toml` 为 `config.toml` 进行自定义配置，或通过环境变量覆盖：

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `MINIMEM_BASE_URL` | MiniMem 引擎地址 | `http://127.0.0.1:6677` |
| `MINIMEM_API_TOKEN` | MiniMem JWT Token | — |
| `MINIMEM_DATA_DIR` | MiniMem 数据目录（只读） | `~/.minimem` |
| `CONSOLE_HOST` | Console 后端监听地址 | `127.0.0.1` |
| `CONSOLE_PORT` | Console 后端监听端口 | `3080` |
| `CONSOLE_DATA_DIR` | Console 数据目录 | `~/.minimem-console` |
| `MINIMEM_LLM_BASE_URL` | LLM API 地址 | DashScope |
| `MINIMEM_LLM_API_KEY` | LLM API Key | — |
| `MINIMEM_LLM_MODEL` | LLM 模型名 | `qwen-plus` |
| `PIPELINE_OUTPUT_DIR` | Pipeline 报告输出目录 | `~/.minimem-console/reports` |

## 技术栈

- **前端**：React 18 + TypeScript + Vite + Shadcn/UI + Tailwind CSS + React Flow + TanStack Query
- **后端**：Hono + better-sqlite3 + node-cron + Handlebars
- **LLM**：OpenAI SDK 兼容模式（DashScope）
