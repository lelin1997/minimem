// ============================================================
// MiniMem — Vector Store Port (P3.1 依赖倒置)
// ============================================================
// 向量存储统一接口，domain 层通过此接口访问向量能力。
// infra/store/vectors.ts 在 app 启动时通过 registerVectorStore 注册实现。

/**
 * 向量检索结果
 */
export interface VectorSearchResult {
  id: string;
  memoryId: string;
  memoryType: string;
  similarity: number;
}

/**
 * MINIMEM-003 E04: 多步漫游轨迹
 * 每一跳的记录 + 总发现数
 */
export interface VectorWalkTrail {
  hops: Array<{
    step: number;
    results: VectorSearchResult[];
    seedVector: number[];
  }>;
  totalDiscovered: number;
}

/**
 * 向量存储 Provider 统一接口
 *
 * 所有向量后端（内存、Qdrant、Chroma 等）都必须实现此接口。
 * 通过 config.storage.vector.provider 切换实现。
 */
export interface VectorProvider {
  /** Provider 名称标识 */
  readonly name: string;

  /** 添加向量 */
  add(id: string, memoryId: string, memoryType: string, vector: number[], metadata?: Record<string, unknown>): void | Promise<void>;

  /** 语义检索 */
  search(queryVector: number[], topK?: number, minSimilarity?: number, domain?: string): VectorSearchResult[] | Promise<VectorSearchResult[]>;

  /** 随机漫游（做梦用） */
  randomWalk(queryVector: number[], count?: number, minSim?: number, maxSim?: number): VectorSearchResult[] | Promise<VectorSearchResult[]>;

  /** 多步向量漫游 */
  multiStepWalk(
    queryVector: number[],
    steps: number,
    breadthPerStep: number,
    minSim?: number,
    maxSim?: number,
  ): VectorWalkTrail | Promise<VectorWalkTrail>;

  /** 按向量 ID 删除 */
  delete(id: string): boolean | Promise<boolean>;

  /** 按 memoryId 批量删除 */
  deleteByMemoryId(memoryId: string): number | Promise<number>;

  /** 获取所有已索引的 memoryId 集合 */
  getIndexedMemoryIds(): Set<string> | Promise<Set<string>>;

  /** 获取任意一条（维度检查用） */
  getAny(): { id: string; memoryId: string; memoryType: string; vector: { length: number } } | undefined | Promise<{ id: string; memoryId: string; memoryType: string; vector: { length: number } } | undefined>;

  /** 当前存储的向量数量 */
  readonly size: number;

  /** 清空所有数据 */
  clear(): void | Promise<void>;

  /** 持久化到磁盘 */
  saveToDisk(dataDir: string): void | Promise<void>;

  /** 从磁盘加载 */
  loadFromDisk(dataDir: string): number | Promise<number>;

  /** 启动自动保存 */
  startAutoSave(dataDir: string, intervalMs?: number, updateThreshold?: number): void;

  /** 停止自动保存 */
  stopAutoSave(): void;
}

// ── Registry: infra 启动时注册实现 ──

let _factory: (() => VectorProvider) | null = null;

/**
 * infra 层在 app 启动时调用，注册向量存储工厂
 */
export function registerVectorStore(factory: () => VectorProvider): void {
  _factory = factory;
}

/**
 * domain 层获取向量存储实例
 */
export function getVectorStore(): VectorProvider {
  if (!_factory) {
    throw new Error('VectorStore factory not registered. Call registerVectorStore() at app startup.');
  }
  return _factory();
}
