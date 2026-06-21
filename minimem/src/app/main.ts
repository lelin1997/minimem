// ============================================================
// MiniMem — 应用编排层主入口 (A01: 从 src/index.ts 迁移)
// ============================================================
// 职责：启动编排 — 初始化各层 → 注册 ports → 启动服务 → 优雅关闭
// 依赖规则：可依赖所有层；不可被任何层依赖
//
// 启动模式：
//   npm run dev          → REST API + 控制台
//   minimem --mcp        → MCP Server (stdio)
//   minimem --mcp-http   → MCP Server (Streamable HTTP)
//   minimem --rest       → REST API only

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 最先加载 .env — 用 import.meta 定位项目根目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// src/app/main.ts → 上三级是项目根 (dist/app/main.js → 上两级)
const projectRoot = resolve(__dirname, '..', '..');
dotenv.config({ path: resolve(projectRoot, '.env') });

import { serve } from '@hono/node-server';
import { initLogger, getLogger } from '../common/logger.js';
import { loadConfig, getConfig } from '../config/index.js';
import { initDb, closeDb } from '../infra/store/database.js';
import { runMigrations } from '../infra/store/migrate.js';
import { registerInfraPorts } from '../infra/ports-registration.js';
import { createRestApp } from '../adapters/gateway/rest-api.js';
import { startMCPStdio, startMCPHttp } from '../adapters/gateway/mcp-server.js';
import { getVectorStore, initVectorStore } from '../infra/store/vectors.js';
import { startScheduler, stopScheduler } from '../infra/scheduler/index.js';
import { syncAllSurfacesToDisk } from '../domain/surface/index.js';
import { recoverDreamSession } from '../domain/dream/recovery.js';
import { getOrCreateJwtSecret } from '../infra/security/keychain.js';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ── 启动编排 ──

export async function startMinimem(): Promise<void> {
  // 1. 初始化配置
  const config = loadConfig();

  // 2. 初始化日志
  initLogger(config.storage.log, config.storage.data_dir);
  const log = getLogger('app');

  // 3. 解析启动参数
  const args = process.argv.slice(2);
  const mode = args.includes('--mcp-http') ? 'mcp-http' : args.includes('--mcp') ? 'mcp' : 'rest';
  const insecureMode = args.includes('--insecure');

  // --insecure 模式 — 禁用认证和加密（开发/测试用）
  if (insecureMode) {
    config.auth.enabled = false;
    config.encryption.enabled = false;
    config.encryption.provider = 'none';
    config.server.host = '127.0.0.1';
  }

  log.info({ version: '0.1.0', mode, insecure: insecureMode }, '🧠 MiniMem starting...');

  if (insecureMode) {
    log.warn('⚠️ Running in INSECURE mode: auth/encryption disabled, forced to listen on 127.0.0.1 only');
  }

  // 4. 统一初始化 data/ 子目录
  const dataDirs = ['db', 'vectors', 'dreams', 'surfaces', 'exports', 'snapshots', 'backups'];
  for (const sub of dataDirs) {
    const dir = join(config.storage.data_dir, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // 5. 安全初始化（JWT secret）
  if (config.auth.enabled) {
    const jwtSecret = getOrCreateJwtSecret(config.auth.jwt_secret_env);
    if (jwtSecret) {
      log.info('JWT authentication ready');
    } else {
      log.warn('JWT secret not available — auth will fail for non-local clients. '
        + 'Set MINIMEM_JWT_SECRET env var or use --insecure for development.');
    }
  }

  // 6. 初始化数据库
  initDb();
  runMigrations();
  log.info('Database ready');

  // 7. P3.1: 注册 infra ports 到 domain (依赖倒置)
  registerInfraPorts();
  log.info('Ports registered (dependency inversion)');

  // 8. 从磁盘加载向量索引缓存
  try {
    const vectorStore = await initVectorStore();
    const loaded = await vectorStore.loadFromDisk(config.storage.data_dir);
    if (loaded > 0) {
      log.info({ loaded }, 'Vector index loaded from disk cache');

      // 维度不匹配检测
      const sample = await vectorStore.getAny();
      if (sample) {
        const configDim = config.llm.embedding.dimensions;
        const actualDim = sample.vector.length;
        if (configDim !== actualDim) {
          log.error({
            configuredDimensions: configDim,
            actualDimensions: actualDim,
          }, '⚠️ Vector dimension mismatch! Configured dimensions differ from existing vectors. '
            + 'This will cause search failures.');
        }
      }
    }
    vectorStore.startAutoSave(config.storage.data_dir);
  } catch (err) {
    log.warn({ err }, 'Failed to load vector index from disk (will rebuild from DB)');
  }

  // 9. 恢复中断的做梦 session
  try {
    const recovery = await recoverDreamSession();
    if (recovery.action !== 'none') {
      log.info({ action: recovery.action, sessionId: recovery.session_id }, 'Dream recovery processed');
    }
  } catch (err) {
    log.warn({ err }, 'Dream recovery check failed (non-critical)');
  }

  // 10. 启动定时调度器
  startScheduler();
  log.info('Scheduler started');

  // 11. 根据模式启动服务
  if (mode !== 'mcp') {
    const app = createRestApp();
    const { host, port } = config.server;

    serve({
      fetch: app.fetch,
      hostname: host,
      port,
    });

    log.info({ host, port }, `🚀 MiniMem REST API running at http://${host}:${port}`);
  }

  // MCP Server
  if (mode === 'mcp') {
    log.info('Starting MCP Server (stdio mode)...');
    await startMCPStdio();
  } else if (mode === 'mcp-http') {
    const mcpPort = parseInt(process.env.MINIMEM_MCP_PORT || '6678', 10);
    const mcpHost = process.env.MINIMEM_MCP_HOST || config.server.host;
    log.info('Starting MCP Server (Streamable HTTP mode)...');
    await startMCPHttp(mcpPort, mcpHost);
  }

  // 12. 优雅关闭
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ── 关闭编排 ──

async function shutdown(signal: string): Promise<void> {
  const log = getLogger('app');
  log.info({ signal }, 'Shutting down...');
  const config = getConfig();

  // 停止调度器
  try {
    stopScheduler();
    log.info('Scheduler stopped');
  } catch (err) {
    log.warn({ err }, 'Failed to stop scheduler');
  }

  // 同步 Surface Files 到磁盘
  try {
    const synced = syncAllSurfacesToDisk();
    if (synced > 0) {
      log.info({ synced }, 'Surface files synced to disk');
    }
  } catch (err) {
    log.warn({ err }, 'Failed to sync surface files to disk');
  }

  // 保存向量索引到磁盘
  try {
    const vectorStore = getVectorStore();
    vectorStore.stopAutoSave();
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

// ── 启动 ──

startMinimem().catch((err) => {
  const log = getLogger('app');
  log.error({ err }, 'Fatal startup error');
  process.exit(1);
});
