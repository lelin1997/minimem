// ============================================================
// MiniMem — Qdrant 向量存储 Provider (MINIMEM-003: 生产级升级)
// ============================================================
// 通过 HTTP API 对接 Qdrant 向量数据库
// 配置 storage.vector.provider = 'qdrant' 激活
//
// MINIMEM-003 新增:
// - 从 config.storage.vector.qdrant 读取配置
// - 健康检查（定时心跳 GET /healthz）
// - 自动重连（指数退避，最多 N 次）
// - 连接失败降级到 MemoryVectorStore

import { getLogger } from '../common/logger.js';
import { getConfig } from '../config/index.js';
import type { VectorProvider, VectorSearchResult, VectorWalkTrail } from './vector-provider.js';

const log = getLogger('store:qdrant');

/** Qdrant 配置 */
export interface QdrantConfig {
  url: string;                          // e.g. 'http://localhost:6333'
  collection: string;                   // e.g. 'minimem'
  api_key_env: string;                  // 环境变量名，如 'QDRANT_API_KEY'
  health_check_interval_ms: number;     // 健康检查间隔（毫秒），默认 30000
  retry_max_attempts: number;           // 最大重试次数，默认 3
  retry_base_delay_ms: number;          // 重试基准延迟（毫秒），默认 1000
  retry_max_delay_ms: number;           // 重试最大延迟（毫秒），默认 10000
  request_timeout_ms: number;           // 单次请求超时（毫秒），默认 10000
}

const DEFAULT_QDRANT_CONFIG: QdrantConfig = {
  url: 'http://localhost:6333',
  collection: 'minimem',
  api_key_env: 'QDRANT_API_KEY',
  health_check_interval_ms: 30_000,
  retry_max_attempts: 3,
  retry_base_delay_ms: 1000,
  retry_max_delay_ms: 10_000,
  request_timeout_ms: 10_000,
};

/**
 * 从 MiniMem 配置加载 Qdrant 配置
 */
function loadQdrantConfig(): QdrantConfig {
  try {
    const cfg = getConfig();
    const qdrantCfg = cfg.storage.vector.qdrant;
    if (!qdrantCfg) return DEFAULT_QDRANT_CONFIG;

    return {
      url: qdrantCfg.url ?? DEFAULT_QDRANT_CONFIG.url,
      collection: qdrantCfg.collection ?? DEFAULT_QDRANT_CONFIG.collection,
      api_key_env: qdrantCfg.api_key_env ?? DEFAULT_QDRANT_CONFIG.api_key_env,
      health_check_interval_ms: qdrantCfg.health_check_interval_ms ?? DEFAULT_QDRANT_CONFIG.health_check_interval_ms,
      retry_max_attempts: qdrantCfg.retry_max_attempts ?? DEFAULT_QDRANT_CONFIG.retry_max_attempts,
      retry_base_delay_ms: qdrantCfg.retry_base_delay_ms ?? DEFAULT_QDRANT_CONFIG.retry_base_delay_ms,
      retry_max_delay_ms: qdrantCfg.retry_max_delay_ms ?? DEFAULT_QDRANT_CONFIG.retry_max_delay_ms,
      request_timeout_ms: qdrantCfg.request_timeout_ms ?? DEFAULT_QDRANT_CONFIG.request_timeout_ms,
    };
  } catch {
    return DEFAULT_QDRANT_CONFIG;
  }
}

export type QdrantHealthStatus = 'connected' | 'disconnected' | 'degraded';

/**
 * Qdrant 向量存储 Provider（生产级）
 *
 * 通过 Qdrant REST API 实现向量存储和检索。
 * 支持健康检查、自动重连、降级到内存后端。
 */
export class QdrantVectorProvider implements VectorProvider {
  readonly name = 'qdrant';
  private config: QdrantConfig;
  private _size: number = 0;
  private _healthStatus: QdrantHealthStatus = 'disconnected';
  private _healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private _consecutiveFailures: number = 0;

  constructor(config?: Partial<QdrantConfig>) {
    const loaded = loadQdrantConfig();
    this.config = { ...loaded, ...config };
    log.info({
      url: this.config.url,
      collection: this.config.collection,
      healthCheckMs: this.config.health_check_interval_ms,
    }, 'Qdrant provider created');
  }

  /** 当前健康状态 */
  get healthStatus(): QdrantHealthStatus {
    return this._healthStatus;
  }

  /** 连续失败次数 */
  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  get size(): number {
    return this._size;
  }

  private get apiKey(): string | undefined {
    return process.env[this.config.api_key_env] || undefined;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const key = this.apiKey;
    if (key) h['api-key'] = key;
    return h;
  }

  // ── 连接管理 ──

  /**
   * 异步初始化：验证连接 + 确保集合存在 + 启动健康检查
   * 调用方应在 initVectorStore() 中调用此方法
   */
  async initialize(dimensions?: number): Promise<boolean> {
    try {
      // 1. 验证连接
      const healthy = await this.checkHealth();
      if (!healthy) {
        log.warn('Qdrant initial health check failed');
        return false;
      }

      // 2. 确保集合存在
      if (dimensions && dimensions > 0) {
        await this.ensureCollection(dimensions);
      }

      // 3. 同步 size
      await this.syncSize();

      // 4. 启动定时健康检查
      this.startHealthCheck();

      this._healthStatus = 'connected';
      log.info({
        url: this.config.url,
        collection: this.config.collection,
        size: this._size,
      }, 'Qdrant provider initialized successfully');

      return true;
    } catch (err) {
      log.error({ err }, 'Qdrant initialization failed');
      this._healthStatus = 'disconnected';
      return false;
    }
  }

  /**
   * 健康检查：GET /healthz 或 GET /
   */
  async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const resp = await fetch(`${this.config.url}/healthz`, {
        method: 'GET',
        headers: this.headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (resp.ok) {
        this._consecutiveFailures = 0;
        if (this._healthStatus !== 'connected') {
          log.info('Qdrant health check passed — connection restored');
          this._healthStatus = 'connected';
        }
        return true;
      }

      this._consecutiveFailures++;
      log.warn({ status: resp.status, failures: this._consecutiveFailures }, 'Qdrant health check returned non-OK');
      this._healthStatus = 'degraded';
      return false;
    } catch (err) {
      this._consecutiveFailures++;
      log.warn({ err, failures: this._consecutiveFailures }, 'Qdrant health check failed');
      this._healthStatus = this._consecutiveFailures >= this.config.retry_max_attempts ? 'disconnected' : 'degraded';
      return false;
    }
  }

  /**
   * 启动定时健康检查
   */
  startHealthCheck(): void {
    this.stopHealthCheck();
    this._healthCheckTimer = setInterval(async () => {
      await this.checkHealth();
    }, this.config.health_check_interval_ms);
    log.debug({ intervalMs: this.config.health_check_interval_ms }, 'Qdrant health check started');
  }

  /**
   * 停止健康检查
   */
  stopHealthCheck(): void {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }
  }

  /**
   * 同步 size（从 Qdrant 获取实际点数）
   */
  private async syncSize(): Promise<void> {
    try {
      const result = await this.request('GET', `/collections/${this.config.collection}`) as {
        result?: { points_count?: number; vectors_count?: number };
      };
      this._size = result.result?.points_count ?? result.result?.vectors_count ?? 0;
    } catch {
      // 非致命，保持当前 size
    }
  }

  // ── HTTP 请求（带重试） ──

  /**
   * 带指数退避重试的 HTTP 请求
   */
  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.config.url}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retry_max_attempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.request_timeout_ms);

        const resp = await fetch(url, {
          method,
          headers: this.headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (resp.ok) {
          this._consecutiveFailures = 0;
          return resp.json();
        }

        // 4xx 错误不重试（客户端错误）
        if (resp.status >= 400 && resp.status < 500) {
          const text = await resp.text().catch(() => '');
          throw new Error(`Qdrant API client error ${resp.status}: ${text}`);
        }

        // 5xx 错误重试
        const text = await resp.text().catch(() => '');
        lastError = new Error(`Qdrant API server error ${resp.status}: ${text}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // AbortError = 超时，可重试
        if (lastError.name === 'AbortError') {
          lastError = new Error(`Qdrant request timeout after ${this.config.request_timeout_ms}ms`);
        }

        // 4xx 直接抛出不重试
        if (lastError.message.includes('client error')) {
          throw lastError;
        }
      }

      // 计算退避延迟
      if (attempt < this.config.retry_max_attempts) {
        const delay = Math.min(
          this.config.retry_base_delay_ms * Math.pow(2, attempt - 1),
          this.config.retry_max_delay_ms,
        );
        const jitter = delay * (0.5 + Math.random() * 0.5); // 50%-100% jitter
        log.debug({ attempt, delay: Math.round(jitter), path }, 'Qdrant request retry');
        await sleep(jitter);
      }
    }

    this._consecutiveFailures++;
    if (this._consecutiveFailures >= this.config.retry_max_attempts) {
      this._healthStatus = 'disconnected';
    }
    throw lastError ?? new Error('Qdrant request failed after all retries');
  }

  // ── 集合管理 ──

  /**
   * 确保集合存在（首次使用时调用）
   */
  async ensureCollection(dimensions: number): Promise<void> {
    try {
      await this.request('GET', `/collections/${this.config.collection}`);
      log.debug({ collection: this.config.collection }, 'Qdrant collection exists');
    } catch (err) {
      if (err instanceof Error && err.message.includes('client error')) {
        // 404 = 集合不存在，创建之
        await this.request('PUT', `/collections/${this.config.collection}`, {
          vectors: {
            size: dimensions,
            distance: 'Cosine',
          },
        });
        log.info({ collection: this.config.collection, dimensions }, 'Qdrant collection created');
      } else {
        throw err;
      }
    }
  }

  // ── VectorProvider 接口实现 ──

  async add(id: string, memoryId: string, memoryType: string, vector: number[], metadata: Record<string, unknown> = {}): Promise<void> {
    await this.request('PUT', `/collections/${this.config.collection}/points`, {
      points: [{
        id: hashToInt(id), // Qdrant 需要整数或 UUID 作为 ID
        vector,
        payload: {
          original_id: id,
          memoryId,
          memoryType,
          ...metadata,
        },
      }],
    });
    this._size++;
  }

  async search(queryVector: number[], topK: number = 10, minSimilarity: number = 0.3, domain?: string): Promise<VectorSearchResult[]> {
    const filter = domain ? {
      must: [{ key: 'domain', match: { value: domain } }],
    } : undefined;

    const result = await this.request('POST', `/collections/${this.config.collection}/points/search`, {
      vector: queryVector,
      limit: topK,
      score_threshold: minSimilarity,
      filter,
      with_payload: true,
    }) as { result: Array<{ id: number; score: number; payload: Record<string, unknown> }> };

    return (result.result || []).map(r => ({
      id: r.payload.original_id as string,
      memoryId: r.payload.memoryId as string,
      memoryType: r.payload.memoryType as string,
      similarity: r.score,
    }));
  }

  async randomWalk(queryVector: number[], count: number = 5, minSim: number = 0.3, maxSim: number = 0.7): Promise<VectorSearchResult[]> {
    // Qdrant 没有原生的 random walk，用 search + 过滤模拟
    const results = await this.search(queryVector, count * 3, minSim);
    const filtered = results.filter(r => r.similarity <= maxSim);
    // 随机打乱
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }
    return filtered.slice(0, count);
  }

  /**
   * MINIMEM-003 E04: 多步向量漫游
   *
   * Qdrant 实现：每一跳用 search + 过滤模拟漫游，
   * 选择 similarity 最接近 sweet spot (0.45) 的结果向量进入下一跳。
   * 由于 Qdrant 不存储本地向量，需要通过 API 取回向量。
   */
  async multiStepWalk(
    queryVector: number[],
    steps: number,
    breadthPerStep: number,
    minSim: number = 0.15,
    maxSim: number = 0.7,
  ): Promise<VectorWalkTrail> {
    const SWEET_SPOT = 0.45;
    const visited = new Set<string>();
    const hops: VectorWalkTrail['hops'] = [];
    let currentVector = queryVector;

    for (let step = 1; step <= steps; step++) {
      const rawResults = await this.randomWalk(currentVector, breadthPerStep * 3, minSim, maxSim);

      // 过滤已访问
      const freshResults = rawResults.filter(r => !visited.has(r.memoryId));
      const stepResults = freshResults.slice(0, breadthPerStep);

      for (const r of stepResults) {
        visited.add(r.memoryId);
      }

      hops.push({
        step,
        results: stepResults,
        seedVector: currentVector,
      });

      if (stepResults.length === 0) break;

      // 选择下一跳种子：similarity 最接近 sweet spot
      const nextSeed = stepResults.reduce((best, curr) =>
        Math.abs(curr.similarity - SWEET_SPOT) < Math.abs(best.similarity - SWEET_SPOT) ? curr : best
      );

      // 从 Qdrant 取回该点的向量用于下一跳查询
      try {
        const pointResult = await this.request('POST', `/collections/${this.config.collection}/points/scroll`, {
          filter: {
            must: [{ key: 'original_id', match: { value: nextSeed.id } }],
          },
          limit: 1,
          with_vector: true,
          with_payload: false,
        }) as { result: { points: Array<{ vector?: number[] }> } };

        const vec = pointResult.result?.points?.[0]?.vector;
        if (vec && vec.length > 0) {
          currentVector = vec;
        } else {
          break; // 无法获取向量，终止
        }
      } catch {
        break; // API 错误，终止
      }
    }

    return {
      hops,
      totalDiscovered: visited.size,
    };
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.request('POST', `/collections/${this.config.collection}/points/delete`, {
        points: [hashToInt(id)],
      });
      this._size = Math.max(0, this._size - 1);
      return true;
    } catch {
      return false;
    }
  }

  async deleteByMemoryId(memoryId: string): Promise<number> {
    try {
      await this.request('POST', `/collections/${this.config.collection}/points/delete`, {
        filter: {
          must: [{ key: 'memoryId', match: { value: memoryId } }],
        },
      });
      // Qdrant 不返回删除数量，估算
      this._size = Math.max(0, this._size - 1);
      return 1;
    } catch {
      return 0;
    }
  }

  async getIndexedMemoryIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    try {
      // 分页滚动获取所有点
      const result = await this.request('POST', `/collections/${this.config.collection}/points/scroll`, {
        limit: 10000,
        with_payload: ['memoryId'],
      }) as { result: { points: Array<{ payload: { memoryId: string } }> } };

      for (const p of result.result?.points ?? []) {
        if (p.payload?.memoryId) ids.add(p.payload.memoryId);
      }
    } catch (err) {
      log.warn({ err }, 'Failed to get indexed memory IDs from Qdrant');
    }
    return ids;
  }

  async getAny(): Promise<{ id: string; memoryId: string; memoryType: string; vector: { length: number } } | undefined> {
    try {
      const result = await this.request('POST', `/collections/${this.config.collection}/points/scroll`, {
        limit: 1,
        with_payload: true,
        with_vector: true,
      }) as { result: { points: Array<{ payload: Record<string, unknown>; vector: number[] }> } };

      const point = result.result?.points?.[0];
      if (!point) return undefined;
      return {
        id: point.payload.original_id as string,
        memoryId: point.payload.memoryId as string,
        memoryType: point.payload.memoryType as string,
        vector: { length: point.vector?.length ?? 0 },
      };
    } catch {
      return undefined;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.request('DELETE', `/collections/${this.config.collection}`);
      this._size = 0;
    } catch {
      log.warn('Failed to clear Qdrant collection');
    }
  }

  // Qdrant 是持久化存储，这些操作是 no-op
  saveToDisk(): void { /* no-op: Qdrant 自己持久化 */ }
  loadFromDisk(): number { return 0; /* no-op: Qdrant 自己管理数据 */ }
  startAutoSave(): void { /* no-op */ }
  stopAutoSave(): void { /* no-op */ }

  /**
   * 优雅关闭：停止健康检查
   */
  shutdown(): void {
    this.stopHealthCheck();
    log.info('Qdrant provider shut down');
  }
}

/**
 * 将字符串 ID 哈希为整数（Qdrant 需要整数 ID）
 */
function hashToInt(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
