// ============================================================
// MiniMem — Graph Signal (MINIMEM-006 T-H01.5)
// ============================================================
// 图关联信号：从用户消息实体出发，在 knowledge graph 做 1-hop 关联

import { getLogger } from '../../common/logger.js';
import { traverseGraph } from '../../store/graph.js';
import { lookupByPrefix } from '../../store/indexes.js';
import type { MemoryLayer } from '../../common/types.js';
import type { SignalResult } from '../types.js';

const log = getLogger('recall:signal:graph');

const ENTITY_PREFIXES = ['person', 'topic', 'project', 'technology', 'organization', 'place', 'event'];

/**
 * 图关联信号：
 * 1. 从实体列表出发找到对应的记忆
 * 2. 对每个记忆做 1-hop 图遍历
 * 3. 返回关联记忆（非起始记忆本身）
 *
 * @param entities - 从用户消息中提取的实体列表
 * @param topK - 最大返回数
 */
export function computeGraphSignal(entities: string[], topK: number = 10): SignalResult[] {
  if (entities.length === 0) return [];

  const results: SignalResult[] = [];
  const seenIds = new Set<string>();
  const sourceIds = new Set<string>(); // 起始记忆 ID，不计入结果

  try {
    for (const entity of entities) {
      if (results.length >= topK) break;

      for (const prefix of ENTITY_PREFIXES) {
        const hits = lookupByPrefix(`${prefix}:${entity}`);
        for (const hit of hits) {
          sourceIds.add(hit.memory_id);

          // 1-hop 图遍历
          const links = traverseGraph(hit.memory_id, 1, topK);
          for (const link of links) {
            if (results.length >= topK) break;
            if (seenIds.has(link.target_id)) continue;
            if (sourceIds.has(link.target_id)) continue; // 跳过起始节点

            seenIds.add(link.target_id);
            results.push({
              memory_id: link.target_id,
              score: link.weight * 0.7, // 图关联分数衰减
              source: 'graph',
              layer: link.target_type as MemoryLayer,
            });
          }
        }
      }
    }
  } catch (err) {
    log.warn({ err }, 'Graph signal computation failed');
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
