# MiniMem 多机迁移指南

> 如何在另一台电脑上使用 MiniMem（包括所有 SQLite 数据）

## 数据架构

MiniMem 数据分两部分存储：

| 位置 | 内容 | 大小（参考） |
|------|------|------|
| `~/.minimem/` | **核心数据**：SQLite 数据库、backups、dreams、snapshots、surfaces | ~42MB |
| 项目目录（如 `~/codebuddy/minimem/`） | **代码 + 配置**：源码、node_modules、config.local.toml | — |

### `~/.minimem/` 目录结构

```
~/.minimem/
├── db/
│   ├── minimem.db          # 主数据库（所有记忆、灵感、人物画像等）
│   ├── minimem.db-shm      # SQLite WAL 共享内存
│   └── minimem.db-wal      # SQLite WAL 日志
├── backups/                 # 自动备份
├── dreams/                  # 做梦管线产物
├── snapshots/               # 版本快照
├── surfaces/                # Surface Files
├── vectors/                 # 向量数据（memory 模式下为空）
├── logs/                    # 运行日志
└── exports/                 # 导出文件
```

---

## 迁移步骤

### 1. 同步代码仓库

```bash
# 家里电脑，克隆/拉取最新代码
git clone <你的仓库地址> ~/codebuddy/minimem
cd ~/codebuddy/minimem
npm install
npm run build
```

### 2. 复制数据目录 `~/.minimem/`（最关键）

⚠️ **迁移前务必先停止 MiniMem 进程**，确保 SQLite WAL 数据已刷入主文件。

```bash
# ── 在当前办公电脑上 ──

# 停止 MiniMem 进程
lsof -i :6677 -P | grep LISTEN    # 找到 PID
kill <PID>                          # 停止

# 打包数据目录
tar -czf ~/minimem-data-backup.tar.gz -C ~ .minimem/
```

传输 `minimem-data-backup.tar.gz` 到家里电脑（U盘 / 网盘 / scp / AirDrop）。

```bash
# ── 在家里电脑上 ──

# 解压到 home 目录
tar -xzf minimem-data-backup.tar.gz -C ~/

# 验证
ls -la ~/.minimem/db/minimem.db
# 应该存在，约 4~10MB
```

### 3. 复制本地配置文件

`config.local.toml` 被 `.gitignore` 忽略，需手动同步：

```bash
# 复制到家里电脑的项目目录下
scp ~/codebuddy/minimem/config.local.toml <家里电脑>:~/codebuddy/minimem/
```

或者直接在家里电脑创建 `config.local.toml`，内容参考：

```toml
[llm]
provider = "openai-compatible"
base_url = "https://api.lkeap.cloud.tencent.com/coding/v3"
api_key_env = "MINIMEM_LLM_API_KEY"
timeout_ms = 90000

[llm.models]
heavy = "glm-5"
medium = "minimax-m2.5"
light = "hunyuan-2.0-instruct"

[llm.embedding]
enabled = false
model = "text-embedding-v3"
dimensions = 1024
base_url = ""
api_key_env = ""

[llm.rate_limit]
max_concurrency = 3
min_interval_ms = 200
jitter_max_ms = 500
quota_5h = 6000
quota_weekly = 45000
quota_monthly = 90000
quota_warn_threshold = 0.15
degrade_on_exhaustion = true
```

### 4. 设置环境变量

在家里电脑的 `~/.zshrc` 或 `~/.zprofile` 中添加：

```bash
export MINIMEM_LLM_API_KEY="<你的腾讯云 Coding Plan API Key>"
# 如果启用了 JWT 认证：
export MINIMEM_JWT_SECRET="<你的 JWT Secret>"
```

### 5. 启动验证

```bash
cd ~/codebuddy/minimem

# 方式 A：生产模式（跑编译产物）
node dist/index.js --insecure

# 方式 B：开发模式（实时编译 TypeScript）
npx tsx src/index.ts --insecure
```

验证：

```bash
curl http://127.0.0.1:6677/api/v1/health
curl http://127.0.0.1:6677/api/v1/memories | python3 -m json.tool | head -20
```

---

## 长期双机同步方案

如果需要两台电脑**交替使用**（而非一次性迁移）：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. rsync 脚本（推荐）** | 简单可靠 | 每次切换要记得同步 |
| **B. 网盘同步 ~/.minimem/** | 自动化 | SQLite 并发写入风险 |
| **C. 部署到云服务器** | 两台共用，无需同步 | 需要有服务器 + 网络延迟 |

### 推荐：rsync 同步脚本

创建 `~/bin/sync-minimem.sh`：

```bash
#!/bin/bash
# sync-minimem.sh — 在两台机器间同步 MiniMem 数据
# 用法: ./sync-minimem.sh push|pull
#
# ⚠️ 同步前务必停止 MiniMem 进程！

REMOTE="user@home-pc"       # ← 改成你家里电脑的 SSH 地址
DATA_DIR="$HOME/.minimem"

# 检查 MiniMem 是否在运行
if lsof -i :6677 -P 2>/dev/null | grep -q LISTEN; then
  echo "⚠️  MiniMem 进程仍在运行（端口 6677），请先停止再同步！"
  exit 1
fi

case "$1" in
  push)
    echo "📤 Pushing local data to remote..."
    rsync -avz --delete \
      --exclude='logs/' \
      "$DATA_DIR/" "$REMOTE:$DATA_DIR/"
    echo "✅ Push 完成"
    ;;
  pull)
    echo "📥 Pulling remote data to local..."
    rsync -avz --delete \
      --exclude='logs/' \
      "$REMOTE:$DATA_DIR/" "$DATA_DIR/"
    echo "✅ Pull 完成"
    ;;
  *)
    echo "Usage: $0 push|pull"
    echo "  push  — 推送本机数据到远程"
    echo "  pull  — 从远程拉取数据到本机"
    exit 1
    ;;
esac
```

```bash
chmod +x ~/bin/sync-minimem.sh
```

### 日常工作流

```
下班前（办公电脑）：  停止 MiniMem → sync-minimem.sh push
到家后（家里电脑）：  sync-minimem.sh pull → 启动 MiniMem
回公司前（家里电脑）：停止 MiniMem → sync-minimem.sh push
到公司后（办公电脑）：sync-minimem.sh pull → 启动 MiniMem
```

---

## 注意事项

1. **停进程再同步** — SQLite WAL 模式下，未 checkpoint 的数据在 `.db-wal` 文件中，必须确保进程停止后再复制
2. **单向同步** — 不要两台同时运行后再合并，SQLite 不支持自动合并冲突
3. **加密问题** — 如果启用了 SQLCipher（`config.default.toml` 中 `encryption.provider = "sqlcipher"`），密钥存在 macOS Keychain 中，需要在两台机器的 Keychain 中都设置相同密钥
4. **config.local.toml** — 如果两台电脑网络环境不同（如家里无法访问某些 API），可以为每台机器维护不同的 `config.local.toml`

---

## 快速检查清单

- [ ] 代码仓库已克隆/更新
- [ ] `~/.minimem/` 数据目录已复制
- [ ] `config.local.toml` 已配置
- [ ] 环境变量 `MINIMEM_LLM_API_KEY` 已设置
- [ ] `npm install` + `npm run build` 已执行
- [ ] `curl http://127.0.0.1:6677/api/v1/health` 返回正常
- [ ] `curl http://127.0.0.1:6677/api/v1/memories` 返回数据
