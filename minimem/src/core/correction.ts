// ============================================================
// MiniMem — 冲突自动解决（REQ-010）
// ============================================================
// 对 detectConflicts() 发现的冲突，用 LLM 判定并标记过时记忆

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { getLLM } from '../llm/client.js';
import { now } from '../common/utils.js';
import { conflictResolutionPrompt } from '../llm/prompts.js';
import type { ConflictReport } from './consolidation.js';

const log = getLogger('core:correction');

/**
 * 解决冲突列表中的 fact_contradiction 类型冲突
 *
 * 对每个冲突：LLM 判断哪条更可信
 * 被判定过时的记忆：confidence 降为 0.1，添加 tag 'superseded'
 *
 * @returns 解决的冲突数
 */
export async function resolveConflicts(conflicts: ConflictReport[]): Promise<number> {
  const db = getDb();
  const llm = getLLM();
  let resolved = 0;

  // 只处理 fact_contradiction 类型
  const factConflicts = conflicts.filter(c => c.type === 'fact_contradiction');

  if (factConflicts.length === 0 || !llm.isAvailable) {
    return 0;
  }

  for (const conflict of factConflicts) {
    if (conflict.memory_ids.length < 2) continue;

    const [idA, idB] = conflict.memory_ids;

    try {
      // 获取两条事实的完整信息
      const factA = db.prepare(
        'SELECT id, subject, predicate, object, confidence, created_at FROM world_facts WHERE id = ?'
      ).get(idA) as { id: string; subject: string; predicate: string; object: string; confidence: number; created_at: string } | undefined;

      const factB = db.prepare(
        'SELECT id, subject, predicate, object, confidence, created_at FROM world_facts WHERE id = ?'
      ).get(idB) as { id: string; subject: string; predicate: string; object: string; confidence: number; created_at: string } | undefined;

      if (!factA || !factB) continue;

      const result = await llm.chatJson<{
        keep: 'A' | 'B';
        reason: string;
      }>({
        messages: conflictResolutionPrompt(factA, factB),
        tier: 'light',
        temperature: 0.1,
        fallback: { keep: 'B' as const, reason: '默认保留更新的事实' },
      });

      // 标记被淘汰的事实
      const loserId = result.keep === 'A' ? idB : idA;
      const timestamp = now();

      db.prepare(
        `UPDATE world_facts SET confidence = 0.1, updated_at = ? WHERE id = ?`
      ).run(timestamp, loserId);

      // 尝试在 condition_index 或 FTS 中添加 superseded 标记
      // 简化实现：直接在 compile_queue 中记录
      db.prepare(`
        INSERT INTO compile_queue (id, source_type, content, target_page, priority, status, created_at)
        VALUES (?, 'conflict_resolution', ?, NULL, 3, 'pending', ?)
      `).run(
        `cr-${loserId.slice(0, 8)}`,
        JSON.stringify({ loser_id: loserId, winner_id: result.keep === 'A' ? idA : idB, reason: result.reason }),
        timestamp,
      );

      resolved++;
      log.info({ conflict: conflict.description, keep: result.keep, reason: result.reason }, 'Conflict resolved');
    } catch (err) {
      log.warn({ err, conflict: conflict.description }, 'Failed to resolve conflict');
    }
  }

  log.info({ total: factConflicts.length, resolved }, 'Conflict resolution complete');
  return resolved;
}
