// ============================================================
// MiniMem — 加工层（Processing Layer）
// ============================================================
// 职责：L1 → L2 事实提取，条件索引维护，图关系建立

import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import { getUnprocessedExperiences } from '../store/experiences.js';
import { createWorldFactsBatch, findFactsBySubject } from '../store/world-facts.js';
import { addConditionIndex, addToFts } from '../store/indexes.js';
import { createLink } from '../store/graph.js';
import { getVectorStore } from '../store/vectors.js';
import { getLLM } from '../llm/client.js';
import { factExtractionPrompt } from '../llm/prompts.js';
import { initTemperature } from '../lifecycle/index.js';
import { getDb } from '../store/database.js';
import { enqueueEmbeddingBackfill } from './embedding-backfill.js';
import type { WorldFact } from '../common/types.js';

const log = getLogger('core:processing');

export interface ProcessingResult {
  processed_experiences: number;
  extracted_facts: number;
  condition_keys_added: number;
  graph_links_added: number;
}

/**
 * 从 L1 提取事实到 L2（批量处理）
 */
export async function extractFacts(batchSize: number = 10): Promise<ProcessingResult> {
  const llm = getLLM();
  if (!llm.isAvailable) {
    log.warn('LLM not available, skipping fact extraction');
    return { processed_experiences: 0, extracted_facts: 0, condition_keys_added: 0, graph_links_added: 0 };
  }

  // 获取未处理的 L1 经历
  const experiences = getUnprocessedExperiences(batchSize);
  if (experiences.length === 0) {
    log.debug('No unprocessed experiences');
    return { processed_experiences: 0, extracted_facts: 0, condition_keys_added: 0, graph_links_added: 0 };
  }

  log.info({ count: experiences.length }, 'Processing experiences for fact extraction');

  // 调用 LLM 提取事实
  const messages = factExtractionPrompt(
    experiences.map(e => ({ id: e.id, content: e.raw_content }))
  );

  interface ExtractedFact {
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
    valid_from: string | null;
    valid_until: string | null;
    evidence_ids: string[];
    condition_keys: string[];
  }

  // REPAIR-8: 增加 max_tokens 到 8192，避免 20 条经历提取的事实 JSON 过长被截断
  // 导致 robustJsonParse 全部策略失败 → 返回 fallback { facts: [] }
  const result = await llm.chatJson<{ facts: ExtractedFact[] }>({
    messages,
    tier: 'medium',
    temperature: 0.3,
    max_tokens: 8192,
    fallback: { facts: [] },
  });

  if (!result.facts || result.facts.length === 0) {
    log.debug('No facts extracted');
    return { processed_experiences: experiences.length, extracted_facts: 0, condition_keys_added: 0, graph_links_added: 0 };
  }

  // REPAIR-8: 过滤无效事实 — LLM 可能返回 subject/predicate/object 为 null/undefined/空字符串
  // 这些无效数据会导致 SQLite NOT NULL constraint failed
  const validFacts = result.facts.filter(f => {
    if (!f.subject?.trim() || !f.predicate?.trim() || !f.object?.trim()) {
      log.debug({ subject: f.subject, predicate: f.predicate, object: f.object }, 'Invalid fact skipped (missing required field)');
      return false;
    }
    return true;
  });

  if (validFacts.length === 0) {
    log.debug('No valid facts after filtering');
    return { processed_experiences: experiences.length, extracted_facts: 0, condition_keys_added: 0, graph_links_added: 0 };
  }

  log.info({ total: result.facts.length, valid: validFacts.length, filtered: result.facts.length - validFacts.length }, 'Facts validation');

  // 写入 L2
  const factInputs = validFacts.map(f => ({
    subject: f.subject.trim(),
    predicate: f.predicate.trim(),
    object: f.object.trim(),
    confidence: f.confidence ?? 0.7,
    valid_from: f.valid_from,
    valid_until: f.valid_until,
    evidence_experience_ids: f.evidence_ids ?? experiences.map(e => e.id),
    condition_keys: f.condition_keys ?? [],
    source: experiences[0].source,
  }));

  // R-025: 事实去重 — 过滤掉与数据库中已有事实完全重复的条目
  const db = getDb();
  const dedupedFactInputs = factInputs.filter(f => {
    const existing = db.prepare(
      "SELECT 1 FROM world_facts WHERE subject = ? AND predicate = ? AND object = ? AND branch = 'main' LIMIT 1"
    ).get(f.subject, f.predicate, f.object);
    if (existing) {
      log.debug({ subject: f.subject, predicate: f.predicate }, 'Duplicate fact skipped');
      return false;
    }
    return true;
  });

  if (dedupedFactInputs.length === 0) {
    log.debug('All extracted facts are duplicates');
    return { processed_experiences: experiences.length, extracted_facts: 0, condition_keys_added: 0, graph_links_added: 0 };
  }

  const facts = createWorldFactsBatch(dedupedFactInputs);

  // 建立条件索引和图关系
  let conditionKeysAdded = 0;
  let graphLinksAdded = 0;

  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i];
    const extractedFact = result.facts[i];

    // 条件索引
    for (const key of extractedFact.condition_keys ?? []) {
      addConditionIndex(key, 'L2', fact.id);
      conditionKeysAdded++;
    }

    // FTS 索引
    addToFts(fact.id, 'L2', `${fact.subject} ${fact.predicate} ${fact.object}`, [], extractedFact.condition_keys ?? []);

    // R-003: 为 L2 事实生成向量嵌入
    try {
      const factText = `${fact.subject} ${fact.predicate} ${fact.object}`;
      const embResult = await llm.embed(factText);
      const embId = generateId();
      const vectorStore = getVectorStore();
      vectorStore.add(embId, fact.id, 'L2', embResult.embedding, { subject: fact.subject });
      // 初始化温度
      initTemperature(fact.id, 'L2', extractedFact.confidence ?? 0.7);
    } catch {
      log.warn({ factId: fact.id }, 'L2 embedding generation failed, queuing for backfill');
      enqueueEmbeddingBackfill(fact.id, 'L2');
    }

    // 图关系：L1 → L2 (derived_from)
    for (const evidenceId of extractedFact.evidence_ids ?? []) {
      createLink(fact.id, 'L2', evidenceId, 'L1', 'derived_from', 0.9);
      graphLinksAdded++;

      // REQ-013: 记录编译链 L1 → L2（用于反馈传播）
      try {
        db.prepare(
          'INSERT INTO compilation_trace (id, source_id, source_type, target_id, target_type, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(generateId(), evidenceId, 'L1', fact.id, 'L2', now());
      } catch {
        // 非关键路径，失败不阻断
      }
    }

    // 图关系：同主题的 L2 事实之间 (related) — 同批次内
    for (let j = 0; j < i; j++) {
      const otherFact = facts[j];
      if (fact.subject === otherFact.subject || fact.object === otherFact.object) {
        createLink(fact.id, 'L2', otherFact.id, 'L2', 'related', 0.6);
        graphLinksAdded++;
      }
    }

    // R-009: 跨批次 related 链接 — 查询数据库中同 subject 的已有事实
    try {
      const existingFacts = findFactsBySubject(fact.subject);
      for (const existing of existingFacts) {
        // 排除本批次的事实和自身
        if (facts.some(f => f.id === existing.id)) continue;
        createLink(fact.id, 'L2', existing.id, 'L2', 'related', 0.5);
        graphLinksAdded++;
      }
    } catch {
      log.warn({ subject: fact.subject }, 'Cross-batch linking failed');
    }
  }

  log.info({
    experiences: experiences.length,
    facts: facts.length,
    conditionKeys: conditionKeysAdded,
    graphLinks: graphLinksAdded,
  }, 'Fact extraction complete');

  return {
    processed_experiences: experiences.length,
    extracted_facts: facts.length,
    condition_keys_added: conditionKeysAdded,
    graph_links_added: graphLinksAdded,
  };
}

/**
 * 持续处理：处理所有积压的未提炼经历
 */
export async function processAllPending(batchSize: number = 10, maxBatches: number = 10): Promise<ProcessingResult> {
  const totals: ProcessingResult = {
    processed_experiences: 0,
    extracted_facts: 0,
    condition_keys_added: 0,
    graph_links_added: 0,
  };

  for (let i = 0; i < maxBatches; i++) {
    const result = await extractFacts(batchSize);
    totals.processed_experiences += result.processed_experiences;
    totals.extracted_facts += result.extracted_facts;
    totals.condition_keys_added += result.condition_keys_added;
    totals.graph_links_added += result.graph_links_added;

    if (result.processed_experiences === 0) break; // 无更多待处理
  }

  return totals;
}
