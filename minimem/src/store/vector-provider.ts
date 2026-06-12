// ============================================================
// MiniMem — 向量存储 Provider 抽象 (REQ-018 / TODO-020)
// ============================================================
// 统一的向量存储接口，支持切换后端实现

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
    seedVector: number[]; // 本跳使用的查询向量
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

  /**
   * MINIMEM-003 E04: 多步向量漫游
   * 从 queryVector 出发，每一跳取上一跳中 similarity 最接近 sweet spot (0.45) 的结果作为新查询向量，
   * 跟踪已访问 ID 避免重复，返回完整漫游轨迹。
   *
   * @param queryVector - 起始查询向量
   * @param steps - 漫游步数
   * @param breadthPerStep - 每步宽度（每跳返回多少结果）
   * @param minSim - 最小相似度（默认 0.15）
   * @param maxSim - 最大相似度（默认 0.7）
   */
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

  /** 持久化到磁盘（部分 provider 可能是 no-op） */
  saveToDisk(dataDir: string): void | Promise<void>;

  /** 从磁盘加载（部分 provider 可能是 no-op） */
  loadFromDisk(dataDir: string): number | Promise<number>;

  /** 启动自动保存（部分 provider 可能是 no-op） */
  startAutoSave(dataDir: string, intervalMs?: number, updateThreshold?: number): void;

  /** 停止自动保存 */
  stopAutoSave(): void;
}
