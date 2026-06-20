// ============================================================
// MiniMem — Inspiration Engine: Phase 3.5 灵感引擎
// ============================================================
// MINIMEM-002: 在 Dream Phase 3（REM）之后、Phase 4（Cleanup）之前执行
// 流水线: spark → cross-pollinate → habit-detect → incubate → hypothesize → evaluate

import { getDb } from '../../store/database.js';
import { getLogger } from '../../common/logger.js';
import { getLLM } from '../../llm/client.js';
import { getVectorStore } from '../../store/vectors.js';
import { getConfig } from '../../config/index.js';
import { generateId, now } from '../../common/utils.js';
import { createLink } from '../../store/graph.js';
import { enqueueCompile } from '../../store/knowledge-pages/compile-queue.js';
import { INSPIRATION_SCORE, HABIT_NEGATIVE_KEYWORDS } from '../../common/constants.js';
import { inspirationIncubatePrompt, inspirationHypothesizePrompt, inspirationWorthinessPrompt } from '../../llm/prompts.js';
import type { MemoryLayer, InspirationOrigin, InspirationStatus, IncubationEntry } from '../../common/types.js';
import type { DreamResult } from './dreamer.js';
import type { DreamMode } from './dream-engine.js';

const log = getLogger('dream:inspiration');

// ── 公共接口 ──

export interface InspirationEngineOptions {
  dreamResult: DreamResult | null;
  mode: DreamMode;
  domain?: string;
}

export interface InspirationEngineResult {
  sparks_generated: number;
  cross_pollinations: number;
  habits_detected: number;
  incubations_performed: number;
  matured: number;
  archived_expired: number;
  duration_ms: number;
}

interface InspirationCandidate {
  content: string;
  origin: InspirationOrigin;
  source_memory_ids: string[];
  source_layers: MemoryLayer[];
  source_domains: string[];
  novelty: number;
}

interface HypothesizedInspiration {
  title: string;
  content: string;
  hypothesis: string;
  origin: InspirationOrigin;
  source_memory_ids: string[];
  source_layers: MemoryLayer[];
  source_domains: string[];
  novelty: number;
  actionability: number;
  confidence: number;
}

// ── 主入口 ──

/**
 * 灵感引擎主函数
 * 在 Dream Phase 3 之后调用，执行完整的灵感生成流水线
 */
export async function runInspirationEngine(options: InspirationEngineOptions): Promise<InspirationEngineResult> {
  const start = Date.now();
  const config = getConfig();
  const inspirationConfig = config.dreaming.inspiration;

  // enabled 检查
  if (!inspirationConfig?.enabled) {
    log.info('Inspiration engine disabled');
    return emptyResult(start);
  }

  log.info({ mode: options.mode, domain: options.domain }, '💡 Inspiration engine started');

  const result: InspirationEngineResult = {
    sparks_generated: 0,
    cross_pollinations: 0,
    habits_detected: 0,
    incubations_performed: 0,
    matured: 0,
    archived_expired: 0,
    duration_ms: 0,
  };

  try {
    // Step 1: Spark — 种子筛选
    const sparkCandidates = collectSparkCandidates(options);

    // Step 2: Cross-pollinate — 跨域碰撞
    const crossCandidates = await crossPollinate(inspirationConfig);
    result.cross_pollinations = crossCandidates.length;

    // Step 3: Habit-detect — 习惯/错误模式检测
    const habitCandidates = detectHabits(inspirationConfig);
    result.habits_detected = habitCandidates.length;

    // Step 4: Incubate — 孵化已有灵感
    const incubated = await incubateInspirations(inspirationConfig);
    result.incubations_performed = incubated.performed;
    result.matured += incubated.matured;

    // Step 5: Worthiness Filter + Hypothesize — 灵感适性预筛 → LLM 生成可行动推论
    const allCandidates = [...sparkCandidates, ...crossCandidates, ...habitCandidates];
    let hypothesized: HypothesizedInspiration[] = [];
    if (allCandidates.length > 0) {
      // Step 5a: 灵感适性预筛 — 用 LLM 判断每条候选是否有灵感潜力
      const worthyCandidates = await filterByWorthiness(allCandidates);
      log.info({ before: allCandidates.length, after: worthyCandidates.length }, 'Worthiness filter applied');

      // Step 5b: 对通过预筛的候选执行 Hypothesize
      if (worthyCandidates.length > 0) {
        hypothesized = await hypothesize(worthyCandidates, options.mode);
      }
    }

    // Step 6: Evaluate & Persist — 评分、存储、反哺
    const persisted = evaluateAndPersist(hypothesized, inspirationConfig, options.domain);
    result.sparks_generated = persisted.created;
    result.matured += persisted.matured;

    // 保鲜期 GC
    result.archived_expired = expireInspirations(inspirationConfig);

  } catch (err) {
    log.warn({ err }, 'Inspiration engine encountered an error');
  }

  result.duration_ms = Date.now() - start;
  log.info(result, '💡 Inspiration engine complete');
  return result;
}

// ── Step 1: Spark — 种子筛选 ──

function collectSparkCandidates(options: InspirationEngineOptions): InspirationCandidate[] {
  const db = getDb();
  const candidates: InspirationCandidate[] = [];

  try {
    // ① 从 compile_queue 中取 query_insight（来自 Phase 3 联想）
    const insights = db.prepare(`
      SELECT content FROM compile_queue
      WHERE source_type = 'query_insight' AND priority >= 6 AND status = 'pending'
      ORDER BY priority DESC LIMIT 10
    `).all() as Array<{ content: string }>;

    for (const ins of insights) {
      candidates.push({
        content: ins.content,
        origin: 'dream_association',
        source_memory_ids: [],
        source_layers: [],
        source_domains: [],
        novelty: 0.7,
      });
    }

    // ② 最近 24h 内 importance ≥ 0.7 的 L1 经历
    const recentL1 = db.prepare(`
      SELECT id, raw_content, domain FROM experiences
      WHERE branch = 'main' AND importance >= 0.7
        AND created_at >= datetime('now', '-1 day')
      ORDER BY importance DESC LIMIT 5
    `).all() as Array<{ id: string; raw_content: string; domain: string }>;

    for (const exp of recentL1) {
      candidates.push({
        content: exp.raw_content.slice(0, 300),
        origin: 'dream_association',
        source_memory_ids: [exp.id],
        source_layers: ['L1'],
        source_domains: [exp.domain],
        novelty: 0.6,
      });
    }

    // ③ drift_risk = 1 的 L3 观察
    const driftObs = db.prepare(`
      SELECT id, description, domain FROM observations
      WHERE branch = 'main' AND drift_risk = 1
      ORDER BY updated_at DESC LIMIT 3
    `).all() as Array<{ id: string; description: string; domain: string }>;

    for (const obs of driftObs) {
      candidates.push({
        content: obs.description.slice(0, 300),
        origin: 'contradiction_resolution',
        source_memory_ids: [obs.id],
        source_layers: ['L3'],
        source_domains: [obs.domain],
        novelty: 0.65,
      });
    }
  } catch (err) {
    log.warn({ err }, 'Spark candidate collection failed');
  }

  log.debug({ count: candidates.length }, 'Spark candidates collected');
  return candidates;
}

// ── Step 1.5: Worthiness Filter — 灵感适性预筛 ──

/**
 * 用 LLM 判断每条候选素材是否具有"灵感潜力"
 * 过滤掉工作日志、状态报告、项目元信息等无灵感价值的内容
 * 但保留其中可能蕴含 insight 的部分（如架构决策的深层原因）
 */
async function filterByWorthiness(candidates: InspirationCandidate[]): Promise<InspirationCandidate[]> {
  const llm = getLLM();

  // LLM 不可用时降级：全部放行（保持原有行为）
  if (!llm.isAvailable) return candidates;

  // 候选太少时跳过预筛（节省 LLM 调用）
  if (candidates.length <= 1) return candidates;

  try {
    const candidatesText = candidates.map((c, i) =>
      `[${i + 1}] (来源: ${c.origin}) ${c.content}`
    ).join('\n\n');

    const result = await llm.chatJson<{
      results: Array<{ index: number; worthy: boolean; reason: string }>;
    }>({
      messages: inspirationWorthinessPrompt(candidatesText, candidates.length),
      tier: 'light',
      temperature: 0.1,
      fallback: { results: candidates.map((_, i) => ({ index: i + 1, worthy: true, reason: 'fallback' })) },
    });

    const worthyIndices = new Set<number>();
    for (const r of result.results || []) {
      if (r.worthy) {
        worthyIndices.add((r.index ?? 1) - 1);
      } else {
        log.debug({ index: r.index, reason: r.reason }, 'Worthiness filter rejected candidate');
      }
    }

    // 安全兜底：如果 LLM 返回为空或全部拒绝但候选很多，可能是 LLM 理解出了问题
    // 此时保守放行前 2 条（避免假阴性导致灵感引擎完全静默）
    if (worthyIndices.size === 0 && candidates.length >= 3) {
      log.warn('Worthiness filter rejected ALL candidates — fallback: passing first 2');
      return candidates.slice(0, 2);
    }

    return candidates.filter((_, i) => worthyIndices.has(i));
  } catch (err) {
    log.warn({ err }, 'Worthiness filter failed, passing all candidates');
    return candidates; // 出错时降级放行
  }
}

// ── Step 2: Cross-pollinate — 跨域碰撞 ──

async function crossPollinate(
  config: NonNullable<ReturnType<typeof getConfig>['dreaming']['inspiration']>,
): Promise<InspirationCandidate[]> {
  const db = getDb();
  const llm = getLLM();
  const candidates: InspirationCandidate[] = [];
  const maxPairs = config.cross_pollinate_pairs;
  const [simMin, simMax] = config.similarity_window;

  try {
    // 从 L3 观察 + L4 心智模型中按 tags 分组
    const l3Items = db.prepare(`
      SELECT id, description as content, tags, domain FROM observations
      WHERE branch = 'main' AND confidence >= 0.5
      ORDER BY created_at DESC LIMIT 30
    `).all() as Array<{ id: string; content: string; tags: string; domain: string }>;

    const l4Items = db.prepare(`
      SELECT id, content, model_type as tags, domain FROM mental_models
      WHERE branch = 'main' AND is_active = 1
      ORDER BY priority DESC LIMIT 20
    `).all() as Array<{ id: string; content: string; tags: string; domain: string }>;

    const allItems = [
      ...l3Items.map(i => ({ ...i, layer: 'L3' as MemoryLayer })),
      ...l4Items.map(i => ({ ...i, layer: 'L4' as MemoryLayer })),
    ];

    if (allItems.length < 4) {
      log.debug('Not enough L3/L4 items for cross-pollination, skipping');
      return candidates;
    }

    // 按 domain 分组
    const groups = new Map<string, typeof allItems>();
    for (const item of allItems) {
      const key = item.domain || 'default';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

    // 如果只有 1 个 domain，按 tags 尝试分组
    if (groups.size < 2) {
      groups.clear();
      for (const item of allItems) {
        let parsedTags: string[] = [];
        try { parsedTags = JSON.parse(item.tags); } catch { /* ignore */ }
        const key = parsedTags[0] || `group-${groups.size % 3}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
    }

    const groupKeys = [...groups.keys()];
    if (groupKeys.length < 2) {
      log.debug('Not enough distinct groups for cross-pollination');
      return candidates;
    }

    // 对每对不同组，随机采样碰撞
    const vectorStore = getVectorStore();
    let pairsAttempted = 0;

    for (let i = 0; i < groupKeys.length && pairsAttempted < maxPairs; i++) {
      for (let j = i + 1; j < groupKeys.length && pairsAttempted < maxPairs; j++) {
        const groupA = groups.get(groupKeys[i])!;
        const groupB = groups.get(groupKeys[j])!;

        const itemA = groupA[Math.floor(Math.random() * groupA.length)];
        const itemB = groupB[Math.floor(Math.random() * groupB.length)];

        // 计算 embedding 相似度
        try {
          if (!llm.isAvailable || vectorStore.size === 0) {
            // embedding 不可用时，用 tags 不同作为碰撞依据
            candidates.push({
              content: `碰撞: [${itemA.content.slice(0, 100)}] × [${itemB.content.slice(0, 100)}]`,
              origin: 'cross_domain',
              source_memory_ids: [itemA.id, itemB.id],
              source_layers: [itemA.layer, itemB.layer],
              source_domains: [itemA.domain, itemB.domain].filter(Boolean),
              novelty: 0.6,
            });
            pairsAttempted++;
            continue;
          }

          const [embA, embB] = await Promise.all([
            llm.embed(itemA.content.slice(0, 200)),
            llm.embed(itemB.content.slice(0, 200)),
          ]);

          const similarity = cosineSimilarity(embA.embedding, embB.embedding);

          if (similarity >= simMin && similarity <= simMax) {
            candidates.push({
              content: `碰撞: [${itemA.content.slice(0, 150)}] × [${itemB.content.slice(0, 150)}]`,
              origin: 'cross_domain',
              source_memory_ids: [itemA.id, itemB.id],
              source_layers: [itemA.layer, itemB.layer],
              source_domains: [...new Set([itemA.domain, itemB.domain].filter(Boolean))],
              novelty: 0.7 + (1 - similarity) * 0.3, // 越不相似的碰撞越新颖
            });
          }
        } catch {
          // embedding 失败，跳过这对
        }
        pairsAttempted++;
      }
    }
  } catch (err) {
    log.warn({ err }, 'Cross-pollination failed');
  }

  log.debug({ count: candidates.length }, 'Cross-pollinate candidates generated');
  return candidates;
}

// ── Step 3: Habit-detect — 习惯/错误模式检测 ──

function detectHabits(
  config: NonNullable<ReturnType<typeof getConfig>['dreaming']['inspiration']>,
): InspirationCandidate[] {
  const db = getDb();
  const candidates: InspirationCandidate[] = [];
  const days = config.habit_detect_days;
  const minOccurrences = config.habit_min_occurrences;

  try {
    // 查询最近 N 天的 L1 经历
    const recentL1 = db.prepare(`
      SELECT id, raw_content, tags, created_at, domain FROM experiences
      WHERE branch = 'main' AND created_at >= datetime('now', '-' || ? || ' days')
      ORDER BY created_at DESC LIMIT 200
    `).all(days) as Array<{ id: string; raw_content: string; tags: string; created_at: string; domain: string }>;

    // 筛选含负面信号的记忆
    const negativeMemories: Array<typeof recentL1[0] & { matchedKeywords: string[] }> = [];
    for (const mem of recentL1) {
      const content = mem.raw_content.toLowerCase();
      const matched = HABIT_NEGATIVE_KEYWORDS.filter(kw => content.includes(kw.toLowerCase()));
      if (matched.length > 0) {
        negativeMemories.push({ ...mem, matchedKeywords: matched });
      }
    }

    // 也检查 feedback='incorrect' 的记忆
    const incorrectFeedback = db.prepare(`
      SELECT content FROM compile_queue
      WHERE source_type = 'feedback' AND content LIKE '%incorrect%'
        AND created_at >= datetime('now', '-' || ? || ' days')
      LIMIT 50
    `).all(days) as Array<{ content: string }>;

    // 按关键词聚类
    const clusters = new Map<string, Array<{ id: string; content: string; created_at: string }>>();
    for (const mem of negativeMemories) {
      for (const kw of mem.matchedKeywords) {
        if (!clusters.has(kw)) clusters.set(kw, []);
        clusters.get(kw)!.push({ id: mem.id, content: mem.raw_content.slice(0, 200), created_at: mem.created_at });
      }
    }

    // 按 tags/subject 二次聚类
    const tagClusters = new Map<string, typeof negativeMemories>();
    for (const mem of negativeMemories) {
      let parsedTags: string[] = [];
      try { parsedTags = JSON.parse(mem.tags); } catch { /* ignore */ }
      for (const tag of parsedTags) {
        if (!tagClusters.has(tag)) tagClusters.set(tag, []);
        tagClusters.get(tag)!.push(mem);
      }
    }

    // 生成习惯检测候选（出现 >= minOccurrences 次）
    for (const [keyword, mems] of clusters) {
      if (mems.length >= minOccurrences) {
        // 时间模式检测：按星期几分组
        const dayOfWeek = new Map<number, number>();
        for (const m of mems) {
          const day = new Date(m.created_at).getDay();
          dayOfWeek.set(day, (dayOfWeek.get(day) ?? 0) + 1);
        }
        const dominantDay = [...dayOfWeek.entries()].sort((a, b) => b[1] - a[1])[0];
        const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const timeHint = dominantDay && dominantDay[1] >= 2
          ? `（多发生在${dayNames[dominantDay[0]]}）`
          : '';

        candidates.push({
          content: `检测到重复出现的"${keyword}"模式${timeHint}，过去 ${days} 天出现 ${mems.length} 次: ${mems.map(m => m.content.slice(0, 50)).join('; ')}`,
          origin: 'habit_detection',
          source_memory_ids: mems.map(m => m.id),
          source_layers: ['L1'],
          source_domains: [],
          novelty: 0.5,
        });
      }
    }

    // tag 级别聚类
    for (const [tag, mems] of tagClusters) {
      if (mems.length >= minOccurrences && !candidates.some(c => c.source_memory_ids.some(id => mems.some(m => m.id === id)))) {
        candidates.push({
          content: `在"${tag}"主题上检测到 ${mems.length} 次负面模式`,
          origin: 'habit_detection',
          source_memory_ids: mems.map(m => m.id),
          source_layers: ['L1'],
          source_domains: [...new Set(mems.map(m => m.domain))],
          novelty: 0.5,
        });
      }
    }
  } catch (err) {
    log.warn({ err }, 'Habit detection failed');
  }

  log.debug({ count: candidates.length }, 'Habit candidates detected');
  return candidates;
}

// ── Step 4: Incubate — 灵感孵化 ──

async function incubateInspirations(
  config: NonNullable<ReturnType<typeof getConfig>['dreaming']['inspiration']>,
): Promise<{ performed: number; matured: number }> {
  const db = getDb();
  const llm = getLLM();
  let performed = 0;
  let matured = 0;

  if (!llm.isAvailable) return { performed, matured };

  try {
    // 取 spark 或 incubating 且孵化次数未满的灵感
    const toIncubate = db.prepare(`
      SELECT * FROM inspirations
      WHERE (status = 'spark' OR status = 'incubating')
        AND incubation_count < ?
      ORDER BY confidence ASC LIMIT 5
    `).all(config.max_incubations) as Array<Record<string, unknown>>;

    for (const insp of toIncubate) {
      try {
        // 找邻居作为"新角度"
        const sourceIds: string[] = JSON.parse((insp.source_memory_ids as string) || '[]');
        const newAngles: string[] = [];

        for (const srcId of sourceIds.slice(0, 2)) {
          const neighbors = db.prepare(`
            SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END as neighbor_id,
                   CASE WHEN source_id = ? THEN target_type ELSE source_type END as neighbor_type
            FROM memory_links
            WHERE source_id = ? OR target_id = ?
            LIMIT 3
          `).all(srcId, srcId, srcId, srcId) as Array<{ neighbor_id: string; neighbor_type: string }>;

          for (const n of neighbors) {
            const content = getMemoryContentById(db, n.neighbor_id, n.neighbor_type as MemoryLayer);
            if (content) newAngles.push(content.slice(0, 200));
          }
        }

        if (newAngles.length === 0) {
          // 无新角度，仅增加 incubation_count
          db.prepare('UPDATE inspirations SET incubation_count = incubation_count + 1, updated_at = ? WHERE id = ?')
            .run(now(), insp.id);
          performed++;
          continue;
        }

        // LLM 孵化 — prompt 统一由 prompts.ts 管理
        const result = await llm.chatJson<{
          result: 'deepened' | 'negated' | 'unchanged';
          updated_content?: string;
          updated_hypothesis?: string;
          confidence_delta?: number;
          reason?: string;
        }>({
          messages: inspirationIncubatePrompt(
            insp.title as string,
            insp.content as string,
            insp.hypothesis as string,
            newAngles,
          ),
          tier: 'medium',
          temperature: config.incubation_temperature,
          fallback: { result: 'unchanged' as const },
        });

        const entry: IncubationEntry = {
          round: (insp.incubation_count as number) + 1,
          new_angles: sourceIds.slice(0, 3),
          deepened: result.result === 'deepened',
          summary: result.reason ?? '',
          confidence_delta: result.confidence_delta ?? 0,
          timestamp: now(),
        };

        const existingLog: IncubationEntry[] = JSON.parse((insp.incubation_log as string) || '[]');
        existingLog.push(entry);

        const newCount = (insp.incubation_count as number) + 1;
        const newConfidence = Math.min(1, Math.max(0, (insp.confidence as number) + (result.confidence_delta ?? 0)));

        if (result.result === 'negated') {
          db.prepare(`
            UPDATE inspirations SET status = 'archived', incubation_count = ?, incubation_log = ?, confidence = ?, updated_at = ?
            WHERE id = ?
          `).run(newCount, JSON.stringify(existingLog), newConfidence, now(), insp.id);
        } else {
          let newStatus: InspirationStatus = (insp.status as InspirationStatus);
          if (newStatus === 'spark') newStatus = 'incubating';
          if (newCount >= 2 && newConfidence >= config.mature_confidence) {
            newStatus = 'mature';
            matured++;
          }

          db.prepare(`
            UPDATE inspirations SET
              status = ?, content = ?, hypothesis = ?, confidence = ?,
              incubation_count = ?, incubation_log = ?, updated_at = ?
            WHERE id = ?
          `).run(
            newStatus,
            result.updated_content || insp.content,
            result.updated_hypothesis || insp.hypothesis,
            newConfidence,
            newCount,
            JSON.stringify(existingLog),
            now(),
            insp.id,
          );
        }

        performed++;
      } catch (err) {
        log.warn({ err, id: insp.id }, 'Incubation failed for inspiration');
      }
    }
  } catch (err) {
    log.warn({ err }, 'Incubation step failed');
  }

  log.debug({ performed, matured }, 'Incubation complete');
  return { performed, matured };
}

// ── Step 5: Hypothesize — 生成可行动推论 ──

async function hypothesize(
  candidates: InspirationCandidate[],
  mode: DreamMode,
): Promise<HypothesizedInspiration[]> {
  const llm = getLLM();
  if (!llm.isAvailable || candidates.length === 0) return [];

  try {
    const candidatesText = candidates.map((c, i) =>
      `[${i + 1}] (来源: ${c.origin}) ${c.content}`
    ).join('\n\n');

    const tier = mode === 'weekly' ? 'heavy' : 'medium';

    // prompt 统一由 prompts.ts 管理
    const result = await llm.chatJson<{
      inspirations: Array<{
        index: number;
        title: string;
        content: string;
        hypothesis: string;
        actionability: number;
        confidence: number;
      }>;
    }>({
      messages: inspirationHypothesizePrompt(candidatesText, candidates.length),
      tier,
      temperature: 0.8,
      fallback: { inspirations: [] },
    });

    const hypothesized: HypothesizedInspiration[] = [];
    for (const h of result.inspirations || []) {
      const idx = (h.index ?? 1) - 1;
      if (idx < 0 || idx >= candidates.length) continue;
      if ((h.actionability ?? 0) < 0.4) continue;

      const candidate = candidates[idx];
      hypothesized.push({
        title: h.title || '未命名灵感',
        content: h.content || candidate.content,
        hypothesis: h.hypothesis || '',
        origin: candidate.origin,
        source_memory_ids: candidate.source_memory_ids,
        source_layers: candidate.source_layers,
        source_domains: candidate.source_domains,
        novelty: candidate.novelty,
        actionability: h.actionability ?? 0.5,
        confidence: h.confidence ?? 0.3,
      });
    }

    log.debug({ input: candidates.length, output: hypothesized.length }, 'Hypothesize complete');
    return hypothesized;
  } catch (err) {
    log.warn({ err }, 'Hypothesize step failed');
    return [];
  }
}

// ── Step 6: Evaluate & Persist — 评分、存储、反哺 ──

function evaluateAndPersist(
  hypothesized: HypothesizedInspiration[],
  config: NonNullable<ReturnType<typeof getConfig>['dreaming']['inspiration']>,
  domain?: string,
): { created: number; matured: number } {
  const db = getDb();
  let created = 0;
  let matured = 0;
  const maxSparks = config.max_sparks_per_dream;

  for (const h of hypothesized) {
    if (created >= maxSparks) break;

    // 评分公式
    const score = h.novelty * INSPIRATION_SCORE.WEIGHTS.NOVELTY
      + h.actionability * INSPIRATION_SCORE.WEIGHTS.ACTIONABILITY
      + h.confidence * INSPIRATION_SCORE.WEIGHTS.CONFIDENCE;

    if (score < config.score_threshold) continue;

    const id = generateId();
    const timestamp = now();
    const ttlDays = config.spark_ttl_days;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    try {
      db.prepare(`
        INSERT INTO inspirations (
          id, title, content, hypothesis, origin,
          source_memory_ids, source_layers, source_domains,
          novelty, actionability, confidence, status,
          incubation_count, incubation_log, tags,
          domain, branch, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'spark', 0, '[]', '[]', ?, 'main', ?, ?, ?)
      `).run(
        id, h.title, h.content, h.hypothesis, h.origin,
        JSON.stringify(h.source_memory_ids),
        JSON.stringify(h.source_layers),
        JSON.stringify(h.source_domains),
        h.novelty, h.actionability, h.confidence,
        domain ?? 'default',
        timestamp, timestamp, expiresAt,
      );

      created++;

      // score >= 0.7 → 创建图连接
      if (score >= INSPIRATION_SCORE.GRAPH_LINK_THRESHOLD) {
        for (const srcId of h.source_memory_ids.slice(0, 3)) {
          const srcLayer = h.source_layers[0] ?? 'L1';
          try {
            createLink(srcId, srcLayer, id, 'L3', 'derived_from', score);
          } catch {
            // 忽略重复连接
          }
        }
      }
    } catch (err) {
      log.warn({ err, title: h.title }, 'Failed to persist inspiration');
    }
  }

  // 反哺机制：查询刚成熟的灵感
  try {
    const matureInspirations = db.prepare(`
      SELECT id, content, hypothesis FROM inspirations
      WHERE status = 'mature' AND updated_at >= datetime('now', '-1 hour')
    `).all() as Array<{ id: string; content: string; hypothesis: string }>;

    for (const mi of matureInspirations) {
      enqueueCompile('inspiration', `${mi.content}\n\n建议: ${mi.hypothesis}`, undefined, 7);
      matured++;
    }
  } catch (err) {
    log.warn({ err }, 'Inspiration feedback failed');
  }

  log.debug({ created, matured }, 'Evaluate & persist complete');
  return { created, matured };
}

// ── 保鲜期 GC ──

function expireInspirations(
  config: NonNullable<ReturnType<typeof getConfig>['dreaming']['inspiration']>,
): number {
  const db = getDb();
  let archived = 0;

  try {
    // spark 超过 TTL
    const r1 = db.prepare(`
      UPDATE inspirations SET status = 'archived', updated_at = ?
      WHERE status = 'spark' AND created_at < datetime('now', '-' || ? || ' days')
    `).run(now(), config.spark_ttl_days);
    archived += r1.changes;

    // incubating 超过 TTL
    const r2 = db.prepare(`
      UPDATE inspirations SET status = 'archived', updated_at = ?
      WHERE status = 'incubating' AND updated_at < datetime('now', '-' || ? || ' days')
    `).run(now(), config.incubating_ttl_days);
    archived += r2.changes;

    // mature 超过 TTL
    const r3 = db.prepare(`
      UPDATE inspirations SET status = 'archived', updated_at = ?
      WHERE status = 'mature' AND updated_at < datetime('now', '-' || ? || ' days')
    `).run(now(), config.mature_ttl_days);
    archived += r3.changes;
  } catch (err) {
    log.warn({ err }, 'Inspiration expiration failed');
  }

  if (archived > 0) {
    log.info({ archived }, 'Expired inspirations archived');
  }
  return archived;
}

// ── 工具函数 ──

function getMemoryContentById(db: ReturnType<typeof getDb>, id: string, layer: MemoryLayer): string | null {
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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function emptyResult(start: number): InspirationEngineResult {
  return {
    sparks_generated: 0,
    cross_pollinations: 0,
    habits_detected: 0,
    incubations_performed: 0,
    matured: 0,
    archived_expired: 0,
    duration_ms: Date.now() - start,
  };
}
