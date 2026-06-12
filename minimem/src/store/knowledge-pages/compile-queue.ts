// ============================================================
// MiniMem — 编译队列管理
// ============================================================

import { getDb } from '../database.js';
import { generateId, now } from '../../common/utils.js';
import type { CompileQueueItem, CompileSourceType, CompileStatus } from '../../common/types.js';

/**
 * 入队
 */
export function enqueueCompile(
  sourceType: CompileSourceType,
  content: string,
  targetPage?: string,
  priority: number = 5,
): CompileQueueItem {
  const db = getDb();
  const id = generateId();

  db.prepare(`
    INSERT INTO compile_queue (id, source_type, content, target_page, priority, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, sourceType, content, targetPage ?? null, priority, now());

  return { id, source_type: sourceType, content, target_page: targetPage ?? null, priority, status: 'pending', created_at: now(), processed_at: null };
}

/**
 * 获取待处理项
 */
export function getPendingCompileItems(limit: number = 50): CompileQueueItem[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM compile_queue WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT ?"
  ).all(limit) as CompileQueueItem[];
}

/**
 * 标记为已处理
 */
export function markCompiled(id: string, status: CompileStatus = 'compiled'): void {
  const db = getDb();
  db.prepare(
    'UPDATE compile_queue SET status = ?, processed_at = ? WHERE id = ?'
  ).run(status, now(), id);
}

/**
 * 批量标记
 */
export function markCompiledBatch(ids: string[], status: CompileStatus = 'compiled'): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE compile_queue SET status = ?, processed_at = ? WHERE id = ?');
  const timestamp = now();
  db.transaction(() => {
    for (const id of ids) {
      stmt.run(status, timestamp, id);
    }
  })();
}

/**
 * 统计待处理数
 */
export function countPendingCompile(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as count FROM compile_queue WHERE status = 'pending'").get() as { count: number }).count;
}
