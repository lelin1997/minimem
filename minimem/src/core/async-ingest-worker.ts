// ============================================================
// MiniMem — 异步摄入 Worker
// ============================================================
// 后台扫描 processed=0 的记忆，补跑 LLM 处理：
//   质量门控 → 重要性评分 ∥ NER → Embedding → 标记 processed=1

import { getLLM } from '../llm/index.js';
import { getLogger } from '../common/logger.js';
import {
  getPendingExperiences,
  markExperienceProcessed,
} from '../store/experiences.js';
import { addToFts, addConditionIndex } from '../store/indexes.js';
import { initTemperature } from '../lifecycle/index.js';
import { generateId, estimateTokens } from '../common/utils.js';
import { getVectorStore } from '../store/vectors.js';
import { qualityGatePrompt, importanceScoringPrompt, nerPrompt } from '../llm/prompts.js';
import type { Experience } from '../common/types.js';
import { getDb } from '../store/database.js';
import { detectInjection } from './injection-guard.js';

const log = getLogger('core:async-ingest-worker');

const BATCH_SIZE = 5;

async function processPendingExperience(exp: Experience): Promise<void> {
  const llm = getLLM();
  const content = exp.raw_content;
  log.info({ id: exp.id, contentLen: content.length }, 'Async processing pending memory');

  try {
    // Step 0: 注入检测（异步 worker 也需要拦截）
    const injectionResult = await detectInjection(content);
    if (!injectionResult.safe) {
      log.warn({ id: exp.id, reason: injectionResult.reason }, 'Injection guard blocked (async worker)');
      markExperienceProcessed(exp.id); // 标记已处理，不再重试
      return;
    }

    // Step 1: 质量门控
    let passQuality = true;
    if (llm.isAvailable && estimateTokens(content) > 5) {
      try {
        const qualityResult = await llm.chatJson<{ accept: boolean; reason: string }>({
          messages: qualityGatePrompt(content),
          tier: 'light',
          temperature: 0.1,
          fallback: { accept: true, reason: 'LLM fallback' },
        });
        passQuality = qualityResult.accept;
        if (!passQuality) {
          log.info({ id: exp.id, reason: qualityResult.reason }, 'Quality gate rejected (async)');
          markExperienceProcessed(exp.id);
          return;
        }
      } catch (err) {
        log.warn({ err, id: exp.id }, 'Quality gate LLM failed (async), passing');
      }
    }

    // Step 2: 重要性评分 + NER（并行）
    let importance = exp.importance;
    let entities: Array<{ text: string; type: string; condition_key: string }> = [];

    if (llm.isAvailable) {
      const [importanceResult, nerResult] = await Promise.allSettled([
        llm.chatJson<{ importance: number; reason: string }>({
          messages: importanceScoringPrompt(content, exp.context ?? undefined),
          tier: 'light',
          temperature: 0.1,
          fallback: { importance, reason: 'default' },
        }),
        llm.chatJson<{ entities: Array<{ text: string; type: string; condition_key: string }> }>({
          messages: nerPrompt(content),
          tier: 'light',
          temperature: 0.1,
          fallback: { entities: [] },
        }),
      ]);

      if (importanceResult.status === 'fulfilled' && importanceResult.value) {
        importance = Math.max(0, Math.min(1, importanceResult.value.importance));
      }
      if (nerResult.status === 'fulfilled' && nerResult.value) {
        entities = nerResult.value.entities ?? [];
      }
    }

    // Step 3: Embedding
    let embeddingId: string | null = null;
    let cachedEmbedding: number[] | null = null;
    if (llm.isEmbeddingAvailable) {
      try {
        const embResult = await llm.embed(content);
        cachedEmbedding = embResult.embedding;
        embeddingId = generateId();
        const vectorStore = getVectorStore();
        vectorStore.add(embeddingId, exp.id, 'L1', cachedEmbedding, {
          source: exp.source,
          domain: exp.domain,
        });
      } catch (err) {
        log.warn({ err, id: exp.id }, 'Embedding failed in async worker');
      }
    }

    // Step 4: 更新 importance + embedding_id
    getDb().prepare(`
      UPDATE experiences SET importance = ?, embedding_id = ?, updated_at = ?
      WHERE id = ?
    `).run(importance, embeddingId, new Date().toISOString(), exp.id);

    // Step 5: 补充索引
    for (const entity of entities) {
      addConditionIndex(entity.condition_key, 'L1', exp.id);
    }
    addToFts(exp.id, 'L1', content, exp.tags, entities.map(e => e.condition_key));
    initTemperature(exp.id, 'L1', importance);

    // Step 6: 标记完成
    markExperienceProcessed(exp.id);
    log.info({ id: exp.id, importance, entities: entities.length, hasEmbedding: embeddingId !== null }, 'Async ingest done');

  } catch (err) {
    log.error({ err, id: exp.id }, 'Async ingest worker failed');
    markExperienceProcessed(exp.id); // 失败也标记，避免死循环
  }
}

export async function runAsyncIngestWorker(): Promise<void> {
  try {
    const pending = getPendingExperiences(BATCH_SIZE);
    if (pending.length === 0) return;
    log.info({ count: pending.length }, 'Async ingest worker processing');
    for (const exp of pending) {
      await processPendingExperience(exp);
    }
  } catch (err) {
    log.error({ err }, 'Async ingest worker run failed');
  }
}
