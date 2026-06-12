// ============================================================
// MiniMem — Hints Engine (MINIMEM-006 T-H01.1)
// ============================================================
// Hint-Driven Recall 核心编排器
// 管线: skip 判断 → 缓存查询 → embedding → 多路信号并行检索 → 融合评分 → 格式化输出
// 延迟预算: ≤200ms

import { getLogger } from '../common/logger.js';
import type { RecallConfig, HintRequest, HintResponse, SignalResult } from './types.js';
import { shouldSkip } from './skip-rules.js';
import {
  computeSemanticSignal,
  computeEntitySignal,
  extractEntities,
  computeTimeSignal,
  computeGraphSignal,
} from './signals/index.js';
import { fuseScores, type FusionWeights } from './score-fusion.js';
import { formatHints } from './hint-formatter.js';
import { getHintsCache, hashMessage } from './cache.js';
import { recordHintsRequest, recordSkip, recordSignal, recordCacheHit } from './metrics.js';

const log = getLogger('recall:engine');

/**
 * HintsEngine — Hint-Driven Recall 核心引擎
 *
 * 职责：
 * 1. 接收用户消息，判断是否需要召回
 * 2. 并行执行多路信号检索（语义 / 实体 / 时间 / 图关联）
 * 3. 融合评分 + 层级加权
 * 4. 格式化为轻量 Hint（≤200 tokens）
 * 5. 在 200ms 延迟预算内返回
 */
export class HintsEngine {
  private config: RecallConfig['hints'];

  constructor(config?: Partial<RecallConfig['hints']>) {
    this.config = {
      max_hints: config?.max_hints ?? 3,
      min_relevance: config?.min_relevance ?? 0.3,
      token_budget: config?.token_budget ?? 200,
      summary_max_chars: config?.summary_max_chars ?? 80,
      skip_min_length: config?.skip_min_length ?? 10,
      signals: {
        semantic_weight: config?.signals?.semantic_weight ?? 0.50,
        entity_weight: config?.signals?.entity_weight ?? 0.25,
        time_weight: config?.signals?.time_weight ?? 0.15,
        graph_weight: config?.signals?.graph_weight ?? 0.10,
      },
      cache: {
        embedding_ttl: config?.cache?.embedding_ttl ?? 300,
        summary_ttl: config?.cache?.summary_ttl ?? 600,
        session_reuse_threshold: config?.cache?.session_reuse_threshold ?? 0.9,
      },
    };
  }

  /**
   * 生成 Hints — 主入口
   *
   * 管线流程:
   * 1. Skip 判断 (< 1ms)
   * 2. 实体提取 (< 5ms)
   * 3. 多路信号并行检索 (semantic ~50ms, entity ~20ms, time ~10ms, graph ~20ms)
   * 4. 融合评分 (< 5ms)
   * 5. 格式化输出 (< 10ms)
   * 总延迟目标: ≤200ms
   */
  async generateHints(request: HintRequest): Promise<HintResponse> {
    const startTime = Date.now();

    // ── Step 1: Skip 判断 ──
    const skipResult = shouldSkip(request.message, this.config.skip_min_length);
    if (skipResult.skip) {
      log.debug({ reason: skipResult.reason }, 'Hint generation skipped');
      recordSkip(skipResult.reason);
      recordHintsRequest('skipped', 0, Date.now() - startTime);
      return this.emptyResponse(startTime);
    }

    // ── Step 1.5: Session 缓存查询 ──
    const cache = getHintsCache(this.config.cache);
    const messageHash = hashMessage(request.message);
    const sessionId = request.domain ?? 'default';  // 用 domain 或 default 作为 session 隔离

    const cachedResponse = cache.getSessionResponse(sessionId, messageHash);
    if (cachedResponse) {
      log.info({ message_length: request.message.length, cache: 'session_hit' }, 'Hints from session cache');
      recordCacheHit('session');
      const cacheLatency = Date.now() - startTime;
      recordHintsRequest('ok', cachedResponse.hints.length, cacheLatency);
      return {
        ...cachedResponse,
        meta: {
          ...cachedResponse.meta,
          search_time_ms: cacheLatency,
        },
      };
    }

    // ── Step 2: 实体提取（同步，< 5ms）──
    const entities = extractEntities(request.message);

    // ── Step 3: 多路信号并行检索 ──
    const allSignals = await this.computeAllSignals(request, entities);

    if (allSignals.length === 0) {
      log.debug('No signals returned, empty response');
      return this.emptyResponse(startTime);
    }

    // ── Step 4: 融合评分 ──
    const weights: FusionWeights = {
      semantic_weight: this.config.signals.semantic_weight,
      entity_weight: this.config.signals.entity_weight,
      time_weight: this.config.signals.time_weight,
      graph_weight: this.config.signals.graph_weight,
    };

    const candidates = fuseScores(allSignals, weights, this.config.min_relevance);

    if (candidates.length === 0) {
      log.debug('No candidates passed fusion threshold');
      return this.emptyResponse(startTime);
    }

    // ── Step 5: 格式化 Hints ──
    const maxHints = request.max_hints ?? this.config.max_hints;
    const tokenBudget = request.token_budget ?? this.config.token_budget;

    const hints = formatHints(
      candidates,
      maxHints,
      tokenBudget,
      this.config.summary_max_chars,
    );

    const searchTimeMs = Date.now() - startTime;

    // Token count 估算
    const tokenCount = hints.reduce(
      (sum, h) => sum + this.estimateHintTokens(h),
      0,
    );

    const response: HintResponse = {
      hints,
      meta: {
        search_time_ms: searchTimeMs,
        total_candidates: candidates.length,
        token_count: tokenCount,
      },
    };

    // ── Step 6: 写入 Session 缓存 ──
    cache.setSessionResponse(sessionId, messageHash, response);

    // ── 记录指标 ──
    recordHintsRequest('ok', hints.length, searchTimeMs);

    log.info(
      {
        message_length: request.message.length,
        entities_count: entities.length,
        signals_count: allSignals.length,
        candidates_count: candidates.length,
        hints_count: hints.length,
        search_time_ms: searchTimeMs,
        token_count: tokenCount,
      },
      'Hints generated',
    );

    return response;
  }

  /**
   * 并行执行 4 路信号检索
   *
   * 语义信号是 async 的（需要 embedding），其余 3 路是同步的。
   * 使用 Promise.allSettled 确保任何单路失败不影响整体。
   */
  private async computeAllSignals(
    request: HintRequest,
    entities: string[],
  ): Promise<SignalResult[]> {
    const { message, domain } = request;
    const topK = 20; // 每路信号的粗筛 top-K

    // 构造上下文增强的查询文本（如果有对话历史）
    const queryText = this.buildQueryText(request);

    const signalStartTime = Date.now();

    // 并行执行所有信号
    const [semanticResult, entityResult, timeResult, graphResult] =
      await Promise.allSettled([
        // 语义信号（async，需要 embedding）
        computeSemanticSignal(queryText, topK, this.config.min_relevance, domain),
        // 实体信号（sync，包装成 Promise）
        Promise.resolve(computeEntitySignal(message, topK)),
        // 时间信号（sync，需要语义结果中的 candidateIds → 延迟传入 undefined，无候选时走独立路径）
        Promise.resolve(computeTimeSignal(message, undefined, topK, domain)),
        // 图关联信号（sync）
        Promise.resolve(computeGraphSignal(entities, topK)),
      ]);

    const signalEndTime = Date.now();
    const signalDuration = signalEndTime - signalStartTime;

    // 收集所有成功的结果
    const allSignals: SignalResult[] = [];

    if (semanticResult.status === 'fulfilled') {
      allSignals.push(...semanticResult.value);
      recordSignal('semantic', true, signalDuration);
    } else {
      // T-H02.2: Embedding 不可用时的 fallback（降级为仅 entity + time）
      log.warn({ err: semanticResult.reason }, 'Semantic signal failed, degrading to entity+time only');
      recordSignal('semantic', false, signalDuration);
    }

    if (entityResult.status === 'fulfilled') {
      allSignals.push(...entityResult.value);
      recordSignal('entity', true, signalDuration);
    } else {
      log.warn({ err: entityResult.reason }, 'Entity signal failed');
      recordSignal('entity', false, signalDuration);
    }

    if (timeResult.status === 'fulfilled') {
      allSignals.push(...timeResult.value);
      recordSignal('time', true, signalDuration);
    } else {
      log.warn({ err: timeResult.reason }, 'Time signal failed');
      recordSignal('time', false, signalDuration);
    }

    if (graphResult.status === 'fulfilled') {
      allSignals.push(...graphResult.value);
      recordSignal('graph', true, signalDuration);
    } else {
      log.warn({ err: graphResult.reason }, 'Graph signal failed');
      recordSignal('graph', false, signalDuration);
    }

    // 如果语义信号成功，用其候选 ID 做时间信号增强（近期 boost）
    if (semanticResult.status === 'fulfilled' && semanticResult.value.length > 0) {
      const candidateIds = semanticResult.value.map(s => s.memory_id);
      try {
        const timeBoost = computeTimeSignal(message, candidateIds, topK, domain);
        allSignals.push(...timeBoost);
      } catch (err) {
        log.debug({ err }, 'Time boost for semantic candidates failed');
      }
    }

    return allSignals;
  }

  /**
   * 构建查询文本：用对话历史增强语义检索质量
   *
   * 如果提供了 context_summary 或 conversation_history，将其拼接以提升
   * embedding 的语境信息。但保持总长度合理（≤500字符）。
   */
  private buildQueryText(request: HintRequest): string {
    const parts: string[] = [request.message];

    // 加入上下文摘要
    if (request.context_summary) {
      parts.push(request.context_summary.slice(0, 200));
    }

    // 加入最近对话历史（取最后 1-2 轮的关键词）
    if (request.conversation_history && request.conversation_history.length > 0) {
      const recent = request.conversation_history.slice(-2).join(' ');
      parts.push(recent.slice(0, 150));
    }

    const combined = parts.join(' ');
    // 限制总查询文本长度，避免 embedding 输入过长
    return combined.length > 500 ? combined.slice(0, 500) : combined;
  }

  /**
   * 估算单条 Hint 的 token 数
   */
  private estimateHintTokens(hint: { summary: string; time_label: string; recall_query: string }): number {
    const text = `${hint.time_label}: ${hint.summary} → ${hint.recall_query}`;
    // 简易估算：中文 ~2字/token，英文 ~4字/token
    let tokens = 0;
    for (const char of text) {
      tokens += char.charCodeAt(0) > 127 ? 0.5 : 0.25;
    }
    return Math.ceil(tokens);
  }

  /**
   * 返回空响应
   */
  private emptyResponse(startTime: number): HintResponse {
    return {
      hints: [],
      meta: {
        search_time_ms: Date.now() - startTime,
        total_candidates: 0,
        token_count: 0,
      },
    };
  }
}
