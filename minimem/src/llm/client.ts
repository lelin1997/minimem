// ============================================================
// MiniMem — LLM 客户端（OpenAI 兼容接口）
// ============================================================

import { getLogger } from '../common/logger.js';
import { LLMError } from '../common/errors.js';
import { getConfig } from '../config/index.js';
import { estimateTokens, truncateForLLM } from '../common/utils.js';
import { getLLMRateLimiter, type LLMRateLimiter } from './rate-limiter.js';

const log = getLogger('llm');

export type ModelTier = 'heavy' | 'medium' | 'light';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  model?: string;
  tier?: ModelTier;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' } | { type: 'text' };
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

/**
 * LLM 客户端
 */
export class LLMClient {
  private baseUrl: string;
  private apiKey: string;
  private models: { heavy: string; medium: string; light: string };
  // Issue-6+21: Embedding 独立配置
  private embeddingEnabled: boolean;
  private embeddingModel: string;
  private embeddingDimensions: number;
  private embeddingBaseUrl: string;
  private embeddingApiKey: string;
  // Harness: 超时 + 重试
  private timeoutMs: number;
  private retryMaxAttempts: number;
  private retryBaseDelay: number;
  private retryMaxDelay: number;

  // P1: 输入截断配置
  private maxInputTokens: number;

  // P0+P1: LLM 限流器
  private rateLimiter: LLMRateLimiter;

  // P2: 成本跟踪
  private _metrics: LLMMetrics = {
    totalRequests: 0,
    totalErrors: 0,
    totalRetries: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalEmbeddingTokens: 0,
    totalLatencyMs: 0,
    requestsByTier: { heavy: 0, medium: 0, light: 0 },
    requestsByType: { chat: 0, chatJson: 0, embed: 0 },
  };

  constructor() {
    const config = getConfig();
    this.baseUrl = config.llm.base_url;
    this.apiKey = process.env[config.llm.api_key_env] ?? '';
    this.models = config.llm.models;

    // Embedding 独立配置：base_url/api_key_env 为空时复用 chat 的配置
    const emb = config.llm.embedding;
    this.embeddingEnabled = emb.enabled;
    this.embeddingModel = emb.model;
    this.embeddingDimensions = emb.dimensions;
    this.embeddingBaseUrl = emb.base_url || this.baseUrl;
    this.embeddingApiKey = emb.api_key_env
      ? (process.env[emb.api_key_env] ?? '')
      : this.apiKey;

    // 超时 + 重试配置
    this.timeoutMs = config.llm.timeout_ms ?? 30_000;
    this.retryMaxAttempts = config.llm.retry?.max_attempts ?? 3;
    this.retryBaseDelay = config.llm.retry?.base_delay_ms ?? 1_000;
    this.retryMaxDelay = config.llm.retry?.max_delay_ms ?? 10_000;

    // 输入截断配置（默认 6000 tokens，约为 8K 上下文窗口的 75%）
    this.maxInputTokens = config.llm.max_input_tokens ?? 6_000;

    // 限流器初始化（读取 llm.rate_limit 配置，如果有的话）
    const rlConfig = (config.llm as Record<string, unknown>).rate_limit as Record<string, unknown> | undefined;
    this.rateLimiter = getLLMRateLimiter(rlConfig ? {
      max_concurrency: (rlConfig.max_concurrency as number) ?? 3,
      min_interval_ms: (rlConfig.min_interval_ms as number) ?? 200,
      jitter_max_ms: (rlConfig.jitter_max_ms as number) ?? 500,
      quota_5h: (rlConfig.quota_5h as number) ?? 6000,
      quota_weekly: (rlConfig.quota_weekly as number) ?? 45000,
      quota_monthly: (rlConfig.quota_monthly as number) ?? 90000,
      quota_warn_threshold: (rlConfig.quota_warn_threshold as number) ?? 0.15,
      degrade_on_exhaustion: (rlConfig.degrade_on_exhaustion as boolean) ?? true,
    } : undefined);

    if (!this.apiKey) {
      log.warn(`LLM API key not set (env: ${config.llm.api_key_env}). LLM features will be degraded.`);
    }

    if (this.embeddingEnabled && !this.embeddingApiKey) {
      log.warn('Embedding API key not available. Embedding features will be disabled.');
    }
  }

  /**
   * Chat Completion（含限流 + 输入截断 + 超时 + 指数退避重试 + 可观测性）
   *
   * @param options Chat 请求选项
   * @param critical 是否为关键请求（降级模式下仍会执行），默认 true
   */
  async chat(options: ChatCompletionOptions, critical = true): Promise<ChatCompletionResult> {
    const model = options.model ?? this.getModel(options.tier ?? 'medium');
    const tier = options.tier ?? 'medium';
    const startTime = Date.now();

    // P0+P1: 限流器 — 获取许可（降级模式下非关键请求会被跳过）
    const permitted = await this.rateLimiter.acquire(critical);
    if (!permitted) {
      // 降级跳过 — 返回空结果，调用方通过 fallback 处理
      this._metrics.totalErrors++;
      throw new LLMError('LLM request skipped: rate limiter degraded mode', model);
    }

    // P1: 输入截断保护 — 检查并截断超长 user message
    const guardedMessages = this.guardInputLength(options.messages);

    const body: Record<string, unknown> = {
      model,
      messages: guardedMessages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 2048,
    };

    if (options.response_format) {
      body.response_format = options.response_format;
    }

    // Issue-REPAIR-6: JSON 模式下对推理模型自动关闭 thinking
    // 推理模型（如 kimi-k2.5, hunyuan-2.0-thinking, hunyuan-t1）开启 thinking 时，
    // content 可能为空或非 JSON，通过 thinking.type = "disabled" 让模型直接返回结构化内容
    // 注意：非推理模型（如 glm-5, hunyuan-turbos 等）不发送此参数，避免未知字段报错
    const THINKING_MODELS = ['kimi-k2.5', 'kimi-k-2-5', 'hunyuan-2.0-thinking', 'hunyuan-t1'];
    if (options.response_format?.type === 'json_object' && THINKING_MODELS.some(m => model.includes(m))) {
      body.thinking = { type: 'disabled' };
      log.debug({ model }, 'Thinking model + JSON mode detected, disabling thinking for reliable JSON output');
    }

    log.debug({ model, messageCount: guardedMessages.length }, 'LLM chat request');

    // P2: 可观测性 — 统计
    this._metrics.totalRequests++;
    this._metrics.requestsByTier[tier]++;
    this._metrics.requestsByType.chat++;

    try {
      const result = await this.fetchWithRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        },
        model,
        async (response) => {
          const data = await response.json() as Record<string, unknown>;

          // Issue-REPAIR-6: 鲁棒解析 — 兼容多种大模型返回格式
          const content = this.extractContent(data);
          const usage = this.extractUsage(data);

          const result: ChatCompletionResult = {
            content,
            model: (data.model as string) ?? model,
            usage,
          };

          // P2: 累计 token 消耗
          this._metrics.totalPromptTokens += result.usage.prompt_tokens;
          this._metrics.totalCompletionTokens += result.usage.completion_tokens;

          return result;
        },
      );

      const latencyMs = Date.now() - startTime;
      this._metrics.totalLatencyMs += latencyMs;

      // P2: per-request 可观测性日志
      log.debug({
        model,
        tier,
        tokens: result.usage.total_tokens,
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens,
        latencyMs,
      }, 'LLM chat complete');

      return result;
    } catch (err) {
      this._metrics.totalErrors++;
      throw err;
    } finally {
      // P0+P1: 限流器 — 释放许可（无论成功失败都释放）
      this.rateLimiter.release();
    }
  }

  /**
   * JSON 模式 Chat（返回解析后的 JSON）
   *
   * Issue-REPAIR-6: 增强鲁棒性 —
   * 1. 优先 JSON.parse 直接解析
   * 2. 失败后尝试从 markdown 代码块 / 混杂文本中提取 JSON
   * 3. 最终 fallback 保底
   *
   * REQ-016: LLM 缓存 — JSON 模式请求自动走缓存
   */
  async chatJson<T>(options: Omit<ChatCompletionOptions, 'response_format'> & { fallback: T }): Promise<T> {
    // P2: chatJson 单独计数（chat() 内部会计 chat 次数，这里只计 chatJson wrapper）
    this._metrics.requestsByType.chatJson++;

    // REQ-016: 尝试从缓存读取
    const model = options.model ?? this.getModel(options.tier ?? 'medium');
    let cacheModule: typeof import('./cache.js') | null = null;
    try {
      cacheModule = await import('./cache.js');
      const cached = cacheModule.getLLMCache().get(model, options.messages);
      if (cached) {
        const parsed = this.robustJsonParse<T>(cached.response);
        if (parsed !== null) {
          log.debug({ model }, 'LLM cache hit for chatJson');
          return parsed;
        }
      }
    } catch {
      // 缓存不可用（如表还不存在），继续正常调用
    }

    try {
      const result = await this.chat({
        ...options,
        response_format: { type: 'json_object' },
        temperature: options.temperature ?? 0.3,
        // Issue-REPAIR-7: JSON 返回通常更长（结构化数据），默认 4096 避免截断
        max_tokens: options.max_tokens ?? 4096,
      });

      const parsed = this.robustJsonParse<T>(result.content);
      if (parsed !== null) {
        // REQ-016: 写入缓存
        try {
          cacheModule?.getLLMCache().set(model, options.messages, result.content, result.usage as unknown as Record<string, number>);
        } catch {
          // 非关键路径
        }
        return parsed;
      }

      log.warn({ contentPreview: result.content.slice(0, 200) }, 'chatJson: all parse attempts failed, returning fallback');
      return options.fallback;
    } catch (err) {
      log.warn({ err }, 'JSON chat failed, returning fallback');
      return options.fallback;
    }
  }

  /**
   * Embedding（含限流 + 输入截断 + 超时 + 指数退避重试 + 可观测性）
   */
  async embed(text: string, model?: string): Promise<EmbeddingResult> {
    const embeddingModel = model ?? this.embeddingModel;
    const startTime = Date.now();

    // P0+P1: 限流器 — embedding 视为非关键请求（降级时跳过）
    const permitted = await this.rateLimiter.acquire(false);
    if (!permitted) {
      this._metrics.totalErrors++;
      throw new LLMError('Embedding request skipped: rate limiter degraded mode', embeddingModel);
    }

    // P1: Embedding 输入截断保护（embedding 模型通常上下文更短，用 maxInputTokens 的一半）
    const { text: guardedText, truncated } = truncateForLLM(text, Math.floor(this.maxInputTokens / 2));
    if (truncated) {
      log.warn({ originalTokens: estimateTokens(text), maxTokens: Math.floor(this.maxInputTokens / 2) }, 'Embedding input truncated');
    }

    // P2: 可观测性
    this._metrics.totalRequests++;
    this._metrics.requestsByType.embed++;

    try {
      const result = await this.fetchWithRetry(
        `${this.embeddingBaseUrl}/embeddings`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.embeddingApiKey}`,
          },
          body: JSON.stringify({
            model: embeddingModel,
            input: guardedText,
          }),
        },
        embeddingModel,
        async (response) => {
          const data = await response.json() as {
            data: Array<{ embedding: number[] }>;
            model: string;
            usage: { prompt_tokens: number; total_tokens: number };
          };

          // P2: 累计 embedding token 消耗
          this._metrics.totalEmbeddingTokens += data.usage.total_tokens;

          return {
            embedding: data.data[0].embedding,
            model: data.model,
            usage: data.usage,
          };
        },
      );

      const latencyMs = Date.now() - startTime;
      this._metrics.totalLatencyMs += latencyMs;

      log.debug({
        model: embeddingModel,
        tokens: result.usage.total_tokens,
        latencyMs,
        truncated,
      }, 'Embedding complete');

      return result;
    } catch (err) {
      this._metrics.totalErrors++;
      throw err;
    } finally {
      // P0+P1: 限流器 — 释放许可
      this.rateLimiter.release();
    }
  }

  /**
   * 批量 Embedding
   */
  async embedBatch(texts: string[], model?: string): Promise<EmbeddingResult[]> {
    // 逐个调用（部分 API 不支持批量）
    const results: EmbeddingResult[] = [];
    for (const text of texts) {
      results.push(await this.embed(text, model));
    }
    return results;
  }

  /**
   * 检查 LLM 是否可用
   */
  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * 检查 Embedding 是否可用（独立于 chat）
   */
  get isEmbeddingAvailable(): boolean {
    return this.embeddingEnabled && !!this.embeddingApiKey;
  }

  /**
   * 获取配置的 embedding 维度
   */
  get configuredEmbeddingDimensions(): number {
    return this.embeddingDimensions;
  }

  /**
   * 获取 LLM 可观测性指标快照
   */
  get metrics(): Readonly<LLMMetrics> {
    return { ...this._metrics };
  }

  /**
   * 重置指标（用于测试或定期采集后清零）
   */
  resetMetrics(): void {
    this._metrics = {
      totalRequests: 0,
      totalErrors: 0,
      totalRetries: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalEmbeddingTokens: 0,
      totalLatencyMs: 0,
      requestsByTier: { heavy: 0, medium: 0, light: 0 },
      requestsByType: { chat: 0, chatJson: 0, embed: 0 },
    };
  }

  /**
   * 获取 LLM 限流器统计快照（P0+P1 可观测性）
   */
  get rateLimiterStats() {
    return this.rateLimiter.stats;
  }

  private getModel(tier: ModelTier): string {
    return this.models[tier];
  }

  /**
   * P1: 输入长度保护 — 截断超长的 user/assistant message 内容
   *
   * system prompt 不截断（通常很短且是关键指令）。
   * user 和 assistant 消息按 maxInputTokens 截断。
   */
  private guardInputLength(messages: ChatMessage[]): ChatMessage[] {
    const maxPerMessage = this.maxInputTokens;
    let totalTruncated = 0;

    const guarded = messages.map(msg => {
      if (msg.role === 'system') return msg; // system prompt 不截断

      const est = estimateTokens(msg.content);
      if (est <= maxPerMessage) return msg;

      const { text, originalTokens } = truncateForLLM(msg.content, maxPerMessage);
      totalTruncated++;
      log.warn({
        role: msg.role,
        originalTokens,
        maxTokens: maxPerMessage,
      }, 'Message content truncated for LLM input guard');

      return { ...msg, content: text };
    });

    if (totalTruncated > 0) {
      log.info({ truncatedMessages: totalTruncated }, 'Input guard truncated messages');
    }

    return guarded;
  }

  /**
   * 判断 HTTP 状态码是否可重试
   * 429 (Rate Limit) / 500+ (Server Error) 可重试
   */
  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  /**
   * 统一的带超时 + 指数退避重试的 fetch 包装
   */
  private async fetchWithRetry<T>(
    url: string,
    init: RequestInit,
    modelLabel: string,
    parseResponse: (response: Response) => Promise<T>,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryMaxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();

          // P0: 429 — 解析 Retry-After 头，通知限流器设置全局退避
          if (response.status === 429) {
            const retryAfterHeader = response.headers.get('Retry-After') ?? response.headers.get('retry-after');
            this.rateLimiter.handle429(retryAfterHeader, errorText);
          }

          // 如果是可重试的状态码且还有重试次数
          if (this.isRetryableStatus(response.status) && attempt < this.retryMaxAttempts) {
            // P0: 使用限流器计算带 Jitter 的退避延迟
            const delay = this.rateLimiter.calculateBackoff(this.retryBaseDelay, attempt, this.retryMaxDelay);
            log.warn({ status: response.status, attempt, delay, model: modelLabel }, 'Retryable LLM error, backing off with jitter');
            this._metrics.totalRetries++;
            await this.sleep(delay);
            lastError = new LLMError(`LLM API error ${response.status}: ${errorText}`, modelLabel);
            continue;
          }

          throw new LLMError(`LLM API error ${response.status}: ${errorText}`, modelLabel);
        }

        return await parseResponse(response);
      } catch (err) {
        if (err instanceof LLMError) {
          lastError = err;
          // LLMError 不重试（除非是上面 continue 的路径）
          throw err;
        }

        const error = err as Error;

        // AbortError = 超时
        if (error.name === 'AbortError') {
          lastError = new LLMError(`LLM request timed out after ${this.timeoutMs}ms`, modelLabel);
          if (attempt < this.retryMaxAttempts) {
            const delay = this.rateLimiter.calculateBackoff(this.retryBaseDelay, attempt, this.retryMaxDelay);
            log.warn({ attempt, delay, model: modelLabel, timeoutMs: this.timeoutMs }, 'LLM request timeout, retrying with jitter');
            await this.sleep(delay);
            continue;
          }
          throw lastError;
        }

        // 网络错误等也重试
        lastError = new LLMError(`LLM request failed: ${error.message}`, modelLabel);
        if (attempt < this.retryMaxAttempts) {
          const delay = this.rateLimiter.calculateBackoff(this.retryBaseDelay, attempt, this.retryMaxDelay);
          log.warn({ attempt, delay, model: modelLabel, err: error.message }, 'LLM request error, retrying with jitter');
          await this.sleep(delay);
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timeout);
      }
    }

    // 理论上不会到这里，但 TypeScript 需要
    throw lastError ?? new LLMError('LLM request failed after all retries', modelLabel);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Issue-REPAIR-6: 鲁棒响应解析 ──

  /**
   * 从大模型响应中鲁棒地提取文本内容
   *
   * 兼容格式：
   * 1. OpenAI 标准: choices[0].message.content
   * 2. 推理模型 (kimi-k2.5 等): choices[0].message.reasoning_content（content 为空时）
   * 3. 部分模型: choices[0].text（旧 completions 格式）
   * 4. 部分模型: choices[0].delta.content（streaming 残留格式）
   * 5. 直接 output/result 字段（某些自研 API）
   */
  private extractContent(data: Record<string, unknown>): string {
    try {
      const choices = data.choices as Array<Record<string, unknown>> | undefined;
      if (choices && choices.length > 0) {
        const choice = choices[0];

        // 标准 message 格式
        const msg = choice.message as Record<string, unknown> | undefined;
        if (msg) {
          // 优先 content（非空字符串）
          if (typeof msg.content === 'string' && msg.content.trim()) {
            return msg.content;
          }
          // 推理模型 fallback: reasoning_content
          if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
            log.debug('Using reasoning_content as content fallback (thinking model)');
            return msg.reasoning_content;
          }
        }

        // 旧 completions 格式: choices[0].text
        if (typeof choice.text === 'string' && choice.text.trim()) {
          return choice.text;
        }

        // streaming 残留: choices[0].delta.content
        const delta = choice.delta as Record<string, unknown> | undefined;
        if (delta && typeof delta.content === 'string' && delta.content.trim()) {
          return delta.content;
        }
      }

      // 某些自研 API 直接 output/result
      if (typeof data.output === 'string' && data.output.trim()) {
        return data.output;
      }
      if (typeof data.result === 'string' && data.result.trim()) {
        return data.result;
      }

      log.warn({ dataKeys: Object.keys(data) }, 'Could not extract content from LLM response, returning empty');
      return '';
    } catch (err) {
      log.warn({ err }, 'Error extracting content from LLM response');
      return '';
    }
  }

  /**
   * 从大模型响应中鲁棒地提取 usage 信息
   *
   * 兼容格式：
   * 1. OpenAI 标准: { prompt_tokens, completion_tokens, total_tokens }
   * 2. 字段缺失时自动补零
   * 3. total_tokens 缺失时自动求和
   */
  private extractUsage(data: Record<string, unknown>): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
    const defaultUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    try {
      const usage = data.usage as Record<string, unknown> | undefined;
      if (!usage) {
        log.debug('No usage field in LLM response, using defaults');
        return defaultUsage;
      }

      const prompt = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
      const completion = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
      const total = typeof usage.total_tokens === 'number' ? usage.total_tokens : (prompt + completion);

      return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
    } catch {
      return defaultUsage;
    }
  }

  /**
   * 鲁棒 JSON 解析 — 尝试多种策略从大模型返回中提取有效 JSON
   *
   * 策略顺序：
   * 1. 直接 JSON.parse
   * 2. trim 后 JSON.parse（去掉 BOM、空白）
   * 3. 从 markdown 代码块中提取 (```json ... ``` 或 ``` ... ```)
   * 4. 正则查找第一个 { ... } 或 [ ... ]
   * 5. 返回 null（调用方决定 fallback）
   */
  private robustJsonParse<T>(raw: string): T | null {
    if (!raw || !raw.trim()) return null;

    // 策略 1: 直接解析
    try {
      return JSON.parse(raw) as T;
    } catch { /* continue */ }

    const trimmed = raw.trim();

    // 策略 2: 去掉 BOM 和首尾空白
    try {
      const cleaned = trimmed.replace(/^\uFEFF/, '');
      return JSON.parse(cleaned) as T;
    } catch { /* continue */ }

    // 策略 3: markdown 代码块提取 — ```json\n{...}\n``` 或 ```\n{...}\n```
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim()) as T;
      } catch { /* continue */ }
    }

    // 策略 4: 找到第一个 JSON 对象或数组
    const jsonObjMatch = trimmed.match(/(\{[\s\S]*\})/);
    if (jsonObjMatch) {
      try {
        return JSON.parse(jsonObjMatch[1]) as T;
      } catch { /* continue */ }
    }
    const jsonArrMatch = trimmed.match(/(\[[\s\S]*\])/);
    if (jsonArrMatch) {
      try {
        return JSON.parse(jsonArrMatch[1]) as T;
      } catch { /* continue */ }
    }

    // 策略 5: 放弃
    log.debug({ rawPreview: raw.slice(0, 100) }, 'robustJsonParse: all strategies exhausted');
    return null;
  }
}

// ── LLM 可观测性指标 ──

export interface LLMMetrics {
  totalRequests: number;
  totalErrors: number;
  totalRetries: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalEmbeddingTokens: number;
  totalLatencyMs: number;
  requestsByTier: Record<ModelTier, number>;
  requestsByType: { chat: number; chatJson: number; embed: number };
}

// ── 单例 ──

let _llm: LLMClient | null = null;

export function getLLM(): LLMClient {
  if (!_llm) {
    _llm = new LLMClient();
  }
  return _llm;
}
