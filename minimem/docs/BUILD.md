# MiniMem 云端部署指南

## 1. 架构概览

MiniMem 是**单进程架构**的个人统一记忆系统，核心特性：

| 特性 | 说明 |
|------|------|
| 数据库 | SQLite（WAL 模式），单文件 `minimem.db`，单进程写入 |
| 向量存储 | 纯内存 `Map<string, VectorEntry>`，磁盘二进制缓存 |
| 运行模式 | REST API（网络服务）、MCP Stdio（本地子进程）或 MCP Streamable HTTP（远程访问） |
| LLM 依赖 | 外部 API（默认阿里云 DashScope），所有智能处理依赖网络调用 |
| 原生依赖 | `better-sqlite3`（C++ addon，需编译或预编译二进制） |

**关键限制**：SQLite WAL 模式 + 进程内变量锁 = **必须单实例部署，不可水平扩展**。

## 2. 服务器配置推荐

### 2.1 最低配置（个人轻度使用）

| 资源 | 规格 | 说明 |
|------|------|------|
| CPU | 1 核 | 做梦时 LLM 等待为主，CPU 非瓶颈 |
| 内存 | **512 MB** | 向量全量内存驻留 + SQLite 64MB 缓存 |
| 磁盘 | 10 GB SSD | SQLite DB + 向量缓存 + 备份 |
| 网络 | 需访问外部 LLM API | DashScope / OpenAI 兼容端点 |

### 2.2 推荐配置（日常稳定运行）

| 资源 | 规格 | 说明 |
|------|------|------|
| CPU | 2 核 | 做梦 Phase 3 向量漫游时 CPU 密集 |
| 内存 | **1-2 GB** | 10K 条记忆 ≈ 40MB 向量 + 64MB SQLite + 运行时开销 |
| 磁盘 | 20-40 GB SSD | 含 7 天备份（每天含 DB + 向量 + dreams + surfaces） |
| 网络 | 稳定低延迟 | 做梦一次可能调用 LLM 20+ 次 |

### 2.3 内存估算公式

```
总内存 ≈ 基础运行时 (80MB)
       + SQLite 缓存 (64MB, 已配置)
       + 向量数据 (记忆数 × 维度 × 4 bytes)
       + 做梦峰值 (临时对象 ~50MB)

# 1024 维向量示例：
#   1,000  条记忆 → ~4MB  向量 → 总计 ~200MB
#  10,000  条记忆 → ~40MB 向量 → 总计 ~240MB
# 100,000  条记忆 → ~400MB 向量 → 总计 ~600MB
```

### 2.4 磁盘估算

```
SQLite DB:        轻量 10-50MB / 重度 200MB+
向量索引:         记忆数 × 4KB + 元数据 (~2×向量数据)
每日备份:         DB + WAL + vectors/ + dreams/ + surfaces/
7 天备份保留:     轻量 ~500MB / 重度 ~2GB
做梦报告:         每次 ~50KB (Markdown + JSON)
```

## 3. 云服务商选择

| 场景 | 推荐方案 | 最低月费 |
|------|----------|----------|
| 国内最省 | 腾讯云轻量应用服务器 1C1G | ~34 元/月 |
| 国内推荐 | 阿里云 ECS t6-c1m2.large (2C2G) | ~60 元/月 |
| 海外 | AWS Lightsail 1C1G / DigitalOcean 1C1G | $5-6/月 |
| 仅 REST API | 腾讯云函数 SCF / 阿里云 FC | 按调用计费 |

> **注意**：MiniMem 是长驻进程（定时调度器 + 向量内存），Serverless 不适合。如用云函数，需改为 REST-only 模式 + 外部向量库（Qdrant/ChromaDB）。

## 4. Docker 部署（推荐）

### 4.1 Dockerfile

```dockerfile
# ---- Build Stage ----
FROM node:22-slim AS builder

WORKDIR /app

# 安装编译依赖（better-sqlite3 需要）
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Production Stage ----
FROM node:22-slim

WORKDIR /app

# 安装运行时依赖（better-sqlite3 原生 addon 运行时需要 libstdc++）
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

# 默认 REST 模式
ENV NODE_ENV=production
EXPOSE 6677 6678

# 数据卷
VOLUME ["/data/minimem"]

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:6677/api/v1/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "dist/index.js"]
CMD []
```

### 4.2 .dockerignore

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

### 4.3 docker-compose.yml

```yaml
version: "3.8"

services:
  minimem:
    build: .
    container_name: minimem
    restart: unless-stopped
    ports:
      - "6677:6677"   # REST API
      - "6678:6678"   # MCP Streamable HTTP（可选）
    environment:
      - MINIMEM_LLM_API_KEY=${MINIMEM_LLM_API_KEY}
      - MINIMEM_JWT_SECRET=${MINIMEM_JWT_SECRET:-change-me-in-production}
      - NODE_ENV=production
    volumes:
      - minimem-data:/data/minimem
      - ./config.local.toml:/app/config.local.toml:ro
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:6677/api/v1/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
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

### 4.4 构建与运行

```bash
# 构建
docker compose build

# 启动（REST 模式）
MINIMEM_LLM_API_KEY=sk-xxx docker compose up -d

# 查看日志
docker compose logs -f minimem

# 健康检查
curl http://localhost:6677/api/v1/health

# MCP Stdio 模式（用于 AI Agent 本地集成）
docker run --rm -i \
  -e MINIMEM_LLM_API_KEY=sk-xxx \
  -v minimem-data:/data/minimem \
  minimem node dist/index.js --mcp

# MCP Streamable HTTP 模式（用于 AI Agent 远程连接）
docker run -d \
  -e MINIMEM_LLM_API_KEY=sk-xxx \
  -e MINIMEM_MCP_PORT=6678 \
  -p 6678:6678 \
  -v minimem-data:/data/minimem \
  minimem node dist/index.js --mcp-http
```

## 5. 手动部署（无 Docker）

### 5.1 环境准备

```bash
# 1. 安装 Node.js >= 20
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 安装编译工具（better-sqlite3 需要）
sudo apt-get install -y python3 make g++

# 3. 创建部署用户
sudo useradd -r -s /bin/false minimem
sudo mkdir -p /opt/minimem /data/minimem
sudo chown minimem:minimem /data/minimem
```

### 5.2 构建与部署

```bash
# 1. 克隆代码
cd /opt/minimem
git clone <repo-url> .

# 2. 安装依赖 & 构建
npm ci
npm run build

# 3. 配置
cp config.default.toml config.local.toml
# 编辑 config.local.toml，设置：
#   [server] host = "0.0.0.0"
#   [storage] data_dir = "/data/minimem"
#   [auth] enabled = true（生产环境建议开启）
```

### 5.3 环境变量

```bash
# /etc/default/minimem
MINIMEM_LLM_API_KEY=sk-your-api-key
MINIMEM_JWT_SECRET=your-random-secret-at-least-32-chars
NODE_ENV=production
```

### 5.4 Systemd 服务

```ini
# /etc/systemd/system/minimem.service
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
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable minimem
sudo systemctl start minimem

# 检查状态
sudo systemctl status minimem
sudo journalctl -u minimem -f
```

## 6. 生产环境配置调优

### 6.1 config.local.toml 关键项

```toml
[server]
host = "0.0.0.0"     # 监听所有网卡（配合防火墙/反向代理）
port = 6677
mode = "self-hosted"  # 或 "cloud"

[auth]
enabled = true                           # 生产必须开启
jwt_secret_env = "MINIMEM_JWT_SECRET"
token_expiry = "7d"

[llm]
base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
api_key_env = "MINIMEM_LLM_API_KEY"

[llm.cost_limit]
daily = 10        # 元/天，防止 LLM API 费用失控
monthly = 200     # 元/月

[storage]
data_dir = "/data/minimem"

[storage.log]
level = "info"         # 生产用 info，调试用 debug
max_size_mb = 10
max_files = 10

[backup]
enabled = true
retention_count = 7     # 保留 7 天备份
```

### 6.2 Nginx 反向代理（HTTPS + 限流）

```nginx
server {
    listen 443 ssl http2;
    server_name minimem.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/minimem.pem;
    ssl_certificate_key /etc/ssl/private/minimem.key;

    location / {
        proxy_pass http://127.0.0.1:6677;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时（做梦等操作可能耗时长）
        proxy_read_timeout 300s;
        proxy_send_timeout 60s;
    }

    # 限流
    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
    location /api/ {
        limit_req zone=api burst=10 nodelay;
        proxy_pass http://127.0.0.1:6677;
    }
}
```

## 7. 数据备份与恢复

### 7.1 内置备份

MiniMem 自带每日凌晨 2:00 自动备份（`data/backups/`），保留 7 份。

### 7.2 云端额外备份

```bash
# cron 每日上传到 OSS/COS
0 3 * * * tar czf /tmp/minimem-backup-$(date +\%F).tar.gz -C /data minimem && \
  aws s3 cp /tmp/minimem-backup-$(date +\%F).tar.gz s3://your-bucket/minimem/ && \
  rm /tmp/minimem-backup-*.tar.gz
```

### 7.3 恢复

```bash
# 1. 停止服务
sudo systemctl stop minimem

# 2. 恢复数据
sudo cp /data/minimem/backups/minimem-YYYY-MM-DD.db /data/minimem/db/minimem.db
sudo cp /data/minimem/backups/minimem-YYYY-MM-DD.db-wal /data/minimem/db/minimem.db-wal
sudo cp -r /data/minimem/backups/data-YYYY-MM-DD/* /data/minimem/

# 3. 修复权限
sudo chown -R minimem:minimem /data/minimem

# 4. 重启
sudo systemctl start minimem
```

## 8. 监控与告警

### 8.1 健康检查端点

```bash
# 基础健康
curl http://localhost:6677/api/v1/health

# 系统统计
curl http://localhost:6677/api/v1/admin/stats

# 温度分布（记忆生命周期概况）
curl http://localhost:6677/api/v1/admin/temperature
```

### 8.2 关键监控指标

| 指标 | 告警阈值 | 检查方式 |
|------|----------|----------|
| 进程存活 | 进程不存在 | systemd / Docker healthcheck |
| 内存使用 | > 80% 配置上限 | `node` 进程 RSS |
| 磁盘使用 | > 80% | `df -h /data` |
| LLM API 调用失败率 | > 10% | 日志 `error` 级别计数 |
| 做梦连续失败 | 连续 3 天 | `dream_logs` 表检查 |
| 备份缺失 | 超过 25 小时无新备份 | `backups/` 目录检查 |

### 8.3 日志

日志默认写入 `data/logs/` 目录，使用 pino 格式（JSON）：

```bash
# 查看最新日志
cat /data/minimem/logs/*.log | tail -100

# 筛选错误
grep '"level":50' /data/minimem/logs/*.log    # pino level 50 = error

# 查看做梦记录
grep '"name":"dream' /data/minimem/logs/*.log
```

## 9. 安全注意事项

1. **必须开启 Auth**：生产环境设置 `auth.enabled = true`，通过 JWT 保护 API
2. **API Key 安全**：使用环境变量，不要硬编码到配置文件
3. **网络隔离**：REST API 不直接暴露公网，使用 Nginx 反向代理 + HTTPS
4. **数据加密**：如需静态加密，配置 `encryption.enabled = true` + `provider = "sqlcipher"`
5. **PII 检测**：默认开启 `pii_detection = "mask"`，自动遮蔽个人身份信息
6. **成本控制**：配置 `llm.cost_limit` 防止 LLM API 费用失控

## 10. MCP 远程部署

MiniMem 支持三种 MCP 传输模式：

| 模式 | 启动参数 | 适用场景 | 远程访问 |
|------|----------|----------|----------|
| Stdio | `--mcp` | 本地 AI Agent 集成（CodeBuddy/Claude Desktop） | 不支持 |
| Streamable HTTP | `--mcp-http` | 云端部署，远程 AI Agent 连接 | 支持 |
| REST API | 默认（无参数） | Web 应用 / 自定义集成 | 支持 |

### 10.1 Streamable HTTP 模式（推荐远程方案）

MCP 协议的 Streamable HTTP 传输，客户端通过 HTTP POST 发送 JSON-RPC 请求，服务端可通过 SSE 流式返回结果。这是 MCP 官方推荐的远程传输方式（SSE 传输已标记为废弃）。

**启动命令：**

```bash
# 直接启动
MINIMEM_LLM_API_KEY=sk-xxx node dist/index.js --mcp-http

# 自定义端口和地址（默认 6678）
MINIMEM_MCP_PORT=9000 MINIMEM_MCP_HOST=0.0.0.0 node dist/index.js --mcp-http
```

**Docker 启动：**

```bash
docker run -d \
  -e MINIMEM_LLM_API_KEY=sk-xxx \
  -p 6678:6678 \
  -v minimem-data:/data/minimem \
  minimem node dist/index.js --mcp-http
```

**docker-compose.yml 示例：**

```yaml
services:
  minimem-mcp:
    build: .
    container_name: minimem-mcp
    restart: unless-stopped
    ports:
      - "6678:6678"
    environment:
      - MINIMEM_LLM_API_KEY=${MINIMEM_LLM_API_KEY}
      - MINIMEM_MCP_PORT=6678
      - MINIMEM_MCP_HOST=0.0.0.0
    volumes:
      - minimem-data:/data/minimem
    command: ["node", "dist/index.js", "--mcp-http"]
```

**客户端连接配置：**

远程 AI Agent（如 Claude Desktop、CodeBuddy 等）的 MCP 配置示例：

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

> **注意**：不同 MCP 客户端对 Streamable HTTP 的配置方式可能不同，请参考客户端文档。

### 10.2 Nginx 反向代理（MCP over HTTPS）

Streamable HTTP 模式需要 Nginx 正确处理 SSE 流式响应：

```nginx
server {
    listen 443 ssl http2;
    server_name minimem.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/minimem.pem;
    ssl_certificate_key /etc/ssl/private/minimem.key;

    # REST API
    location /api/ {
        proxy_pass http://127.0.0.1:6677;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    # MCP Streamable HTTP
    location /mcp {
        proxy_pass http://127.0.0.1:6678;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 流式响应支持
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;    # SSE 长连接，24h 超时
        proxy_send_timeout 60s;
        chunked_transfer_encoding on;

        # CORS（如需跨域访问）
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, Mcp-Session-Id" always;
        add_header Access-Control-Expose-Headers "Mcp-Session-Id" always;
    }
}
```

### 10.3 同时运行 REST API + MCP HTTP

如需同时提供 REST API 和 MCP 远程访问，可运行两个进程：

```bash
# 方式 1：两个独立进程
node dist/index.js &                    # REST API on :6677
node dist/index.js --mcp-http &         # MCP HTTP on :6678

# 方式 2：用 docker-compose 同时启动两个服务
```

```yaml
# docker-compose.yml
services:
  minimem-rest:
    build: .
    container_name: minimem-rest
    restart: unless-stopped
    ports:
      - "6677:6677"
    environment:
      - MINIMEM_LLM_API_KEY=${MINIMEM_LLM_API_KEY}
    volumes:
      - minimem-data:/data/minimem
    command: ["node", "dist/index.js"]

  minimem-mcp:
    build: .
    container_name: minimem-mcp
    restart: unless-stopped
    ports:
      - "6678:6678"
    environment:
      - MINIMEM_LLM_API_KEY=${MINIMEM_LLM_API_KEY}
      - MINIMEM_MCP_PORT=6678
      - MINIMEM_MCP_HOST=0.0.0.0
    volumes:
      - minimem-data:/data/minimem
    command: ["node", "dist/index.js", "--mcp-http"]
```

> **注意**：两个进程共享同一个 SQLite 数据库，但 SQLite WAL 模式只允许一个写入者。建议只运行一个进程，或确保 MCP HTTP 进程不做写操作（只读模式）。如果需要同时提供 REST + MCP，更推荐在 REST 进程内集成 MCP HTTP 路由（后续可优化）。

### 10.4 SSH 隧道（Stdio 模式的替代方案）

如果不想暴露 MCP HTTP 端口，仍可使用 SSH 隧道转发 Stdio：

```bash
# AI Agent 客户端通过 SSH 隧道连接远程 MiniMem
ssh -L /tmp/minimem.sock -o StreamLocalBindUnlink=yes \
  user@your-server "node /opt/minimem/dist/index.js --mcp"
```

### 10.5 MCP 远程安全注意事项

1. **必须使用 HTTPS**：Streamable HTTP 模式下，API Key 和记忆数据以明文传输，生产环境必须通过 Nginx + TLS 加密
2. **网络隔离**：MCP 端口（6678）不直接暴露公网，使用 Nginx 反向代理
3. **认证**：Streamable HTTP 当前未内置认证，建议通过 Nginx 的 `auth_request` 或 IP 白名单限制访问
4. **限流**：MCP 调用可能触发 LLM API，建议在 Nginx 层限流

## 11. 性能调优

### 11.1 大规模场景（10万+ 记忆）

当前向量检索为 O(n) 暴力扫描，10 万条记忆时检索耗时可能超过 1 秒。解决方案：

1. **切换到 Qdrant/ChromaDB**：修改 `storage.vector.provider = "qdrant"`（需实现适配器）
2. **减小向量维度**：从 1024 降到 512（需重新嵌入所有记忆）
3. **分层检索**：先条件索引/FTS 过滤，再向量排序

### 11.2 SQLite 调优

已在代码中配置 WAL + NORMAL + 64MB 缓存。如需进一步调优：

```toml
[storage.sqlite]
wal_mode = true

# 如需更大缓存（仅对大数据集有意义），需修改代码中 cache_size pragma
# cache_size = -128000  # 128MB
```

### 11.3 LLM 调用优化

- `llm.batch.batch_size = 10`：批量嵌入，减少 API 调用次数
- `llm.cache.enabled = true`：语义缓存，相似查询命中缓存直接返回
- `llm.retry`：指数退避重试，避免偶发网络问题导致失败

## 12. 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 启动失败 "node: No such file" | PATH 不包含 node | 使用绝对路径启动，或设置 PATH |
| SQLite 锁超时 | 另一个进程在写 | 确保只运行一个实例 |
| 向量搜索返回空 | 维度不匹配 | 检查 `llm.embedding.dimensions` 与实际一致 |
| 做梦失败 | LLM API 不可达 | 检查 API Key + 网络连通性 |
| 内存持续增长 | 向量数据量大 | 扩容或切换外部向量库 |
| 备份失败 | 磁盘满 | 清理旧备份或扩容 |
| MCP HTTP 连接被拒 | 端口未开放或防火墙阻止 | 检查端口映射和防火墙规则 |
| MCP HTTP 404 | Session ID 无效 | 客户端需先发起 initialize 请求 |
| MCP HTTP SSE 断开 | Nginx 缓冲开启或超时太短 | 设置 `proxy_buffering off` + `proxy_read_timeout 86400s` |
