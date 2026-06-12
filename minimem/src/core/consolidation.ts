// ============================================================
// MiniMem — 巩固层（L2→L3 提炼 + L3→L4 晋升 + 冲突检测）
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now, sanitizeUserContent } from '../common/utils.js';
import { getLLM } from '../llm/client.js';
import { getVectorStore } from '../store/vectors.js';
import { initTemperature } from '../lifecycle/index.js';
import { addToFts } from '../store/indexes.js';
import { enqueueEmbeddingBackfill } from './embedding-backfill.js';
import { observationWithL4Prompt, l4ConsistencyCheckPrompt, observationSimplePrompt, mentalModelPromotionPrompt } from '../llm/prompts.js';
import type { WorldFact, Observation, MentalModel, ObservationType, ModelType } from '../common/types.js';

import { getConfig } from '../config/index.js';

const log = getLogger('core:consolidation');

/** sanitize 简便函数 */
function san(text: string): string {
  return sanitizeUserContent(text).sanitized;
}

// ═══════════════ L2→L3 观察提炼 ═══════════════

export interface ConsolidationResult {
  observations_created: number;
  models_created: number;
  conflicts_detected: number;
  duration_ms: number;
}

/**
 * 从 L2 事实中提炼 L3 观察
 * 
 * 策略：
 * 1. 找到同一 subject 下有多条事实的实体
 * 2. 用 LLM 分析这些事实，提取 pattern/preference/habit
 * 3. 写入 observations 表
 */
export async function distillObservations(limit: number = 20): Promise<number> {
  const db = getDb();
  const llm = getLLM();

  // REQ-002: 可配置化晋升门槛
  const cfg = getConfig();
  const minFacts = cfg.dreaming.consolidation?.l2_to_l3_min_facts ?? 3;

  // 找到有足够事实支撑的 subject
  const subjects = db.prepare(`
    SELECT subject, COUNT(*) as fact_count
    FROM world_facts
    WHERE branch = 'main' AND confidence >= 0.5
    GROUP BY subject
    HAVING COUNT(*) >= ?
    ORDER BY COUNT(*) DESC
    LIMIT ?
  `).all(minFacts, limit) as Array<{ subject: string; fact_count: number }>;

  let created = 0;

  for (const { subject, fact_count } of subjects) {
    // 检查是否已有这个 subject 的观察
    const existingObs = db.prepare(
      "SELECT 1 FROM observations WHERE branch = 'main' AND description LIKE ? LIMIT 1"
    ).get(`%${subject}%`);

    if (existingObs) continue; // 已有观察，跳过

    // 获取这个 subject 的所有事实
    const facts = db.prepare(
      "SELECT * FROM world_facts WHERE subject = ? AND branch = 'main' AND confidence >= 0.5 ORDER BY created_at DESC LIMIT 10"
    ).all(subject) as Array<Record<string, unknown>>;

    try {
      const factsText = facts.map(f => `- ${san(String(f.subject))} ${san(String(f.predicate))} ${san(String(f.object))} (置信度: ${f.confidence})`).join('\n');
      const factIds = facts.map(f => f.id as string);

      // MINIMEM-003 E12: 搜索相关 L4 心智模型，注入编译上下文（自顶向下）
      const topDownEnabled = cfg.dreaming?.top_down_compile !== false; // 默认开启
      let relatedL4: Array<{ id: string; title: string; content: string; model_type: string }> = [];

      if (topDownEnabled) {
        try {
          const subjectEmb = await llm.embed(subject);
          const store = getVectorStore();
          const l4Candidates = store.search(subjectEmb.embedding, 5, 0.3);
          const resolvedL4 = Array.isArray(l4Candidates) ? l4Candidates : await l4Candidates;

          for (const match of resolvedL4) {
            if (match.memoryType !== 'L4') continue;
            const model = db.prepare(
              'SELECT id, title, content, model_type FROM mental_models WHERE id = ? AND is_active = 1'
            ).get(match.memoryId) as { id: string; title: string; content: string; model_type: string } | undefined;
            if (model) relatedL4.push(model);
            if (relatedL4.length >= 3) break; // Top-3
          }
        } catch (l4Err) {
          log.debug({ subject, err: l4Err }, 'L4 context fetch failed (non-critical), proceeding without top-down');
        }
      }

      // 使用 L4 增强的 prompt（如果有相关 L4）或原有 prompt
      const result = relatedL4.length > 0
        ? await llm.chatJson<{
            description: string;
            type: ObservationType;
            confidence: number;
            contradicts_l4?: boolean;
            related_l4_titles?: string[];
          }>({
            messages: observationWithL4Prompt(subject, factsText, relatedL4),
            tier: 'light',
            temperature: 0.3,
            fallback: { description: '', type: 'pattern' as ObservationType, confidence: 0 },
          })
        // prompt 统一由 prompts.ts 管理（无 L4 上下文版本）
        : await llm.chatJson<{
            description: string;
            type: ObservationType;
            confidence: number;
          }>({
            messages: observationSimplePrompt(subject, factsText),
            tier: 'light',
            temperature: 0.3,
            fallback: { description: '', type: 'pattern' as ObservationType, confidence: 0 },
          });

      if (result && result.description) {
        // MINIMEM-003 T-E05.1: 语义去重 — 检查已有 L3 观察是否有语义重复
        const dedupThreshold = cfg.dreaming?.consolidation?.l2_to_l3_dedup_similarity ?? 0.85;
        let merged = false;

        try {
          const embResult = await llm.embed(result.description);
          const store = getVectorStore();

          // 搜索已有 L3 观察中的近似结果
          const similar = store.search(embResult.embedding, 5, dedupThreshold);
          const resolvedSimilar = Array.isArray(similar) ? similar : await similar;

          for (const match of resolvedSimilar) {
            if (match.memoryType !== 'L3') continue;

            // 找到高度相似的已有观察 → 合并而非新建
            const existingObs = db.prepare(
              'SELECT id, supporting_fact_ids, confidence, confidence_history FROM observations WHERE id = ?'
            ).get(match.memoryId) as { id: string; supporting_fact_ids: string; confidence: number; confidence_history: string } | undefined;

            if (!existingObs) continue;

            // 合并策略：追加 supporting_fact_ids + 提升 confidence
            const existingFactIds: string[] = JSON.parse(existingObs.supporting_fact_ids || '[]');
            const mergedFactIds = [...new Set([...existingFactIds, ...factIds])];
            const newConfidence = Math.min(1, existingObs.confidence + 0.05); // 微增置信度
            const timestamp = now();
            const history: Array<{ date: string; value: number }> = JSON.parse(existingObs.confidence_history || '[]');
            history.push({ date: timestamp, value: newConfidence });

            db.prepare(`
              UPDATE observations
              SET supporting_fact_ids = ?, confidence = ?, confidence_history = ?, updated_at = ?
              WHERE id = ?
            `).run(
              JSON.stringify(mergedFactIds),
              newConfidence,
              JSON.stringify(history),
              timestamp,
              existingObs.id,
            );

            log.debug({ existingId: existingObs.id, similarity: match.similarity, addedFacts: factIds.length },
              'L3 observation merged with existing (semantic dedup)');
            merged = true;
            break;
          }

          if (!merged) {
            // 无重复，正常创建新观察
            const id = generateId();
            const timestamp = now();

            db.prepare(`
              INSERT INTO observations (id, description, observation_type, supporting_fact_ids, contradicting_fact_ids, confidence, confidence_history, tags, branch, created_at, updated_at)
              VALUES (?, ?, ?, ?, '[]', ?, ?, ?, 'main', ?, ?)
            `).run(
              id,
              result.description,
              result.type || 'pattern',
              JSON.stringify(factIds),
              result.confidence || 0.6,
              JSON.stringify([{ date: timestamp, value: result.confidence || 0.6 }]),
              JSON.stringify([subject]),
              timestamp, timestamp,
            );

            // REQ-013: 记录编译链 L2 → L3（用于反馈传播）
            for (const factId of factIds) {
              try {
                db.prepare(
                  'INSERT INTO compilation_trace (id, source_id, source_type, target_id, target_type, created_at) VALUES (?, ?, ?, ?, ?, ?)'
                ).run(generateId(), factId, 'L2', id, 'L3', timestamp);
              } catch {
                // 非关键路径，失败不阻断
              }
            }

            // 向量已经在去重搜索时生成，直接复用
            const embId = generateId();
            store.add(embId, id, 'L3', embResult.embedding, { subject });
            initTemperature(id, 'L3', result.confidence || 0.6);
            addToFts(id, 'L3', result.description, [subject], []);

            // MINIMEM-003 E12+E13: L4→L3 自顶向下一致性校验
            if (topDownEnabled) {
              try {
                await checkL4Consistency(id, result.description, result.type || 'pattern', embResult.embedding);
              } catch (tdErr) {
                log.debug({ id, err: tdErr }, 'Top-down consistency check failed (non-critical)');
              }
            }

            // E12: 如果 LLM 明确标记了与 L4 矛盾，创建 conflict_resolution 条目
            if ('contradicts_l4' in result && result.contradicts_l4) {
              try {
                const relatedTitles = ('related_l4_titles' in result && Array.isArray(result.related_l4_titles))
                  ? result.related_l4_titles.join(', ')
                  : 'unknown';
                db.prepare(`
                  INSERT INTO compile_queue (id, source_type, content, target_page, priority, status, created_at)
                  VALUES (?, 'conflict_resolution', ?, NULL, 8, 'pending', ?)
                `).run(
                  generateId(),
                  `L3 观察 "${result.description}" 与 L4 原则 [${relatedTitles}] 存在矛盾`,
                  now(),
                );
                log.info({ id, relatedTitles }, 'L4 contradiction detected during L2→L3 compilation, queued for resolution');
              } catch {
                // 非关键路径
              }
            }

            created++;
            log.debug({ id, subject, type: result.type }, 'Observation distilled from L2 facts');
          }
        } catch (embErr) {
          // embedding 失败时走原逻辑（无去重）
          log.warn({ subject, err: embErr }, 'L3 dedup embedding failed, creating without dedup');

          const id = generateId();
          const timestamp = now();

          db.prepare(`
            INSERT INTO observations (id, description, observation_type, supporting_fact_ids, contradicting_fact_ids, confidence, confidence_history, tags, branch, created_at, updated_at)
            VALUES (?, ?, ?, ?, '[]', ?, ?, ?, 'main', ?, ?)
          `).run(
            id,
            result.description,
            result.type || 'pattern',
            JSON.stringify(factIds),
            result.confidence || 0.6,
            JSON.stringify([{ date: now(), value: result.confidence || 0.6 }]),
            JSON.stringify([subject]),
            timestamp, timestamp,
          );

          // REQ-013: 记录编译链
          for (const factId of factIds) {
            try {
              db.prepare(
                'INSERT INTO compilation_trace (id, source_id, source_type, target_id, target_type, created_at) VALUES (?, ?, ?, ?, ?, ?)'
              ).run(generateId(), factId, 'L2', id, 'L3', timestamp);
            } catch {
              // 非关键路径
            }
          }

          try {
            const embResult2 = await llm.embed(result.description);
            const embId = generateId();
            getVectorStore().add(embId, id, 'L3', embResult2.embedding, { subject });
            initTemperature(id, 'L3', result.confidence || 0.6);
            addToFts(id, 'L3', result.description, [subject], []);
          } catch {
            log.warn({ id }, 'L3 embedding generation failed, queuing for backfill');
            enqueueEmbeddingBackfill(id, 'L3');
          }

          created++;
        }
      }
    } catch (err) {
      log.warn({ subject, err }, 'Failed to distill observation');
    }
  }

  log.info({ created, subjectsAnalyzed: subjects.length }, 'L2→L3 distillation complete');
  return created;
}

// ═══════════════ L3→L4 心智模型晋升 ═══════════════

/**
 * 从 L3 观察中晋升 L4 心智模型
 * 
 * 策略：
 * 1. 找到高置信度的相关观察聚类
 * 2. 用 LLM 归纳为心智模型（principle/rule/belief）
 */
export async function promoteToMentalModels(limit: number = 10): Promise<number> {
  const db = getDb();
  const llm = getLLM();

  // REQ-002: 可配置化晋升门槛
  const minConfidence = getConfig().dreaming.consolidation?.l3_to_l4_min_confidence ?? 0.7;
  const minObservations = getConfig().dreaming.consolidation?.l3_to_l4_min_observations ?? 2;

  // 找到高置信度观察
  const observations = db.prepare(`
    SELECT * FROM observations
    WHERE branch = 'main' AND confidence >= ?
    ORDER BY confidence DESC
    LIMIT ?
  `).all(minConfidence, limit) as Array<Record<string, unknown>>;

  if (observations.length < minObservations) {
    log.debug('Not enough high-confidence observations for L4 promotion');
    return 0;
  }

  try {
    const obsText = observations.map(o =>
      `- [${o.observation_type}] ${san(String(o.description))} (置信度: ${o.confidence})`
    ).join('\n');

    // prompt 统一由 prompts.ts 管理
    const result = await llm.chatJson<{
      title: string;
      content: string;
      type: ModelType;
      scope: string;
      priority: number;
    } | null>({
      messages: mentalModelPromotionPrompt(obsText),
      tier: 'medium',
      temperature: 0.3,
      fallback: null,
    });

    if (result && result.title) {
      // 检查是否已有类似模型（精确标题匹配）
      const existing = db.prepare(
        "SELECT 1 FROM mental_models WHERE branch = 'main' AND title = ?"
      ).get(result.title);

      if (existing) {
        log.debug({ title: result.title }, 'Similar mental model already exists (exact title match)');
        return 0;
      }

      // MINIMEM-003 T-E05.2: 语义去重 — 搜索已有 L4 模型
      const l4DedupThreshold = getConfig().dreaming?.consolidation?.l3_to_l4_dedup_similarity ?? 0.90;
      const embText = `${result.title}: ${result.content}`;

      try {
        const embResult = await llm.embed(embText);
        const store = getVectorStore();
        const similar = store.search(embResult.embedding, 3, l4DedupThreshold);
        const resolvedSimilar = Array.isArray(similar) ? similar : await similar;

        for (const match of resolvedSimilar) {
          if (match.memoryType !== 'L4') continue;

          // 找到高度相似的已有 L4 → 增强而非新建
          const existingModel = db.prepare(
            'SELECT id, title, content, priority FROM mental_models WHERE id = ? AND is_active = 1'
          ).get(match.memoryId) as { id: string; title: string; content: string; priority: number } | undefined;

          if (!existingModel) continue;

          // 增强策略：追加新证据到 content，提升 priority
          const enhancedContent = `${existingModel.content}\n\n---\n补充证据 (${now()}):\n${result.content}`;
          const newPriority = Math.min(10, existingModel.priority + 1);

          db.prepare(`
            UPDATE mental_models SET content = ?, priority = ?, updated_at = ? WHERE id = ?
          `).run(enhancedContent, newPriority, now(), existingModel.id);

          // 记录编译链
          for (const obs of observations) {
            try {
              db.prepare(
                'INSERT INTO compilation_trace (id, source_id, source_type, target_id, target_type, created_at) VALUES (?, ?, ?, ?, ?, ?)'
              ).run(generateId(), obs.id as string, 'L3', existingModel.id, 'L4', now());
            } catch {
              // 非关键路径
            }
          }

          log.info({ existingId: existingModel.id, similarity: match.similarity },
            'L4 mental model enhanced with new evidence (semantic dedup)');
          return 0; // 计为合并，不计新建
        }

        // 无重复，正常创建新模型
        const id = generateId();
        const timestamp = now();

        db.prepare(`
          INSERT INTO mental_models (id, title, content, model_type, priority, scope, origin, is_active, branch, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'main', ?, ?)
        `).run(
          id,
          result.title,
          result.content,
          result.type || 'principle',
          result.priority || 5,
          result.scope || 'global',
          `Consolidated from ${observations.length} observations`,
          timestamp, timestamp,
        );

        log.info({ id, title: result.title, type: result.type }, 'Mental model promoted from L3');

        // REQ-013: 记录编译链 L3 → L4
        for (const obs of observations) {
          try {
            db.prepare(
              'INSERT INTO compilation_trace (id, source_id, source_type, target_id, target_type, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(generateId(), obs.id as string, 'L3', id, 'L4', timestamp);
          } catch {
            // 非关键路径
          }
        }

        // 向量已经生成，直接复用
        const embId = generateId();
        store.add(embId, id, 'L4', embResult.embedding, { scope: result.scope || 'global' });
        initTemperature(id, 'L4', 0.8);
        addToFts(id, 'L4', embText, [], []);

        return 1;
      } catch (embErr) {
        // embedding 失败时走原逻辑（无去重）
        log.warn({ err: embErr }, 'L4 dedup embedding failed, creating without dedup');

        const id = generateId();
        const timestamp = now();

        db.prepare(`
          INSERT INTO mental_models (id, title, content, model_type, priority, scope, origin, is_active, branch, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'main', ?, ?)
        `).run(
          id,
          result.title,
          result.content,
          result.type || 'principle',
          result.priority || 5,
          result.scope || 'global',
          `Consolidated from ${observations.length} observations`,
          timestamp, timestamp,
        );

        log.info({ id, title: result.title, type: result.type }, 'Mental model promoted from L3 (no dedup)');

        for (const obs of observations) {
          try {
            db.prepare(
              'INSERT INTO compilation_trace (id, source_id, source_type, target_id, target_type, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(generateId(), obs.id as string, 'L3', id, 'L4', timestamp);
          } catch {
            // 非关键路径
          }
        }

        try {
          const embResult2 = await llm.embed(embText);
          const embId = generateId();
          getVectorStore().add(embId, id, 'L4', embResult2.embedding, { scope: result.scope || 'global' });
          initTemperature(id, 'L4', 0.8);
          addToFts(id, 'L4', embText, [], []);
        } catch {
          log.warn({ id }, 'L4 embedding generation failed, queuing for backfill');
          enqueueEmbeddingBackfill(id, 'L4');
        }

        return 1;
      }
    }
  } catch (err) {
    log.warn({ err }, 'Failed to promote to mental model');
  }

  return 0;
}

// ═══════════════ 冲突检测 ═══════════════

export interface ConflictReport {
  type: 'fact_contradiction' | 'page_outdated' | 'observation_conflict';
  memory_ids: string[];
  description: string;
  suggested_resolution: string;
}

/**
 * 检测知识冲突
 * 
 * 检查：
 * 1. 同 subject+predicate 但不同 object 的 L2 事实
 * 2. 页面内容与最新事实矛盾
 * 3. 观察间的互相矛盾
 */
export function detectConflicts(): ConflictReport[] {
  const db = getDb();
  const conflicts: ConflictReport[] = [];

  // 1. 检测同主谓不同宾的事实冲突
  const factConflicts = db.prepare(`
    SELECT a.id as id_a, b.id as id_b, a.subject, a.predicate, a.object as obj_a, b.object as obj_b
    FROM world_facts a
    JOIN world_facts b ON a.subject = b.subject AND a.predicate = b.predicate AND a.id < b.id
    WHERE a.branch = 'main' AND b.branch = 'main'
      AND a.object != b.object
      AND a.confidence >= 0.4 AND b.confidence >= 0.4
  `).all() as Array<{
    id_a: string; id_b: string; subject: string; predicate: string; obj_a: string; obj_b: string;
  }>;

  for (const c of factConflicts) {
    conflicts.push({
      type: 'fact_contradiction',
      memory_ids: [c.id_a, c.id_b],
      description: `"${c.subject} ${c.predicate}" 有两个不同值: "${c.obj_a}" vs "${c.obj_b}"`,
      suggested_resolution: '保留较新/置信度更高的事实，降低另一个的置信度',
    });
  }

  // 2. 检测 stale 或 conflicted 的知识页面
  const stalePages = db.prepare(`
    SELECT id, slug, title, lint_status, staleness_score
    FROM knowledge_pages
    WHERE branch = 'main' AND (lint_status = 'conflicted' OR staleness_score > 0.7)
  `).all() as Array<{
    id: string; slug: string; title: string; lint_status: string; staleness_score: number;
  }>;

  for (const p of stalePages) {
    conflicts.push({
      type: 'page_outdated',
      memory_ids: [p.id],
      description: `知识页面 "${p.title}" (${p.slug}) 状态异常: ${p.lint_status}, staleness=${p.staleness_score}`,
      suggested_resolution: '重新编译此知识页面以更新内容',
    });
  }

  log.info({ total: conflicts.length, facts: factConflicts.length, pages: stalePages.length }, 'Conflict detection complete');
  return conflicts;
}

// ═══════════════ 完整巩固流程 ═══════════════

/**
 * 运行完整的巩固流程
 */
export async function runConsolidation(): Promise<ConsolidationResult> {
  const start = Date.now();

  const obsCreated = await distillObservations();
  const modelsCreated = await promoteToMentalModels();
  const conflicts = detectConflicts();

  // REQ-010: 冲突自动解决
  let conflictsResolved = 0;
  if (conflicts.length > 0) {
    try {
      const { resolveConflicts } = await import('./correction.js');
      conflictsResolved = await resolveConflicts(conflicts);
    } catch (err) {
      log.warn({ err }, 'Conflict resolution failed (non-critical)');
    }
  }

  const result: ConsolidationResult = {
    observations_created: obsCreated,
    models_created: modelsCreated,
    conflicts_detected: conflicts.length,
    duration_ms: Date.now() - start,
  };

  log.info({ ...result, conflictsResolved }, 'Consolidation pipeline complete');
  return result;
}

// ═══════════════ MINIMEM-003 E13: L4→L3 一致性校验 ═══════════════

/**
 * 新 L3 观察写入后，搜索相关 L4 心智模型，检查一致性。
 * 如果发现矛盾，创建 compile_queue 条目并标记 L3 的 contradicting_fact_ids。
 *
 * 此函数为异步非阻塞，失败不影响主流程。
 */
async function checkL4Consistency(
  observationId: string,
  description: string,
  observationType: string,
  embedding: number[],
): Promise<void> {
  const db = getDb();
  const llm = getLLM();
  const store = getVectorStore();

  // 搜索 Top-3 相关 L4 心智模型
  const l4Candidates = store.search(embedding, 5, 0.4);
  const resolvedL4 = Array.isArray(l4Candidates) ? l4Candidates : await l4Candidates;

  const relatedL4: Array<{ id: string; title: string; content: string }> = [];
  for (const match of resolvedL4) {
    if (match.memoryType !== 'L4') continue;
    const model = db.prepare(
      'SELECT id, title, content FROM mental_models WHERE id = ? AND is_active = 1'
    ).get(match.memoryId) as { id: string; title: string; content: string } | undefined;
    if (model) relatedL4.push(model);
    if (relatedL4.length >= 3) break;
  }

  if (relatedL4.length === 0) return; // 无相关 L4，跳过

  // 调用 LLM 轻量判断
  const checkResult = await llm.chatJson<{
    has_contradiction: boolean;
    contradicted_l4_ids: string[];
    contradiction_type: 'direct' | 'partial' | 'none';
    explanation: string;
  }>({
    messages: l4ConsistencyCheckPrompt(
      { description, observation_type: observationType },
      relatedL4,
    ),
    tier: 'light',
    temperature: 0.1,
    fallback: { has_contradiction: false, contradicted_l4_ids: [], contradiction_type: 'none' as const, explanation: '' },
  });

  if (checkResult.has_contradiction && checkResult.contradicted_l4_ids.length > 0) {
    // 标记 L3 的 contradicting_fact_ids 包含 L4 ID
    db.prepare(`
      UPDATE observations
      SET contradicting_fact_ids = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(checkResult.contradicted_l4_ids),
      now(),
      observationId,
    );

    // 创建 compile_queue 条目
    db.prepare(`
      INSERT INTO compile_queue (id, source_type, content, target_page, priority, status, created_at)
      VALUES (?, 'conflict_resolution', ?, NULL, 8, 'pending', ?)
    `).run(
      generateId(),
      `L3(${observationId}) "${description}" 与 L4 [${checkResult.contradicted_l4_ids.join(',')}] ${checkResult.contradiction_type} 矛盾: ${checkResult.explanation}`,
      now(),
    );

    log.info({
      observationId,
      contradictedL4: checkResult.contradicted_l4_ids,
      type: checkResult.contradiction_type,
    }, 'L4→L3 consistency check: contradiction detected');
  }
}
