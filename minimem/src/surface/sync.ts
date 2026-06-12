// ============================================================
// MiniMem — Surface Sync 引擎
// ============================================================
// Issue-23 修复：自动从各业务模块收集数据，生成 Surface 更新请求
// 在 Dream Phase 4 的 processUpdateQueue() 之前执行

import { getDb } from '../store/database.js';
import { getLLM } from '../llm/client.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import { surfaceSyncPrompt } from '../llm/prompts.js';
import type { SurfaceFileName } from '../common/types.js';

const log = getLogger('surface-sync');

// ── SurfaceSyncer 接口 ──

/**
 * Surface Syncer 接口
 * 每个 Surface File 对应一个 Syncer，负责从数据库收集最新数据
 */
export interface SurfaceSyncer {
  /** 收集该文件需要的最新数据 */
  collectData(): SyncData | null;
  /** 判断是否有足够的变化需要更新 */
  hasChanges(lastSyncAt: string | null): boolean;
}

export interface SyncData {
  file_name: SurfaceFileName;
  /** 收集到的结构化数据，传给 LLM 生成 Surface 内容 */
  context: Record<string, unknown>;
  /** 重要程度 1-5 */
  importance: number;
}

// ── Syncer 注册表 ──

/**
 * Surface Syncer 注册表
 * 每个 Surface File 注册自己的数据收集器
 */
const syncerRegistry = new Map<SurfaceFileName, SurfaceSyncer>();

export function registerSyncer(fileName: SurfaceFileName, syncer: SurfaceSyncer): void {
  syncerRegistry.set(fileName, syncer);
  log.debug({ fileName }, 'Surface syncer registered');
}

export function getSyncerRegistry(): ReadonlyMap<SurfaceFileName, SurfaceSyncer> {
  return syncerRegistry;
}

// ── 主入口 ──

/**
 * 在做梦阶段执行 Surface Sync
 * 遍历指定的 Surface Files，收集数据并写入 surface_update_queue
 *
 * @param surfaceFiles - 本次做梦需要更新的文件列表（由 DreamProfile 控制）
 * @returns 写入队列的更新数量
 */
export async function syncSurfaces(surfaceFiles: SurfaceFileName[]): Promise<number> {
  // 延迟初始化 syncers（避免 ESM 循环引用）
  await initSyncers();

  const db = getDb();
  const llm = getLLM();
  let queued = 0;

  log.info({ surfaceFiles, registeredSyncers: [...syncerRegistry.keys()] }, 'Surface sync started');

  for (const fileName of surfaceFiles) {
    const syncer = syncerRegistry.get(fileName);
    if (!syncer) {
      log.debug({ fileName }, 'No syncer registered, skipping');
      continue;
    }

    try {
      // 获取上次同步时间
      const lastSync = db.prepare(
        `SELECT MAX(processed_at) as last_sync FROM surface_update_queue
         WHERE file_name = ? AND status = 'applied'`
      ).get(fileName) as { last_sync: string | null } | undefined;

      // 判断是否有变化
      if (!syncer.hasChanges(lastSync?.last_sync ?? null)) {
        log.debug({ fileName }, 'No changes since last sync, skipping');
        continue;
      }

      // 收集数据
      const data = syncer.collectData();
      if (!data) {
        log.debug({ fileName }, 'Syncer returned no data, skipping');
        continue;
      }

      // 获取当前 Surface 内容
      const currentContent = db.prepare(
        `SELECT content FROM surface_files WHERE file_name = ?`
      ).get(fileName) as { content: string } | undefined;

      // LLM 生成更新建议
      if (!llm.isAvailable) {
        // LLM 不可用时，直接将数据 JSON 作为 suggestion
        const fallbackSuggestion = `## 数据更新 (${now()})\n\n${JSON.stringify(data.context, null, 2)}`;
        db.prepare(`
          INSERT INTO surface_update_queue (id, file_name, suggestion, importance, status, created_at)
          VALUES (?, ?, ?, ?, 'pending', ?)
        `).run(generateId(), fileName, fallbackSuggestion, data.importance, now());
        queued++;
        log.info({ fileName, importance: data.importance, mode: 'fallback' }, 'Surface sync: queued update (no LLM)');
        continue;
      }

      // prompt 统一由 prompts.ts 管理
      const result = await llm.chat({
        messages: surfaceSyncPrompt(
          fileName,
          currentContent?.content ?? '(空)',
          JSON.stringify(data.context, null, 2),
        ),
        temperature: 0.3,
        tier: 'light',
      });

      // 写入队列
      db.prepare(`
        INSERT INTO surface_update_queue (id, file_name, suggestion, importance, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `).run(generateId(), fileName, result.content, data.importance, now());

      queued++;
      log.info({ fileName, importance: data.importance }, 'Surface sync: queued update');
    } catch (err) {
      log.warn({ err, fileName }, 'Surface sync failed for file');
    }
  }

  log.info({ queued, total: surfaceFiles.length }, 'Surface sync completed');
  return queued;
}

// ── 延迟注册所有 Syncers（避免 ESM 循环引用） ──

let _syncersInitialized = false;

export async function initSyncers(): Promise<void> {
  if (_syncersInitialized) return;
  _syncersInitialized = true;

  await import('./syncers/me-syncer.js');
  await import('./syncers/soul-syncer.js');
  await import('./syncers/work-syncer.js');
  await import('./syncers/social-syncer.js');
  await import('./syncers/context-syncer.js');
  await import('./syncers/life-syncer.js');
  // REQ-008: 新增 agent.md 和 index.md syncer
  await import('./syncers/agent-syncer.js');
  await import('./syncers/index-syncer.js');
  // MINIMEM-002: 新增 insight.md syncer
  await import('./syncers/insight-syncer.js');

  log.debug({ count: syncerRegistry.size }, 'All surface syncers initialized');
}
