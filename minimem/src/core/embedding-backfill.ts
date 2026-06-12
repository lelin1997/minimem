// ============================================================
// MiniMem — Embedding 补偿队列（REQ-004）
// ============================================================
// 通用 embedding 失败入队函数，L1-L4 统一使用

import { getDb } from '../store/database.js';
import { generateId, now } from '../common/utils.js';
import { getLogger } from '../common/logger.js';
import type { MemoryLayer } from '../common/types.js';

const log = getLogger('core:embedding-backfill');

/**
 * 将 embedding 失败的记忆加入补偿队列
 * 复用 compile_queue 表，source_type = 'embedding_backfill'
 *
 * @param memoryId - 记忆 ID
 * @param memoryType - 记忆层级（L1/L2/L3/L4）
 */
export function enqueueEmbeddingBackfill(memoryId: string, memoryType: MemoryLayer): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO compile_queue (id, source_type, content, target_page, priority, status, created_at)
      VALUES (?, 'embedding_backfill', ?, NULL, 8, 'pending', ?)
    `).run(
      generateId(),
      JSON.stringify({ memory_id: memoryId, memory_type: memoryType }),
      now(),
    );
    log.debug({ memoryId, memoryType }, 'Embedding backfill enqueued');
  } catch (err) {
    log.warn({ err, memoryId, memoryType }, 'Failed to enqueue embedding backfill');
  }
}
