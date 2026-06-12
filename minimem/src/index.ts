// ============================================================
// MiniMem — 主入口
// ============================================================
// 启动模式：
//   npm run dev          → REST API + 控制台
//   minimem --mcp        → MCP Server (stdio)
//   minimem --rest       → REST API only

// 最先加载 .env — 用 import.meta 定位项目根目录，不依赖 process.cwd()
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// src/index.ts → 上一级就是项目根（dist/index.js → 上一级也是项目根）
dotenv.config({ path: resolve(__dirname, '..', '.env') });

import { serve } from '@hono/node-server';
import { initLogger, getLogger } from './common/logger.js';
import { loadConfig, getConfig, updateConfig } from './config/index.js';
import { initDb, closeDb } from './store/database.js';
import { runMigrations } from './store/migrate.js';
import { createRestApp } from './gateway/rest-api.js';
import { startMCPStdio, startMCPHttp } from './gateway/mcp-server.js';
import { getVectorStore, initVectorStore } from './store/vectors.js';
import { startScheduler, stopScheduler } from './scheduler/index.js';
import { syncAllSurfacesToDisk } from './surface/index.js';
import { recoverDreamSession } from './modules/dream/recovery.js';
import { getOrCreateJwtSecret } from './security/keychain.js';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// 1. 初始化配置
const config = loadConfig();

// 2. 初始化日志
initLogger(config.storage.log, config.storage.data_dir);
const log = getLogger('main');

// 3. 解析启动参数
const args = process.argv.slice(2);
const mode = args.includes('--mcp-http') ? 'mcp-http' : args.includes('--mcp') ? 'mcp' : 'rest';
const insecureMode = args.includes('--insecure');

// TODO-021.5: --insecure 模式 — 禁用认证和加密（开发/测试用）
if (insecureMode) {
  config.auth.enabled = false;
  config.encryption.enabled = false;
  config.encryption.provider = 'none';
  // 安全保护：insecure 模式强制只监听 localhost，防止公网暴露无认证服务
  config.server.host = '127.0.0.1';
}

async function main() {
  log.info({ version: '0.1.0', mode, insecure: insecureMode }, '🧠 MiniMem starting...');

  if (insecureMode) {
    log.warn('⚠️ Running in INSECURE mode: auth/encryption disabled, forced to listen on 127.0.0.1 only');
  }

  // R-024: 统一初始化所有 data/ 子目录
  const dataDirs = ['db', 'vectors', 'dreams', 'surfaces', 'exports', 'snapshots', 'backups'];
  for (const sub of dataDirs) {
    const dir = join(config.storage.data_dir, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // 4. 安全初始化（TODO-021.2: JWT secret 自动生成）
  if (config.auth.enabled) {
    const jwtSecret = getOrCreateJwtSecret(config.auth.jwt_secret_env);
    if (jwtSecret) {
      log.info('JWT authentication ready');
    } else {
      log.warn('JWT secret not available — auth will fail for non-local clients. '
        + 'Set MINIMEM_JWT_SECRET env var or use --insecure for development.');
    }
  }

  // 4.5 初始化数据库
  initDb();
  runMigrations();
  log.info('Database ready');

  // 4.5 从磁盘加载向量索引缓存（避免每次重启全量重建）
  try {
    const vectorStore = await initVectorStore();
    const loaded = await vectorStore.loadFromDisk(config.storage.data_dir);
    if (loaded > 0) {
      log.info({ loaded }, 'Vector index loaded from disk cache');

      // Issue-6+21: 启动维度不匹配检测
      const sample = await vectorStore.getAny();
      if (sample) {
        const configDim = config.llm.embedding.dimensions;
        const actualDim = sample.vector.length;
        if (configDim !== actualDim) {
          log.error({
            configuredDimensions: configDim,
            actualDimensions: actualDim,
          }, '⚠️ Vector dimension mismatch! Configured dimensions differ from existing vectors. '
            + 'This will cause search failures. Please either: '
            + '1) Update llm.embedding.dimensions to match existing vectors, or '
            + '2) Clear vectors and re-embed all memories.');
        }
      }
    }
    // R-002: 启动周期性自动保存（每 5 分钟或每 100 次更新）
    vectorStore.startAutoSave(config.storage.data_dir);
  } catch (err) {
    log.warn({ err }, 'Failed to load vector index from disk (will rebuild from DB)');
  }

  // 5. 恢复中断的做梦 session（R-007）
  try {
    const recovery = await recoverDreamSession();
    if (recovery.action !== 'none') {
      log.info({ action: recovery.action, sessionId: recovery.session_id }, 'Dream recovery processed');
    }
  } catch (err) {
    log.warn({ err }, 'Dream recovery check failed (non-critical)');
  }

  // 6. 启动定时调度器（R-001）
  startScheduler();
  log.info('Scheduler started');

  // 7. 根据模式启动
  if (mode === 'mcp') {
    // MCP Server 模式 (stdio)
    log.info('Starting MCP Server (stdio mode)...');
    await startMCPStdio();
  } else if (mode === 'mcp-http') {
    // MCP Server 模式 (Streamable HTTP — 支持远程访问)
    const mcpPort = parseInt(process.env.MINIMEM_MCP_PORT || '6678', 10);
    const mcpHost = process.env.MINIMEM_MCP_HOST || config.server.host;
    log.info('Starting MCP Server (Streamable HTTP mode)...');
    await startMCPHttp(mcpPort, mcpHost);
  } else {
    // REST API 模式
    const app = createRestApp();
    const { host, port } = config.server;

    serve({
      fetch: app.fetch,
      hostname: host,
      port,
    });

    log.info({ host, port }, `🚀 MiniMem REST API running at http://${host}:${port}`);
    log.info('Endpoints:');
    log.info('  POST   /api/v1/memory          — 添加记忆');
    log.info('  GET    /api/v1/memory/search    — 搜索记忆');
    log.info('  GET    /api/v1/health           — 健康检查');
    log.info('  GET    /api/v1/admin/stats      — 统计信息');
  }

  // 6. 优雅关闭
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function shutdown(signal: string) {
  log.info({ signal }, 'Shutting down...');

  // 停止调度器（R-001）
  try {
    stopScheduler();
    log.info('Scheduler stopped');
  } catch (err) {
    log.warn({ err }, 'Failed to stop scheduler');
  }

  // 同步 Surface Files 到磁盘（R-006）
  try {
    const synced = syncAllSurfacesToDisk();
    if (synced > 0) {
      log.info({ synced }, 'Surface files synced to disk');
    }
  } catch (err) {
    log.warn({ err }, 'Failed to sync surface files to disk');
  }

  // 保存向量索引到磁盘（下次启动可快速恢复）
  try {
    const vectorStore = getVectorStore();
    vectorStore.stopAutoSave(); // R-002: 停止自动保存
    if (vectorStore.size > 0) {
      await vectorStore.saveToDisk(config.storage.data_dir);
      log.info({ count: vectorStore.size }, 'Vector index saved to disk');
    }
  } catch (err) {
    log.warn({ err }, 'Failed to save vector index to disk');
  }

  closeDb();
  process.exit(0);
}

main().catch((err) => {
  log.error({ err }, 'Fatal startup error');
  process.exit(1);
});
