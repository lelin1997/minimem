// ============================================================
// MiniMem — 反馈传播机制（REQ-013）
// ============================================================
// L1 反馈能沿编译链（compilation_trace）传播到 L2/L3/L4

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { now } from '../common/utils.js';

const log = getLogger('core:feedback-propagator');

/**
 * 沿编译链传播反馈
 *
 * 查询 compilation_trace 找到所有下游记忆
 * 对下游记忆递归降低 confidence（衰减因子 0.7 逐层递减）
 *
 * @param memoryId - 源记忆 ID
 * @param feedbackType - 反馈类型
 * @returns 受影响的下游记忆数
 */
export function propagateFeedback(memoryId: string, feedbackType: 'incorrect' | 'outdated'): number {
  const db = getDb();
  let affected = 0;

  // 衰减因子：incorrect 更强（0.5），outdated 更温和（0.7）
  const baseFactor = feedbackType === 'incorrect' ? 0.5 : 0.7;

  // BFS 遍历 compilation_trace
  const queue: Array<{ id: string; depth: number }> = [{ id: memoryId, depth: 0 }];
  const visited = new Set<string>();
  visited.add(memoryId);

  const timestamp = now();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth > 3) continue; // 最多传播 3 层

    // 查找下游
    const downstream = db.prepare(
      `SELECT target_id, target_type FROM compilation_trace WHERE source_id = ?`
    ).all(current.id) as Array<{ target_id: string; target_type: string }>;

    for (const target of downstream) {
      if (visited.has(target.target_id)) continue;
      visited.add(target.target_id);

      // 衰减因子随深度递减
      const factor = Math.pow(baseFactor, current.depth + 1);

      // 根据目标类型更新 confidence
      const tableMap: Record<string, string> = {
        L2: 'world_facts',
        L3: 'observations',
        L4: 'mental_models',
      };

      const table = tableMap[target.target_type];
      if (table) {
        const result = db.prepare(
          `UPDATE ${table} SET confidence = MAX(0.05, confidence * ?), updated_at = ? WHERE id = ?`
        ).run(factor, timestamp, target.target_id);

        if (result.changes > 0) {
          affected++;
          log.debug({ targetId: target.target_id, type: target.target_type, factor }, 'Feedback propagated');
        }
      }

      // 继续向下游传播
      queue.push({ id: target.target_id, depth: current.depth + 1 });
    }
  }

  if (affected > 0) {
    log.info({ sourceId: memoryId, feedbackType, affected }, 'Feedback propagation complete');
  }

  return affected;
}
