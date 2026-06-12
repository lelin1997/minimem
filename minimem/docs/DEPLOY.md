# MiniMem 云服务器部署与启动手册

> 本文档面向"拿到一台新云服务器，从零部署 MiniMem 并跑通"的场景。
> 参考架构详情见 [BUILD.md](./BUILD.md)。

---

## 目录

1. [服务器选型与配置](#1-服务器选型与配置)
2. [方式一：Docker 部署（推荐）](#2-方式一docker-部署推荐)
3. [方式二：手动部署（Systemd）](#3-方式二手动部署systemd)
4. [配置文件详解](#4-配置文件详解)
5. [首次启动验证](#5-首次启动验证)
6. [Nginx 反向代理 + HTTPS](#6-nginx-反向代理--https)
7. [MCP 远程接入（AI Agent 连接）](#7-mcp-远程接入ai-agent-连接)
8. [备份与恢复](#8-备份与恢复)
9. [日常运维](#9-日常运维)
10. [故障排查](#10-故障排查)

---

## 1. 服务器选型与配置

### 架构特点

MiniMem 是**单进程长驻服务**：SQLite（WAL 模式）+ 内存向量索引 + node-cron 定时调度。  
**必须单实例部署，不可水平扩展。**

### 最低配置

| 资源 | 规格 | 说明 |
|------|------|------|
| CPU | 1 核 | LLM 调用以等待 I/O 为主 |
| 内存 | 512 MB | 向量全量内存驻留 + SQLite 64MB 缓存 |
| 磁盘 | 10 GB SSD | SQLite DB + 向量缓存 + 7 天备份 |
| 系统 | Ubuntu 22.04+ / Debian 12+ | 需要 Node.js 20+ |
| 网络 | 需访问外部 LLM API | DashScope / OpenAI 兼容端点 |

### 推荐配置（日常稳定运行）

| 资源 | 规格 |
|------|------|
| CPU | 2 核 |
| 内存 | 1-2 GB |
| 磁盘 | 20-40 GB SSD |

### 云服务商参考

| 场景 | 推荐 | 月费 |
|------|------|------|
| 国内省钱 | 腾讯云轻量 1C1G | ~34 元 |
| 国内推荐 | 阿里云 ECS 2C2G | ~60 元 |
| 海外 | AWS Lightsail / DigitalOcean 1C1G | $5-6 |

---

## 2. 方式一：Docker 部署（推荐）

### 2.1 服务器环境准备

```bash
# 安装 Docker + Docker Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# 重新登录使 docker 组生效

# 验证
docker --version
docker compose version
```

### 2.2 上传代码到服务器

```bash
# 方式 A：Git 克隆
ssh your-server
git clone <repo-url> /opt/minimem
cd /opt/minimem

# 方式 B：本地打包上传（如果没有 git repo）
# 在本地执行：
tar czf minimem.tar.gz \
  --exclude=node_modules --exclude=dist --exclude=data \
  --exclude=.git --exclude='*.db*' \
  -C /path/to/minimem .
scp minimem.tar.gz your-server:/opt/minimem.tar.gz

# 在服务器执行：
mkdir -p /opt/minimem && cd /opt/minimem
tar xzf /opt/minimem.tar.gz
```

### 2.3 创建 Dockerfile

在项目根目录创建 `Dockerfile`：

```dockerfile
# ---- Build Stage ----
FROM node:22-slim AS builder

WORKDIR /app

# better-sqlite3 需要编译工具
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Production Stage ----
FROM node:22-slim

WORKDIR /app

# better-sqlite3 运行时需要 libstdc++
RUN apt-get update && apt-get install -y libstdc++6 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY config.default.toml ./

# 数据目录
RUN mkdir -p /data/minimem

# 非 root 用户
RUN groupadd -r minimem && useradd -r -g minimem -d /app -s /sbin/nologin minimem
RUN chown -R minimem:minimem /app /data
USER minimem

ENV NODE_ENV=production
EXPOSE 6677 6678

VOLUME ["/data/minimem"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:6677/api/v1/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "dist/index.js"]
CMD []
```

### 2.4 创建 .dockerignore

```
node_modules
dist
.git
.env
.env.local
config.local.toml
data/
logs/
*.db
*.db-wal
*.db-shm
references/
docs/
tests/
```

### 2.5 创建生产配置

```bash
# 在服务器项目根目录创建 config.local.toml
cat > config.local.toml << 'EOF'
[server]
host = "0.0.0.0"           # 监听所有网卡（Docker 内需要）
port = 6677
mode = "self-hosted"

[auth]
enabled = true

[encryption]
enabled = false             # Docker 部署建议先关闭 SQLCipher，简化首次启动
provider = "none"

[llm]
provider = "openai-compatible"
base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
api_key_env = "MINIMEM_LLM_API_KEY"

[llm.models]
heavy = "qwen-max"
medium = "qwen-plus"
light = "qwen-turbo"

[llm.embedding]
enabled = true
model = "text-embedding-v3"
dimensions = 1024

[storage]
data_dir = "/data/minimem"

[storage.log]
level = "info"

[backup]
enabled = true
retention_count = 7
EOF
```

### 2.6 创建 docker-compose.yml

```yaml
services:
  minimem:
    build: .
    container_name: minimem
    restart: unless-stopped
    ports:
      - "6677:6677"    # REST API
      - "6678:6678"    # MCP Streamable HTTP（可选）
    environment:
      - MINIMEM_LLM_API_KEY=${MINIMEM_LLM_API_KEY}
      - MINIMEM_JWT_SECRET=${MINIMEM_JWT_SECRET:-change-me-in-production}
      - NODE_ENV=production
    volumes:
      - minimem-data:/data/minimem
      - ./config.local.toml:/app/config.local.toml:ro
    deploy:
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 512M

volumes:
  minimem-data:
    driver: local
```

### 2.7 创建 .env 文件

```bash
cat > .env << 'EOF'
MINIMEM_LLM_API_KEY=sk-your-dashscope-api-key
MINIMEM_JWT_SECRET=your-random-secret-at-least-32-characters-长度至少32字符
EOF
chmod 600 .env
```

### 2.8 构建并启动

```bash
# 构建镜像
docker compose build

# 启动（后台运行）
docker compose up -d

# 查看日志
docker compose logs -f minimem

# 验证健康
curl http://localhost:6677/api/v1/health
```

### 2.9 常用 Docker 命令

```bash
# 停止服务
docker compose down

# 重启
docker compose restart

# 重新构建并启动（代码更新后）
docker compose up -d --build

# 进入容器
docker compose exec minimem sh

# 查看资源使用
docker stats minimem
```

---

## 3. 方式二：手动部署（Systemd）

适合不用 Docker 的场景，直接在系统上运行。

### 3.1 安装 Node.js 22

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证
node --version  # >= v22.x
npm --version
```

### 3.2 安装编译依赖

```bash
# better-sqlite3 是 C++ addon，需要编译工具链
sudo apt-get install -y python3 make g++
```

### 3.3 创建部署用户和目录

```bash
# 创建系统用户
sudo useradd -r -s /bin/false -m -d /opt/minimem minimem

# 创建数据目录
sudo mkdir -p /data/minimem
sudo chown minimem:minimem /data/minimem
```

### 3.4 部署代码

```bash
# 将代码放到 /opt/minimem
sudo -u minimem bash -c 'cd /opt/minimem && git clone <repo-url> .'
# 或者解压上传的压缩包

# 安装依赖
cd /opt/minimem
sudo -u minimem npm ci

# 构建
sudo -u minimem npm run build

# 验证构建产物
ls -la dist/index.js
```

### 3.5 配置

```bash
# 复制并编辑配置
sudo -u minimem cp config.default.toml config.local.toml

# 编辑生产配置（参见第 4 节「配置文件详解」）
sudo -u minimem vim config.local.toml
```

关键改动：
```toml
[server]
host = "0.0.0.0"
mode = "self-hosted"

[storage]
data_dir = "/data/minimem"

[auth]
enabled = true

[encryption]
enabled = false        # 首次部署建议先关闭
provider = "none"
```

### 3.6 设置环境变量

```bash
sudo tee /etc/default/minimem << 'EOF'
MINIMEM_LLM_API_KEY=sk-your-dashscope-api-key
MINIMEM_JWT_SECRET=your-random-secret-at-least-32-characters
NODE_ENV=production
EOF

sudo chmod 600 /etc/default/minimem
```

### 3.7 创建 Systemd 服务

```bash
sudo tee /etc/systemd/system/minimem.service << 'EOF'
[Unit]
Description=MiniMem — Personal Memory System
After=network.target

[Service]
Type=simple
User=minimem
Group=minimem
WorkingDirectory=/opt/minimem
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/etc/default/minimem

# 安全限制
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/data/minimem /opt/minimem/logs

# 资源限制
LimitNOFILE=65536
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF
```

### 3.8 启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable minimem
sudo systemctl start minimem

# 检查状态
sudo systemctl status minimem

# 查看日志
sudo journalctl -u minimem -f

# 验证
curl http://localhost:6677/api/v1/health
```

---

## 4. 配置文件详解

### 配置加载优先级（从低到高）

```
代码默认值 → ~/.minimem/config.toml → 项目根目录/config.local.toml → 环境变量
```

每一层都能覆盖上一层的同名字段。

### 关键环境变量

| 变量 | 必须 | 说明 |
|------|------|------|
| `MINIMEM_LLM_API_KEY` | ✅ | LLM API 密钥 |
| `MINIMEM_JWT_SECRET` | ✅(生产) | JWT 签名密钥，至少 32 字符 |
| `NODE_ENV` | 建议 | 设为 `production` |
| `MINIMEM_HOST` | 可选 | 覆盖监听地址 |
| `MINIMEM_PORT` | 可选 | 覆盖监听端口 |
| `MINIMEM_DATA_DIR` | 可选 | 覆盖数据目录 |
| `MINIMEM_LOG_LEVEL` | 可选 | 日志级别：debug/info/warn/error |
| `MINIMEM_LLM_BASE_URL` | 可选 | 覆盖 LLM API 地址 |
| `MINIMEM_LLM_HEAVY` | 可选 | 覆盖重量级模型名 |
| `MINIMEM_LLM_MEDIUM` | 可选 | 覆盖中量级模型名 |
| `MINIMEM_LLM_LIGHT` | 可选 | 覆盖轻量级模型名 |
| `MINIMEM_EMBEDDING_ENABLED` | 可选 | 是否启用向量嵌入 |
| `MINIMEM_EMBEDDING_MODEL` | 可选 | 嵌入模型名 |
| `MINIMEM_EMBEDDING_BASE_URL` | 可选 | 嵌入 API 独立地址 |

### 启动模式

| 模式 | 命令 | 端口 | 说明 |
|------|------|------|------|
| REST API | `node dist/index.js` | 6677 | 默认模式，HTTP API |
| MCP Stdio | `node dist/index.js --mcp` | 无 | stdin/stdout，供本地 AI Agent |
| MCP HTTP | `node dist/index.js --mcp-http` | 6678 | Streamable HTTP，供远程 AI Agent |

额外参数：
- `--insecure` — 关闭认证和加密（**仅限开发/测试**）

### 数据目录结构

首次启动会自动创建：

```
/data/minimem/           # (或 ~/.minimem/)
├── db/                  # SQLite 数据库
│   ├── minimem.db
│   ├── minimem.db-wal
│   └── minimem.db-shm
├── vectors/             # 向量索引二进制缓存
├── dreams/              # 做梦报告（Markdown + JSON）
├── surfaces/            # Surface Files（me.md, soul.md 等）
├── exports/             # 数据导出
├── snapshots/           # 版本快照
├── backups/             # 自动备份（每天凌晨 2 点）
└── logs/                # 日志（pino JSON 格式）
```

### config.local.toml 最小生产模板

```toml
[server]
host = "0.0.0.0"
port = 6677
mode = "self-hosted"

[auth]
enabled = true

[encryption]
enabled = false
provider = "none"

[llm]
provider = "openai-compatible"
base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
api_key_env = "MINIMEM_LLM_API_KEY"

[llm.models]
heavy = "qwen-max"
medium = "qwen-plus"
light = "qwen-turbo"

[llm.embedding]
enabled = true
model = "text-embedding-v3"
dimensions = 1024

[llm.cost_limit]
daily = 10
monthly = 200

[storage]
data_dir = "/data/minimem"

[storage.log]
level = "info"

[backup]
enabled = true
retention_count = 7
```

### 切换 LLM 提供商

MiniMem 使用 OpenAI 兼容 API 格式，可以对接任何兼容端点：

```toml
# 阿里云 DashScope（默认）
[llm]
base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"

# 腾讯云
[llm]
base_url = "https://api.lkeap.cloud.tencent.com/coding/v3"

# OpenAI 官方
[llm]
base_url = "https://api.openai.com/v1"

# 本地 Ollama
[llm]
base_url = "http://localhost:11434/v1"

# 第三方代理（如 OpenRouter）
[llm]
base_url = "https://openrouter.ai/api/v1"
```

---

## 5. 首次启动验证

服务启动后，按以下顺序验证核心链路。

### Step 1: 健康检查

```bash
curl http://localhost:6677/api/v1/health
```

✅ 预期：返回 `{"status":"ok","version":"0.1.0","uptime_seconds":...}`

### Step 2: 写入第一条记忆

```bash
curl -X POST http://localhost:6677/api/v1/memory \
  -H "Content-Type: application/json" \
  -d '{
    "content": "MiniMem 在云服务器上首次部署成功，今天开始正式使用。",
    "source": "deploy-test",
    "agent_id": "admin"
  }'
```

✅ 预期：返回 201，body 含 `memory_id`

### Step 3: 搜索记忆

```bash
curl "http://localhost:6677/api/v1/memory/search?q=部署&limit=5"
```

✅ 预期：返回搜索结果数组，包含刚写入的记忆

### Step 4: 批量写入测试数据

```bash
# 写入多条记忆，让系统有足够数据触发做梦
for i in $(seq 1 5); do
  curl -s -X POST http://localhost:6677/api/v1/memory \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"测试记忆 $i：MiniMem 四层记忆模型包括 L1 经历、L2 事实、L3 观察、L4 心智模型。这是第 $i 条测试。\", \"source\": \"deploy-test\", \"agent_id\": \"admin\"}"
  echo ""
done
```

### Step 5: 查看统计

```bash
curl http://localhost:6677/api/v1/admin/stats
```

✅ 预期：看到 L1 记忆数量、向量数量等统计

### Step 6: 手动触发做梦（可选）

> 做梦需要 ≥20 条 L1 记忆（`cold_start_threshold = 20`），先写够再触发。

```bash
curl -X POST http://localhost:6677/api/v1/admin/dream/trigger
```

✅ 预期：返回做梦 session ID，日志中看到 Phase 1→2→3→4 执行

---

## 6. Nginx 反向代理 + HTTPS

生产环境强烈建议通过 Nginx 反向代理访问，不直接暴露 MiniMem 端口。

### 6.1 安装 Nginx + Certbot

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### 6.2 申请 SSL 证书

```bash
# 先确保域名 DNS 已指向服务器 IP
sudo certbot --nginx -d minimem.yourdomain.com
```

### 6.3 Nginx 配置

```bash
sudo tee /etc/nginx/sites-available/minimem << 'EOF'
# MiniMem 反向代理
upstream minimem_rest {
    server 127.0.0.1:6677;
}

upstream minimem_mcp {
    server 127.0.0.1:6678;
}

# 限流（每客户端 30 请求/分钟）
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;

server {
    listen 443 ssl http2;
    server_name minimem.yourdomain.com;

    # Certbot 自动管理证书路径
    ssl_certificate /etc/letsencrypt/live/minimem.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/minimem.yourdomain.com/privkey.pem;

    # ── REST API ──
    location /api/ {
        limit_req zone=api burst=10 nodelay;

        proxy_pass http://minimem_rest;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 做梦等长操作需要较长超时
        proxy_read_timeout 300s;
        proxy_send_timeout 60s;
    }

    # ── MCP Streamable HTTP ──
    location /mcp {
        proxy_pass http://minimem_mcp;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 流式响应：必须关闭缓冲
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;     # SSE 长连接 24h
        proxy_send_timeout 60s;
        chunked_transfer_encoding on;

        # CORS
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, POST, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, Mcp-Session-Id" always;
        add_header Access-Control-Expose-Headers "Mcp-Session-Id" always;
    }

    # ── 健康检查（无需限流）──
    location = /api/v1/health {
        proxy_pass http://minimem_rest;
    }
}

# HTTP → HTTPS 重定向
server {
    listen 80;
    server_name minimem.yourdomain.com;
    return 301 https://$host$request_uri;
}
EOF

sudo ln -sf /etc/nginx/sites-available/minimem /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 6.4 开放防火墙

```bash
# UFW（Ubuntu）
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# 不要直接开放 6677/6678！

# 或者 iptables
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

---

## 7. MCP 远程接入（AI Agent 连接）

### 7.1 启动 MCP HTTP 模式

如果需要远程 AI Agent（CodeBuddy、Claude Desktop 等）通过 MCP 协议连接：

**Systemd 方式**：创建一个额外的 service：

```bash
sudo tee /etc/systemd/system/minimem-mcp.service << 'EOF'
[Unit]
Description=MiniMem — MCP Streamable HTTP
After=network.target minimem.service

[Service]
Type=simple
User=minimem
Group=minimem
WorkingDirectory=/opt/minimem
ExecStart=/usr/bin/node dist/index.js --mcp-http
Restart=on-failure
RestartSec=5
EnvironmentFile=/etc/default/minimem
Environment=MINIMEM_MCP_PORT=6678
Environment=MINIMEM_MCP_HOST=0.0.0.0
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/data/minimem /opt/minimem/logs
LimitNOFILE=65536
MemoryMax=512M

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable minimem-mcp
sudo systemctl start minimem-mcp
```

> ⚠️ **注意**：REST 和 MCP-HTTP 两个进程共享同一个 SQLite 数据库。SQLite WAL 模式支持并发读，但只允许一个写入者。短时间内的并发写入会通过 SQLite 的 busy_timeout 排队，通常不影响日常使用。如果出现锁定问题，建议只运行一个进程。

**Docker 方式**：参见 `docker-compose.yml` 中额外添加 `minimem-mcp` 服务。

### 7.2 AI Agent 客户端配置

配置 AI Agent 连接远程 MiniMem MCP：

```json
{
  "mcpServers": {
    "minimem": {
      "url": "https://minimem.yourdomain.com/mcp",
      "transport": "streamable-http"
    }
  }
}
```

> 不同 MCP 客户端配置方式可能不同，请参考各自文档。

### 7.3 SSH 隧道方式（替代方案）

不想暴露 MCP 端口，也可以通过 SSH 隧道：

```bash
# 在客户端机器执行，建立到服务器的隧道
ssh -L 6678:127.0.0.1:6678 user@your-server -N

# 然后 AI Agent 连接 localhost:6678 即可
```

---

## 8. 备份与恢复

### 8.1 自动备份

MiniMem 内置每日凌晨 2:00 自动备份（`backup.schedule = "0 2 * * *"`），备份文件保存在 `data/backups/`，保留最近 7 份。

### 8.2 手动备份

```bash
# 创建版本快照（通过 API）
curl -X POST http://localhost:6677/api/v1/version/snapshot \
  -H "Content-Type: application/json" \
  -d '{"description": "手动备份"}'
```

### 8.3 云端异地备份（推荐）

```bash
# 示例：每天凌晨 3 点上传到对象存储
sudo tee /etc/cron.d/minimem-offsite-backup << 'EOF'
0 3 * * * root tar czf /tmp/minimem-backup-$(date +\%F).tar.gz -C /data minimem && \
  # 上传到 OSS/COS/S3（替换为你的命令）
  ossutil cp /tmp/minimem-backup-$(date +\%F).tar.gz oss://your-bucket/minimem/ && \
  rm -f /tmp/minimem-backup-*.tar.gz
EOF
```

### 8.4 恢复

```bash
# 1. 停止服务
sudo systemctl stop minimem minimem-mcp

# 2. 恢复 SQLite 数据库
sudo cp /data/minimem/backups/<backup-name>.db /data/minimem/db/minimem.db
# 删除 WAL 文件让 SQLite 重新创建
sudo rm -f /data/minimem/db/minimem.db-wal /data/minimem/db/minimem.db-shm

# 3. 修复权限
sudo chown -R minimem:minimem /data/minimem

# 4. 重启
sudo systemctl start minimem
```

---

## 9. 日常运维

### 9.1 查看日志

```bash
# Systemd 日志
sudo journalctl -u minimem -f
sudo journalctl -u minimem --since "1 hour ago"

# Docker 日志
docker compose logs -f minimem

# 应用日志文件（pino JSON 格式）
# 筛选错误（level 50 = error）
grep '"level":50' /data/minimem/logs/*.log

# 查看做梦记录
grep '"name":"dream' /data/minimem/logs/*.log
```

### 9.2 监控指标

```bash
# 健康检查
curl -s http://localhost:6677/api/v1/health | jq .

# 系统统计
curl -s http://localhost:6677/api/v1/admin/stats | jq .

# 温度分布
curl -s http://localhost:6677/api/v1/admin/temperature | jq .
```

### 9.3 关键告警阈值

| 指标 | 告警条件 | 检查方式 |
|------|----------|----------|
| 进程存活 | 进程不存在 | systemd watchdog / healthcheck |
| 内存使用 | > 800MB（1G 限额的 80%） | `docker stats` / `ps aux` |
| 磁盘使用 | > 80% | `df -h /data` |
| LLM API 失败 | 连续 5+ 次失败 | 日志 error 级别 |
| 做梦失败 | 连续 3 天无成功做梦 | `dream_logs` 表 |
| 备份缺失 | >25h 无新备份 | `ls -lt /data/minimem/backups/` |

### 9.4 代码更新

```bash
# Systemd 方式
cd /opt/minimem
sudo -u minimem git pull
sudo -u minimem npm ci
sudo -u minimem npm run build
sudo systemctl restart minimem

# Docker 方式
cd /opt/minimem
git pull
docker compose up -d --build
```

### 9.5 定时任务时间表

MiniMem 内置的 node-cron 调度（无需配置 crontab）：

| 时间 | 任务 | 说明 |
|------|------|------|
| 每 6 小时 | 温度衰减 + 轻量 GC | 记忆生命周期更新 |
| 每天 02:00 | 自动备份 | DB + 向量 + surfaces |
| 每天 03:00 | 日做梦（Dream） | L1→L2→L3→L4 编译 |
| 每天 04:00 | 标准 GC | 清理冷/冻结记忆 |
| 每周日 04:00 | 周做梦（Weekly Dream） | 更深层次的记忆整合 |
| 每周日 05:00 | 深度 GC | 全面清理 + 压缩 |
| 事件触发 | Auto Dream | 新记忆超过阈值时自动触发 |
| 事件触发 | Surface 更新 | 做梦完成后同步 Surface Files |

---

## 10. 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 启动失败 "Cannot find module" | 未 build 或 build 产物损坏 | `npm run build` |
| "MINIMEM_LLM_API_KEY not set" | 环境变量未配置 | 检查 `.env` 或 `/etc/default/minimem` |
| Embedding 失败 | LLM API 不可达 / Key 无效 | `curl` 测试 LLM API 连通性 |
| SQLite 锁超时 | 多进程同时写入 | 确保只有一个 MiniMem 实例在运行 |
| 向量搜索返回空 | 维度不匹配 / Embedding 未启用 | 检查 `llm.embedding.dimensions` 和 `enabled` |
| 做梦不触发 | L1 记忆 <20 条 | 先写入足够测试数据 |
| 内存持续增长 | 向量数据量大 | 扩容或考虑 Qdrant 外部向量库 |
| Docker 容器 OOM | 内存限制太小 | 调大 `deploy.resources.limits.memory` |
| MCP HTTP 404 | Session ID 无效 | 客户端需先发起 initialize 请求 |
| MCP HTTP SSE 断开 | Nginx 缓冲或超时 | `proxy_buffering off` + `proxy_read_timeout 86400s` |
| 端口冲突 | 6677 被占用 | `lsof -i :6677` 找到占用进程，或改配置端口 |
| 做梦 LLM 超时 | 模型推理慢 | 调大 `llm.timeout_ms`（如 120000） |

### 快速诊断命令

```bash
# 检查进程
ps aux | grep minimem

# 检查端口
ss -tlnp | grep -E '6677|6678'

# 检查磁盘
df -h /data

# 检查数据库文件
ls -lh /data/minimem/db/

# 测试 LLM API 连通性
curl -s https://dashscope.aliyuncs.com/compatible-mode/v1/models \
  -H "Authorization: Bearer $MINIMEM_LLM_API_KEY" | head -c 200
```

---

## 附录：一键部署脚本（参考）

把上面的步骤串成脚本，适合 Ubuntu 22.04+：

```bash
#!/bin/bash
set -euo pipefail

# ── 配置 ──
MINIMEM_DIR="/opt/minimem"
DATA_DIR="/data/minimem"
REPO_URL="<your-repo-url>"
LLM_API_KEY="sk-your-api-key"
JWT_SECRET="$(openssl rand -hex 32)"

echo "=== 1. 安装 Node.js 22 ==="
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs python3 make g++

echo "=== 2. 创建用户和目录 ==="
sudo useradd -r -s /bin/false -m -d "$MINIMEM_DIR" minimem || true
sudo mkdir -p "$DATA_DIR"
sudo chown minimem:minimem "$DATA_DIR"

echo "=== 3. 部署代码 ==="
sudo -u minimem git clone "$REPO_URL" "$MINIMEM_DIR" || (cd "$MINIMEM_DIR" && sudo -u minimem git pull)
cd "$MINIMEM_DIR"
sudo -u minimem npm ci
sudo -u minimem npm run build

echo "=== 4. 写入配置 ==="
sudo tee /etc/default/minimem << EOF
MINIMEM_LLM_API_KEY=$LLM_API_KEY
MINIMEM_JWT_SECRET=$JWT_SECRET
NODE_ENV=production
EOF
sudo chmod 600 /etc/default/minimem

sudo -u minimem tee "$MINIMEM_DIR/config.local.toml" << EOF
[server]
host = "0.0.0.0"
mode = "self-hosted"

[auth]
enabled = true

[encryption]
enabled = false
provider = "none"

[storage]
data_dir = "$DATA_DIR"
EOF

echo "=== 5. 创建 Systemd 服务 ==="
sudo tee /etc/systemd/system/minimem.service << EOF
[Unit]
Description=MiniMem
After=network.target

[Service]
Type=simple
User=minimem
Group=minimem
WorkingDirectory=$MINIMEM_DIR
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/etc/default/minimem
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR $MINIMEM_DIR/logs
LimitNOFILE=65536
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF

echo "=== 6. 启动 ==="
sudo systemctl daemon-reload
sudo systemctl enable minimem
sudo systemctl start minimem

echo "=== 等待启动... ==="
sleep 3

echo "=== 7. 验证 ==="
curl -s http://localhost:6677/api/v1/health | head -c 200
echo ""

echo "=== ✅ 部署完成 ==="
echo "JWT Secret: $JWT_SECRET"
echo "REST API:   http://$(hostname -I | awk '{print $1}'):6677"
```

> 将脚本中的 `<your-repo-url>` 和 `sk-your-api-key` 替换为实际值后执行。
