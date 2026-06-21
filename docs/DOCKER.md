# Docker 部署指南

## 快速开始

### 1. 设置 API Key

```bash
export MINIMEM_LLM_API_KEY=sk-your-deepseek-key
```

### 2. 一键启动

```bash
docker compose up -d
```

### 3. 访问

| 服务 | 地址 |
|------|------|
| REST API | http://localhost:6677 |
| Console | http://localhost:3000 |

### 4. 查看日志

```bash
docker compose logs -f minimem     # 后端日志
docker compose logs -f console     # Console 日志
```

### 5. 停止

```bash
docker compose down
```

## 只启动后端

不需要 Console 的话：

```bash
docker compose up -d minimem
```

## 数据持久化

数据存储在 Docker volume `minimem-data`，映射到容器内 `/data`：

```bash
# 查看数据卷
docker volume inspect minimem_minimem-data

# 备份数据
docker run --rm -v minimem_minimem-data:/data -v $(pwd):/backup alpine tar czf /backup/minimem-backup.tar.gz /data

# 恢复数据
docker run --rm -v minimem_minimem-data:/data -v $(pwd):/backup alpine tar xzf /backup/minimem-backup.tar.gz -C /
```

## 自定义配置

### 换 LLM Provider

修改 `docker-compose.yml` 的 environment：

```yaml
environment:
  - MINIMEM_LLM_API_KEY=your-key
  - MINIMEM_LLM_BASE_URL=https://api.openai.com/v1   # 改成你的 provider
```

### 开启 Embedding

如果你的 LLM provider 支持 embedding（如 OpenAI）：

```yaml
environment:
  - MINIMEM_EMBEDDING_ENABLED=true
  - MINIMEM_EMBEDDING_BASE_URL=https://api.openai.com/v1
  - MINIMEM_EMBEDDING_API_KEY=your-embedding-key
```

### 自定义端口

```yaml
ports:
  - "8080:6677"   # 宿主机 8080 → 容器 6677
  - "8081:3000"   # 宿主机 8081 → 容器 3000
```

## 健康检查

```bash
curl http://localhost:6677/api/v1/health
```

返回 `{"status":"ok"}` 表示服务正常。

## 重新构建

代码更新后重新构建：

```bash
docker compose build --no-cache
docker compose up -d
```

## 故障排查

### 端口冲突

```bash
# 查看占用 6677 的进程
lsof -i :6677

# 改用其他端口
docker compose up -d  # 先改 docker-compose.yml 的 ports
```

### API Key 未设置

```
ERROR: 请设置 MINIMEM_LLM_API_KEY 环境变量
```

解决：`export MINIMEM_LLM_API_KEY=sk-xxx` 后再 `docker compose up`。

### better-sqlite3 报错

镜像已包含构建依赖。如果仍报错，尝试：

```bash
docker compose build --no-cache minimem
```
