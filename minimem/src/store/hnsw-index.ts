// ============================================================
// MiniMem — HNSW 近似最近邻索引 (MINIMEM-003 / TODO-E01)
// ============================================================
// 纯 TypeScript 实现，零外部依赖
// 算法参考: Malkov & Yashunin, "Efficient and robust approximate nearest neighbor search using HNSW graphs" (2016)

import { getLogger } from '../common/logger.js';

const log = getLogger('store:hnsw');

// ── 配置接口 ──

export interface HNSWConfig {
  /** 每层最大双向连接数，默认 16 */
  M: number;
  /** 构建时搜索宽度（越大越慢但索引质量越高），默认 200 */
  efConstruction: number;
  /** 查询时搜索宽度（越大越慢但召回率越高），默认 50 */
  efSearch: number;
  /** 向量维度（初始化后不可变） */
  dimensions: number;
}

export const DEFAULT_HNSW_CONFIG: HNSWConfig = {
  M: 16,
  efConstruction: 200,
  efSearch: 50,
  dimensions: 0, // 必须由调用者指定
};

// ── 内部数据结构 ──

interface HNSWNode {
  id: string;
  vector: Float32Array;
  norm: number; // 预计算 L2 范数
  /** 每层的邻居列表：level → Set<nodeId> */
  neighbors: Map<number, Set<string>>;
  /** 此节点被分配到的最高层级 */
  level: number;
  /** 标记删除（惰性删除） */
  deleted: boolean;
}

export interface HNSWSearchResult {
  id: string;
  distance: number; // 1 - cosine_similarity（距离越小越相似）
}

// ── HNSW 索引核心 ──

export class HNSWIndex {
  private config: HNSWConfig;
  private nodes: Map<string, HNSWNode> = new Map();
  private entryPointId: string | null = null;
  private maxLevel: number = 0;
  private _deletedCount: number = 0;

  // mL = 1 / ln(M), 用于随机层级生成
  private readonly mL: number;

  constructor(config: Partial<HNSWConfig> & { dimensions: number }) {
    this.config = { ...DEFAULT_HNSW_CONFIG, ...config };
    if (this.config.dimensions <= 0) {
      throw new Error('HNSW: dimensions must be positive');
    }
    this.mL = 1 / Math.log(this.config.M);
  }

  // ── 公共属性 ──

  get size(): number {
    return this.nodes.size - this._deletedCount;
  }

  get totalNodes(): number {
    return this.nodes.size;
  }

  get deletedCount(): number {
    return this._deletedCount;
  }

  get dimensions(): number {
    return this.config.dimensions;
  }

  get currentMaxLevel(): number {
    return this.maxLevel;
  }

  // ── 插入 ──

  /**
   * 插入一个向量到索引中
   * @param id 唯一标识符
   * @param vector 向量数据（Float32Array 或 number[]）
   */
  insert(id: string, vector: Float32Array | number[]): void {
    if (this.nodes.has(id)) {
      // 更新：先物理删除旧节点再插入（不用惰性删除，因为要立即替换）
      this.physicalRemove(id);
    }

    const vec = vector instanceof Float32Array ? vector : new Float32Array(vector);
    if (vec.length !== this.config.dimensions) {
      throw new Error(`HNSW: vector dimension mismatch. Expected ${this.config.dimensions}, got ${vec.length}`);
    }

    const norm = vectorNorm(vec);
    const nodeLevel = this.randomLevel();

    const node: HNSWNode = {
      id,
      vector: vec,
      norm,
      neighbors: new Map(),
      level: nodeLevel,
      deleted: false,
    };

    // 为每层初始化空邻居集
    for (let l = 0; l <= nodeLevel; l++) {
      node.neighbors.set(l, new Set());
    }

    this.nodes.set(id, node);

    // 空索引时设为入口点
    if (this.entryPointId === null) {
      this.entryPointId = id;
      this.maxLevel = nodeLevel;
      return;
    }

    const ep = this.nodes.get(this.entryPointId)!;
    let currentBestId = this.entryPointId;

    // Phase 1: 从顶层贪心下降到 nodeLevel + 1
    for (let level = this.maxLevel; level > nodeLevel; level--) {
      currentBestId = this.greedyClosest(vec, norm, currentBestId, level);
    }

    // Phase 2: 从 min(nodeLevel, maxLevel) 到 0，逐层插入并连接邻居
    const insertLevel = Math.min(nodeLevel, this.maxLevel);
    for (let level = insertLevel; level >= 0; level--) {
      // 在当前层搜索最近的 efConstruction 个候选
      const candidates = this.searchLayer(vec, norm, currentBestId, this.config.efConstruction, level);

      // 选择最优邻居（简单启发式：取最近的 M 个）
      const maxNeighbors = level === 0 ? this.config.M * 2 : this.config.M;
      const selectedNeighbors = this.selectNeighborsSimple(candidates, maxNeighbors);

      // 建立双向连接
      const nodeNeighbors = node.neighbors.get(level)!;
      for (const neighbor of selectedNeighbors) {
        nodeNeighbors.add(neighbor.id);

        // 确保邻居节点有此层的邻居集
        const neighborNode = this.nodes.get(neighbor.id)!;
        let neighborSet = neighborNode.neighbors.get(level);
        if (!neighborSet) {
          neighborSet = new Set();
          neighborNode.neighbors.set(level, neighborSet);
        }
        neighborSet.add(id);

        // 如果邻居的连接数超过上限，裁剪
        if (neighborSet.size > maxNeighbors) {
          this.shrinkNeighbors(neighborNode, level, maxNeighbors);
        }
      }

      // 更新下一层的搜索起点
      if (candidates.length > 0) {
        currentBestId = candidates[0].id;
      }
    }

    // 如果新节点层级高于当前最大层级，更新入口点
    if (nodeLevel > this.maxLevel) {
      this.maxLevel = nodeLevel;
      this.entryPointId = id;
    }
  }

  // ── 搜索 ──

  /**
   * 搜索最近的 topK 个向量
   * @param query 查询向量
   * @param topK 返回数量
   * @param efSearch 搜索宽度（覆盖配置值）
   * @returns 按距离升序排列的结果
   */
  search(query: Float32Array | number[], topK: number = 10, efSearch?: number): HNSWSearchResult[] {
    if (this.entryPointId === null) return [];

    const qVec = query instanceof Float32Array ? query : new Float32Array(query);
    const qNorm = vectorNorm(qVec);
    if (qNorm === 0) return [];

    const ef = efSearch ?? this.config.efSearch;
    let currentBestId = this.entryPointId;

    // Phase 1: 从顶层贪心下降到 Layer 1
    for (let level = this.maxLevel; level > 0; level--) {
      currentBestId = this.greedyClosest(qVec, qNorm, currentBestId, level);
    }

    // Phase 2: 在 Layer 0 做 ef-search
    const candidates = this.searchLayer(qVec, qNorm, currentBestId, Math.max(ef, topK), 0);

    // 过滤已删除节点，取 topK
    const results: HNSWSearchResult[] = [];
    for (const c of candidates) {
      if (results.length >= topK) break;
      const node = this.nodes.get(c.id);
      if (node && !node.deleted) {
        results.push({ id: c.id, distance: c.distance });
      }
    }

    return results;
  }

  // ── 删除 ──

  /**
   * 标记删除一个节点（惰性删除）
   * 节点仍保留在图中用于路由，但不会出现在搜索结果中
   */
  remove(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;
    if (node.deleted) return false;

    node.deleted = true;
    this._deletedCount++;

    // 如果删除的是入口点，尝试找一个替代
    if (id === this.entryPointId) {
      this.repairEntryPoint();
    }

    return true;
  }

  /**
   * 检查 ID 是否存在且未被删除
   */
  has(id: string): boolean {
    const node = this.nodes.get(id);
    return node !== undefined && !node.deleted;
  }

  // ── 序列化/反序列化 ──

  /**
   * 序列化为二进制 Buffer
   *
   * 格式 (v3 HNSW):
   *   [4B magic "HNSW"]
   *   [4B version = 3]
   *   [4B nodeCount]
   *   [4B dimensions]
   *   [4B M]
   *   [4B efConstruction]
   *   [4B efSearch]
   *   [4B maxLevel]
   *   [4B entryPointIdLen][entryPointId bytes]
   *   For each node:
   *     [4B idLen][id bytes]
   *     [1B deleted flag]
   *     [4B level]
   *     [dimensions * 4B vector data]
   *     [4B neighborLayerCount]
   *     For each layer:
   *       [4B layerIndex]
   *       [4B neighborCount]
   *       For each neighbor:
   *         [4B neighborIdLen][neighborId bytes]
   */
  serialize(): Buffer {
    const nodes = Array.from(this.nodes.values());
    const nodeCount = nodes.length;

    // 预计算总大小以一次性分配 buffer
    let totalSize = 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4; // header: 32 bytes

    // entry point id
    const epIdBuf = this.entryPointId ? Buffer.from(this.entryPointId, 'utf-8') : Buffer.alloc(0);
    totalSize += 4 + epIdBuf.length;

    // 预计算每个 node 的大小
    interface NodeMeta {
      idBuf: Buffer;
      neighborData: Array<{ level: number; neighborBufs: Buffer[] }>;
    }
    const nodeMetas: NodeMeta[] = [];

    for (const node of nodes) {
      const idBuf = Buffer.from(node.id, 'utf-8');
      let nodeSize = 4 + idBuf.length + 1 + 4 + this.config.dimensions * 4 + 4;

      const neighborData: Array<{ level: number; neighborBufs: Buffer[] }> = [];
      for (const [level, neighbors] of node.neighbors) {
        const neighborBufs: Buffer[] = [];
        let layerSize = 4 + 4; // layerIndex + neighborCount
        for (const nId of neighbors) {
          const nBuf = Buffer.from(nId, 'utf-8');
          neighborBufs.push(nBuf);
          layerSize += 4 + nBuf.length;
        }
        neighborData.push({ level, neighborBufs });
        nodeSize += layerSize;
      }

      nodeMetas.push({ idBuf, neighborData });
      totalSize += nodeSize;
    }

    const buf = Buffer.alloc(totalSize);
    let offset = 0;

    // Header
    buf.write('HNSW', offset, 4, 'ascii'); offset += 4;
    buf.writeUInt32LE(3, offset); offset += 4; // version
    buf.writeUInt32LE(nodeCount, offset); offset += 4;
    buf.writeUInt32LE(this.config.dimensions, offset); offset += 4;
    buf.writeUInt32LE(this.config.M, offset); offset += 4;
    buf.writeUInt32LE(this.config.efConstruction, offset); offset += 4;
    buf.writeUInt32LE(this.config.efSearch, offset); offset += 4;
    buf.writeUInt32LE(this.maxLevel, offset); offset += 4;

    // Entry point ID
    buf.writeUInt32LE(epIdBuf.length, offset); offset += 4;
    if (epIdBuf.length > 0) {
      epIdBuf.copy(buf, offset); offset += epIdBuf.length;
    }

    // Nodes
    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i];
      const meta = nodeMetas[i];

      // ID
      buf.writeUInt32LE(meta.idBuf.length, offset); offset += 4;
      meta.idBuf.copy(buf, offset); offset += meta.idBuf.length;

      // Deleted flag
      buf.writeUInt8(node.deleted ? 1 : 0, offset); offset += 1;

      // Level
      buf.writeUInt32LE(node.level, offset); offset += 4;

      // Vector data
      for (let d = 0; d < this.config.dimensions; d++) {
        buf.writeFloatLE(node.vector[d], offset); offset += 4;
      }

      // Neighbor layers
      buf.writeUInt32LE(meta.neighborData.length, offset); offset += 4;
      for (const layerData of meta.neighborData) {
        buf.writeUInt32LE(layerData.level, offset); offset += 4;
        buf.writeUInt32LE(layerData.neighborBufs.length, offset); offset += 4;
        for (const nBuf of layerData.neighborBufs) {
          buf.writeUInt32LE(nBuf.length, offset); offset += 4;
          nBuf.copy(buf, offset); offset += nBuf.length;
        }
      }
    }

    return buf;
  }

  /**
   * 从二进制 Buffer 反序列化
   */
  static deserialize(buf: Buffer): HNSWIndex {
    let offset = 0;

    // Header
    const magic = buf.subarray(offset, offset + 4).toString('ascii'); offset += 4;
    if (magic !== 'HNSW') {
      throw new Error(`HNSW: invalid magic "${magic}"`);
    }

    const version = buf.readUInt32LE(offset); offset += 4;
    if (version !== 3) {
      throw new Error(`HNSW: unsupported version ${version}`);
    }

    const nodeCount = buf.readUInt32LE(offset); offset += 4;
    const dimensions = buf.readUInt32LE(offset); offset += 4;
    const M = buf.readUInt32LE(offset); offset += 4;
    const efConstruction = buf.readUInt32LE(offset); offset += 4;
    const efSearch = buf.readUInt32LE(offset); offset += 4;
    const maxLevel = buf.readUInt32LE(offset); offset += 4;

    // Entry point ID
    const epIdLen = buf.readUInt32LE(offset); offset += 4;
    const entryPointId = epIdLen > 0 ? buf.subarray(offset, offset + epIdLen).toString('utf-8') : null;
    offset += epIdLen;

    const index = new HNSWIndex({ dimensions, M, efConstruction, efSearch });
    index.maxLevel = maxLevel;
    index.entryPointId = entryPointId;

    // Nodes
    for (let i = 0; i < nodeCount; i++) {
      // ID
      const idLen = buf.readUInt32LE(offset); offset += 4;
      const id = buf.subarray(offset, offset + idLen).toString('utf-8'); offset += idLen;

      // Deleted flag
      const deleted = buf.readUInt8(offset) === 1; offset += 1;

      // Level
      const level = buf.readUInt32LE(offset); offset += 4;

      // Vector
      const vector = new Float32Array(dimensions);
      for (let d = 0; d < dimensions; d++) {
        vector[d] = buf.readFloatLE(offset); offset += 4;
      }

      // Neighbor layers
      const neighbors = new Map<number, Set<string>>();
      const layerCount = buf.readUInt32LE(offset); offset += 4;
      for (let l = 0; l < layerCount; l++) {
        const layerIndex = buf.readUInt32LE(offset); offset += 4;
        const neighborCount = buf.readUInt32LE(offset); offset += 4;
        const neighborSet = new Set<string>();
        for (let n = 0; n < neighborCount; n++) {
          const nIdLen = buf.readUInt32LE(offset); offset += 4;
          const nId = buf.subarray(offset, offset + nIdLen).toString('utf-8'); offset += nIdLen;
          neighborSet.add(nId);
        }
        neighbors.set(layerIndex, neighborSet);
      }

      const node: HNSWNode = {
        id,
        vector,
        norm: vectorNorm(vector),
        neighbors,
        level,
        deleted,
      };

      index.nodes.set(id, node);
      if (deleted) index._deletedCount++;
    }

    log.info({ nodeCount, dimensions, maxLevel, M }, 'HNSW index deserialized');
    return index;
  }

  // ── 维护操作 ──

  /**
   * 真正删除所有标记为 deleted 的节点（压缩索引）
   * 在低流量时调用，会重建受影响的连接
   */
  compact(): number {
    const toRemove: string[] = [];
    for (const [id, node] of this.nodes) {
      if (node.deleted) toRemove.push(id);
    }

    for (const id of toRemove) {
      const node = this.nodes.get(id)!;

      // 从所有邻居的邻居列表中移除此节点
      for (const [level, neighbors] of node.neighbors) {
        for (const neighborId of neighbors) {
          const neighborNode = this.nodes.get(neighborId);
          if (neighborNode) {
            const nSet = neighborNode.neighbors.get(level);
            if (nSet) nSet.delete(id);
          }
        }
      }

      this.nodes.delete(id);
    }

    this._deletedCount = 0;

    // 如果入口点被清除，重新选择
    if (this.entryPointId && !this.nodes.has(this.entryPointId)) {
      this.repairEntryPoint();
    }

    // 更新 maxLevel
    if (this.nodes.size === 0) {
      this.maxLevel = 0;
      this.entryPointId = null;
    } else {
      let newMaxLevel = 0;
      for (const node of this.nodes.values()) {
        if (node.level > newMaxLevel) newMaxLevel = node.level;
      }
      this.maxLevel = newMaxLevel;
    }

    if (toRemove.length > 0) {
      log.info({ compacted: toRemove.length, remaining: this.nodes.size }, 'HNSW index compacted');
    }

    return toRemove.length;
  }

  /**
   * 获取索引统计信息
   */
  getStats(): {
    totalNodes: number;
    activeNodes: number;
    deletedNodes: number;
    maxLevel: number;
    dimensions: number;
    config: HNSWConfig;
    levelDistribution: Record<number, number>;
  } {
    const levelDist: Record<number, number> = {};
    for (const node of this.nodes.values()) {
      if (!node.deleted) {
        levelDist[node.level] = (levelDist[node.level] || 0) + 1;
      }
    }

    return {
      totalNodes: this.nodes.size,
      activeNodes: this.size,
      deletedNodes: this._deletedCount,
      maxLevel: this.maxLevel,
      dimensions: this.config.dimensions,
      config: { ...this.config },
      levelDistribution: levelDist,
    };
  }

  // ── 内部方法 ──

  /**
   * 生成随机层级: level = floor(-ln(uniform()) * mL)
   */
  private randomLevel(): number {
    return Math.floor(-Math.log(Math.random()) * this.mL);
  }

  /**
   * 在某层中贪心找到最近的节点（用于高层下降）
   */
  private greedyClosest(query: Float32Array, qNorm: number, startId: string, level: number): string {
    let currentId = startId;
    let currentDist = this.distanceTo(query, qNorm, currentId);

    let improved = true;
    while (improved) {
      improved = false;
      const node = this.nodes.get(currentId);
      if (!node) break;

      const neighbors = node.neighbors.get(level);
      if (!neighbors) break;

      for (const neighborId of neighbors) {
        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;

        const dist = this.distanceTo(query, qNorm, neighborId);
        if (dist < currentDist) {
          currentId = neighborId;
          currentDist = dist;
          improved = true;
        }
      }
    }

    return currentId;
  }

  /**
   * 在某层中做 beam search，返回最近的 ef 个候选
   * 使用有序数组 + 二分插入实现（比反复 sort 快得多）
   */
  private searchLayer(
    query: Float32Array,
    qNorm: number,
    entryId: string,
    ef: number,
    level: number,
  ): Array<{ id: string; distance: number }> {
    const visited = new Set<string>();
    visited.add(entryId);

    const entryDist = this.distanceTo(query, qNorm, entryId);

    // candidates: 按距离升序排列（最近的在前）— 待探索队列
    const candidates: Array<{ id: string; distance: number }> = [{ id: entryId, distance: entryDist }];
    // results: 按距离升序排列（最近的在前）— 当前最佳结果
    const results: Array<{ id: string; distance: number }> = [{ id: entryId, distance: entryDist }];
    // 追踪 results 中最大距离
    let resultMaxDist = entryDist;

    let candidateIdx = 0; // 下一个要处理的候选索引

    while (candidateIdx < candidates.length) {
      const closest = candidates[candidateIdx++];

      // 如果最近候选比结果中最远的还远且结果已满，停止
      if (closest.distance > resultMaxDist && results.length >= ef) {
        break;
      }

      // 探索最近候选的邻居
      const node = this.nodes.get(closest.id);
      if (!node) continue;

      const neighbors = node.neighbors.get(level);
      if (!neighbors) continue;

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;

        const dist = this.distanceTo(query, qNorm, neighborId);

        // 如果 results 还没满，或者比 results 中最远的更近
        if (results.length < ef || dist < resultMaxDist) {
          // 二分插入到 candidates（按距离升序）
          insertSorted(candidates, { id: neighborId, distance: dist });

          // 二分插入到 results（按距离升序）
          insertSorted(results, { id: neighborId, distance: dist });

          // 保持 results 大小不超过 ef
          if (results.length > ef) {
            results.pop(); // 移除最远的（末尾）
          }

          // 更新 resultMaxDist
          resultMaxDist = results[results.length - 1].distance;
        }
      }
    }

    return results;
  }

  /**
   * 简单邻居选择：取距离最近的 maxNeighbors 个
   */
  private selectNeighborsSimple(
    candidates: Array<{ id: string; distance: number }>,
    maxNeighbors: number,
  ): Array<{ id: string; distance: number }> {
    // candidates 已经按距离升序排列
    return candidates.slice(0, maxNeighbors);
  }

  /**
   * 裁剪邻居：当连接数超过上限时，保留最近的
   */
  private shrinkNeighbors(node: HNSWNode, level: number, maxNeighbors: number): void {
    const neighbors = node.neighbors.get(level);
    if (!neighbors || neighbors.size <= maxNeighbors) return;

    // 计算每个邻居到此节点的距离
    const scored: Array<{ id: string; distance: number }> = [];
    for (const nId of neighbors) {
      const nNode = this.nodes.get(nId);
      if (!nNode) continue;
      const dist = cosineDistance(node.vector, node.norm, nNode.vector, nNode.norm);
      scored.push({ id: nId, distance: dist });
    }

    scored.sort((a, b) => a.distance - b.distance);

    // 保留最近的 maxNeighbors 个
    const keep = new Set(scored.slice(0, maxNeighbors).map(s => s.id));

    // 删除被裁剪的连接（双向断开）
    for (const nId of neighbors) {
      if (!keep.has(nId)) {
        neighbors.delete(nId);
        // 也从对方移除
        const nNode = this.nodes.get(nId);
        if (nNode) {
          const nSet = nNode.neighbors.get(level);
          if (nSet) nSet.delete(node.id);
        }
      }
    }
  }

  /**
   * 计算查询向量到指定节点的距离
   */
  private distanceTo(query: Float32Array, qNorm: number, nodeId: string): number {
    const node = this.nodes.get(nodeId);
    if (!node) return Infinity;
    return cosineDistance(query, qNorm, node.vector, node.norm);
  }

  /**
   * 修复入口点：当入口点被删除时，选择一个新的
   */
  private repairEntryPoint(): void {
    this.entryPointId = null;
    this.maxLevel = 0;

    for (const node of this.nodes.values()) {
      if (!node.deleted) {
        if (this.entryPointId === null || node.level > this.maxLevel) {
          this.entryPointId = node.id;
          this.maxLevel = node.level;
        }
      }
    }
  }

  /**
   * 物理删除一个节点（用于 insert 覆盖场景）
   * 从图中彻底移除节点及其所有连接
   */
  private physicalRemove(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    // 从所有邻居的邻居列表中移除此节点
    for (const [level, neighbors] of node.neighbors) {
      for (const neighborId of neighbors) {
        const neighborNode = this.nodes.get(neighborId);
        if (neighborNode) {
          const nSet = neighborNode.neighbors.get(level);
          if (nSet) nSet.delete(id);
        }
      }
    }

    // 如果是已标记删除的，减少计数
    if (node.deleted) this._deletedCount--;

    this.nodes.delete(id);

    // 如果删除的是入口点，重新选择
    if (id === this.entryPointId) {
      this.repairEntryPoint();
    }
  }
}

// ── 工具函数 ──

/**
 * 二分插入到有序数组中（按 distance 升序）
 */
function insertSorted(arr: Array<{ id: string; distance: number }>, item: { id: string; distance: number }): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].distance < item.distance) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  arr.splice(lo, 0, item);
}

/**
 * 计算向量 L2 范数
 */
function vectorNorm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

/**
 * 余弦距离 = 1 - 余弦相似度
 * 距离越小越相似（0 = 完全相同，1 = 正交，2 = 完全相反）
 */
function cosineDistance(a: Float32Array, normA: number, b: Float32Array, normB: number): number {
  if (normA === 0 || normB === 0) return 1;
  if (a.length !== b.length) return 1;

  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }

  const similarity = dot / (normA * normB);
  // Clamp to [0, 2] range（避免浮点精度问题导致负距离）
  return Math.max(0, 1 - similarity);
}
