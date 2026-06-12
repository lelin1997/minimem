# MiniMem Console 迁移指南

> 如何在另一台电脑（如家里办公电脑）上使用本项目，包括所有 SQLite 数据。

---

## 需要迁移的内容

| 分类 | 路径 | 说明 |
|------|------|------|
| **项目代码** | `~/codebuddy/minimem-console/` | Git 仓库（含源码） |
| **用户配置** | 项目根目录 `config.toml` | LLM API key、模型配置（被 .gitignore 排除） |
| **SQLite 数据库** | `~/.minimem-console/console.db` | Pipeline 定义、运行记录、输出历史、模板 |
| **Pipeline 报告** | `~/.minimem-console/reports/` | Pipeline 生成的文件输出 |
| **MiniMem 数据（只读）** | `~/.minimem/` | Dream 报告等（如果用了 MiniMem 引擎） |

---

## 方案 A：快速迁移（推荐）

### 在当前电脑上打包

```bash
# 1. 打包数据目录（SQLite + 报告 + 配置）
tar -czf ~/minimem-data-backup.tar.gz \
  ~/.minimem-console/ \
  ~/.minimem/ \
  ~/codebuddy/minimem-console/config.toml

# 2. 确认 git 代码已推送
cd ~/codebuddy/minimem-console && git push
```

### 在家里电脑上恢复

```bash
# 1. Clone 代码
git clone <你的仓库地址> ~/codebuddy/minimem-console
cd ~/codebuddy/minimem-console

# 2. 安装依赖
pnpm install

# 3. 解压数据（把 minimem-data-backup.tar.gz 传到家里电脑后）
tar -xzf minimem-data-backup.tar.gz -C /

# 这会还原：
#   ~/.minimem-console/console.db                  ← SQLite 数据库
#   ~/.minimem-console/reports/                    ← Pipeline 输出
#   ~/.minimem/                                    ← MiniMem 引擎数据
#   ~/codebuddy/minimem-console/config.toml        ← 你的 LLM 配置

# 4. 启动
npx tsx server/index.ts
```

---

## 方案 B：持续同步（双机日常使用）

如果经常在两台电脑间切换：

### 代码

用 Git 正常 `push` / `pull`。

### SQLite 数据

两种思路：

#### 思路 1：文件同步工具

使用 **Syncthing / 坚果云 / iCloud** 同步 `~/.minimem-console/` 目录。

- SQLite WAL 模式对文件同步比较友好（只要不同时双开写入）
- 确保同步前关闭服务，同步后再启动

#### 思路 2：修改 data_dir 指向云盘目录

```toml
# config.toml 追加
[storage]
data_dir = "~/Library/Mobile Documents/com~apple~CloudDocs/minimem-console"
```

这样 SQLite 数据库直接存在 iCloud Drive 中。

> ⚠️ 注意：不要两台电脑同时运行服务端！

### 配置

`config.toml` 在两台电脑各放一份（API key 相同就行）。

---

## 方案 C：环境变量方式（不需要复制 config.toml）

所有配置都支持环境变量覆盖，在 `~/.zshrc` 或 `~/.bashrc` 中添加：

```bash
export MINIMEM_LLM_BASE_URL="https://api.lkeap.cloud.tencent.com/coding/v3"
export MINIMEM_LLM_API_KEY="你的API Key"
export MINIMEM_LLM_MODEL="glm-5"

# 以下为默认值，不改可以不设
export CONSOLE_DATA_DIR="$HOME/.minimem-console"
export MINIMEM_BASE_URL="http://127.0.0.1:6677"
```

支持的所有环境变量：

| 变量名 | 作用 | 默认值 |
|--------|------|--------|
| `CONSOLE_HOST` | 服务监听地址 | `127.0.0.1` |
| `CONSOLE_PORT` | 服务端口 | `3080` |
| `CONSOLE_DATA_DIR` | SQLite 数据目录 | `~/.minimem-console` |
| `MINIMEM_BASE_URL` | MiniMem 引擎地址 | `http://127.0.0.1:6677` |
| `MINIMEM_DATA_DIR` | MiniMem 数据目录 | `~/.minimem` |
| `MINIMEM_API_TOKEN` | MiniMem JWT Token | （空） |
| `MINIMEM_LLM_BASE_URL` | LLM API 地址 | dashscope |
| `MINIMEM_LLM_API_KEY` | LLM API Key | （空） |
| `MINIMEM_LLM_MODEL` | LLM 模型名 | `qwen-plus` |
| `PIPELINE_OUTPUT_DIR` | Pipeline 报告输出目录 | `~/.minimem-console/reports` |
| `SMTP_ENABLED` | 是否启用邮件 | `false` |
| `SMTP_HOST` | SMTP 服务器 | （空） |
| `SMTP_PORT` | SMTP 端口 | `465` |
| `SMTP_USER` | SMTP 用户名 | （空） |
| `SMTP_PASS` | SMTP 密码 | （空） |

---

## ⚠️ 注意事项

1. **SQLite 不支持双机同时写入** — 如果两台电脑同步 db 文件，确保同一时间只有一台在运行 server
2. **WAL 附属文件** — 复制数据库时，记得一起复制 `console.db-wal` 和 `console.db-shm`（如果存在），否则可能丢失最近未刷入主库的数据
3. **`config.toml` 在 .gitignore 中** — 不会被 git 追踪，需要手动复制或用环境变量
4. **Node.js 版本** — 确保两台电脑的 Node 版本一致（推荐 v18+）
5. **`better-sqlite3` 是 native addon** — 换了操作系统/架构（如 Intel → Apple Silicon）需要重新 `pnpm install`

---

## 快速检查清单

在家里电脑上启动前，确认以下文件存在：

```bash
# 必须
ls ~/.minimem-console/console.db       # SQLite 数据库
ls ~/codebuddy/minimem-console/config.toml  # 或已配置环境变量

# 可选
ls ~/.minimem-console/reports/         # Pipeline 输出报告
ls ~/.minimem/dreams/                  # MiniMem Dream 报告
```

---

## 核心三件套

一句话总结——把这三样东西传到新电脑的对应位置，再 `git clone` + `pnpm install` 就能用：

```
~/.minimem-console/     ← 整个目录（SQLite + reports）
~/.minimem/             ← MiniMem 引擎数据（可选）
config.toml             ← 放到项目根目录
```

传输方式：U 盘 / AirDrop / SCP / 云盘 均可。
