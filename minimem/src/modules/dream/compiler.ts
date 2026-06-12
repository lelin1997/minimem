// ============================================================
// MiniMem — Dream Engine: Phase 2 — Karpathy Compile 编译器
// ============================================================

import { getLogger } from '../../common/logger.js';
import { getLLM } from '../../llm/client.js';
import { knowledgePageCompilePrompt } from '../../llm/prompts.js';
import { getPendingCompileItems, markCompiledBatch, markCompiled } from '../../store/knowledge-pages/compile-queue.js';
import {
  createKnowledgePage, updateKnowledgePageContent, updateKnowledgePageMeta,
  getAllKnowledgePages, getKnowledgePageBySlug,
} from '../../store/knowledge-pages/page-store.js';
import { extractFacts } from '../../core/processing.js';
import { distillObservations, promoteToMentalModels } from '../../core/consolidation.js';
import { updateSurfaceFile } from '../../surface/index.js';
import { getDb } from '../../store/database.js';
import { getVectorStore } from '../../store/vectors.js';
import type { SurfaceFileName, MemoryLayer, CompileQueueItem } from '../../common/types.js';
import type { CompileProfile } from './dream-engine.js';

const log = getLogger('dream:compiler');

export interface CompileResult {
  l1_to_l2: number;
  l2_to_l3: number;
  l3_to_l4: number;
  pages_created: number;
  pages_updated: number;
  compile_queue_processed: number;
}

/** 默认编译参数（兼容无参数调用） */
const DEFAULT_COMPILE_PARAMS: CompileProfile = {
  extractFacts: 20,
  distillObservations: 20,
  promoteToMentalModels: 10,
  compileQueue: 30,
};

/**
 * Phase 2: 深度睡眠 — 记忆巩固 + Karpathy Compile
 *
 * @param params - 编译参数（各批次大小），由 DreamProfile 控制
 */
export async function runCompile(params?: CompileProfile): Promise<CompileResult> {
  const p = params ?? DEFAULT_COMPILE_PARAMS;
  log.info({ params: p }, 'Phase 2: Compile started');

  const result: CompileResult = {
    l1_to_l2: 0,
    l2_to_l3: 0,
    l3_to_l4: 0,
    pages_created: 0,
    pages_updated: 0,
    compile_queue_processed: 0,
  };

  // 1. L1→L2 事实提取
  try {
    const extractResult = await extractFacts(p.extractFacts);
    result.l1_to_l2 = extractResult.extracted_facts;
    log.info({ facts: result.l1_to_l2 }, 'L1→L2 extraction done');
  } catch (err) {
    log.warn({ err }, 'L1→L2 extraction failed, continuing');
  }

  // 2. L2→L3 观察提炼
  try {
    result.l2_to_l3 = await distillObservations(p.distillObservations);
    log.info({ observations: result.l2_to_l3 }, 'L2→L3 distillation done');
  } catch (err) {
    log.warn({ err }, 'L2→L3 distillation failed, continuing');
  }

  // 3. L3→L4 心智模型晋升
  if (p.promoteToMentalModels > 0) {
    try {
      result.l3_to_l4 = await promoteToMentalModels(p.promoteToMentalModels);
      log.info({ models: result.l3_to_l4 }, 'L3→L4 promotion done');
    } catch (err) {
      log.warn({ err }, 'L3→L4 promotion failed, continuing');
    }
  } else {
    log.info('L3→L4 promotion skipped (daily mode)');
  }

  // 4. 处理 compile_queue (Karpathy Compile)
  try {
    const compileStats = await processCompileQueue(p.compileQueue);
    result.pages_created = compileStats.created;
    result.pages_updated = compileStats.updated;
    result.compile_queue_processed = compileStats.processed;
    log.info(compileStats, 'Compile queue processed');
  } catch (err) {
    log.warn({ err }, 'Compile queue processing failed, continuing');
  }

  // 5. 维护 index.md
  try {
    await updateKnowledgeIndex();
  } catch (err) {
    log.warn({ err }, 'Index update failed');
  }

  log.info(result, 'Phase 2: Compile complete');
  return result;
}

// ── compile_queue 处理 ──

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

async function processCompileQueue(limit: number = 30): Promise<{ processed: number; created: number; updated: number }> {
  const llm = getLLM();
  if (!llm.isAvailable) {
    log.warn('LLM not available, skipping compile queue');
    return { processed: 0, created: 0, updated: 0 };
  }

  const items = getPendingCompileItems(limit);
  if (items.length === 0) return { processed: 0, created: 0, updated: 0 };

  // T-003.6: 先拆出 embedding_backfill 项单独处理（不走 Knowledge Page 编译流程）
  const backfillItems = items.filter(i => i.source_type === 'embedding_backfill');
  const otherItems = items.filter(i => i.source_type !== 'embedding_backfill');

  if (backfillItems.length > 0) {
    // REPAIR-8: 仅在 embedding 功能实际可用时才处理 backfill，否则标记跳过
    if (llm.isEmbeddingAvailable) {
      await processEmbeddingBackfills(backfillItems);
    } else {
      log.info({ count: backfillItems.length }, 'Embedding disabled, skipping backfill items and marking as skipped');
      for (const item of backfillItems) {
        markCompiled(item.id, 'skipped');
      }
    }
  }

  if (otherItems.length === 0) {
    return { processed: items.length, created: 0, updated: 0 };
  }

  // 提取事实内容用于编译（含来源追踪与相似度路由）
  const rawFacts = otherItems
    .filter(i => i.source_type === 'new_fact' || i.source_type === 'query_insight')
    .map(i => {
      const parts = i.content.split(' — ');
      return {
        subject: parts[0] ?? i.content.slice(0, 50),
        predicate: parts[1] ?? 'relates_to',
        object: parts[2] ?? '',
        sourceId: '',
      };
    });

  // 相似度路由：按语义相似度给出追加/新建/独立的建议
  const existingPages = getAllKnowledgePages();
  const vectorStore2 = getVectorStore();
  const routingHints: string[] = [];
  
  if (llm.isEmbeddingAvailable && vectorStore2.size > 0 && existingPages.length > 0) {
    for (const fact of rawFacts) {
      try {
        const factText = `${fact.subject} ${fact.predicate} ${fact.object}`;
        const embResult = await llm.embed(factText);
        const allPages = getAllKnowledgePages();
        let bestSlug: string | null = null;
        let bestSim = 0;
        for (const page of allPages) {
          const pageText = page.title + ': ' + (page.summary ?? page.content.slice(0, 200));
          const pageEmb = await llm.embed(pageText);
          const sim = cosineSimilarity(embResult.embedding, pageEmb.embedding);
          if (sim > bestSim) {
            bestSim = sim;
            bestSlug = page.slug;
          }
        }
        const hint = bestSim > 0.85
          ? `  → 建议追加到 [[${bestSlug}]] (sim=${bestSim.toFixed(3)})`
          : bestSim > 0.5
            ? `  → 建议新建页面 + link [[${bestSlug}]] (sim=${bestSim.toFixed(3)})`
            : `  → 建议独立页面 (低相似度 ${bestSim.toFixed(3)})`;
        routingHints.push(`- "${fact.subject}": ${hint}`);
        log.debug({ fact: fact.subject, targetSlug: bestSlug, sim: bestSim.toFixed(3) }, 'Similarity routing');
      } catch {
        routingHints.push(`- "${fact.subject}": 相似度路由失败，跳过`);
      }
    }
  }

  // 构建路由上下文传给 LLM
  const routingContext = routingHints.length > 0
    ? `\n\n相似度路由建议（基于语义相似度）：\n${routingHints.join('\n')}`
    : '';

  const facts = rawFacts.map(f => ({ subject: f.subject, predicate: f.predicate, object: f.object }));

  if (facts.length === 0) {
    // 仅标记非事实项为已处理
    markCompiledBatch(otherItems.map(i => i.id), 'compiled');
    return { processed: items.length, created: 0, updated: 0 };
  }

  // 获取已有页面标题
  const existingTitles = existingPages.map(p => p.title);

  // LLM 编译
  const messages = knowledgePageCompilePrompt(facts, existingTitles, routingContext || undefined);

  interface CompileAction {
    action: 'create_page' | 'update_page' | 'create_observation';
    slug?: string;
    title: string;
    page_type?: string;
    content: string;
    summary?: string;
    domain?: string;
    tags?: string[];
    confidence?: number;
  }

  const compileResult = await llm.chatJson<{ actions: CompileAction[] }>({
    messages,
    tier: 'medium',
    temperature: 0.6,
    fallback: { actions: [] },
  });

  let created = 0;
  let updated = 0;

  for (const action of compileResult.actions) {
    try {
      if (action.action === 'create_page' && action.slug) {
        const existing = getKnowledgePageBySlug(action.slug);
        if (existing) {
          // 追加到现有页面
          const merged = `${existing.content}\n\n${action.content}`;
          updateKnowledgePageContent(existing.id, merged);
          // 如果 LLM 返回了新的 summary/domain/tags，更新元数据
          if (action.summary || action.domain || action.tags) {
            updateKnowledgePageMeta(existing.id, {
              summary: action.summary,
              domain: action.domain,
              tags: action.tags,
            });
          }
          updated++;
        } else {
          createKnowledgePage({
            title: action.title,
            slug: action.slug,
            page_type: action.page_type as any ?? 'topic',
            content: action.content,
            summary: action.summary,
            domain: action.domain,
            tags: action.tags,
            confidence: action.confidence,
          });
          created++;
        }
      } else if (action.action === 'update_page' && action.slug) {
        const existing = getKnowledgePageBySlug(action.slug);
        if (existing) {
          const merged = `${existing.content}\n\n${action.content}`;
          updateKnowledgePageContent(existing.id, merged);
          updated++;
        }
      }
    } catch (err) {
      log.warn({ action: action.action, slug: action.slug, err }, 'Failed to execute compile action');
    }
  }

  // 标记为已处理
  markCompiledBatch(otherItems.map(i => i.id), 'compiled');

  return { processed: items.length, created, updated };
}

// ── T-003.6: Embedding Backfill 消费逻辑 ──

/**
 * 处理 embedding_backfill 类型的 compile_queue 条目
 *
 * 从 content JSON 中提取 memory_id + memory_type，
 * 从对应表读取记忆内容，重新生成 embedding 写入向量存储。
 */
async function processEmbeddingBackfills(items: CompileQueueItem[]): Promise<void> {
  const llm = getLLM();
  const vectorStore = getVectorStore();
  const db = getDb();
  let success = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const { memory_id, memory_type } = JSON.parse(item.content) as { memory_id: string; memory_type: MemoryLayer };

      // 根据层级读取记忆内容
      let text: string | null = null;
      switch (memory_type) {
        case 'L1': {
          const row = db.prepare('SELECT raw_content FROM experiences WHERE id = ?').get(memory_id) as { raw_content: string } | undefined;
          text = row?.raw_content ?? null;
          break;
        }
        case 'L2': {
          const row = db.prepare('SELECT subject, predicate, object FROM world_facts WHERE id = ?').get(memory_id) as { subject: string; predicate: string; object: string } | undefined;
          text = row ? `${row.subject} ${row.predicate} ${row.object}` : null;
          break;
        }
        case 'L3': {
          const row = db.prepare('SELECT description FROM observations WHERE id = ?').get(memory_id) as { description: string } | undefined;
          text = row?.description ?? null;
          break;
        }
        case 'L4': {
          const row = db.prepare('SELECT title, description FROM mental_models WHERE id = ?').get(memory_id) as { title: string; description: string } | undefined;
          text = row ? `${row.title}: ${row.description}` : null;
          break;
        }
      }

      if (!text) {
        log.warn({ memory_id, memory_type }, 'Backfill: memory not found, skipping');
        markCompiled(item.id, 'skipped');
        failed++;
        continue;
      }

      // 生成 embedding 并写入向量存储
      const embResult = await llm.embed(text);
      const embeddingId = `emb-${memory_id.slice(0, 12)}`;
      vectorStore.add(embeddingId, memory_id, memory_type, embResult.embedding, {});

      markCompiled(item.id, 'compiled');
      success++;
      log.debug({ memory_id, memory_type }, 'Embedding backfill completed');
    } catch (err) {
      log.warn({ err, itemId: item.id }, 'Embedding backfill failed for item');
      // 不标记为 compiled，下次还会重试
      failed++;
    }
  }

  if (success > 0 || failed > 0) {
    log.info({ success, failed, total: items.length }, 'Embedding backfill batch processed');
  }
}

// ── INDEX (index.md) 知识索引区自动维护 (#115) ──

async function updateKnowledgeIndex(): Promise<void> {
  const pages = getAllKnowledgePages();
  if (pages.length === 0) return;

  // 按类型分组
  const grouped: Record<string, Array<{ slug: string; title: string; confidence: number }>> = {};
  for (const page of pages) {
    const group = page.page_type;
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push({ slug: page.slug, title: page.title, confidence: page.confidence });
  }

  // 生成 index.md 内容
  let indexContent = '# 知识索引\n\n';
  indexContent += `> 共 ${pages.length} 个知识页面，最后更新于 ${new Date().toISOString().slice(0, 10)}\n\n`;

  for (const [type, items] of Object.entries(grouped).sort()) {
    indexContent += `## ${typeLabel(type)} (${items.length})\n\n`;
    for (const item of items.sort((a, b) => b.confidence - a.confidence)) {
      indexContent += `- [[${item.slug}]] — ${item.title} (置信度: ${item.confidence.toFixed(1)})\n`;
    }
    indexContent += '\n';
  }

  updateSurfaceFile('index.md' as SurfaceFileName, indexContent, 'Dream Phase 2: auto-update knowledge index');
  log.debug({ pages: pages.length }, 'Knowledge index updated');
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    person: '👤 人物',
    topic: '📋 主题',
    project: '🔨 项目',
    concept: '💡 概念',
    skill: '🎯 技能',
    place: '📍 地点',
    event_series: '📅 事件',
  };
  return labels[type] ?? type;
}
