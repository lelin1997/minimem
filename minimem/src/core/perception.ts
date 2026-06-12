// ============================================================
// MiniMem — 感知层（Perception Layer）
// ============================================================
// 职责：接收外部输入 → 清洗 → NER → 重要性评分 → PII检测 → 质量门控 → 写入 L1

import { getLogger } from '../common/logger.js';
import { generateId, hashContent, estimateTokens } from '../common/utils.js';
import { ValidationError } from '../common/errors.js';
import { createExperience, experienceExistsByHash } from '../store/experiences.js';
import { addConditionIndex, addToFts } from '../store/indexes.js';
import { getVectorStore } from '../store/vectors.js';
import { getLLM } from '../llm/client.js';
import { importanceScoringPrompt, qualityGatePrompt, nerPrompt, l1ImportanceBoostPrompt } from '../llm/prompts.js';
import { initTemperature } from '../lifecycle/index.js';
import { incrementMemoryCount } from '../scheduler/index.js';
import { enqueueEmbeddingBackfill } from './embedding-backfill.js';
import { getConfig } from '../config/index.js';
import type { Experience, ContentType, MemorySource } from '../common/types.js';

const log = getLogger('core:perception');

// ── PII 正则模式 ──

const PII_PATTERNS = [
  { name: 'credit_card', pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  { name: 'phone_cn', pattern: /\b1[3-9]\d{9}\b/g },
  { name: 'phone_intl', pattern: /\+\d{1,3}[\s-]?\d{4,14}\b/g },
  { name: 'id_card_cn', pattern: /\b\d{17}[\dXx]\b/g },
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
  { name: 'api_key', pattern: /\b(sk-|ak-|key-|token-|AKIA)[A-Za-z0-9]{16,}\b/g },
  { name: 'password', pattern: /(?:password|passwd|pwd|密码)\s*[:=]\s*\S+/gi },
  // R-016: 扩展 PII 模式
  { name: 'ssn_us', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'passport_cn', pattern: /\b[EeGg]\d{8}\b/g },
  { name: 'bank_account_cn', pattern: /\b\d{16,19}\b/g },
  { name: 'ip_address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: 'jwt_token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'private_key', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g },
];

export interface IngestInput {
  content: string;
  source: MemorySource;
  content_type?: ContentType;
  importance?: number;
  tags?: string[];
  participants?: string[];
  context?: string;
  domain?: string; // MINIMEM-001: 领域隔离
  // MINIMEM-005: 多模态感知扩展
  url?: string;
  image_url?: string;
  file_path?: string;
}

export interface IngestResult {
  experience: Experience;
  entities: Array<{ text: string; type: string; condition_key: string }>;
  pii_detected: string[];
  importance: number;
}

/**
 * 感知层主入口：接收并处理一条记忆
 */
export async function ingestMemory(input: IngestInput): Promise<IngestResult> {
  log.info({ source: input.source, contentLen: input.content.length, domain: input.domain }, 'Ingesting memory');

  // 1. 基本验证
  if (!input.content || input.content.trim().length === 0) {
    throw new ValidationError('Content cannot be empty');
  }

  if (input.content.length > 100_000) {
    throw new ValidationError('Content too long (max 100KB)');
  }

  // MINIMEM-001: 领域判定（三级优先级链）
  const domain = resolveDomain(input);

  // 2. 文本清洗
  let content = cleanText(input.content);

  // 3. 内容去重（hash）
  const contentHash = await hashContent(`${input.source}:${content}`);
  if (experienceExistsByHash(contentHash)) {
    log.debug({ hash: contentHash }, 'Duplicate content, skipping');
    throw new ValidationError('Duplicate content already exists');
  }

  // 4. PII 检测
  const piiResult = detectPII(content);
  if (piiResult.detected.length > 0) {
    content = piiResult.masked;
    log.info({ pii: piiResult.detected }, 'PII detected and masked');
  }

  // 5. 质量门控（LLM 或规则）
  const llm = getLLM();
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
        log.debug({ reason: qualityResult.reason }, 'Quality gate rejected');
        throw new ValidationError(`Quality gate rejected: ${qualityResult.reason}`);
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      // LLM 失败时降级放行
      log.warn({ err }, 'Quality gate LLM failed, passing by default');
    }
  }

  // 6. 重要性评分 + 7. NER 实体识别（R-008: 并行执行，无数据依赖）
  let importance = input.importance ?? 0.5;
  let entities: Array<{ text: string; type: string; condition_key: string }> = [];

  if (llm.isAvailable) {
    const [importanceResult, nerResult] = await Promise.allSettled([
      // 重要性评分
      input.importance === undefined
        ? llm.chatJson<{ importance: number; reason: string }>({
            messages: importanceScoringPrompt(content, input.context),
            tier: 'light',
            temperature: 0.1,
            fallback: { importance: 0.5, reason: 'default' },
          })
        : Promise.resolve(null),
      // NER 实体识别
      llm.chatJson<{ entities: Array<{ text: string; type: string; condition_key: string }> }>({
        messages: nerPrompt(content),
        tier: 'light',
        temperature: 0.1,
        fallback: { entities: [] },
      }),
    ]);

    if (importanceResult.status === 'fulfilled' && importanceResult.value) {
      importance = Math.max(0, Math.min(1, importanceResult.value.importance));
    } else if (importanceResult.status === 'rejected') {
      log.warn('Importance scoring failed, using default');
    }

    if (nerResult.status === 'fulfilled' && nerResult.value) {
      entities = nerResult.value.entities ?? [];
    } else if (nerResult.status === 'rejected') {
      log.warn('NER extraction failed');
    }
  }

  // 8. 生成 Embedding（R-026: 失败时记录待回填状态）
  let embeddingId: string | null = null;
  let embeddingFailed = false;
  let cachedEmbedding: number[] | null = null;
  if (llm.isEmbeddingAvailable) {
    try {
      const embResult = await llm.embed(content);
      cachedEmbedding = embResult.embedding;
      embeddingId = generateId();
      const vectorStore = getVectorStore();
      // 先用占位 memoryId，等 L1 写入后修正
      vectorStore.add(embeddingId, '', 'L1', cachedEmbedding, { source: input.source, domain });
    } catch {
      log.warn('Embedding generation failed, marking for backfill');
      embeddingFailed = true;
    }
  }

  // 9. 写入 L1
  const experience = createExperience({
    raw_content: content,
    content_type: input.content_type,
    source: input.source,
    importance,
    tags: input.tags,
    participants: input.participants,
    context: input.context,
    content_hash: contentHash,
    embedding_id: embeddingId,
    domain,
  });

  // 10. 修正 embedding 的 memoryId（复用 Step 8 缓存的向量，不再重复调用 LLM）
  if (embeddingId && cachedEmbedding) {
    const vectorStore = getVectorStore();
    vectorStore.delete(embeddingId);
    vectorStore.add(embeddingId, experience.id, 'L1', cachedEmbedding, { source: input.source, domain });
  }

  // 11. 条件索引
  const conditionKeys: string[] = [];
  for (const entity of entities) {
    conditionKeys.push(entity.condition_key);
    addConditionIndex(entity.condition_key, 'L1', experience.id);
  }

  // 12. FTS 全文索引
  addToFts(experience.id, 'L1', content, input.tags ?? [], conditionKeys);

  // 13. L1 温度初始化（此前 L1 无温度记录，导致 lifecycle 的温度衰减和 GC 无法作用于 L1）
  initTemperature(experience.id, 'L1', importance);

  // MINIMEM-003 E14: L4 辅助重要性评估（异步，不阻塞摄入流程）
  if (cachedEmbedding && llm.isAvailable) {
    boostImportanceByL4(experience.id, content, cachedEmbedding, importance).catch(err => {
      log.debug({ err, id: experience.id }, 'L4 importance boost failed (non-critical)');
    });
  }

  // 14. 记忆计数器递增（用于"攒够 N 条自动触发做梦"）
  incrementMemoryCount();

  // R-026: 嵌入失败时标记待回填（REQ-004: 使用共用补偿函数）
  if (embeddingFailed) {
    enqueueEmbeddingBackfill(experience.id, 'L1');
  }

  log.info({
    id: experience.id,
    importance,
    entities: entities.length,
    pii: piiResult.detected.length,
    domain,
  }, 'Memory ingested');

  return {
    experience,
    entities,
    pii_detected: piiResult.detected,
    importance,
  };
}

/**
 * 批量摄入（并发执行，带并发限制）
 */
export async function ingestMemoriesBatch(inputs: IngestInput[], concurrency: number = 5): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  // 分批并发处理
  for (let i = 0; i < inputs.length; i += concurrency) {
    const batch = inputs.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(input => ingestMemory(input))
    );
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        log.warn({ err: result.reason }, 'Batch ingest item failed');
      }
    }
  }
  return results;
}

// ── MINIMEM-005: 多模态感知入口 ──

export interface MultimodalIngestInput {
  /** 纯文本内容（与 url/image_url/file_path 互斥） */
  content?: string;
  /** URL 地址 */
  url?: string;
  /** 图片 URL */
  image_url?: string;
  /** 本地文件路径 */
  file_path?: string;
  /** 来源标识 */
  source: MemorySource;
  /** 内容类型 */
  content_type?: ContentType;
  /** 重要性 */
  importance?: number;
  /** 标签 */
  tags?: string[];
  /** 相关人物 */
  participants?: string[];
  /** 上下文说明 */
  context?: string;
  /** 领域 */
  domain?: string;
  /** URL 提取模式 */
  extract_mode?: 'readability' | 'full' | 'summary';
}

export interface MultimodalIngestResult {
  /** 成功写入的记忆列表 */
  results: IngestResult[];
  /** 预处理源信息 */
  source_info: {
    type: 'text' | 'url' | 'image' | 'file';
    url?: string;
    title?: string;
    content_length?: number;
    chunk_count?: number;
  };
}

/**
 * 多模态感知入口：接收 URL/图片/文件/文本 输入
 *
 * 工作流程：
 * 1. InputRouter 检测输入类型并路由到对应 Preprocessor
 * 2. Preprocessor 转换为 PreprocessResult（可能多个，如分块场景）
 * 3. 每个 PreprocessResult 调用 ingestMemory() 写入 L1
 * 4. 纯文本输入直接 bypass Preprocessor，走原有路径（向后兼容）
 */
export async function ingestMultimodal(input: MultimodalIngestInput): Promise<MultimodalIngestResult> {
  const { getInputRouter } = await import('./preprocessor/index.js');
  const router = getInputRouter();

  // 构造 MultimodalInput
  const multiInput = {
    content: input.content,
    url: input.url,
    image_url: input.image_url,
    file_path: input.file_path,
    context: input.context,
    source: input.source,
    tags: input.tags,
    participants: input.participants,
    importance: input.importance,
    domain: input.domain,
    extract_mode: input.extract_mode,
  };

  // 检测输入类型
  const inputType = router.detectType(multiInput);

  // 纯文本 bypass — 直接走原有 ingestMemory
  if (inputType === 'text') {
    if (!input.content || input.content.trim().length === 0) {
      throw new ValidationError('At least one of content, url, image_url, or file_path must be provided');
    }

    const result = await ingestMemory({
      content: input.content,
      source: input.source,
      content_type: input.content_type,
      importance: input.importance,
      tags: input.tags,
      participants: input.participants,
      context: input.context,
      domain: input.domain,
    });

    return {
      results: [result],
      source_info: {
        type: 'text',
        content_length: input.content.length,
        chunk_count: 1,
      },
    };
  }

  // 多模态路径 — 通过 Preprocessor 转换
  log.info({ type: inputType, url: input.url, file_path: input.file_path }, 'Multimodal ingest started');

  const preprocessResults = await router.route(multiInput);

  if (!preprocessResults || preprocessResults.length === 0) {
    throw new ValidationError('Preprocessor returned no results');
  }

  // 逐个写入 L1
  const ingestResults: IngestResult[] = [];
  for (const pr of preprocessResults) {
    try {
      const result = await ingestMemory({
        content: pr.content,
        source: input.source,
        content_type: pr.contentType,
        importance: input.importance,
        tags: input.tags,
        participants: input.participants,
        context: input.context,
        domain: input.domain,
      });
      ingestResults.push(result);
    } catch (err) {
      log.warn({ err, metadata: pr.metadata }, 'Failed to ingest preprocessor result');
    }
  }

  if (ingestResults.length === 0) {
    throw new Error('All preprocessed chunks failed to ingest');
  }

  // 构造源信息
  const firstMeta = preprocessResults[0].metadata;
  const sourceInfo: MultimodalIngestResult['source_info'] = {
    type: inputType,
    url: input.url,
    title: firstMeta.title as string | undefined,
    content_length: preprocessResults.reduce((sum, r) => sum + r.content.length, 0),
    chunk_count: preprocessResults.length,
  };

  log.info({
    type: inputType,
    chunks: preprocessResults.length,
    ingested: ingestResults.length,
  }, 'Multimodal ingest completed');

  return {
    results: ingestResults,
    source_info: sourceInfo,
  };
}

// ── 内部工具 ──

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')          // 统一换行
    .replace(/\n{3,}/g, '\n\n')      // 压缩多余空行
    .replace(/\t/g, '  ')            // Tab → 空格
    .trim();
}

function detectPII(content: string): { masked: string; detected: string[] } {
  const detected: string[] = [];
  let masked = content;

  for (const { name, pattern } of PII_PATTERNS) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      detected.push(name);
      masked = masked.replace(pattern, `[${name.toUpperCase()}_MASKED]`);
    }
  }

  return { masked, detected };
}

// ── MINIMEM-001: 领域判定（三级优先级链）──

/**
 * 判定记忆所属领域
 * Level 1: 显式传入 domain → 直接使用
 * Level 2: 来源规则推断（source → domain 映射）
 * Level 3: 默认 fallback → 'default'
 */
function resolveDomain(input: IngestInput): string {
  // Level 1: 显式传入
  if (input.domain) {
    return input.domain;
  }

  // Level 2: 来源规则推断（从配置读取）
  try {
    const { getConfig } = require('../config/index.js');
    const config = getConfig();
    const sourceMap = config.domain?.rules?.source_map;
    if (sourceMap && input.source in sourceMap) {
      const resolved = sourceMap[input.source];
      log.debug({ source: input.source, domain: resolved }, 'Domain resolved from source map');
      return resolved;
    }
  } catch {
    // 配置未加载时降级到 default
  }

  // Level 3: 默认 fallback
  return 'default';
}

// ── MINIMEM-003 E14: L4 辅助 L1 重要性评估 ──

/**
 * 异步检查新 L1 记忆是否与已有 L4 心智模型相关，
 * 如果高度相关则调整 importance：
 * - 支撑 L4 → importance += 0.1
 * - 矛盾 L4 → importance += 0.2（矛盾更值得关注）
 *
 * 此函数异步执行，不阻塞摄入主流程。
 */
async function boostImportanceByL4(
  experienceId: string,
  content: string,
  embedding: number[],
  currentImportance: number,
): Promise<void> {
  const cfg = getConfig();
  if (cfg.dreaming?.top_down_compile === false) return; // 自顶向下编译关闭

  const llm = getLLM();
  const store = getVectorStore();

  // 搜索 Top-3 相关 L4（sim > 0.7 才算"高度相关"）
  const l4Candidates = store.search(embedding, 5, 0.7);
  const resolvedL4 = Array.isArray(l4Candidates) ? l4Candidates : await l4Candidates;

  const relatedL4: Array<{ title: string; content: string }> = [];
  const { getDb } = await import('../store/database.js');
  const db = getDb();

  for (const match of resolvedL4) {
    if (match.memoryType !== 'L4') continue;
    const model = db.prepare(
      'SELECT title, content FROM mental_models WHERE id = ? AND is_active = 1'
    ).get(match.memoryId) as { title: string; content: string } | undefined;
    if (model) relatedL4.push(model);
    if (relatedL4.length >= 3) break;
  }

  if (relatedL4.length === 0) return; // 无高度相关 L4

  // 调用 LLM 判断关系
  const result = await llm.chatJson<{
    relation: 'supports' | 'contradicts' | 'unrelated';
    related_principle: string;
    importance_delta: number;
    reason: string;
  }>({
    messages: l1ImportanceBoostPrompt(content, relatedL4),
    tier: 'light',
    temperature: 0.1,
    fallback: { relation: 'unrelated' as const, related_principle: '', importance_delta: 0, reason: '' },
  });

  if (result.relation === 'unrelated' || result.importance_delta <= 0) return;

  // 计算调整后的 importance
  const delta = result.relation === 'contradicts'
    ? Math.min(0.2, result.importance_delta)
    : Math.min(0.1, result.importance_delta);
  const newImportance = Math.min(1, currentImportance + delta);

  if (newImportance > currentImportance) {
    db.prepare('UPDATE experiences SET importance = ?, updated_at = ? WHERE id = ?')
      .run(newImportance, new Date().toISOString().replace('T', ' ').slice(0, 19), experienceId);

    log.info({
      id: experienceId,
      relation: result.relation,
      principle: result.related_principle,
      delta,
      oldImportance: currentImportance,
      newImportance,
    }, 'L4-boosted L1 importance');
  }
}
