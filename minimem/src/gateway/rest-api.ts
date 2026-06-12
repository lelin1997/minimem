// ============================================================
// MiniMem — REST API (Hono)
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { getLogger } from '../common/logger.js';
import { MiniMemError, NotFoundError, ValidationError } from '../common/errors.js';
import { generateId, now, sanitizeUserContent } from '../common/utils.js';
import { ingestMemory, ingestMemoriesBatch, ingestMultimodal } from '../core/perception.js';
import { searchMemory, enrichResults } from '../retrieval/search.js';
import { lookupByPrefix } from '../store/indexes.js';
import {
  getExperienceById, listExperiences, countExperiences,
} from '../store/experiences.js';
import { countWorldFacts, listWorldFacts } from '../store/world-facts.js';
import { countObservations, listObservations } from '../store/observations.js';
import { countMentalModels, listMentalModels, getActiveMentalModels } from '../store/mental-models.js';
import { countKnowledgePages } from '../store/knowledge-pages/page-store.js';
import { getKnowledgePageById, listKnowledgePages, deleteOrArchiveKnowledgePage, getAllKnowledgeTags } from '../store/knowledge-pages/index.js';
import { getDb } from '../store/database.js';
import { getConfig } from '../config/index.js';
import { pinMemory, getTemperatureDistribution } from '../lifecycle/index.js';
import { forgetAbout } from '../lifecycle/forget.js';
import { createSnapshot, diffSnapshots, listSnapshots } from '../version/index.js';
import { getFullProfile, getProfileByCategory, setProfileEntry, setProfileEntries, deleteProfileEntry } from '../owner/profile.js';
import { findPersonByName, createPerson, updatePerson, deletePerson, listPersons } from '../owner/persons.js';
import { auditMiddleware } from './audit.js';
import { rateLimiterMiddleware, recallRateLimiterMiddleware } from './rate-limiter.js';
import { authMiddleware } from './auth.js';
import { z } from 'zod';

const log = getLogger('gateway:rest');

// ── 安全：Zod 请求体 Schema 校验 ──

const AddMemorySchema = z.object({
  content: z.string().min(1).max(100_000).optional(),
  url: z.string().url().max(4096).optional(),
  file_path: z.string().min(1).max(4096).optional(),
  image_url: z.string().min(1).max(1_000_000).optional(),  // Base64 data URI 可以很长
  source: z.string().min(1).max(200).default('api'),
  content_type: z.enum(['conversation', 'event', 'reflection', 'decision', 'note', 'import', 'url_import', 'image_import', 'file_import']).optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  participants: z.array(z.string().max(200)).max(50).optional(),
  context: z.string().max(10_000).optional(),
  domain: z.string().max(100).optional(),
  extract_mode: z.enum(['readability', 'full', 'summary']).optional(),
}).refine(
  (data) => data.content || data.url || data.file_path || data.image_url,
  { message: 'At least one of content, url, file_path, or image_url must be provided' },
);

const ImportUrlSchema = z.object({
  url: z.string().url().max(4096),
  context: z.string().max(10_000).optional(),
  extract_mode: z.enum(['readability', 'full', 'summary']).optional().default('readability'),
  source: z.string().min(1).max(200).optional().default('url-import'),
  tags: z.array(z.string().max(100)).max(50).optional(),
  domain: z.string().max(100).optional(),
});

const BatchMemoriesSchema = z.object({
  memories: z.array(z.object({
    content: z.string().min(1).max(100_000),
    source: z.string().min(1).max(200).default('api'),
    content_type: z.enum(['conversation', 'event', 'reflection', 'decision', 'note', 'import']).optional(),
    tags: z.array(z.string().max(100)).max(50).optional(),
    domain: z.string().max(100).optional(),
  })).min(1).max(100),
});

// MINIMEM-005 Phase 5: 批量 URL 导入 Schema
const BatchUrlImportSchema = z.object({
  urls: z.array(z.string().url().max(4096)).min(1).max(20),
  context: z.string().max(10_000).optional(),
  extract_mode: z.enum(['readability', 'full', 'summary']).optional().default('readability'),
  source: z.string().min(1).max(200).optional().default('batch-url-import'),
  tags: z.array(z.string().max(100)).max(50).optional(),
  domain: z.string().max(100).optional(),
});

const UpdateMemorySchema = z.object({
  layer: z.enum(['L1', 'L2', 'L3', 'L4']).optional().default('L1'),
  updates: z.record(z.string(), z.unknown()).optional().default({}),
});

const ForgetSchema = z.object({
  topic: z.string().min(1).max(1000),
  dry_run: z.boolean().optional().default(false),
});

// MINIMEM-006: Recall Hints Schema
const RecallHintsSchema = z.object({
  message: z.string().min(1).max(10_000),
  context_summary: z.string().max(2_000).optional(),
  conversation_history: z.array(z.string().max(2_000)).max(10).optional(),
  max_hints: z.number().int().min(1).max(10).optional(),
  token_budget: z.number().int().min(50).max(1000).optional(),
  domain: z.string().max(100).optional(),
});

// MINIMEM-006: Recall Auto Schema
const RecallAutoSchema = z.object({
  message: z.string().min(1).max(10_000),
  context_summary: z.string().max(2_000).optional(),
  agent_type: z.string().max(100).optional(),
  mode: z.enum(['hint', 'full', 'smart']).optional(),
});

const ExportSchema = z.object({
  layers: z.array(z.enum(['L1', 'L2', 'L3', 'L4'])).optional(),
  output_to_file: z.boolean().optional().default(false),
});

const ImportSchema = z.object({
  memories: z.array(z.object({
    content: z.string().min(1).max(100_000),
    tags: z.array(z.string().max(100)).max(50).optional(),
  })).min(1).max(1000),
  source: z.string().min(1).max(200).optional().default('import'),
});

// ── 安全：SQL 列名白名单（防止列名注入攻击） ──
const ALLOWED_UPDATE_COLUMNS: Record<string, Set<string>> = {
  experiences: new Set(['raw_content', 'content_type', 'source', 'importance', 'tags', 'participants', 'context', 'domain', 'embedding_id']),
  world_facts: new Set(['subject', 'predicate', 'object', 'confidence', 'valid_from', 'valid_until', 'source', 'evidence_experience_ids', 'condition_keys', 'domain']),
  observations: new Set(['description', 'observation_type', 'supporting_fact_ids', 'contradicting_fact_ids', 'confidence', 'confidence_history', 'tags', 'drift_risk', 'domain']),
  mental_models: new Set(['title', 'content', 'model_type', 'priority', 'scope', 'origin', 'is_active', 'domain']),
};

/**
 * 创建 REST API 应用
 */
export function createRestApp(): Hono {
  const app = new Hono();

  // ── 中间件 ──
  // CORS: 限制允许的来源（通过 MINIMEM_CORS_ORIGINS 环境变量配置，逗号分隔）
  const corsOrigins = (process.env.MINIMEM_CORS_ORIGINS || '').split(',').filter(Boolean);
  app.use('*', cors({
    origin: corsOrigins.length > 0
      ? corsOrigins
      : ['http://127.0.0.1', 'http://localhost', 'http://127.0.0.1:6677', 'http://localhost:6677'],
    credentials: true,
  }));

  // JWT 认证（auth.enabled=false 时默认以 trusted 权限放行）
  app.use('/api/*', authMiddleware());

  // 速率限制（全局 60 写/分钟，单客户端 20 写/分钟）
  app.use('/api/*', rateLimiterMiddleware());

  // 访问审计日志
  app.use('/api/*', auditMiddleware());

  // 请求日志
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const latency = Date.now() - start;
    log.info({ method: c.req.method, path: c.req.path, status: c.res.status, latency }, 'Request');
  });

  // ── 记忆写入 ──

  app.post('/api/v1/memory', async (c) => {
    const raw = await c.req.json();
    const body = AddMemorySchema.parse(raw);

    // MINIMEM-005: URL 输入走多模态路径
    if (body.url) {
      const multiResult = await ingestMultimodal({
        url: body.url,
        source: body.source,
        content_type: body.content_type,
        importance: body.importance,
        tags: body.tags,
        participants: body.participants,
        context: body.context,
        domain: body.domain,
        extract_mode: body.extract_mode,
      });
      return c.json({
        memory_id: multiResult.results[0]?.experience.id,
        memory_ids: multiResult.results.map(r => r.experience.id),
        layer: 'L1',
        importance: multiResult.results[0]?.importance,
        source_info: multiResult.source_info,
      }, 201);
    }

    // MINIMEM-005 Phase 2: 文件路径输入走多模态路径
    if (body.file_path) {
      const multiResult = await ingestMultimodal({
        file_path: body.file_path,
        source: body.source,
        content_type: body.content_type,
        importance: body.importance,
        tags: body.tags,
        participants: body.participants,
        context: body.context,
        domain: body.domain,
      });
      return c.json({
        memory_id: multiResult.results[0]?.experience.id,
        memory_ids: multiResult.results.map(r => r.experience.id),
        layer: 'L1',
        importance: multiResult.results[0]?.importance,
        source_info: multiResult.source_info,
      }, 201);
    }

    // MINIMEM-005 Phase 3: 图片输入走多模态路径
    if (body.image_url) {
      const multiResult = await ingestMultimodal({
        image_url: body.image_url,
        source: body.source,
        content_type: body.content_type,
        importance: body.importance,
        tags: body.tags,
        participants: body.participants,
        context: body.context,
        domain: body.domain,
      });
      return c.json({
        memory_id: multiResult.results[0]?.experience.id,
        memory_ids: multiResult.results.map(r => r.experience.id),
        layer: 'L1',
        importance: multiResult.results[0]?.importance,
        source_info: multiResult.source_info,
      }, 201);
    }

    // 纯文本原有路径
    const result = await ingestMemory({
      content: body.content!,
      source: body.source,
      content_type: body.content_type,
      importance: body.importance,
      tags: body.tags,
      participants: body.participants,
      context: body.context,
      domain: body.domain,
    });
    return c.json({
      memory_id: result.experience.id,
      layer: 'L1',
      importance: result.importance,
      entities: result.entities.length,
    }, 201);
  });

  app.post('/api/v1/memory/batch', async (c) => {
    const raw = await c.req.json();
    const body = BatchMemoriesSchema.parse(raw);
    const results = await ingestMemoriesBatch(body.memories);
    return c.json({
      added: results.length,
      memory_ids: results.map(r => r.experience.id),
    }, 201);
  });

  // MINIMEM-005 Phase 5: 批量 URL 导入端点
  app.post('/api/v1/memory/batch-url', async (c) => {
    const raw = await c.req.json();
    const body = BatchUrlImportSchema.parse(raw);

    const BATCH_CONCURRENCY = 3; // 最多 3 个 URL 同时抓取
    const results: Array<{
      url: string;
      status: 'success' | 'error';
      experience_ids?: string[];
      chunk_count?: number;
      title?: string;
      error?: string;
    }> = [];

    // 分批并发处理
    for (let i = 0; i < body.urls.length; i += BATCH_CONCURRENCY) {
      const batch = body.urls.slice(i, i + BATCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (url) => {
          const multiResult = await ingestMultimodal({
            url,
            source: body.source,
            context: body.context,
            extract_mode: body.extract_mode,
            tags: body.tags,
            domain: body.domain,
          });
          return {
            url,
            experience_ids: multiResult.results.map(r => r.experience.id),
            chunk_count: multiResult.source_info.chunk_count ?? 1,
            title: multiResult.source_info.title ?? undefined,
          };
        })
      );

      for (let j = 0; j < settled.length; j++) {
        const result = settled[j];
        if (result.status === 'fulfilled') {
          results.push({ ...result.value, status: 'success' });
        } else {
          results.push({
            url: batch[j],
            status: 'error',
            error: result.reason?.message ?? 'Unknown error',
          });
        }
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    return c.json({
      total: body.urls.length,
      success: successCount,
      failed: body.urls.length - successCount,
      results,
    }, 201);
  });

  // MINIMEM-005: URL 导入专用端点
  app.post('/api/v1/memory/import-url', async (c) => {
    const raw = await c.req.json();
    const body = ImportUrlSchema.parse(raw);

    const multiResult = await ingestMultimodal({
      url: body.url,
      source: body.source,
      context: body.context,
      extract_mode: body.extract_mode,
      tags: body.tags,
      domain: body.domain,
    });

    const firstResult = multiResult.results[0];
    return c.json({
      experience_id: firstResult?.experience.id,
      experience_ids: multiResult.results.map(r => r.experience.id),
      title: multiResult.source_info.title ?? null,
      content_length: multiResult.source_info.content_length ?? 0,
      chunk_count: multiResult.source_info.chunk_count ?? 1,
      preview: firstResult?.experience.raw_content.slice(0, 300) ?? '',
    }, 201);
  });

  // ── 记忆检索 ──

  app.get('/api/v1/memory/search', async (c) => {
    const query = c.req.query('query') ?? '';
    const topK = parseInt(c.req.query('top_k') ?? '10', 10);
    const response = await searchMemory({ query, top_k: topK });
    // searchMemory 内部已完成 enrichResults，无需重复调用
    return c.json({
      results: response.results,
      direct_answer: response.direct_answer,
      total: response.total_candidates,
    });
  });

  // ── MINIMEM-006: Hint-Driven Recall 端点 ──

  // T-H03.3: Recall 端点专属限流（hints: 60/min, auto: 30/min）
  app.use('/api/v1/recall/*', recallRateLimiterMiddleware());

  app.post('/api/v1/recall/hints', async (c) => {
    const raw = await c.req.json();
    const body = RecallHintsSchema.parse(raw);

    // T-H08.1: 输入消毒
    const { sanitized: message } = sanitizeUserContent(body.message);
    const contextSummary = body.context_summary ? sanitizeUserContent(body.context_summary).sanitized : undefined;
    const conversationHistory = body.conversation_history?.map(h => sanitizeUserContent(h).sanitized);

    const { HintsEngine } = await import('../recall/hints-engine.js');
    const config = getConfig();
    const recallConfig = (config as any).recall?.hints;

    const engine = new HintsEngine(recallConfig);
    const response = await engine.generateHints({
      message,
      context_summary: contextSummary,
      conversation_history: conversationHistory,
      max_hints: body.max_hints,
      token_budget: body.token_budget,
      domain: body.domain,
    });

    return c.json(response);
  });

  app.post('/api/v1/recall/auto', async (c) => {
    const raw = await c.req.json();
    const body = RecallAutoSchema.parse(raw);

    // T-H08.1: 输入消毒
    const { sanitized: message } = sanitizeUserContent(body.message);
    const contextSummary = body.context_summary ? sanitizeUserContent(body.context_summary).sanitized : undefined;

    const { HintsEngine } = await import('../recall/hints-engine.js');
    const { recordAutoRequest } = await import('../recall/metrics.js');
    const config = getConfig();
    const recallConfig = (config as any).recall;

    const mode = body.mode ?? recallConfig?.auto?.default_mode ?? 'hint';
    const engine = new HintsEngine(recallConfig?.hints);

    try {
      if (mode === 'hint') {
        const response = await engine.generateHints({
          message,
          context_summary: contextSummary,
        });

        recordAutoRequest('ok', mode);
        return c.json({
          should_recall: response.hints.length > 0,
          hints: response.hints,
          full_memories: null,
          surface_delta: null,
        });
      }

      if (mode === 'full') {
        // 先获取 hints，然后对 top-1 做完整检索
        const hintResponse = await engine.generateHints({
          message,
          context_summary: contextSummary,
        });

        let fullMemories: Array<{ id: string; layer: string; content: string }> | null = null;

        if (hintResponse.hints.length > 0) {
          const topHint = hintResponse.hints[0];
          const fullResponse = await searchMemory({
            query: topHint.recall_query,
            top_k: 5,
          });
          fullMemories = fullResponse.results.map(r => ({
            id: r.id,
            layer: r.layer,
            content: r.content,
          }));
        }

        recordAutoRequest('ok', mode);
        return c.json({
          should_recall: hintResponse.hints.length > 0,
          hints: hintResponse.hints,
          full_memories: fullMemories,
          surface_delta: null,
        });
      }

      // mode === 'smart': 先 hints，如果分数足够高自动升级为 full
      const hintResponse = await engine.generateHints({
        message,
        context_summary: contextSummary,
      });

      const HIGH_RELEVANCE_THRESHOLD = 0.8;
      const shouldDeepen = hintResponse.hints.some(h => h.relevance_score >= HIGH_RELEVANCE_THRESHOLD);

      let fullMemories: Array<{ id: string; layer: string; content: string }> | null = null;

      if (shouldDeepen && hintResponse.hints.length > 0) {
        const topHint = hintResponse.hints[0];
        const fullResponse = await searchMemory({
          query: topHint.recall_query,
          top_k: 5,
        });
        fullMemories = fullResponse.results.map(r => ({
          id: r.id,
          layer: r.layer,
          content: r.content,
        }));
      }

      recordAutoRequest('ok', mode);
      return c.json({
        should_recall: hintResponse.hints.length > 0,
        reasoning: shouldDeepen ? 'high_relevance_auto_deepen' : 'hint_only',
        hints: hintResponse.hints,
        full_memories: fullMemories,
        surface_delta: null,
      });
    } catch (err) {
      recordAutoRequest('error', mode);
      throw err;
    }
  });

  app.get('/api/v1/memory/recall/:entity', async (c) => {
    const entity = c.req.param('entity');
    const topK = 10;

    // 精确召回：通过条件索引查找所有前缀类型
    const ENTITY_PREFIXES = ['person', 'topic', 'project', 'technology', 'organization', 'place', 'event'];
    const conditionHits: Array<{ id: string; layer: string }> = [];
    for (const prefix of ENTITY_PREFIXES) {
      const hits = lookupByPrefix(`${prefix}:${entity}`);
      for (const hit of hits) {
        conditionHits.push({ id: hit.memory_id, layer: hit.memory_type });
      }
    }

    // 语义召回
    const response = await searchMemory({
      query: `关于 ${entity} 的所有信息`,
      top_k: topK,
    });

    // 合并去重
    const mergedMap = new Map<string, any>();
    for (const hit of conditionHits) {
      mergedMap.set(hit.id, { id: hit.id, layer: hit.layer, content: '', score: 0.95, source_strategy: 'condition' });
    }
    for (const r of response.results) {
      const existing = mergedMap.get(r.id);
      if (!existing || r.score > existing.score) {
        mergedMap.set(r.id, r);
      }
    }

    const merged = Array.from(mergedMap.values())
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, topK);
    const enriched = enrichResults(merged);

    return c.json({ entity, memories: enriched });
  });

  app.get('/api/v1/memory/:id', async (c) => {
    const id = c.req.param('id');
    const exp = getExperienceById(id);
    if (!exp) throw new NotFoundError('memory', id);
    return c.json(exp);
  });

  app.get('/api/v1/memory/list', async (c) => {
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const pageSize = parseInt(c.req.query('page_size') ?? '20', 10);
    const result = listExperiences({ page, page_size: pageSize });
    return c.json(result);
  });

  // ── 统一记忆列表（Console 用，支持 L1-L4 混合/分层查询） ──

  app.get('/api/v1/memories', async (c) => {
    const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('page_size') ?? '20', 10)));
    const layerParam = c.req.query('layer');  // L1 | L2 | L3 | L4 | 不传=全部
    const domain = c.req.query('domain');
    const db = getDb();

    // 确定要查询哪些层
    const validLayers = ['L1', 'L2', 'L3', 'L4'] as const;
    const layers: Array<typeof validLayers[number]> = layerParam && validLayers.includes(layerParam as any)
      ? [layerParam as typeof validLayers[number]]
      : [...validLayers];

    // 统一结果格式
    interface UnifiedMemory {
      id: string;
      layer: string;
      content: string;
      temperature: string | null;
      importance: number | null;
      tags: string[];
      source: string | null;
      source_strategy?: string;
      created_at: string;
      updated_at: string;
      // L2 特有
      subject?: string;
      predicate?: string;
      object?: string;
      // L3 特有
      confidence?: number;
      observation_type?: string;
      supporting_ids?: string[];
      opposing_ids?: string[];
      drift_risk?: boolean;
      // L4 特有
      title?: string;
      priority?: number;
      scope?: string;
      active?: boolean;
      model_type?: string;
    }

    // 查询温度信息的辅助函数
    const getTemperatureMap = (ids: Array<{ id: string; type: string }>) => {
      if (ids.length === 0) return new Map<string, string>();
      const map = new Map<string, string>();
      // 批量查询以提高性能
      const stmt = db.prepare('SELECT memory_id, temperature FROM memory_temperature WHERE memory_id = ? AND memory_type = ?');
      for (const { id, type } of ids) {
        const row = stmt.get(id, type) as { memory_id: string; temperature: string } | undefined;
        if (row) map.set(row.memory_id, row.temperature);
      }
      return map;
    };

    let memories: UnifiedMemory[] = [];
    let total = 0;

    if (layers.length === 1) {
      // 单层查询：直接分页
      const layer = layers[0];
      const domainFilter = domain ? domain : undefined;

      switch (layer) {
        case 'L1': {
          const result = listExperiences({ page, page_size: pageSize, domain: domainFilter });
          total = result.total;
          const tempMap = getTemperatureMap(result.items.map(i => ({ id: i.id, type: 'L1' })));
          memories = result.items.map(e => ({
            id: e.id,
            layer: 'L1',
            content: e.raw_content,
            temperature: tempMap.get(e.id) ?? null,
            importance: e.importance,
            tags: e.tags,
            source: e.source,
            created_at: e.created_at,
            updated_at: e.updated_at,
          }));
          break;
        }
        case 'L2': {
          const result = listWorldFacts({ page, page_size: pageSize, domain: domainFilter });
          total = result.total;
          const tempMap = getTemperatureMap(result.items.map(i => ({ id: i.id, type: 'L2' })));
          memories = result.items.map(f => ({
            id: f.id,
            layer: 'L2',
            content: `${f.subject} ${f.predicate} ${f.object}`,
            temperature: tempMap.get(f.id) ?? null,
            importance: null,
            tags: [],
            source: f.source,
            created_at: f.created_at,
            updated_at: f.updated_at,
            // L2 特有
            subject: f.subject,
            predicate: f.predicate,
            object: f.object,
            confidence: f.confidence,
          }));
          break;
        }
        case 'L3': {
          const result = listObservations({ page, page_size: pageSize, domain: domainFilter });
          total = result.total;
          const tempMap = getTemperatureMap(result.items.map(i => ({ id: i.id, type: 'L3' })));
          memories = result.items.map(o => ({
            id: o.id,
            layer: 'L3',
            content: o.description,
            temperature: tempMap.get(o.id) ?? null,
            importance: null,
            tags: o.tags,
            source: null,
            created_at: o.created_at,
            updated_at: o.updated_at,
            // L3 特有
            confidence: o.confidence,
            observation_type: o.observation_type,
            supporting_ids: o.supporting_fact_ids,
            opposing_ids: o.contradicting_fact_ids,
            drift_risk: o.drift_risk,
          }));
          break;
        }
        case 'L4': {
          const result = listMentalModels({ page, page_size: pageSize, domain: domainFilter });
          total = result.total;
          const tempMap = getTemperatureMap(result.items.map(i => ({ id: i.id, type: 'L4' })));
          memories = result.items.map(m => ({
            id: m.id,
            layer: 'L4',
            content: m.content,
            temperature: tempMap.get(m.id) ?? null,
            importance: null,
            tags: [],
            source: null,
            created_at: m.created_at,
            updated_at: m.updated_at,
            // L4 特有
            title: m.title,
            priority: m.priority,
            scope: m.scope,
            active: m.is_active,
            model_type: m.model_type,
          }));
          break;
        }
      }
    } else {
      // 多层混合查询：按 created_at DESC 统一排序
      // 先统计各层总数
      const domainCondition = domain ? ' AND domain = ?' : '';
      const domainValues = domain ? [domain] : [];

      const l1Count = (db.prepare(`SELECT COUNT(*) as c FROM experiences WHERE branch = 'main'${domainCondition}`).get(...domainValues) as { c: number }).c;
      const l2Count = (db.prepare(`SELECT COUNT(*) as c FROM world_facts WHERE branch = 'main'${domainCondition}`).get(...domainValues) as { c: number }).c;
      const l3Count = (db.prepare(`SELECT COUNT(*) as c FROM observations WHERE branch = 'main'${domainCondition}`).get(...domainValues) as { c: number }).c;
      const l4Count = (db.prepare(`SELECT COUNT(*) as c FROM mental_models WHERE branch = 'main'${domainCondition}`).get(...domainValues) as { c: number }).c;
      total = l1Count + l2Count + l3Count + l4Count;

      // 联合查询，按 created_at DESC 分页
      const offset = (page - 1) * pageSize;
      const unionSql = `
        SELECT id, 'L1' as layer, raw_content as content, source, importance, tags, NULL as subject, NULL as predicate, NULL as object,
               NULL as confidence, NULL as observation_type, NULL as supporting_fact_ids, NULL as contradicting_fact_ids, NULL as drift_risk,
               NULL as title, NULL as priority, NULL as scope, NULL as is_active, NULL as model_type, NULL as description,
               created_at, updated_at
        FROM experiences WHERE branch = 'main'${domainCondition}
        UNION ALL
        SELECT id, 'L2' as layer, (subject || ' ' || predicate || ' ' || object) as content, source, NULL as importance, '[]' as tags,
               subject, predicate, object, confidence, NULL as observation_type, NULL as supporting_fact_ids, NULL as contradicting_fact_ids, NULL as drift_risk,
               NULL as title, NULL as priority, NULL as scope, NULL as is_active, NULL as model_type, NULL as description,
               created_at, updated_at
        FROM world_facts WHERE branch = 'main'${domainCondition}
        UNION ALL
        SELECT id, 'L3' as layer, description as content, NULL as source, NULL as importance, tags,
               NULL as subject, NULL as predicate, NULL as object, confidence, observation_type, supporting_fact_ids, contradicting_fact_ids, drift_risk,
               NULL as title, NULL as priority, NULL as scope, NULL as is_active, NULL as model_type, description,
               created_at, updated_at
        FROM observations WHERE branch = 'main'${domainCondition}
        UNION ALL
        SELECT id, 'L4' as layer, content, NULL as source, NULL as importance, '[]' as tags,
               NULL as subject, NULL as predicate, NULL as object, NULL as confidence, NULL as observation_type, NULL as supporting_fact_ids, NULL as contradicting_fact_ids, NULL as drift_risk,
               title, priority, scope, is_active, model_type, NULL as description,
               created_at, updated_at
        FROM mental_models WHERE branch = 'main'${domainCondition}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;
      const allDomainValues = [...domainValues, ...domainValues, ...domainValues, ...domainValues];
      const rows = db.prepare(unionSql).all(...allDomainValues, pageSize, offset) as Record<string, unknown>[];

      // 批量获取温度
      const tempMap = getTemperatureMap(rows.map(r => ({ id: r.id as string, type: r.layer as string })));

      memories = rows.map(r => {
        const layer = r.layer as string;
        const base: UnifiedMemory = {
          id: r.id as string,
          layer,
          content: r.content as string,
          temperature: tempMap.get(r.id as string) ?? null,
          importance: r.importance as number | null,
          tags: JSON.parse((r.tags as string) || '[]'),
          source: (r.source as string) ?? null,
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
        };

        // 层级特有字段
        if (layer === 'L2') {
          base.subject = r.subject as string;
          base.predicate = r.predicate as string;
          base.object = r.object as string;
          base.confidence = r.confidence as number;
        } else if (layer === 'L3') {
          base.confidence = r.confidence as number;
          base.observation_type = r.observation_type as string;
          base.supporting_ids = JSON.parse((r.supporting_fact_ids as string) || '[]');
          base.opposing_ids = JSON.parse((r.contradicting_fact_ids as string) || '[]');
          base.drift_risk = (r.drift_risk as number) === 1;
        } else if (layer === 'L4') {
          base.title = r.title as string;
          base.priority = r.priority as number;
          base.scope = r.scope as string;
          base.active = !!(r.is_active as number);
          base.model_type = r.model_type as string;
        }

        return base;
      });
    }

    return c.json({
      memories,
      total,
      page,
      page_size: pageSize,
    });
  });

  // ── Surface Files ──

  app.get('/api/v1/surface', async (c) => {
    const agentType = c.req.query('agent_type') ?? 'general';
    const db = getDb();
    const fileMap: Record<string, string[]> = {
      codebuddy: ['me.md', 'work.md', 'agent.md', 'context.md'],
      openclaw: ['me.md', 'soul.md', 'social.md', 'context.md'],
      general: ['me.md', 'soul.md', 'work.md', 'social.md', 'life.md', 'agent.md', 'context.md', 'index.md'],
    };
    const files = fileMap[agentType] ?? fileMap.general;
    const result: Record<string, string> = {};
    for (const f of files) {
      const row = db.prepare('SELECT content FROM surface_files WHERE file_name = ?').get(f) as { content: string } | undefined;
      if (row) result[f] = row.content;
    }
    return c.json(result);
  });

  app.get('/api/v1/surface/:file', async (c) => {
    const fileName = c.req.param('file');
    const db = getDb();
    const row = db.prepare('SELECT * FROM surface_files WHERE file_name = ?').get(fileName);
    if (!row) throw new NotFoundError('surface_file', fileName);
    return c.json(row);
  });

  // ── Owner Profile ──

  app.get('/api/v1/owner/profile', async (c) => {
    const category = c.req.query('category');
    const profile = category ? getProfileByCategory(category) : getFullProfile();
    return c.json({ profile });
  });

  // 新增：设置单个 Owner Profile 条目
  app.post('/api/v1/owner/profile', async (c) => {
    const body = await c.req.json();
    const { key, value, category, confidence = 0.8, source = 'manual' } = body;
    if (!key || value === undefined) {
      return c.json({ error: 'Missing required fields: key, value' }, 400);
    }
    const entry = setProfileEntry(key, value, { category, confidence, source });
    return c.json(entry, 201);
  });

  // 新增：批量设置 Owner Profile 条目
  app.post('/api/v1/owner/profile/batch', async (c) => {
    const body = await c.req.json();
    const { entries } = body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return c.json({ error: 'Missing required field: entries (array)' }, 400);
    }
    const count = setProfileEntries(entries.map(e => ({
      key: e.key,
      value: e.value,
      category: e.category,
      confidence: e.confidence ?? 0.8,
      source: e.source ?? 'manual',
    })));
    return c.json({ count, message: `${count} profile entries updated` });
  });

  // 新增：更新指定 key 的 Owner Profile
  app.put('/api/v1/owner/profile/:key', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json();
    const { value, category, confidence = 0.8, source = 'manual' } = body;
    if (value === undefined) {
      return c.json({ error: 'Missing required field: value' }, 400);
    }
    const entry = setProfileEntry(key, value, { category, confidence, source });
    return c.json(entry);
  });

  // 新增：删除指定 key 的 Owner Profile
  app.delete('/api/v1/owner/profile/:key', async (c) => {
    const key = c.req.param('key');
    const success = deleteProfileEntry(key);
    if (!success) throw new NotFoundError('profile_entry', key);
    return c.json({ deleted: true, key });
  });

  app.get('/api/v1/owner/person/:name', async (c) => {
    const name = c.req.param('name');
    const person = findPersonByName(name);
    if (!person) throw new NotFoundError('person', name);
    return c.json(person);
  });

  // ── 记忆管理（PUT/DELETE） ──

  app.put('/api/v1/memory/:id', async (c) => {
    const id = c.req.param('id');
    const raw = await c.req.json();
    const body = UpdateMemorySchema.parse(raw);
    const db = getDb();
    const layer = body.layer;
    const tableMap: Record<string, string> = { L1: 'experiences', L2: 'world_facts', L3: 'observations', L4: 'mental_models' };
    const table = tableMap[layer];

    if (!table) throw new ValidationError('Invalid layer', { layer, valid_layers: Object.keys(tableMap) });

    const updates = body.updates;
    const sets: string[] = ['updated_at = ?'];
    const values: unknown[] = [now()];

    const allowedCols = ALLOWED_UPDATE_COLUMNS[table];
    for (const [key, val] of Object.entries(updates)) {
      if (!allowedCols?.has(key)) continue;  // 白名单过滤，拒绝非法列名
      sets.push(`${key} = ?`);
      values.push(typeof val === 'object' ? JSON.stringify(val) : val);
    }
    values.push(id);
    db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    return c.json({ updated: true, id });
  });

  app.delete('/api/v1/memory/:id', async (c) => {
    const id = c.req.param('id');
    const db = getDb();
    const layer = c.req.query('layer') ?? 'L1';
    const tableMap: Record<string, string> = { L1: 'experiences', L2: 'world_facts', L3: 'observations', L4: 'mental_models' };
    const table = tableMap[layer];

    if (!table) throw new ValidationError('Invalid layer', { layer, valid_layers: Object.keys(tableMap) });

    db.transaction(() => {
      db.prepare(`INSERT INTO memory_tombstones (id, original_id, original_type, reason, created_at) VALUES (?, ?, ?, 'manual', ?)`)
        .run(generateId(), id, layer, now());
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      db.prepare('DELETE FROM condition_index WHERE memory_id = ?').run(id);
      db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(id);
      db.prepare('DELETE FROM memory_temperature WHERE memory_id = ?').run(id);
    })();

    return c.json({ deleted: true, id });
  });

  // ── 遗忘 ──

  app.post('/api/v1/memory/forget', async (c) => {
    const raw = await c.req.json();
    const body = ForgetSchema.parse(raw);
    const result = forgetAbout(body.topic, body.dry_run);
    return c.json(result);
  });

  // ── 导入导出 ──

  app.post('/api/v1/memory/export', async (c) => {
    const raw = await c.req.json();
    const body = ExportSchema.parse(raw);
    const db = getDb();
    const layers = body.layers ?? ['L1', 'L2', 'L3', 'L4'];
    const outputToFile = body.output_to_file;
    const data: Record<string, unknown[]> = {};

    if (layers.includes('L1')) data.experiences = db.prepare("SELECT * FROM experiences WHERE branch = 'main'").all();
    if (layers.includes('L2')) data.world_facts = db.prepare("SELECT * FROM world_facts WHERE branch = 'main'").all();
    if (layers.includes('L3')) data.observations = db.prepare("SELECT * FROM observations WHERE branch = 'main'").all();
    if (layers.includes('L4')) data.mental_models = db.prepare("SELECT * FROM mental_models WHERE branch = 'main'").all();

    // 写入磁盘文件
    let filePath: string | null = null;
    if (outputToFile) {
      try {
        const config = getConfig();
        const exportsDir = join(config.storage.data_dir, 'exports');
        if (!existsSync(exportsDir)) {
          mkdirSync(exportsDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `export-${timestamp}.json`;
        filePath = join(exportsDir, fileName);

        const exportPayload = {
          exported_at: new Date().toISOString(),
          layers,
          stats: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, v.length]),
          ),
          data,
        };

        writeFileSync(filePath, JSON.stringify(exportPayload, null, 2), 'utf-8');
        log.info({ filePath, layers }, 'Memory exported to file');
      } catch (err) {
        log.error({ err }, 'Failed to write export file');
        filePath = null;
      }
    }

    return c.json({ ...data, ...(filePath ? { file_path: filePath } : {}) });
  });

  app.post('/api/v1/memory/import', async (c) => {
    const raw = await c.req.json();
    const body = ImportSchema.parse(raw);
    const results = await ingestMemoriesBatch(
      body.memories.map((m) => ({ content: m.content, source: body.source, tags: m.tags }))
    );
    return c.json({ imported: results.length }, 201);
  });

  // ── 版本控制 ──

  app.post('/api/v1/snapshot', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const snapshot = createSnapshot({ label: body.label, trigger: 'manual' });
    return c.json(snapshot, 201);
  });

  app.get('/api/v1/snapshot/list', async (c) => {
    const branch = c.req.query('branch') ?? 'main';
    const snapshots = listSnapshots(branch);
    return c.json({ snapshots });
  });

  app.get('/api/v1/snapshot/diff', async (c) => {
    const a = c.req.query('snapshot_a');
    const b = c.req.query('snapshot_b');
    if (!a || !b) return c.json({ error: 'snapshot_a and snapshot_b required' }, 400);
    const diff = diffSnapshots(a, b);
    return c.json(diff);
  });

  // ── 做梦（占位） ──

  app.post('/api/v1/dream/trigger', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { mode?: string; phases?: number[] };
    const { triggerDream, getDreamReportMarkdown } = await import('../modules/dream/dream-engine.js');
    const session = await triggerDream({
      mode: (body.mode === 'weekly' ? 'weekly' : 'daily'),
      phases: body.phases,
    });
    return c.json({
      session_id: session.session_id,
      status: session.status,
      report_markdown: getDreamReportMarkdown(session),
    });
  });

  // ── R-020: Onboarding (与 MCP 对齐) ──

  app.post('/api/v1/onboarding', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { user_name?: string };
    const welcomeMsg = body.user_name
      ? `欢迎 ${body.user_name}！我是你的个人记忆系统 MiniMem。`
      : '欢迎使用 MiniMem！请先告诉我你的名字。';

    if (body.user_name) {
      setProfileEntry('identity.name', body.user_name, { category: 'identity', confidence: 1.0, source: 'onboarding' });
    }

    return c.json({ message: welcomeMsg, onboarding: true });
  });

  // ── R-020: Person CRUD (与 MCP 对齐) ──

  app.get('/api/v1/persons', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '100', 10);
    return c.json({ persons: listPersons(limit) });
  });

  app.post('/api/v1/person', async (c) => {
    const body = await c.req.json();
    const person = createPerson(body);
    return c.json(person, 201);
  });

  app.put('/api/v1/person/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const updated = updatePerson(id, body);
    if (!updated) return c.json({ error: 'Person not found' }, 404);
    return c.json(updated);
  });

  app.delete('/api/v1/person/:id', async (c) => {
    const id = c.req.param('id');
    const success = deletePerson(id);
    if (!success) throw new NotFoundError('person', id);
    return c.json({ deleted: true, id });
  });

  // ── 📚 Knowledge Pages Console API（只读 + 归档/删除） ──

  // 获取所有标签（放在 :id 路由之前，避免 "tags" 被当作 :id）
  app.get('/api/v1/knowledge/tags', async (c) => {
    const tags = getAllKnowledgeTags();
    return c.json({ tags });
  });

  // 知识列表（分页 + 多条件筛选）
  app.get('/api/v1/knowledge', async (c) => {
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const pageSize = parseInt(c.req.query('page_size') ?? '20', 10);
    const search = c.req.query('search');
    const tag = c.req.query('tag');
    const domain = c.req.query('domain');
    const status = c.req.query('status');

    const result = listKnowledgePages({
      page,
      page_size: pageSize,
      search: search || undefined,
      tag: tag || undefined,
      domain: domain || undefined,
      status: status || undefined,
    });

    // 转换为 Console 期望的响应格式
    return c.json({
      items: result.items.map(item => ({
        id: item.id,
        title: item.title,
        content: item.content,
        summary: item.summary,
        domain: item.domain,
        tags: item.tags,
        status: item.status,
        confidence: item.confidence,
        source_memory_ids: [], // 从 evidence 表衍生，后续可扩展
        created_at: item.created_at,
        updated_at: item.updated_at,
      })),
      total: result.total,
      page: result.page,
      page_size: result.page_size,
    });
  });

  // 知识详情
  app.get('/api/v1/knowledge/:id', async (c) => {
    const id = c.req.param('id');
    const page = getKnowledgePageById(id);
    if (!page) throw new NotFoundError('knowledge', id);

    return c.json({
      id: page.id,
      title: page.title,
      content: page.content,
      summary: page.summary,
      domain: page.domain,
      tags: page.tags,
      status: page.status,
      confidence: page.confidence,
      source_memory_ids: [],
      created_at: page.created_at,
      updated_at: page.updated_at,
    });
  });

  // 删除/归档知识
  app.delete('/api/v1/knowledge/:id', async (c) => {
    const id = c.req.param('id');
    const mode = (c.req.query('mode') ?? 'archive') as 'archive' | 'delete';

    if (mode !== 'archive' && mode !== 'delete') {
      throw new ValidationError('Invalid mode', { mode, valid_modes: ['archive', 'delete'] });
    }

    const success = deleteOrArchiveKnowledgePage(id, mode);
    if (!success) throw new NotFoundError('knowledge', id);

    return c.json({ deleted: true });
  });

  // ── 💡 MINIMEM-002: 灵感层 REST API ──

  // 获取灵感列表（支持状态/领域过滤、分页）
  app.get('/api/v1/inspirations', async (c) => {
    const db = getDb();
    const status = c.req.query('status');
    const domain = c.req.query('domain');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    let sql = `SELECT id, title, content, hypothesis, origin, status, confidence, actionability, novelty,
               incubation_count, domain, created_at, updated_at, expires_at
               FROM inspirations WHERE branch = 'main'`;
    const values: unknown[] = [];

    if (status) {
      sql += ' AND status = ?';
      values.push(status);
    }
    if (domain) {
      sql += ' AND domain = ?';
      values.push(domain);
    }

    // 统计总数
    const countSql = sql.replace(/SELECT[\s\S]+?FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = db.prepare(countSql).get(...values) as { total: number } | undefined;
    const total = countResult?.total ?? 0;

    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    values.push(limit, offset);

    const inspirations = db.prepare(sql).all(...values);
    return c.json({ inspirations, total, limit, offset });
  });

  // 获取单条灵感详情
  app.get('/api/v1/inspiration/:id', async (c) => {
    const id = c.req.param('id');
    const db = getDb();
    const insp = db.prepare('SELECT * FROM inspirations WHERE id = ?').get(id);
    if (!insp) throw new NotFoundError('inspiration', id);
    return c.json(insp);
  });

  // 评分反馈
  app.post('/api/v1/inspiration/:id/rate', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json() as { rating: number; comment?: string };
    const db = getDb();
    const timestamp = now();

    const rating = Math.min(5, Math.max(1, Math.round(body.rating ?? 3)));

    const insp = db.prepare('SELECT id, confidence, actionability FROM inspirations WHERE id = ?').get(id) as { id: string; confidence: number; actionability: number } | undefined;
    if (!insp) throw new NotFoundError('inspiration', id);

    const confidenceDelta = (rating - 3) * 0.1;
    const newConfidence = Math.min(1, Math.max(0, insp.confidence + confidenceDelta));

    db.prepare('UPDATE inspirations SET confidence = ?, updated_at = ? WHERE id = ?').run(newConfidence, timestamp, id);

    db.prepare(`
      INSERT INTO compile_queue (id, source_type, content, target_page, priority, status, created_at)
      VALUES (?, 'feedback', ?, NULL, 4, 'pending', ?)
    `).run(generateId(), JSON.stringify({ inspiration_id: id, rating, comment: body.comment, type: 'inspiration_rating' }), timestamp);

    return c.json({ rated: true, id, rating, new_confidence: newConfidence });
  });

  // 标记已行动
  app.post('/api/v1/inspiration/:id/act', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json() as { outcome: string };
    const db = getDb();
    const timestamp = now();

    const insp = db.prepare('SELECT id, status, title FROM inspirations WHERE id = ?').get(id) as { id: string; status: string; title: string } | undefined;
    if (!insp) throw new NotFoundError('inspiration', id);

    db.prepare("UPDATE inspirations SET status = 'acted', acted_outcome = ?, updated_at = ? WHERE id = ?").run(body.outcome, timestamp, id);

    db.prepare(`
      INSERT INTO compile_queue (id, source_type, content, target_page, priority, status, created_at)
      VALUES (?, 'inspiration', ?, NULL, 6, 'pending', ?)
    `).run(generateId(), JSON.stringify({ inspiration_id: id, title: insp.title, outcome: body.outcome, action: 'acted' }), timestamp);

    return c.json({ acted: true, id, title: insp.title });
  });

  // Dismiss 单条灵感（归档或物理删除）
  app.delete('/api/v1/inspiration/:id', async (c) => {
    const id = c.req.param('id');
    const mode = c.req.query('mode') ?? 'archive';  // archive | delete
    const reason = c.req.query('reason') ?? 'user_dismissed';
    const db = getDb();
    const timestamp = now();

    const insp = db.prepare('SELECT id, title, status FROM inspirations WHERE id = ?').get(id) as { id: string; title: string; status: string } | undefined;
    if (!insp) throw new NotFoundError('inspiration', id);

    if (mode === 'delete') {
      db.prepare('DELETE FROM inspirations WHERE id = ?').run(id);
    } else {
      db.prepare("UPDATE inspirations SET status = 'archived', updated_at = ? WHERE id = ?").run(timestamp, id);
    }

    // 记录负反馈
    db.prepare(`
      INSERT INTO compile_queue (id, source_type, content, target_page, priority, status, created_at)
      VALUES (?, 'feedback', ?, NULL, 3, 'pending', ?)
    `).run(generateId(), JSON.stringify({ inspiration_id: id, title: insp.title, action: 'dismissed', reason, mode }), timestamp);

    return c.json({ dismissed: 1, id, mode, reason });
  });

  // 批量 Dismiss（按状态清理）
  app.post('/api/v1/inspirations/dismiss', async (c) => {
    const body = await c.req.json() as { status?: string; ids?: string[]; mode?: string; reason?: string; domain?: string };
    const db = getDb();
    const timestamp = now();
    const mode = body.mode ?? 'archive';
    const reason = body.reason ?? 'user_dismissed';

    let dismissed = 0;

    // 按 ID 列表批量 dismiss
    if (body.ids && body.ids.length > 0) {
      const placeholders = body.ids.map(() => '?').join(',');

      if (mode === 'delete') {
        const result = db.prepare(`DELETE FROM inspirations WHERE id IN (${placeholders})`).run(...body.ids);
        dismissed = result.changes;
      } else {
        const result = db.prepare(`UPDATE inspirations SET status = 'archived', updated_at = ? WHERE id IN (${placeholders})`).run(timestamp, ...body.ids);
        dismissed = result.changes;
      }
    }
    // 按状态批量 dismiss
    else if (body.status) {
      let sql: string;
      const values: unknown[] = [];

      if (mode === 'delete') {
        sql = "DELETE FROM inspirations WHERE status = ? AND branch = 'main'";
      } else {
        sql = "UPDATE inspirations SET status = 'archived', updated_at = ? WHERE status = ? AND branch = 'main'";
        values.push(timestamp);
      }
      values.push(body.status);

      if (body.domain) {
        sql += ' AND domain = ?';
        values.push(body.domain);
      }

      const result = db.prepare(sql).run(...values);
      dismissed = result.changes;
    } else {
      return c.json({ error: 'Either ids or status is required' }, 400);
    }

    // 记录批量负反馈
    if (dismissed > 0) {
      db.prepare(`
        INSERT INTO compile_queue (id, source_type, content, target_page, priority, status, created_at)
        VALUES (?, 'feedback', ?, NULL, 3, 'pending', ?)
      `).run(generateId(), JSON.stringify({ action: 'batch_dismissed', ids: body.ids, status: body.status, count: dismissed, reason, mode, domain: body.domain }), timestamp);
    }

    return c.json({ dismissed, mode, reason });
  });

  // ── R-020: Temperature 查询 ──

  app.get('/api/v1/admin/temperature', async (c) => {
    return c.json(getTemperatureDistribution());
  });

  // ── 系统 ──

  // Issue-22: 版本 & Surface 同步端点
  app.get('/api/v1/version', async (c) => {
    const { getSurfacesVersionInfo } = await import('../surface/index.js');
    const versionInfo = getSurfacesVersionInfo();
    const db = getDb();
    const lastDream = db.prepare(
      'SELECT created_at FROM dream_logs ORDER BY created_at DESC LIMIT 1'
    ).get() as { created_at: string } | undefined;

    return c.json({
      version: '0.1.0',
      etag: versionInfo.etag,
      surfaces_version: versionInfo.surfaces_version,
      last_dream_at: lastDream?.created_at ?? null,
      last_updated: versionInfo.last_updated,
    });
  });

  // TODO-019 / T-019.3: 健康端点调用完整 checkHealth() 并返回告警
  app.get('/api/v1/health', async (c) => {
    try {
      const { checkHealth } = await import('../lifecycle/health.js');
      const report = checkHealth();
      return c.json(report);
    } catch {
      // fallback 到基础统计
      return c.json({
        status: 'healthy',
        version: '0.2.0',
        layers: {
          L1: countExperiences(),
          L2: countWorldFacts(),
          L3: countObservations(),
          L4: countMentalModels(),
          knowledge_pages: countKnowledgePages(),
        },
      });
    }
  });

  // TODO-019 / T-019.2: Prometheus 指标端点（已移入 /api/ 前缀下，受 auth 保护）
  app.get('/api/v1/metrics', async (c) => {
    const { collectMetrics } = await import('../observability/metrics.js');
    const metricsText = await collectMetrics();
    return new Response(metricsText, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      },
    });
  });

  app.get('/api/v1/admin/stats', async (c) => {
    return c.json({
      experiences: countExperiences(),
      world_facts: countWorldFacts(),
      observations: countObservations(),
      mental_models: countMentalModels(),
      knowledge_pages: countKnowledgePages(),
    });
  });

  // 404
  app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND', details: null }, 404));

  // 错误处理 — 适配 MiniMemError 层次 + Zod 校验错误，统一响应格式
  app.onError((err, c) => {
    // Zod 校验错误：返回 400
    if (err instanceof z.ZodError) {
      log.warn({ issues: err.issues }, 'Request validation failed');
      return c.json({
        error: 'Request validation failed',
        code: 'VALIDATION_ERROR',
        details: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      }, 400);
    }

    if (err instanceof MiniMemError) {
      // 自定义错误：使用语义化的 code、statusCode 和 details
      log.warn({ err, code: err.code, statusCode: err.statusCode }, 'Handled error');
      return c.json({
        error: err.message,
        code: err.code,
        details: err.details ?? null,
      }, err.statusCode as any);
    }

    // 未知错误：500 + 隐藏内部信息（生产环境）
    log.error({ err }, 'Unhandled error');
    const isDev = process.env.NODE_ENV !== 'production';
    return c.json({
      error: isDev ? err.message : 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: null,
    }, 500);
  });

  return app;
}
