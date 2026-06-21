# ============================================================
# MiniMem Console — Dockerfile
# ============================================================
# 多阶段构建：构建前端 + 服务端 → 最终镜像只跑 server
#
# 构建上下文需在 monorepo 根目录 (docker compose 会处理)

# ── Stage 1: 构建 ──
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# better-sqlite3 构建依赖
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制 console 的 package.json + lockfile
COPY minimem-console/package.json minimem-console/pnpm-lock.yaml ./

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源码
COPY minimem-console/ ./

# 构建 (vite build + tsc server)
RUN pnpm build

# ── Stage 2: 运行 ──
FROM node:22-slim AS runner

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# better-sqlite3 运行时依赖
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制 package.json + lockfile
COPY minimem-console/package.json minimem-console/pnpm-lock.yaml ./

# 只装生产依赖
RUN pnpm install --prod --frozen-lockfile && pnpm rebuild better-sqlite3

# 复制构建产物
COPY --from=builder /app/dist ./dist

# 环境变量
ENV CONSOLE_PORT=3000
ENV MINIMEM_API_URL=http://minimem:6677

EXPOSE 3000

# 启动 console server
CMD ["node", "dist/server/index.js"]
