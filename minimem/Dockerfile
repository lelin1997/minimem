# ============================================================
# MiniMem — Dockerfile (minimem 后端)
# ============================================================
# 多阶段构建：构建 TypeScript → 最终镜像只跑 dist
#
# 构建上下文需在 monorepo 根目录:
#   docker build -f minimem/Dockerfile -t minimem .

# ── Stage 1: 构建 ──
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# better-sqlite3 构建依赖
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制 package.json 和 lockfile (利用 Docker 缓存)
COPY minimem/package.json minimem/pnpm-lock.yaml ./

# 安装依赖
RUN pnpm install --frozen-lockfile && pnpm rebuild better-sqlite3

# 复制源码
COPY minimem/ ./

# 构建 TypeScript → dist/
RUN pnpm build

# ── Stage 2: 运行 ──
FROM node:22-slim AS runner

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# better-sqlite3 运行时依赖 (native module)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制 package.json + lockfile
COPY minimem/package.json minimem/pnpm-lock.yaml ./

# 只装生产依赖
RUN pnpm install --prod --frozen-lockfile && pnpm rebuild better-sqlite3

# 复制构建产物
COPY --from=builder /app/dist ./dist

# 创建数据目录
RUN mkdir -p /data

# 环境变量默认值
ENV MINIMEM_DATA_DIR=/data
ENV MINIMEM_SERVER_HOST=0.0.0.0
ENV MINIMEM_SERVER_PORT=6677

# 暴露端口（REST API 6677, MCP HTTP 6678）
EXPOSE 6677 6678

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:6677/api/v1/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# 默认启动 REST API 模式
CMD ["node", "dist/index.js"]
