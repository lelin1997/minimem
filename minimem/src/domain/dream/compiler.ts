// ============================================================
// MiniMem — Dream Engine: Phase 2 — Knowledge Compile 编译器
// ============================================================

import { getLogger } from '../../common/logger.js';
import { getLLMClient as getLLM } from '../ports/llm-client.js';
import { knowledgePageCompilePrompt } from '../prompts/templates.js';
import { getPendingCompileItems, markCompiledBatch, markCompiled } from '../ports/data-store.js';
import {
  createKnowledgePage, updateKnowledgePageContent, updateKnowledgePageMeta,
  getAllKnowledgePages, getKnowledgePageBySlug,
} from '../ports/data-store.js';
import { extractFacts } from '../../domain/core/processing.js';
import { distillObservations, promoteToMentalModels } from '../../domain/core/consolidation.js';
import { updateSurfaceFile } from '../../domain/surface/index.js';
import { getDb } from '../ports/data-store.js';
import { getVectorStore } from '../ports/vector-store.js';
import { generateId } from '../../common/utils.js';
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
  /** TODO-027: Surface 变更记录 */
  surface_changes?: SurfaceChangeRecord[];
}

/** 默认编译参数（兼容无参数调用） */
const DEFAULT_COMPILE_PARAMS: CompileProfile = {
  extractFacts: 20,
  distillObservations: 20,
  promoteToMentalModels: 10,
  compileQueue: 30,
};

/**
 * Phase 2: 深度睡眠 — 记忆巩固 + Knowledge Compile
 *
 * @param params - 编译参数（各批次大小），由 DreamProfile 控制
 */
export async function runCompile(params?: CompileProfile): Promise<CompileResult> {
  const p = params ?? DEFAULT_COMPILE_PARAMS;
  log.info({ params: p }, 'Phase 2: Compile started');

  // TODO-027: 捕获 compile 开始前的 Surface version，用于后续变更检测
  const surfaceFilesToSync = ['me.md', 'work.md', 'context.md'] as const;
  compileStartVersions = await captureSurfaceVersions(surfaceFilesToSync);

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

  // 4. 处理 compile_queue (Knowledge Compile)
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

  // TODO-025: 6. 后置步骤 — Compile 完成后调 surface_syncer 更新 Surface Files
  // 从最新的 L1-L4 数据同步到 me.md / work.md / context.md
  let surfaceChanges: SurfaceChangeRecord[] = [];
  try {
    const { syncSurfaces } = await import('../../domain/surface/sync.js');
    // 同步核心 Surface 文件（基于本次 compile 影响的层级）
    const queued = await syncSurfaces([...surfaceFilesToSync]);
    log.info({ queued, files: surfaceFilesToSync }, 'TODO-025: Surface sync triggered after compile');

    // TODO-027: 记录哪些 Surface 文件被改了（通过对比 version 变化）
    surfaceChanges = await detectSurfaceChanges(surfaceFilesToSync, compileStartVersions);
  } catch (err) {
    log.warn({ err }, 'TODO-025: Surface sync after compile failed (non-critical)');
  }

  log.info(result, 'Phase 2: Compile complete');
  return { ...result, surface_changes: surfaceChanges };
}

// ── TODO-027: Surface 变更检测 ──

export interface SurfaceChangeRecord {
  file_name: string;
  version_before: number;
  version_after: number;
  changed: boolean;
}

/**
 * 记录 compile 开始前的 Surface version，compile 后对比
 */
let compileStartVersions: Record<string, number> = {};

async function captureSurfaceVersions(files: readonly string[]): Promise<Record<string, number>> {
  const { getSurfaceFile } = await import('../../domain/surface/index.js');
  const versions: Record<string, number> = {};
  for (const f of files) {
    const file = getSurfaceFile(f as any);
    versions[f] = file?.version ?? 0;
  }
  return versions;
}

async function detectSurfaceChanges(
  files: readonly string[],
  before: Record<string, number>,
): Promise<SurfaceChangeRecord[]> {
  const { getSurfaceFile } = await import('../../domain/surface/index.js');
  const changes: SurfaceChangeRecord[] = [];
  for (const f of files) {
    const file = getSurfaceFile(f as any);
    const versionAfter = file?.version ?? 0;
    changes.push({
      file_name: f,
      version_before: before[f] ?? 0,
      version_after: versionAfter,
      changed: versionAfter > (before[f] ?? 0),
    });
  }
  return changes;
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

  // KC0Y: 三路分流 — embedding_backfill / lint_finding / new_fact+inspiration
  const backfillItems = items.filter(i => i.source_type === 'embedding_backfill');
  const lintItems = items.filter(i => i.source_type === 'lint_finding');
  const factItems = items.filter(i => i.source_type === 'new_fact' || i.source_type === 'inspiration');

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

  // KC0Y: lint_finding 走专门修复流程，不再被跳过
  let lintFixed = 0;
  if (lintItems.length > 0) {
    lintFixed = await processLintFindings(lintItems, llm);
  }

  if (factItems.length === 0) {
    return { processed: items.length, created: 0, updated: lintFixed };
  }

  // KC0Z: 只处理 new_fact 和 inspiration，query_insight 已在 KC00 切断
  // KC0Z: 解析失败的条目跳过，不喂给 LLM
  const rawFacts = factItems
    .map(i => {
      const parts = i.content.split(' — ');
      if (parts.length < 2) {
        // KC0Z: 格式不匹配的条目跳过
        log.debug({ content: i.content.slice(0, 80) }, 'KC0Z: skipping malformed fact (no — separator)');
        markCompiled(i.id, 'skipped');
        return null;
      }
      return {
        subject: parts[0] ?? '',
        predicate: parts[1] ?? 'relates_to',
        object: parts.slice(2).join(' — ') ?? '',
        sourceId: '',
        itemId: i.id,
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null && f.subject.length > 0);

  // KC0X: existingPages 和 vectorStore2 在聚类循环外声明，供所有 subject 共享
  const existingPages = getAllKnowledgePages();
  const vectorStore2 = getVectorStore();

  const facts = rawFacts.map(f => ({ subject: f.subject, predicate: f.predicate, object: f.object }));

  if (facts.length === 0) {
    // KC0Z: 格式不匹配的条目已在前面标记 skipped，这里直接返回
    return { processed: items.length, created: 0, updated: lintFixed };
  }

  // KC0X: 按 subject 聚类编译 — 隔离跨项目混杂
  // 同 subject 的事实合并处理，不同 subject 独立 LLM 调用
  const subjectGroups = new Map<string, typeof rawFacts>();
  for (const f of rawFacts) {
    const key = f.subject.trim();
    if (!subjectGroups.has(key)) subjectGroups.set(key, []);
    subjectGroups.get(key)!.push(f);
  }

  log.info({ subjects: subjectGroups.size, totalFacts: rawFacts.length }, 'KC0X: clustering facts by subject');

  // existingPages 和 vectorStore2 已在前面声明（聚类共享）
  const existingTitles = existingPages.map(p => p.title);

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
    evidence_ids?: string[]; // KC01: 证据溯源
  }

  // KC0Z: page_type 白名单 + title 校验
  const ALLOWED_PAGE_TYPES = new Set(['concept', 'topic', 'project', 'skill', 'product']);
  const BANNED_TITLE_WORDS = ['哲学', '本质', '灵魂', '升华', '递进逻辑', '升级路径', '方法论', '认知框架'];
  const isValidTitle = (title: string): boolean => {
    if (!title || title.length < 2) return false;
    if (title.includes('?') || title.includes('？')) return false;
    return !BANNED_TITLE_WORDS.some(w => title.includes(w));
  };

  let created = 0;
  let updated = 0;

  // KC0X: 每个 subject 独立编译
  for (const [subject, groupFacts] of subjectGroups) {
    const groupFactsSimple = groupFacts.map(f => ({ subject: f.subject, predicate: f.predicate, object: f.object }));

    // 相似度路由（仅对当前 subject 的 facts）
    const routingHints: string[] = [];
    if (llm.isEmbeddingAvailable && vectorStore2.size > 0 && existingPages.length > 0) {
      for (const fact of groupFactsSimple) {
        try {
          const factText = `${fact.subject} ${fact.predicate} ${fact.object}`;
          const embResult = await llm.embed(factText);
          let bestSlug: string | null = null;
          let bestSim = 0;
          for (const page of existingPages) {
            const pageText = page.title + ': ' + (page.summary ?? page.content.slice(0, 200));
            const pageEmb = await llm.embed(pageText);
            const sim = cosineSimilarity(embResult.embedding, pageEmb.embedding);
            if (sim > bestSim) { bestSim = sim; bestSlug = page.slug; }
          }
          const hint = bestSim > 0.85
            ? `  → 建议追加到 [[${bestSlug}]] (sim=${bestSim.toFixed(3)})`
            : bestSim > 0.5
              ? `  → 建议新建页面 + link [[${bestSlug}]] (sim=${bestSim.toFixed(3)})`
              : `  → 建议独立页面 (低相似度 ${bestSim.toFixed(3)})`;
          routingHints.push(`- "${fact.subject}": ${hint}`);
        } catch {
          routingHints.push(`- "${fact.subject}": 相似度路由失败，跳过`);
        }
      }
    }
    const routingContext = routingHints.length > 0
      ? `\n\n相似度路由建议（基于语义相似度）：\n${routingHints.join('\n')}`
      : '';

    // LLM 编译（当前 subject 的 facts）
    const messages = knowledgePageCompilePrompt(groupFactsSimple, existingTitles, routingContext || undefined);

    const compileResult = await llm.chatJson<{ actions: CompileAction[] }>({
      messages,
      tier: 'medium',
      temperature: 0.2, // KC0Z: 知识编译要精确不要创意
      fallback: { actions: [] },
    });

  for (const action of compileResult.actions) {
    try {
      // KC0Z: 校验 page_type 和 title
      const pageType = action.page_type ?? 'topic';
      if (!ALLOWED_PAGE_TYPES.has(pageType)) {
        log.warn({ slug: action.slug, pageType }, 'KC0Z: rejected invalid page_type');
        continue;
      }
      if (!isValidTitle(action.title)) {
        log.warn({ title: action.title }, 'KC0Z: rejected philosophical/vague title');
        continue;
      }
      if (action.action === 'create_page' && action.slug) {
        const existing = getKnowledgePageBySlug(action.slug);
        // KC01: 无证据的页面 confidence 降到 0.3 以下
        const hasEvidence = action.evidence_ids && action.evidence_ids.length > 0;
        const finalConfidence = hasEvidence ? (action.confidence ?? 0.5) : Math.min(action.confidence ?? 0.2, 0.3);

        if (existing) {
          // 追加到现有页面
          const merged = `${existing.content}\n\n${action.content}`;
          updateKnowledgePageContent(existing.id, merged);
          if (action.summary || action.domain || action.tags) {
            updateKnowledgePageMeta(existing.id, {
              summary: action.summary,
              domain: action.domain,
              tags: action.tags,
            });
          }
          // KC01: 写入 evidence 表
          if (hasEvidence) {
            writePageEvidence(existing.id, groupFacts, action.evidence_ids!);
          }
          // KC02: 解析 [[backlink]] 写入 links 表
          parseAndSaveBacklinks(existing.id, action.slug, action.content);
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
            confidence: finalConfidence,
          });
          // KC01: 写入 evidence 表
          const newPage = getKnowledgePageBySlug(action.slug);
          if (newPage && hasEvidence) {
            writePageEvidence(newPage.id, groupFacts, action.evidence_ids!);
          }
          // KC02: 解析 [[backlink]] 写入 links 表
          if (newPage) {
            parseAndSaveBacklinks(newPage.id, action.slug, action.content);
          }
          created++;
        }
      } else if (action.action === 'update_page' && action.slug) {
        const existing = getKnowledgePageBySlug(action.slug);
        if (existing) {
          // KC04: 段落级增量编辑
          // 如果 action.content 含有 ## 段落标题，尝试增量合并
          // 否则 fallback 到追加模式
          const merged = incrementalMerge(existing.content, action.content, action.slug);
          updateKnowledgePageContent(existing.id, merged);
          // KC02: 更新链接
          parseAndSaveBacklinks(existing.id, action.slug, merged);
          // KC01: 写入 evidence
          const hasEvidence = action.evidence_ids && action.evidence_ids.length > 0;
          if (hasEvidence) {
            writePageEvidence(existing.id, groupFacts, action.evidence_ids!);
          }
          updated++;
        }
      }
    } catch (err) {
      log.warn({ action: action.action, slug: action.slug, err }, 'Failed to execute compile action');
    }
  } // end of action for loop

  // KC0X: 标记当前 subject 组的 items 为已处理
  markCompiledBatch(groupFacts.map(f => f.itemId), 'compiled');
  } // end of KC0X subject for loop

  return { processed: items.length, created, updated: updated + lintFixed };
}

// ── KC04: 段落级增量合并 ──

/**
 * 增量合并页面内容
 *
 * 借鉴 Roam append 语义：保留已有段落，只更新/添加变化部分
 * 如果新内容以 ## 段落标题开头，按段落合并；否则 fallback 到追加
 */
function incrementalMerge(existingContent: string, newContent: string, slug: string): string {
  // 如果新内容不含 ## 标题，fallback 到追加模式
  if (!newContent.includes('## ')) {
    log.debug({ slug }, 'KC04: no section headers, fallback to append');
    return `${existingContent}\n\n${newContent}`;
  }

  // 解析现有内容为段落 Map（标题 → 内容）
  const existingSections = parseSections(existingContent);
  const newSections = parseSections(newContent);

  // 合并：新段落覆盖同标题的旧段落，新标题追加到末尾
  const merged = new Map(existingSections);
  const addedTitles: string[] = [];
  for (const [title, body] of newSections) {
    if (merged.has(title)) {
      // 更新已有段落
      merged.set(title, body);
      log.debug({ slug, section: title }, 'KC04: updated section');
    } else {
      // 新段落，稍后追加
      addedTitles.push(title);
    }
  }

  // 组装结果：先按原顺序输出更新后的段落，再追加新段落
  const originalOrder = getSectionOrder(existingContent);
  const parts: string[] = [];
  const seen = new Set<string>();

  // 保留 preamble（第一个 ## 之前的内容）
  const firstHeaderIdx = existingContent.indexOf('\n## ');
  if (firstHeaderIdx > 0) {
    parts.push(existingContent.slice(0, firstHeaderIdx).trim());
  } else if (firstHeaderIdx === -1 && existingContent.trim()) {
    parts.push(existingContent.trim());
  }

  // 按原顺序输出段落
  for (const title of originalOrder) {
    if (merged.has(title) && !seen.has(title)) {
      parts.push(`## ${title}\n\n${merged.get(title)}`);
      seen.add(title);
    }
  }

  // 追加新段落
  for (const title of addedTitles) {
    parts.push(`## ${title}\n\n${newSections.get(title)}`);
    log.debug({ slug, section: title }, 'KC04: added section');
  }

  const result = parts.join('\n\n').trim();
  log.info({ slug, originalSections: originalOrder.length, updatedSections: originalOrder.length - addedTitles.length, addedSections: addedTitles.length }, 'KC04: incremental merge done');
  return result;
}

/** 解析 Markdown 为段落 Map（标题 → 正文） */
function parseSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split('\n');
  let currentTitle = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentTitle) {
        sections.set(currentTitle, currentBody.join('\n').trim());
      }
      currentTitle = line.slice(3).trim();
      currentBody = [];
    } else if (currentTitle) {
      currentBody.push(line);
    }
  }
  if (currentTitle) {
    sections.set(currentTitle, currentBody.join('\n').trim());
  }
  return sections;
}

/** 获取段落原始顺序 */
function getSectionOrder(content: string): string[] {
  const order: string[] = [];
  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) {
      order.push(line.slice(3).trim());
    }
  }
  return order;
}

// ── KC01: 证据溯源写入 ──

/**
 * 把 LLM 返回的 evidence_ids 写入 knowledge_page_evidence 表
 *
 * evidence_ids 是 LLM 引用的输入事实序号（1-based），
 * 需要映射回实际的 fact item，再关联到原始 L1 记忆
 */
function writePageEvidence(
  pageId: string,
  facts: Array<{ subject: string; predicate: string; object: string; itemId: string; sourceId: string }>,
  evidenceIds: string[],
): void {
  try {
    const db = getDb();
    // 清除该页面旧的 evidence（避免重复）
    db.prepare('DELETE FROM knowledge_page_evidence WHERE page_id = ?').run(pageId);

    // evidence_ids 可能是 ["1", "2"] 或 [1, 2] 或 ["fact_1"]，统一处理
    for (const eid of evidenceIds) {
      const eidStr = String(eid);
      const idx = parseInt(eidStr.replace(/\D/g, ''), 10) - 1; // 1-based → 0-based
      if (isNaN(idx) || idx < 0 || idx >= facts.length) continue;

      const fact = facts[idx];
      db.prepare(`
        INSERT INTO knowledge_page_evidence (id, page_id, evidence_type, evidence_id, section_hint, created_at)
        VALUES (?, ?, 'l2', ?, ?, datetime('now'))
      `).run(
        generateId(),
        pageId,
        fact.itemId, // compile_queue item id 作为证据引用
        `${fact.subject} — ${fact.predicate} — ${fact.object}`.slice(0, 200),
      );
    }
    log.debug({ pageId, evidenceCount: evidenceIds.length }, 'KC01: evidence written');
  } catch (err) {
    log.warn({ pageId, err }, 'KC01: failed to write evidence');
  }
}

// ── KC02: 双向链接落库 ──

/**
 * 解析页面内容中的 [[slug]] 链接，写入 knowledge_page_links 表
 *
 * 借鉴 Obsidian 思路 1：链接是关系而非装饰
 * 不做悬空检测，目标不存在就跳过
 */
function parseAndSaveBacklinks(pageId: string, slug: string, content: string): void {
  try {
    const db = getDb();
    // 清除该页面旧的出链
    db.prepare('DELETE FROM knowledge_page_links WHERE from_page_id = ?').run(pageId);

    // 正则提取 [[slug]] 或 [[slug|alias]]
    const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(content)) !== null) {
      const targetSlug = match[1].trim();
      if (targetSlug === slug || seen.has(targetSlug)) continue; // 跳过自链接和重复
      seen.add(targetSlug);

      // 查找目标页面
      const target = db.prepare('SELECT id FROM knowledge_pages WHERE slug = ?').get(targetSlug) as { id: string } | undefined;
      if (!target) continue; // KC02: 目标不存在就跳过，不做悬空检测

      db.prepare(`
        INSERT OR IGNORE INTO knowledge_page_links (id, from_page_id, to_page_id, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(generateId(), pageId, target.id);
    }

    if (seen.size > 0) {
      log.debug({ pageId, slug, linkCount: seen.size }, 'KC02: backlinks saved');
    }
  } catch (err) {
    log.warn({ pageId, err }, 'KC02: failed to save backlinks');
  }
}

// ── KC0Y: lint_finding 修复流程 ──

/**
 * 处理 lint_finding 类型的 compile_queue 条目
 *
 * KC0Y 修复死循环：lint_finding 不再被跳过，而是走专门的修复流程：
 * 1. 按 page slug 分组
 * 2. 读页面内容，清除已有的审计标记（避免堆积）
 * 3. 调 LLM 修复问题（删除哲学化段落/补充证据/精简）
 * 4. 更新页面内容 + lint_status
 * 5. 修复失败才保留标记
 */
async function processLintFindings(
  items: CompileQueueItem[],
  llm: ReturnType<typeof getLLM>,
): Promise<number> {
  // 按 target_page 分组
  const byPage = new Map<string, CompileQueueItem[]>();
  for (const item of items) {
    const slug = item.target_page ?? '_unknown';
    if (!byPage.has(slug)) byPage.set(slug, []);
    byPage.get(slug)!.push(item);
  }

  let fixed = 0;
  for (const [slug, pageItems] of byPage) {
    if (slug === '_unknown') {
      markCompiledBatch(pageItems.map(i => i.id), 'skipped');
      continue;
    }

    const page = getKnowledgePageBySlug(slug);
    if (!page) {
      markCompiledBatch(pageItems.map(i => i.id), 'skipped');
      continue;
    }

    // KC0Y: 先清除页面开头的旧审计标记（避免堆积）
    const cleanedContent = page.content.replace(
      /^> ⚠️ 审计标记[^\n]*\n> 待处理[^\n]*\n*/gm,
      ''
    ).trim();

    // 收集本次的 issues
    const issues = pageItems.map(i => i.content).join('\n');

    try {
      const messages: import('../ports/llm-client.js').ChatMessage[] = [
        {
          role: 'system',
          content: `你是严谨的知识编辑器。修复以下知识页面的审计问题。

规则：
1. 直接修复问题，不要写审计标记
2. 删除哲学化/推测性/比喻性段落
3. 保留有技术依据的内容
4. 如果无法修复，返回原文不变
5. 不要添加新内容，只修复或删除

输出修复后的完整 Markdown 内容（不含审计标记）。`,
        },
        {
          role: 'user',
          content: `页面标题: ${page.title}\n\n审计问题:\n${issues}\n\n当前内容（已清除旧标记）:\n${cleanedContent}`,
        },
      ];

      const result = await llm.chat({
        messages,
        tier: 'medium',
        temperature: 0.2, // KC0Z: 修复也要低温度
      });

      const newContent = result.content.trim();
      if (newContent && newContent !== cleanedContent) {
        updateKnowledgePageContent(page.id, newContent);
        // 更新 lint_status 为 healthy
        getDb().prepare('UPDATE knowledge_pages SET lint_status = ? WHERE id = ?').run('healthy', page.id);
        fixed++;
        log.info({ slug, issues: pageItems.length }, 'KC0Y: lint findings fixed');
      } else {
        // LLM 没改动，标记为 needs_review
        getDb().prepare('UPDATE knowledge_pages SET lint_status = ? WHERE id = ?').run('needs_review', page.id);
      }
    } catch (err) {
      log.warn({ slug, err }, 'KC0Y: lint fix failed');
      // 修复失败才保留标记 + lint_status=missing
      getDb().prepare('UPDATE knowledge_pages SET lint_status = ? WHERE id = ?').run('missing', page.id);
    }

    markCompiledBatch(pageItems.map(i => i.id), 'compiled');
  }

  return fixed;
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
          // fix: mental_models 表字段是 content 不是 description (pre-existing bug)
          const row = db.prepare('SELECT title, content FROM mental_models WHERE id = ?').get(memory_id) as { title: string; content: string } | undefined;
          text = row ? `${row.title}: ${row.content}` : null;
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
