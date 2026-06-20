// ============================================================
// MiniMem — Dream Engine: Phase 3 — REM 创造性联想
// ============================================================
// 模拟 REM 睡眠：随机种子 + 向量漫游 + 图遍历 + 跨层配对 + LLM 联想

import { getDb } from '../../store/database.js';
import { getLogger } from '../../common/logger.js';
import { getLLM } from '../../llm/client.js';
import { getVectorStore } from '../../store/vectors.js';
import { traverseGraph } from '../../store/graph.js';
import { createLink } from '../../store/graph.js';
import { generateId, now } from '../../common/utils.js';
import { enqueueCompile } from '../../store/knowledge-pages/compile-queue.js';
import { getConfig } from '../../config/index.js';
import { dreamAssociationPrompt } from '../../llm/prompts.js';
import type { MemoryLayer, LinkType } from '../../common/types.js';
import type { DreamProfile_Dream } from './dream-engine.js';

const log = getLogger('dream:dreamer');

export interface DreamResult {
  narrative: string;
  new_connections: number;
  graph_discoveries: number;
  insights_to_l3: number;
  iterations_performed: number;   // MINIMEM-003 E09: 实际执行的迭代轮数
  duration_ms: number;
}

interface MemoryPair {
  id_a: string;
  layer_a: MemoryLayer;
  content_a: string;
  id_b: string;
  layer_b: MemoryLayer;
  content_b: string;
  source: string; // 'vector_walk' | 'graph_traverse' | 'cross_layer'
}

/** 默认 dream 参数（兼容无参数调用） */
const DEFAULT_DREAM_PARAMS: DreamProfile_Dream = {
  seedCount: 5,
  vectorWalkSteps: 3,
  vectorWalkBreadth: 3,     // MINIMEM-003 E04: 每步漫游宽度
  graphDepth: 3,
  graphMaxNodes: 10,
  maxPairs: 10,
  llmTier: 'medium',
  llmTemperature: 0.8,
  maxDreamIterations: 1,    // MINIMEM-003 E09: 默认单轮（兼容）
};

/**
 * Phase 3: REM 做梦 — 创造性联想
 *
 * @param params - 做梦参数（种子数、漫游步数等），由 DreamProfile 控制
 */
export async function runDream(params?: DreamProfile_Dream): Promise<DreamResult> {
  const p = params ?? DEFAULT_DREAM_PARAMS;
  const start = Date.now();
  const db = getDb();
  const llm = getLLM();

  log.info('Phase 3: REM dream started');

  let narrative = '（LLM 不可用，跳过创造性联想）';
  let newConnections = 0;
  let graphDiscoveries = 0;
  let insightsToL3 = 0;

  if (!llm.isAvailable) {
    return { narrative, new_connections: 0, graph_discoveries: 0, insights_to_l3: 0, iterations_performed: 0, duration_ms: Date.now() - start };
  }

  // 1. 种子选择 (MINIMEM-003 E08: 支持 MMR 或 random 模式)
  const seedSelection = getConfig().dreaming.seed_selection ?? 'random';
  const mmrLambda = getConfig().dreaming.mmr_lambda ?? 0.7;
  const candidateMultiplier = 5; // MMR 模式下候选池为 seedCount * 5

  let seeds: Array<{ id: string; raw_content: string; importance: number }>;

  if (seedSelection === 'mmr') {
    // MMR 模式：先取大候选池，再用 MMR 筛选
    const candidatePool = db.prepare(`
      SELECT id, raw_content, importance FROM experiences
      WHERE branch = 'main' AND created_at >= ?
      ORDER BY importance DESC LIMIT ?
    `).all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), p.seedCount * candidateMultiplier) as Array<{
      id: string; raw_content: string; importance: number;
    }>;

    if (candidatePool.length === 0) {
      const threshold = getConfig().dreaming.cold_start_threshold;
      log.info({ seedCount: 0, threshold }, 'No recent memories for dreaming (below cold_start_threshold)');
      return { narrative: `没有近期记忆可供做梦（种子数: 0，阈值: ${threshold}）。`, new_connections: 0, graph_discoveries: 0, insights_to_l3: 0, iterations_performed: 0, duration_ms: Date.now() - start };
    }

    seeds = await selectSeedsMMR(candidatePool, p.seedCount, mmrLambda, (text) => llm.embed(text));
    log.info({ mode: 'mmr', candidates: candidatePool.length, selected: seeds.length, lambda: mmrLambda },
      'Seeds selected via MMR');
  } else {
    // Random 模式（默认，兼容现有行为）
    seeds = db.prepare(`
      SELECT id, raw_content, importance FROM experiences
      WHERE branch = 'main' AND created_at >= ?
      ORDER BY RANDOM() LIMIT ?
    `).all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), p.seedCount) as Array<{
      id: string; raw_content: string; importance: number;
    }>;
  }

  if (seeds.length === 0) {
    const threshold = getConfig().dreaming.cold_start_threshold;
    log.info({ seedCount: seeds.length, threshold }, 'No recent memories for dreaming (below cold_start_threshold)');
    return { narrative: `没有近期记忆可供做梦（种子数: ${seeds.length}，阈值: ${threshold}）。`, new_connections: 0, graph_discoveries: 0, insights_to_l3: 0, iterations_performed: 0, duration_ms: Date.now() - start };
  }

  const pairs: MemoryPair[] = [];

  // 2. 多步向量漫游 (MINIMEM-003 E04: multiStepWalk 替换 randomWalk)
  const vectorStore = getVectorStore();
  if (vectorStore.size > 0) {
    for (const seed of seeds) {
      try {
        const embResult = await llm.embed(seed.raw_content);
        const trail = await vectorStore.multiStepWalk(
          embResult.embedding,
          p.vectorWalkSteps,
          p.vectorWalkBreadth,
          0.15, // minSim: 允许更远的发现
          0.7,  // maxSim
        );

        // 将所有跳的结果展平为记忆对
        for (const hop of trail.hops) {
          for (const walk of hop.results) {
            const content = getMemoryContent(db, walk.memoryId, walk.memoryType as MemoryLayer);
            if (content) {
              pairs.push({
                id_a: seed.id, layer_a: 'L1', content_a: seed.raw_content.slice(0, 200),
                id_b: walk.memoryId, layer_b: walk.memoryType as MemoryLayer, content_b: content.slice(0, 200),
                source: `vector_walk_step${hop.step}`,
              });
            }
          }
        }

        log.debug({ seedId: seed.id, steps: trail.hops.length, discovered: trail.totalDiscovered },
          'Multi-step walk complete for seed');
      } catch {
        // 跳过向量漫游失败
      }
    }
  }

  // 3. 图遍历发现
  for (const seed of seeds.slice(0, Math.min(3, p.seedCount))) {
    try {
      const links = traverseGraph(seed.id, p.graphDepth, p.graphMaxNodes);
      for (const link of links) {
        const targetId = link.source_id === seed.id ? link.target_id : link.source_id;
        const targetType = link.source_id === seed.id ? link.target_type : link.source_type;
        const content = getMemoryContent(db, targetId, targetType as MemoryLayer);
        if (content) {
          pairs.push({
            id_a: seed.id, layer_a: 'L1', content_a: seed.raw_content.slice(0, 200),
            id_b: targetId, layer_b: targetType as MemoryLayer, content_b: content.slice(0, 200),
            source: 'graph_traverse',
          });
          graphDiscoveries++;
        }
      }
    } catch {
      // 跳过
    }
  }

  // 4. 跨层联想 — L1 经历与 L3 观察配对
  const recentObservations = db.prepare(`
    SELECT id, description FROM observations
    WHERE branch = 'main' AND confidence >= 0.5
    ORDER BY created_at DESC LIMIT 5
  `).all() as Array<{ id: string; description: string }>;

  for (const seed of seeds.slice(0, 2)) {
    for (const obs of recentObservations.slice(0, 2)) {
      pairs.push({
        id_a: seed.id, layer_a: 'L1', content_a: seed.raw_content.slice(0, 200),
        id_b: obs.id, layer_b: 'L3', content_b: obs.description.slice(0, 200),
        source: 'cross_layer',
      });
    }
  }

  // 5. LLM 联想 — MINIMEM-003 E09: 多轮迭代联想
  const uniquePairs = deduplicatePairs(pairs).slice(0, p.maxPairs);

  if (uniquePairs.length === 0) {
    return { narrative: '记忆太少，暂无有趣联想。', new_connections: 0, graph_discoveries: graphDiscoveries, insights_to_l3: 0, iterations_performed: 0, duration_ms: Date.now() - start };
  }

  interface AssociationConnection {
    pair_index: number;
    connection_type: string;
    insight: string;
    novelty: number;
    depth?: number;   // MINIMEM-003 E09: 第几轮发现
  }

  interface AssociationResult {
    connections: AssociationConnection[];
    narrative: string;
  }

  const maxIterations = p.maxDreamIterations ?? 1;
  let iterationsPerformed = 0;
  let currentPairs = uniquePairs;
  const allConnections: AssociationConnection[] = [];
  const allNarratives: string[] = [];

  for (let round = 1; round <= maxIterations; round++) {
    if (currentPairs.length === 0) {
      log.debug({ round }, 'No pairs for iteration, stopping');
      break;
    }

    const pairsText = currentPairs.map((pair, i) =>
      `[${i + 1}] 记忆A (${pair.layer_a}): ${pair.content_a}\n    记忆B (${pair.layer_b}): ${pair.content_b}`
    ).join('\n\n');

    try {
      const roundLabel = round > 1 ? `（第 ${round} 轮深度联想）` : '';
      const result = await llm.chatJson<AssociationResult>({
        messages: dreamAssociationPrompt(pairsText, currentPairs.length, roundLabel),
        tier: p.llmTier,
        temperature: p.llmTemperature,
        fallback: { connections: [], narrative: '做梦联想未产生结果。' },
      });

      iterationsPerformed = round;

      if (result.narrative) {
        allNarratives.push(round > 1 ? `[深层第${round}轮] ${result.narrative}` : result.narrative);
      }

      // 处理当前轮结果
      const highNoveltyInsights: string[] = [];

      for (const conn of result.connections || []) {
        const idx = (conn.pair_index ?? 1) - 1;
        if (idx < 0 || idx >= currentPairs.length) continue;

        // E09.2: 标注 depth 字段
        conn.depth = round;
        // E09.2: 深层联想（depth ≥ 2）novelty 加 0.1 bonus
        if (round >= 2) {
          conn.novelty = Math.min(1.0, (conn.novelty ?? 0.5) + 0.1);
        }

        allConnections.push(conn);

        const pair = currentPairs[idx];
        const linkType = mapConnectionType(conn.connection_type);

        try {
          createLink(pair.id_a, pair.layer_a, pair.id_b, pair.layer_b, linkType, conn.novelty ?? 0.5);
          newConnections++;
        } catch {
          // 跳过重复链接
        }

        // 高置信度洞察 → 写入编译队列以供后续写入 L3
        if (conn.novelty >= 0.7 && conn.insight) {
          enqueueCompile('query_insight', conn.insight, undefined, 7);
          insightsToL3++;
          highNoveltyInsights.push(conn.insight);
        }
      }

      // E09.1: 检查终止条件
      const roundNovelties = (result.connections || []).map(c => c.novelty ?? 0);
      const allBelowThreshold = roundNovelties.length > 0 && roundNovelties.every(n => n < 0.5);

      if (allBelowThreshold) {
        log.info({ round, maxNovelty: Math.max(...roundNovelties) },
          'All novelties below 0.5, stopping iterations');
        break;
      }

      // E09.1: Round 2+: 高 novelty 洞察作为虚拟种子，执行向量漫游生成新记忆对
      if (round < maxIterations && highNoveltyInsights.length > 0) {
        const nextPairs: MemoryPair[] = [];

        for (const insight of highNoveltyInsights.slice(0, 3)) { // 最多 3 个虚拟种子
          try {
            const embResult = await llm.embed(insight);
            const trail = await vectorStore.multiStepWalk(
              embResult.embedding,
              Math.min(2, p.vectorWalkSteps), // 迭代轮用更短的漫游
              p.vectorWalkBreadth,
              0.15,
              0.7,
            );

            for (const hop of trail.hops) {
              for (const walk of hop.results) {
                const content = getMemoryContent(db, walk.memoryId, walk.memoryType as MemoryLayer);
                if (content) {
                  nextPairs.push({
                    id_a: walk.memoryId, layer_a: walk.memoryType as MemoryLayer,
                    content_a: content.slice(0, 200),
                    id_b: walk.memoryId, layer_b: walk.memoryType as MemoryLayer,
                    content_b: insight.slice(0, 200), // 虚拟种子内容
                    source: `iterative_round${round + 1}_step${hop.step}`,
                  });
                }
              }
            }
          } catch {
            // 向量漫游失败跳过
          }
        }

        currentPairs = deduplicatePairs(nextPairs).slice(0, Math.ceil(p.maxPairs / 2));
        log.info({ round, nextPairsCount: currentPairs.length, highNoveltyCount: highNoveltyInsights.length },
          'Prepared pairs for next iteration');
      } else {
        break; // 没有高 novelty 或已到最大轮
      }
    } catch (err) {
      log.warn({ err, round }, 'LLM dream association failed in iteration');
      if (round === 1) {
        narrative = '做梦联想发生错误。';
      }
      break;
    }
  }

  // 合并所有轮次的叙事
  narrative = allNarratives.length > 0 ? allNarratives.join('\n\n') : '做梦中...';

  const dreamResult: DreamResult = {
    narrative,
    new_connections: newConnections,
    graph_discoveries: graphDiscoveries,
    insights_to_l3: insightsToL3,
    iterations_performed: iterationsPerformed,
    duration_ms: Date.now() - start,
  };

  log.info({ ...dreamResult, iterations: iterationsPerformed }, 'Phase 3: REM dream complete');
  return dreamResult;
}

// ── 工具函数 ──

function getMemoryContent(db: ReturnType<typeof getDb>, id: string, layer: MemoryLayer): string | null {
  try {
    switch (layer) {
      case 'L1': {
        const row = db.prepare('SELECT raw_content FROM experiences WHERE id = ?').get(id) as { raw_content: string } | undefined;
        return row?.raw_content ?? null;
      }
      case 'L2': {
        const row = db.prepare('SELECT subject, predicate, object FROM world_facts WHERE id = ?').get(id) as { subject: string; predicate: string; object: string } | undefined;
        return row ? `${row.subject} ${row.predicate} ${row.object}` : null;
      }
      case 'L3': {
        const row = db.prepare('SELECT description FROM observations WHERE id = ?').get(id) as { description: string } | undefined;
        return row?.description ?? null;
      }
      case 'L4': {
        const row = db.prepare('SELECT title, content FROM mental_models WHERE id = ?').get(id) as { title: string; content: string } | undefined;
        return row ? `${row.title}: ${row.content}` : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function mapConnectionType(type: string): LinkType {
  const map: Record<string, LinkType> = {
    '类比': 'related',
    '因果': 'caused',
    '互补': 'supports',
    '矛盾': 'contradicts',
    'analogy': 'related',
    'causal': 'caused',
    'complementary': 'supports',
    'contradiction': 'contradicts',
  };
  return map[type] ?? 'related';
}

function deduplicatePairs(pairs: MemoryPair[]): MemoryPair[] {
  const seen = new Set<string>();
  return pairs.filter(p => {
    const key = [p.id_a, p.id_b].sort().join('_');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * MINIMEM-003 E08: MMR 种子选择
 *
 * 用最大边际相关性 (Maximal Marginal Relevance) 替代 ORDER BY RANDOM()，
 * 在保证重要性的同时最大化种子间的多样性。
 *
 * MMR(d) = λ * importance(d) - (1-λ) * max_cosine(d, already_selected)
 *
 * @param candidates 候选种子（importance 已归一化到 0-1）
 * @param count 需要选取的种子数量
 * @param lambda 平衡系数（1=纯重要性, 0=纯多样性）
 * @param embedFn embedding 函数
 * @returns MMR 选出的种子列表
 */
async function selectSeedsMMR(
  candidates: Array<{ id: string; raw_content: string; importance: number }>,
  count: number,
  lambda: number,
  embedFn: (text: string) => Promise<{ embedding: number[] }>,
): Promise<Array<{ id: string; raw_content: string; importance: number }>> {
  if (candidates.length <= count) return candidates;

  // 为所有候选生成 embedding
  const embeddings = new Map<string, number[]>();
  for (const c of candidates) {
    try {
      const result = await embedFn(c.raw_content);
      embeddings.set(c.id, result.embedding);
    } catch {
      // embedding 失败的候选跳过
    }
  }

  // 过滤掉无 embedding 的候选
  const validCandidates = candidates.filter(c => embeddings.has(c.id));
  if (validCandidates.length <= count) return validCandidates;

  const selected: Array<{ id: string; raw_content: string; importance: number }> = [];
  const remaining = new Set(validCandidates.map(c => c.id));

  // 第一颗种子：importance 最高
  const first = validCandidates.reduce((best, curr) => curr.importance > best.importance ? curr : best);
  selected.push(first);
  remaining.delete(first.id);

  // 后续种子：MMR 选择
  while (selected.length < count && remaining.size > 0) {
    let bestScore = -Infinity;
    let bestCandidate: typeof first | null = null;

    for (const candId of remaining) {
      const cand = validCandidates.find(c => c.id === candId)!;
      const candEmb = embeddings.get(candId)!;

      // 计算与已选种子的最大余弦相似度
      let maxSim = -1;
      for (const sel of selected) {
        const selEmb = embeddings.get(sel.id)!;
        const sim = vecCosineSimilarity(candEmb, selEmb);
        if (sim > maxSim) maxSim = sim;
      }

      // MMR 得分
      const mmrScore = lambda * cand.importance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestCandidate = cand;
      }
    }

    if (!bestCandidate) break;
    selected.push(bestCandidate);
    remaining.delete(bestCandidate.id);
  }

  return selected;
}

/**
 * 向量余弦相似度（用于 MMR 计算）
 */
function vecCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
