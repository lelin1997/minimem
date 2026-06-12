// ============================================================
// MiniMem — Semantic Signal (MINIMEM-006 T-H01.2)
// ============================================================
// 语义相似度信号：embedding cosine similarity

import { getLogger } from '../../common/logger.js';
import { getLLM } from '../../llm/client.js';
import { getVectorStore } from '../../store/vectors.js';
import type { MemoryLayer } from '../../common/types.js';
import type { SignalResult } from '../types.js';

const log = getLogger('recall:signal:semantic');

/**
 * 语义信号：对用户消息生成 embedding，在向量库做 top-K 近邻搜索
 *
 * @param message - 用户消息
 * @param topK - 返回的最大候选数
 * @param minRelevance - 最低相关性阈值
 * @param domain - 可选领域过滤
 * @returns 按相似度降序排列的候选列表
 */
export async function computeSemanticSignal(
  message: string,
  topK: number = 10,
  minRelevance: number = 0.3,
  domain?: string,
): Promise<SignalResult[]> {
  const llm = getLLM();

  if (!llm.isEmbeddingAvailable) {
    log.debug('Embedding not available, semantic signal skipped');
    return [];
  }

  try {
    const embResult = await llm.embed(message);
    const vectorStore = getVectorStore();
    const hits = await vectorStore.search(embResult.embedding, topK, minRelevance, domain);

    return hits.map(hit => ({
      memory_id: hit.memoryId,
      score: hit.similarity,
      source: 'semantic' as const,
      layer: hit.memoryType as MemoryLayer,
    }));
  } catch (err) {
    log.warn({ err }, 'Semantic signal computation failed');
    return [];
  }
}
