// ============================================================
// MiniMem — LLM 限流器（Coding Plan 限流保护）
// ============================================================
//
// 针对腾讯云 Coding Plan 的三级滑动窗口限额设计：
// - P0: Jitter（退避随机化）、429 Retry-After 解析
// - P1: 全局并发限制、请求最小间隔
// - P1: Coding Plan 配额跟踪 + 预警
// - P1: 配额耗尽降级策略（error code 20097）
//
// 设计原则：
// 1. 不侵入 LLMClient 核心逻辑，通过 acquire/release 信号量模式集成
// 2. 限流器是全局单例，所有 LLM 调用共享
// 3. 配额跟踪基于滑动窗口，与 Coding Plan 的 5h/周/月窗口对齐

import { getLogger } from '../common/logger.js';

const log = getLogger('llm:rate-limiter');

// ── 配置接口 ──

export interface LLMRateLimiterConfig {
  /** 最大并发 LLM 请求数（默认 3） */
  max_concurrency: number;
  /** 请求最小间隔（毫秒，默认 200ms） */
  min_interval_ms: number;
  /** Jitter 随机范围上限（毫秒，默认 500ms，在退避延迟基础上叠加 [0, jitter_max_ms]） */
  jitter_max_ms: number;
  /** Coding Plan 5h 窗口配额（默认 6000 for Pro） */
  quota_5h: number;
  /** Coding Plan 周窗口配额（默认 45000 for Pro） */
  quota_weekly: number;
  /** Coding Plan 月窗口配额（默认 90000 for Pro） */
  quota_monthly: number;
  /** 配额预警阈值（剩余百分比，默认 0.15 即 15%） */
  quota_warn_threshold: number;
  /** 配额耗尽时是否启用降级（跳过非关键 LLM 调用，默认 true） */
  degrade_on_exhaustion: boolean;
}

// ── 配额窗口 ──

interface QuotaWindow {
  count: number;
  resetAt: number; // Unix timestamp (ms)
  limit: number;
}

// ── 限流器状态 ──

export interface RateLimiterStats {
  /** 当前并发请求数 */
  activeConcurrency: number;
  /** 等待中的请求数 */
  waitingCount: number;
  /** 累计被限流的请求数 */
  totalThrottled: number;
  /** 累计 429 次数 */
  total429s: number;
  /** 当前是否处于降级模式 */
  isDegraded: boolean;
  /** 5h 窗口剩余配额 */
  quota5hRemaining: number;
  /** 周窗口剩余配额 */
  quotaWeeklyRemaining: number;
  /** 月窗口剩余配额 */
  quotaMonthlyRemaining: number;
}

/**
 * LLM 限流器
 *
 * 功能：
 * 1. 并发信号量 — 限制同时进行的 LLM 请求数
 * 2. 请求间隔 — 两次请求之间强制最小间隔
 * 3. Jitter — 退避延迟随机化，避免惊群效应
 * 4. 429 Retry-After — 解析服务端返回的 Retry-After 头
 * 5. 配额跟踪 — 滑动窗口追踪 5h/周/月配额消耗
 * 6. 降级模式 — 配额即将耗尽时跳过非关键调用
 */
export class LLMRateLimiter {
  private config: LLMRateLimiterConfig;

  // 并发控制
  private activeCount = 0;
  private waitQueue: Array<() => void> = [];

  // 请求间隔
  private lastRequestTime = 0;

  // 429 全局退避
  private globalRetryAfter = 0; // Unix timestamp (ms)，在此之前不允许发请求

  // 配额窗口
  private quota5h: QuotaWindow;
  private quotaWeekly: QuotaWindow;
  private quotaMonthly: QuotaWindow;

  // 降级状态
  private _isDegraded = false;

  // 统计
  private _totalThrottled = 0;
  private _total429s = 0;

  constructor(config?: Partial<LLMRateLimiterConfig>) {
    this.config = {
      max_concurrency: config?.max_concurrency ?? 3,
      min_interval_ms: config?.min_interval_ms ?? 200,
      jitter_max_ms: config?.jitter_max_ms ?? 500,
      quota_5h: config?.quota_5h ?? 6000,
      quota_weekly: config?.quota_weekly ?? 45000,
      quota_monthly: config?.quota_monthly ?? 90000,
      quota_warn_threshold: config?.quota_warn_threshold ?? 0.15,
      degrade_on_exhaustion: config?.degrade_on_exhaustion ?? true,
    };

    const now = Date.now();
    this.quota5h = { count: 0, resetAt: now + 5 * 60 * 60 * 1000, limit: this.config.quota_5h };
    this.quotaWeekly = { count: 0, resetAt: now + 7 * 24 * 60 * 60 * 1000, limit: this.config.quota_weekly };
    this.quotaMonthly = { count: 0, resetAt: now + 30 * 24 * 60 * 60 * 1000, limit: this.config.quota_monthly };

    log.info({
      maxConcurrency: this.config.max_concurrency,
      minIntervalMs: this.config.min_interval_ms,
      quota5h: this.config.quota_5h,
    }, 'LLM rate limiter initialized');
  }

  /**
   * 获取当前限流器统计
   */
  get stats(): RateLimiterStats {
    this.refreshWindows();
    return {
      activeConcurrency: this.activeCount,
      waitingCount: this.waitQueue.length,
      totalThrottled: this._totalThrottled,
      total429s: this._total429s,
      isDegraded: this._isDegraded,
      quota5hRemaining: Math.max(0, this.quota5h.limit - this.quota5h.count),
      quotaWeeklyRemaining: Math.max(0, this.quotaWeekly.limit - this.quotaWeekly.count),
      quotaMonthlyRemaining: Math.max(0, this.quotaMonthly.limit - this.quotaMonthly.count),
    };
  }

  /**
   * 检查是否处于降级模式
   */
  get isDegraded(): boolean {
    return this._isDegraded;
  }

  /**
   * 获取请求前需要等待的毫秒数（用于调用方可选的预检查）
   * 返回 0 表示可以立即发请求
   */
  getWaitEstimate(): number {
    const now = Date.now();
    let wait = 0;

    // 429 全局退避
    if (now < this.globalRetryAfter) {
      wait = Math.max(wait, this.globalRetryAfter - now);
    }

    // 最小间隔
    const sinceLastRequest = now - this.lastRequestTime;
    if (sinceLastRequest < this.config.min_interval_ms) {
      wait = Math.max(wait, this.config.min_interval_ms - sinceLastRequest);
    }

    return wait;
  }

  /**
   * 获取许可（在发请求前调用）
   *
   * 等待直到：
   * 1. 并发数未达上限
   * 2. 请求间隔满足
   * 3. 429 退避时间已过
   *
   * @param critical 是否为关键请求（降级模式下关键请求不被跳过）
   * @returns true 表示获得许可可以发请求，false 表示被降级跳过
   */
  async acquire(critical = false): Promise<boolean> {
    // 降级检查：非关键请求在降级模式下直接跳过
    if (this._isDegraded && !critical) {
      this._totalThrottled++;
      log.warn('LLM request skipped: degraded mode (quota near exhaustion)');
      return false;
    }

    // 等待并发许可
    if (this.activeCount >= this.config.max_concurrency) {
      this._totalThrottled++;
      log.debug({
        active: this.activeCount,
        max: this.config.max_concurrency,
        waiting: this.waitQueue.length,
      }, 'Waiting for concurrency slot');

      await new Promise<void>(resolve => {
        this.waitQueue.push(resolve);
      });
    }

    // 等待请求间隔
    const now = Date.now();
    const sinceLastRequest = now - this.lastRequestTime;
    if (sinceLastRequest < this.config.min_interval_ms) {
      const intervalWait = this.config.min_interval_ms - sinceLastRequest;
      await this.sleep(intervalWait);
    }

    // 等待 429 全局退避
    const retryAfterWait = this.globalRetryAfter - Date.now();
    if (retryAfterWait > 0) {
      log.warn({ retryAfterMs: retryAfterWait }, 'Waiting for 429 Retry-After');
      await this.sleep(retryAfterWait);
    }

    // 获得许可
    this.activeCount++;
    this.lastRequestTime = Date.now();

    // 计数配额
    this.recordRequest();

    return true;
  }

  /**
   * 释放许可（在请求完成后调用）
   */
  release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);

    // 唤醒等待队列中的下一个
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    }
  }

  /**
   * 处理 429 响应（从 response headers 中提取 Retry-After）
   *
   * @param retryAfterHeader Retry-After header 值（秒数或 HTTP 日期）
   * @param errorBody 可选的错误响应体，用于检测 error code 20097（配额耗尽）
   */
  handle429(retryAfterHeader?: string | null, errorBody?: string): void {
    this._total429s++;

    let retryAfterMs: number;

    if (retryAfterHeader) {
      // Retry-After 可能是秒数或 HTTP 日期
      const seconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(seconds)) {
        retryAfterMs = seconds * 1000;
      } else {
        // 尝试解析为 HTTP 日期
        const date = new Date(retryAfterHeader);
        retryAfterMs = Math.max(0, date.getTime() - Date.now());
      }
    } else {
      // 没有 Retry-After 头，使用默认退避 30 秒
      retryAfterMs = 30_000;
    }

    // 加 jitter
    retryAfterMs += this.jitter();

    this.globalRetryAfter = Date.now() + retryAfterMs;

    log.warn({
      retryAfterMs,
      retryAfterHeader,
      until: new Date(this.globalRetryAfter).toISOString(),
    }, '429 rate limit hit, setting global backoff');

    // 检测 error code 20097（Coding Plan 配额耗尽）
    if (errorBody?.includes('20097') || errorBody?.includes('quota')) {
      this.enterDegradedMode('Coding Plan quota exhausted (error 20097)');
    }
  }

  /**
   * 计算带 Jitter 的退避延迟
   *
   * @param baseDelayMs 基础退避延迟
   * @param attempt 重试次数（从 1 开始）
   * @returns 带 Jitter 的指数退避延迟
   */
  calculateBackoff(baseDelayMs: number, attempt: number, maxDelayMs: number): number {
    // 指数退避 + full jitter
    const exponential = baseDelayMs * Math.pow(2, attempt - 1);
    const capped = Math.min(exponential, maxDelayMs);
    // Full jitter: 随机 [0, capped] 而非固定 capped
    return Math.floor(Math.random() * capped) + this.jitter();
  }

  /**
   * 手动进入降级模式
   */
  enterDegradedMode(reason: string): void {
    if (!this.config.degrade_on_exhaustion) return;
    if (this._isDegraded) return;

    this._isDegraded = true;
    log.error({ reason }, '⚠️ LLM rate limiter entering degraded mode');
  }

  /**
   * 手动退出降级模式
   */
  exitDegradedMode(): void {
    if (!this._isDegraded) return;
    this._isDegraded = false;
    log.info('LLM rate limiter exiting degraded mode');
  }

  /**
   * 重置所有状态（用于测试）
   */
  reset(): void {
    this.activeCount = 0;
    this.waitQueue = [];
    this.lastRequestTime = 0;
    this.globalRetryAfter = 0;
    this._isDegraded = false;
    this._totalThrottled = 0;
    this._total429s = 0;

    const now = Date.now();
    this.quota5h.count = 0;
    this.quota5h.resetAt = now + 5 * 60 * 60 * 1000;
    this.quotaWeekly.count = 0;
    this.quotaWeekly.resetAt = now + 7 * 24 * 60 * 60 * 1000;
    this.quotaMonthly.count = 0;
    this.quotaMonthly.resetAt = now + 30 * 24 * 60 * 60 * 1000;
  }

  // ── 内部方法 ──

  /**
   * 记录一次请求消耗，并检查配额预警
   */
  private recordRequest(): void {
    this.refreshWindows();

    this.quota5h.count++;
    this.quotaWeekly.count++;
    this.quotaMonthly.count++;

    // 预警检查
    this.checkQuotaWarning(this.quota5h, '5h');
    this.checkQuotaWarning(this.quotaWeekly, 'weekly');
    this.checkQuotaWarning(this.quotaMonthly, 'monthly');
  }

  /**
   * 刷新过期窗口
   */
  private refreshWindows(): void {
    const now = Date.now();

    if (now >= this.quota5h.resetAt) {
      this.quota5h.count = 0;
      this.quota5h.resetAt = now + 5 * 60 * 60 * 1000;
      // 5h 窗口重置时，如果之前因为 5h 配额耗尽降级，可以恢复
      if (this._isDegraded) {
        this.exitDegradedMode();
      }
    }

    if (now >= this.quotaWeekly.resetAt) {
      this.quotaWeekly.count = 0;
      this.quotaWeekly.resetAt = now + 7 * 24 * 60 * 60 * 1000;
    }

    if (now >= this.quotaMonthly.resetAt) {
      this.quotaMonthly.count = 0;
      this.quotaMonthly.resetAt = now + 30 * 24 * 60 * 60 * 1000;
    }
  }

  /**
   * 检查单个窗口的配额预警
   */
  private checkQuotaWarning(window: QuotaWindow, label: string): void {
    const remaining = window.limit - window.count;
    const ratio = remaining / window.limit;

    if (remaining <= 0) {
      this.enterDegradedMode(`${label} quota exhausted (${window.count}/${window.limit})`);
    } else if (ratio <= this.config.quota_warn_threshold) {
      log.warn({
        window: label,
        used: window.count,
        limit: window.limit,
        remaining,
        ratio: ratio.toFixed(3),
      }, `⚠️ LLM quota nearing limit`);
    }
  }

  /**
   * 生成 [0, jitter_max_ms) 的随机 jitter
   */
  private jitter(): number {
    return Math.floor(Math.random() * this.config.jitter_max_ms);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ── 单例 ──

let _rateLimiter: LLMRateLimiter | null = null;

export function getLLMRateLimiter(config?: Partial<LLMRateLimiterConfig>): LLMRateLimiter {
  if (!_rateLimiter) {
    _rateLimiter = new LLMRateLimiter(config);
  }
  return _rateLimiter;
}

/**
 * 重建限流器（配置变更后调用）
 */
export function resetLLMRateLimiter(config?: Partial<LLMRateLimiterConfig>): LLMRateLimiter {
  _rateLimiter = new LLMRateLimiter(config);
  return _rateLimiter;
}
