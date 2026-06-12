// ============================================================
// MiniMem — 向量存储（内存实现 + 磁盘持久化）
// ============================================================
// 内存为主，磁盘为持久化缓存（避免重启后全量重建）
// 后续可切换为 Qdrant / ChromaDB

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getLogger } from '../common/logger.js';
import { getConfig } from '../config/index.js';
import type { VectorProvider, VectorSearchResult, VectorWalkTrail } from './vector-provider.js';
import { HNSWIndex } from './hnsw-index.js';

const log = getLogger('store:vectors');

interface VectorEntry {
  id: string;
  memoryId: string;
  memoryType: string;
  vector: Float32Array;
  norm: number;  // 预计算的 L2 范数，用于检索加速
  metadata: Record<string, unknown>;
}

/**
 * 磁盘序列化格式
 */
interface VectorDiskRecord {
  id: string;
  memoryId: string;
  memoryType: string;
  vector: number[];  // Float32Array → 普通数组
  metadata: Record<string, unknown>;
}

/**
 * 内存向量存储（支持磁盘持久化）
 * 实现 VectorProvider 接口，作为默认的内存后端
 */
export class MemoryVectorStore implements VectorProvider {
  readonly name = 'memory' as const;
  private vectors: Map<string, VectorEntry> = new Map();
  private _dirty: boolean = false;        // R-002: 脏标记
  private _updatesSinceLastSave: number = 0; // R-002: 自上次保存以来的更新次数
  private _autoSaveInterval: ReturnType<typeof setInterval> | null = null;
  private _autoSaveDataDir: string | null = null;

  // MINIMEM-003: HNSW 近似最近邻索引
  private hnswIndex: HNSWIndex | null = null;
  private hnswAutoThreshold: number = 5000; // 向量数超过此值自动启用 HNSW
  private _dimensions: number = 0; // 从第一个插入的向量推断

  /**
   * 启动周期性自动保存（R-002）
   * @param dataDir - 数据目录
   * @param intervalMs - 保存间隔（毫秒），默认 5 分钟
   * @param updateThreshold - 更新次数阈值，达到后立即保存，默认 100
   */
  startAutoSave(dataDir: string, intervalMs: number = 5 * 60 * 1000, updateThreshold: number = 100): void {
    this._autoSaveDataDir = dataDir;

    // 周期性检查并保存
    this._autoSaveInterval = setInterval(() => {
      if (this._dirty && this._autoSaveDataDir) {
        try {
          this.saveToDisk(this._autoSaveDataDir);
          log.info({ count: this.vectors.size, trigger: 'interval' }, 'Vector index auto-saved');
        } catch (err) {
          log.warn({ err }, 'Vector auto-save failed');
        }
      }
    }, intervalMs);

    // 更新阈值触发保存通过 markDirty 实现
    log.info({ intervalMs, updateThreshold }, 'Vector auto-save started');
  }

  /**
   * 停止自动保存
   */
  stopAutoSave(): void {
    if (this._autoSaveInterval) {
      clearInterval(this._autoSaveInterval);
      this._autoSaveInterval = null;
    }
  }

  /**
   * 标记为脏（有未保存更新）
   */
  private markDirty(): void {
    this._dirty = true;
    this._updatesSinceLastSave++;

    // 更新次数达到阈值时立即保存
    if (this._updatesSinceLastSave >= 100 && this._autoSaveDataDir) {
      try {
        this.saveToDisk(this._autoSaveDataDir);
        log.info({ count: this.vectors.size, trigger: 'threshold' }, 'Vector index auto-saved (threshold)');
      } catch (err) {
        log.warn({ err }, 'Vector threshold auto-save failed');
      }
    }
  }

  /**
   * 添加向量
   */
  add(id: string, memoryId: string, memoryType: string, vector: number[], metadata: Record<string, unknown> = {}): void {
    const vec = new Float32Array(vector);
    this.vectors.set(id, {
      id,
      memoryId,
      memoryType,
      vector: vec,
      norm: vectorNorm(vec),
      metadata,
    });

    // MINIMEM-003: 推断维度并维护 HNSW 索引
    if (this._dimensions === 0 && vec.length > 0) {
      this._dimensions = vec.length;
      this.loadHNSWConfig();
    }

    if (this.hnswIndex) {
      this.hnswIndex.insert(id, vec);
    } else if (this.vectors.size >= this.hnswAutoThreshold && this._dimensions > 0) {
      // 达到阈值，自动构建 HNSW 索引
      this.buildHNSWIndex();
    }

    this.markDirty();
  }

  /**
   * 从配置读取 HNSW 参数
   */
  private loadHNSWConfig(): void {
    try {
      const cfg = getConfig();
      const vectorCfg = cfg.storage.vector;
      if (vectorCfg.hnsw_auto_threshold !== undefined) {
        this.hnswAutoThreshold = vectorCfg.hnsw_auto_threshold;
      }
    } catch {
      // 配置不可用时使用默认值
    }
  }

  /**
   * MINIMEM-003: 从现有向量构建 HNSW 索引
   */
  private buildHNSWIndex(): void {
    if (this._dimensions <= 0) return;

    let M = 16;
    let efConstruction = 200;
    let efSearch = 50;

    try {
      const cfg = getConfig();
      const vectorCfg = cfg.storage.vector;
      if (vectorCfg.hnsw_m !== undefined) M = vectorCfg.hnsw_m;
      if (vectorCfg.hnsw_ef_construction !== undefined) efConstruction = vectorCfg.hnsw_ef_construction;
      if (vectorCfg.hnsw_ef_search !== undefined) efSearch = vectorCfg.hnsw_ef_search;
    } catch {
      // 使用默认值
    }

    log.info({ count: this.vectors.size, dimensions: this._dimensions, M, efConstruction },
      'Building HNSW index from existing vectors');

    const start = Date.now();
    this.hnswIndex = new HNSWIndex({ dimensions: this._dimensions, M, efConstruction, efSearch });

    for (const entry of this.vectors.values()) {
      this.hnswIndex.insert(entry.id, entry.vector);
    }

    log.info({ count: this.vectors.size, duration_ms: Date.now() - start },
      'HNSW index built successfully');
  }

  /**
   * 语义检索（余弦相似度）
   * @param domain - MINIMEM-001: 可选领域过滤，传入则只检索该领域的向量
   *
   * MINIMEM-003: 当 HNSW 索引可用且无 domain 过滤时，使用 HNSW 加速搜索
   */
  search(queryVector: number[], topK: number = 10, minSimilarity: number = 0.3, domain?: string): VectorSearchResult[] {
    const qVec = new Float32Array(queryVector);
    const qNorm = vectorNorm(qVec);

    // 如果查询向量为零向量，无法计算余弦相似度
    if (qNorm === 0) return [];

    // MINIMEM-003: HNSW 加速路径
    // 当无 domain 过滤时使用 HNSW（domain 过滤需要访问 metadata，HNSW 不支持）
    if (this.hnswIndex && !domain) {
      return this.searchWithHNSW(qVec, topK, minSimilarity);
    }

    // 暴力扫描路径（小数据集或需要 domain 过滤时）
    const results: VectorSearchResult[] = [];

    for (const entry of this.vectors.values()) {
      // MINIMEM-001: domain 前过滤
      if (domain && entry.metadata.domain !== domain) continue;

      // 范数预过滤：cos(a,b) = dot(a,b) / (|a|*|b|)
      // dot(a,b) ≤ |a|*|b|（Cauchy-Schwarz），所以 cos(a,b) ≤ 1
      // 但如果某个向量范数为 0，直接跳过
      if (entry.norm === 0) continue;

      const sim = cosineSimilarityWithNorms(qVec, entry.vector, qNorm, entry.norm);
      if (sim >= minSimilarity) {
        results.push({
          id: entry.id,
          memoryId: entry.memoryId,
          memoryType: entry.memoryType,
          similarity: sim,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * MINIMEM-003: HNSW 加速搜索
   * 将 HNSW 距离结果转换为 VectorSearchResult（带 memoryId 和 similarity）
   */
  private searchWithHNSW(qVec: Float32Array, topK: number, minSimilarity: number): VectorSearchResult[] {
    // HNSW 返回的是距离（1 - similarity），需要多取一些然后过滤
    const hnswResults = this.hnswIndex!.search(qVec, topK * 2);

    const results: VectorSearchResult[] = [];
    for (const hr of hnswResults) {
      const similarity = 1 - hr.distance; // 距离转相似度
      if (similarity < minSimilarity) continue;

      const entry = this.vectors.get(hr.id);
      if (!entry) continue;

      results.push({
        id: entry.id,
        memoryId: entry.memoryId,
        memoryType: entry.memoryType,
        similarity,
      });

      if (results.length >= topK) break;
    }

    return results;
  }

  /**
   * 随机漫游（做梦 Phase 3 用）
   * 找 similarity 在 [minSim, maxSim] 区间的"不太相似"记忆
   *
   * MINIMEM-003: HNSW 模式下使用 HNSW search 后过滤相似度区间
   */
  randomWalk(queryVector: number[], count: number = 5, minSim: number = 0.3, maxSim: number = 0.7): VectorSearchResult[] {
    const qVec = new Float32Array(queryVector);
    const qNorm = vectorNorm(qVec);
    if (qNorm === 0) return [];

    // MINIMEM-003: HNSW 加速路径
    if (this.hnswIndex) {
      // 取较多候选（count * 5），然后过滤到 [minSim, maxSim] 区间
      const hnswResults = this.hnswIndex.search(qVec, count * 5);
      const candidates: VectorSearchResult[] = [];

      for (const hr of hnswResults) {
        const similarity = 1 - hr.distance;
        if (similarity >= minSim && similarity <= maxSim) {
          const entry = this.vectors.get(hr.id);
          if (!entry) continue;
          candidates.push({
            id: entry.id,
            memoryId: entry.memoryId,
            memoryType: entry.memoryType,
            similarity,
          });
        }
      }

      shuffle(candidates);
      return candidates.slice(0, count);
    }

    // 暴力扫描路径
    const candidates: VectorSearchResult[] = [];

    for (const entry of this.vectors.values()) {
      if (entry.norm === 0) continue;
      const sim = cosineSimilarityWithNorms(qVec, entry.vector, qNorm, entry.norm);
      if (sim >= minSim && sim <= maxSim) {
        candidates.push({
          id: entry.id,
          memoryId: entry.memoryId,
          memoryType: entry.memoryType,
          similarity: sim,
        });
      }
    }

    // 随机打乱并取前 N 个
    shuffle(candidates);
    return candidates.slice(0, count);
  }

  /**
   * MINIMEM-003 E04: 多步向量漫游
   *
   * 从 queryVector 出发进行链式漫游：
   * - 每一跳取上一跳中 similarity 最接近 sweet spot (0.45) 的结果向量作为新查询
   * - 跟踪已访问 ID 避免重复发现
   * - 返回完整漫游轨迹
   */
  multiStepWalk(
    queryVector: number[],
    steps: number,
    breadthPerStep: number,
    minSim: number = 0.15,
    maxSim: number = 0.7,
  ): VectorWalkTrail {
    const SWEET_SPOT = 0.45; // 既不太相似也不太远的最佳相似度
    const visited = new Set<string>();
    const hops: VectorWalkTrail['hops'] = [];
    let currentVector = queryVector;

    for (let step = 1; step <= steps; step++) {
      // 使用 randomWalk 获取当前跳的候选（多取一些以弥补去重后的损失）
      const rawResults = this.randomWalk(currentVector, breadthPerStep * 3, minSim, maxSim);

      // 过滤已访问的结果
      const freshResults = rawResults.filter(r => !visited.has(r.memoryId));

      // 取前 breadthPerStep 个
      const stepResults = freshResults.slice(0, breadthPerStep);

      // 标记为已访问
      for (const r of stepResults) {
        visited.add(r.memoryId);
      }

      hops.push({
        step,
        results: stepResults,
        seedVector: currentVector,
      });

      if (stepResults.length === 0) break; // 无新发现，终止漫游

      // 选择下一跳的种子向量：similarity 最接近 sweet spot 的结果
      const nextSeed = stepResults.reduce((best, curr) =>
        Math.abs(curr.similarity - SWEET_SPOT) < Math.abs(best.similarity - SWEET_SPOT) ? curr : best
      );

      // 获取该结果的实际向量作为下一跳的查询向量
      const entry = this.vectors.get(nextSeed.id);
      if (!entry) break;
      currentVector = Array.from(entry.vector);
    }

    return {
      hops,
      totalDiscovered: visited.size,
    };
  }

  /**
   * 删除向量
   */
  delete(id: string): boolean {
    const result = this.vectors.delete(id);
    if (result) {
      // MINIMEM-003: 同步删除 HNSW 节点
      if (this.hnswIndex) {
        this.hnswIndex.remove(id);
      }
      this.markDirty();
    }
    return result;
  }

  /**
   * 存储大小
   */
  get size(): number {
    return this.vectors.size;
  }

  /**
   * 清空
   */
  clear(): void {
    this.vectors.clear();
    // MINIMEM-003: 清空 HNSW 索引
    this.hnswIndex = null;
    this._dimensions = 0;
  }

  /**
   * 获取所有已索引的 memoryId 集合（用于同步检查）
   */
  getIndexedMemoryIds(): Set<string> {
    const ids = new Set<string>();
    for (const entry of this.vectors.values()) {
      ids.add(entry.memoryId);
    }
    return ids;
  }

  /**
   * 获取任意一个向量条目（用于启动维度检查）
   */
  getAny(): { id: string; memoryId: string; memoryType: string; vector: { length: number } } | undefined {
    for (const entry of this.vectors.values()) {
      return {
        id: entry.id,
        memoryId: entry.memoryId,
        memoryType: entry.memoryType,
        vector: entry.vector,  // Float32Array has .length
      };
    }
    return undefined;
  }

  /**
   * 批量删除（按 memoryId）
   */
  deleteByMemoryId(memoryId: string): number {
    let deleted = 0;
    for (const [id, entry] of this.vectors) {
      if (entry.memoryId === memoryId) {
        this.vectors.delete(id);
        // MINIMEM-003: 同步删除 HNSW 节点
        if (this.hnswIndex) {
          this.hnswIndex.remove(id);
        }
        deleted++;
      }
    }
    if (deleted > 0) this.markDirty();
    return deleted;
  }

  // ── 磁盘持久化 ──

  // Issue-19: 二进制格式常量
  private static readonly MAGIC = Buffer.from('MVEC');  // 4 bytes
  private static readonly FORMAT_VERSION = 2;

  /**
   * 将当前向量索引保存到磁盘（二进制格式 v2）
   *
   * 格式:
   *   [4B magic "MVEC"][4B version][4B count][4B dimensions][8B timestamp]
   *   [metadata JSON length 4B][metadata JSON bytes]
   *   [contiguous Float32 vectors: count * dimensions * 4 bytes]
   */
  saveToDisk(dataDir: string): void {
    const vectorsDir = join(dataDir, 'vectors');
    if (!existsSync(vectorsDir)) {
      mkdirSync(vectorsDir, { recursive: true });
    }

    const entries = Array.from(this.vectors.values());
    const count = entries.length;
    if (count === 0) {
      // 空索引时写一个最小文件
      const filePath = join(vectorsDir, 'vector-index.bin');
      const header = Buffer.alloc(24);
      MemoryVectorStore.MAGIC.copy(header, 0);
      header.writeUInt32LE(MemoryVectorStore.FORMAT_VERSION, 4);
      header.writeUInt32LE(0, 8);
      header.writeUInt32LE(0, 12);
      header.writeBigInt64LE(BigInt(Date.now()), 16);
      const metaJson = Buffer.from('[]', 'utf-8');
      const metaLenBuf = Buffer.alloc(4);
      metaLenBuf.writeUInt32LE(metaJson.length);
      writeFileSync(filePath, Buffer.concat([header, metaLenBuf, metaJson]));
      this._dirty = false;
      this._updatesSinceLastSave = 0;
      log.info({ count: 0, path: filePath }, 'Vector index saved to disk (empty, binary v2)');
      return;
    }

    const dimensions = entries[0].vector.length;

    // 构建 metadata JSON（不含向量数据）
    const metadata = entries.map(e => ({
      id: e.id,
      memoryId: e.memoryId,
      memoryType: e.memoryType,
      metadata: e.metadata,
    }));
    const metaJson = Buffer.from(JSON.stringify(metadata), 'utf-8');

    // Header: 24 bytes
    const header = Buffer.alloc(24);
    MemoryVectorStore.MAGIC.copy(header, 0);           // [0..3] magic
    header.writeUInt32LE(MemoryVectorStore.FORMAT_VERSION, 4);  // [4..7] version
    header.writeUInt32LE(count, 8);                    // [8..11] count
    header.writeUInt32LE(dimensions, 12);              // [12..15] dimensions
    header.writeBigInt64LE(BigInt(Date.now()), 16);    // [16..23] timestamp

    // Metadata length + metadata
    const metaLenBuf = Buffer.alloc(4);
    metaLenBuf.writeUInt32LE(metaJson.length);

    // Contiguous vectors: count * dimensions * 4 bytes
    const vectorBuffer = Buffer.alloc(count * dimensions * 4);
    for (let i = 0; i < count; i++) {
      const vec = entries[i].vector;
      for (let j = 0; j < dimensions; j++) {
        vectorBuffer.writeFloatLE(vec[j], (i * dimensions + j) * 4);
      }
    }

    const filePath = join(vectorsDir, 'vector-index.bin');
    writeFileSync(filePath, Buffer.concat([header, metaLenBuf, metaJson, vectorBuffer]));

    this._dirty = false;
    this._updatesSinceLastSave = 0;
    log.info({ count, dimensions, path: filePath, bytes: 24 + 4 + metaJson.length + vectorBuffer.length }, 'Vector index saved to disk (binary v2)');

    // MINIMEM-003: 保存 HNSW 索引（如果存在）
    if (this.hnswIndex) {
      try {
        const hnswPath = join(vectorsDir, 'hnsw-index.bin');
        const hnswBuf = this.hnswIndex.serialize();
        writeFileSync(hnswPath, hnswBuf);
        log.info({ path: hnswPath, bytes: hnswBuf.length, nodes: this.hnswIndex.size }, 'HNSW index saved to disk');
      } catch (err) {
        log.warn({ err }, 'Failed to save HNSW index (non-critical)');
      }
    }
  }

  /**
   * 从磁盘加载向量索引
   * 支持 v2（二进制）和 v1（JSON 遗留格式，自动迁移）
   */
  loadFromDisk(dataDir: string): number {
    const vectorsDir = join(dataDir, 'vectors');

    // 优先加载二进制 v2
    const binPath = join(vectorsDir, 'vector-index.bin');
    if (existsSync(binPath)) {
      const loaded = this.loadBinaryV2(binPath);

      // MINIMEM-003: 尝试加载 HNSW 索引
      if (loaded > 0) {
        this.tryLoadHNSW(vectorsDir);
      }

      return loaded;
    }

    // 回退到 JSON v1（遗留格式迁移）
    const jsonPath = join(vectorsDir, 'vector-index.json');
    if (existsSync(jsonPath)) {
      const loaded = this.loadJsonV1(jsonPath);
      if (loaded > 0) {
        // 自动迁移：重新保存为二进制格式
        log.info({ loaded }, 'Migrating vector index from JSON v1 to binary v2...');
        this.saveToDisk(dataDir);
        // 可选：保留旧文件不删除，留做备份
        log.info('Vector index migrated to binary v2 successfully');
      }
      return loaded;
    }

    log.debug('No vector index file found on disk, starting fresh');
    return 0;
  }

  /**
   * MINIMEM-003: 尝试从磁盘加载 HNSW 索引
   */
  private tryLoadHNSW(vectorsDir: string): void {
    const hnswPath = join(vectorsDir, 'hnsw-index.bin');
    if (!existsSync(hnswPath)) {
      // 没有 HNSW 文件，检查是否需要自动构建
      if (this.vectors.size >= this.hnswAutoThreshold) {
        this._dimensions = this.vectors.values().next().value?.vector.length ?? 0;
        if (this._dimensions > 0) {
          this.buildHNSWIndex();
        }
      }
      return;
    }

    try {
      const buf = readFileSync(hnswPath);
      this.hnswIndex = HNSWIndex.deserialize(buf);
      this._dimensions = this.hnswIndex.dimensions;
      log.info({ nodes: this.hnswIndex.size, dimensions: this._dimensions, path: hnswPath },
        'HNSW index loaded from disk');
    } catch (err) {
      log.warn({ err, path: hnswPath }, 'Failed to load HNSW index, will rebuild if needed');
      this.hnswIndex = null;

      // 如果超过阈值，重新构建
      if (this.vectors.size >= this.hnswAutoThreshold) {
        this._dimensions = this.vectors.values().next().value?.vector.length ?? 0;
        if (this._dimensions > 0) {
          this.buildHNSWIndex();
        }
      }
    }
  }

  /**
   * 加载二进制 v2 格式
   */
  private loadBinaryV2(filePath: string): number {
    try {
      const buf = readFileSync(filePath);

      // 检查最小文件大小（header + metaLen）
      if (buf.length < 28) {
        log.warn({ path: filePath }, 'Binary vector file too small');
        return 0;
      }

      // 验证 magic
      const magic = buf.subarray(0, 4);
      if (!magic.equals(MemoryVectorStore.MAGIC)) {
        log.warn({ path: filePath }, 'Invalid vector file magic');
        return 0;
      }

      const version = buf.readUInt32LE(4);
      if (version !== 2) {
        log.warn({ version, path: filePath }, 'Unsupported binary vector version');
        return 0;
      }

      const count = buf.readUInt32LE(8);
      const dimensions = buf.readUInt32LE(12);
      // timestamp at 16..23 (informational)

      if (count === 0) {
        log.info({ path: filePath }, 'Vector index file is empty');
        return 0;
      }

      // Read metadata JSON
      const metaLen = buf.readUInt32LE(24);
      const metaStart = 28;
      const metaEnd = metaStart + metaLen;
      const metaJson = buf.subarray(metaStart, metaEnd).toString('utf-8');
      const metadata = JSON.parse(metaJson) as Array<{
        id: string;
        memoryId: string;
        memoryType: string;
        metadata: Record<string, unknown>;
      }>;

      if (metadata.length !== count) {
        log.warn({ metadataLen: metadata.length, expectedCount: count }, 'Metadata count mismatch');
        return 0;
      }

      // Read contiguous vectors
      const vectorStart = metaEnd;
      const expectedVectorBytes = count * dimensions * 4;
      if (buf.length < vectorStart + expectedVectorBytes) {
        log.warn({ bufLen: buf.length, expected: vectorStart + expectedVectorBytes }, 'Vector data truncated');
        return 0;
      }

      let loaded = 0;
      for (let i = 0; i < count; i++) {
        const vec = new Float32Array(dimensions);
        const offset = vectorStart + i * dimensions * 4;
        for (let j = 0; j < dimensions; j++) {
          vec[j] = buf.readFloatLE(offset + j * 4);
        }

        const meta = metadata[i];
        this.vectors.set(meta.id, {
          id: meta.id,
          memoryId: meta.memoryId,
          memoryType: meta.memoryType,
          vector: vec,
          norm: vectorNorm(vec),
          metadata: meta.metadata,
        });
        loaded++;
      }

      log.info({ loaded, dimensions, path: filePath }, 'Vector index loaded from disk (binary v2)');
      return loaded;
    } catch (err) {
      log.warn({ err, path: filePath }, 'Failed to load binary vector index');
      return 0;
    }
  }

  /**
   * 加载 JSON v1 格式（遗留，用于迁移）
   */
  private loadJsonV1(filePath: string): number {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const payload = JSON.parse(raw) as { version: number; count: number; records: VectorDiskRecord[] };

      if (payload.version !== 1) {
        log.warn({ version: payload.version }, 'Unknown JSON vector index version, skipping');
        return 0;
      }

      let loaded = 0;
      for (const rec of payload.records) {
        const vec = new Float32Array(rec.vector);
        this.vectors.set(rec.id, {
          id: rec.id,
          memoryId: rec.memoryId,
          memoryType: rec.memoryType,
          vector: vec,
          norm: vectorNorm(vec),
          metadata: rec.metadata,
        });
        loaded++;
      }

      log.info({ loaded, path: filePath }, 'Vector index loaded from disk (JSON v1, will migrate)');
      return loaded;
    } catch (err) {
      log.warn({ err, path: filePath }, 'Failed to load JSON vector index');
      return 0;
    }
  }
}

// ── 工具函数 ──

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
 * 余弦相似度（利用预计算的范数，避免重复计算）
 */
function cosineSimilarityWithNorms(a: Float32Array, b: Float32Array, normA: number, normB: number): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }

  const denom = normA * normB;
  return denom === 0 ? 0 : dotProduct / denom;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  return cosineSimilarityWithNorms(a, b, vectorNorm(a), vectorNorm(b));
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ── 单例 ──

let _vectorStore: VectorProvider | null = null;

/**
 * 获取向量存储 Provider（根据 config.storage.vector.provider 自动选择后端）
 *
 * - 'memory'（默认）: 内存向量存储 + 磁盘持久化
 * - 'qdrant': Qdrant HTTP API（需要先调用 initVectorStore() 完成异步初始化）
 * - 'chroma': 暂未实现，回退到 memory
 *
 * 注意：此方法始终同步返回。如果 Qdrant 尚未初始化，返回 MemoryVectorStore。
 * 生产环境推荐在启动阶段调用 initVectorStore() 完成异步初始化。
 */
export function getVectorStore(): VectorProvider {
  if (!_vectorStore) {
    // 同步路径：默认返回 MemoryVectorStore
    // Qdrant 需要通过 initVectorStore() 异步初始化
    _vectorStore = new MemoryVectorStore();
    log.info('In-memory vector store initialized (sync path)');
  }
  return _vectorStore;
}

/**
 * 异步初始化向量存储（推荐在启动阶段调用）
 *
 * MINIMEM-003: 重构为正确的异步初始化路径
 * - 'memory': 直接创建 MemoryVectorStore
 * - 'qdrant': 异步初始化 QdrantVectorProvider + 健康检查
 *   - 初始化成功 → 使用 Qdrant
 *   - 初始化失败 → 降级到 MemoryVectorStore 并记录警告
 * - 'chroma': 暂未实现，回退到 memory
 */
export async function initVectorStore(): Promise<VectorProvider> {
  if (_vectorStore) return _vectorStore;

  let provider: string;
  try {
    provider = getConfig().storage.vector.provider;
  } catch {
    provider = 'memory';
  }

  switch (provider) {
    case 'qdrant': {
      log.info('Initializing Qdrant vector provider...');
      try {
        const { QdrantVectorProvider } = await import('./qdrant-provider.js');
        const qdrant = new QdrantVectorProvider();

        // 获取 embedding 维度用于确保集合存在
        let dimensions: number | undefined;
        try {
          dimensions = getConfig().llm.embedding.dimensions;
        } catch {
          // 无法获取维度，ensureCollection 会跳过
        }

        const ok = await qdrant.initialize(dimensions);
        if (ok) {
          _vectorStore = qdrant;
          log.info('Qdrant vector provider activated');
        } else {
          log.warn('Qdrant initialization failed — falling back to MemoryVectorStore');
          _vectorStore = new MemoryVectorStore();
        }
      } catch (err) {
        log.warn({ err }, 'Failed to load/initialize Qdrant provider — falling back to MemoryVectorStore');
        _vectorStore = new MemoryVectorStore();
      }
      break;
    }
    case 'chroma':
      log.warn('Chroma provider not yet implemented, falling back to memory');
      _vectorStore = new MemoryVectorStore();
      break;
    case 'memory':
    default:
      _vectorStore = new MemoryVectorStore();
      log.info('In-memory vector store initialized');
      break;
  }

  return _vectorStore;
}

/**
 * 向量索引同步：
 * 1. 正向清理：删除向量存储中已不存在于 SQLite 的记忆
 * 2. Issue-11 反向检查：SQLite 中有 embedding_id 但向量缺失 → 标记待回填
 */
export async function syncVectorIndex(db: {
  prepare: (sql: string) => {
    all: (...args: unknown[]) => Array<Record<string, unknown>>;
    run: (...args: unknown[]) => void;
  };
}): Promise<{ removed: number; total: number; needsBackfill: number }> {
  const store = getVectorStore();
  const indexedIds = await store.getIndexedMemoryIds();

  // 收集所有 SQLite 中存在的 memory IDs
  const tables = ['experiences', 'world_facts', 'observations', 'mental_models'];
  const existingIds = new Set<string>();

  for (const table of tables) {
    const rows = db.prepare(`SELECT id FROM "${table}"`).all() as Array<{ id: string }>;
    for (const r of rows) existingIds.add(r.id);
  }

  // 正向清理：向量存储中不存在于 SQLite 的
  let removed = 0;
  if (indexedIds.size > 0) {
    for (const memId of indexedIds) {
      if (!existingIds.has(memId)) {
        removed += await store.deleteByMemoryId(memId);
      }
    }
  }

  // Issue-11: 反向检查 — SQLite 中有 embedding_id 但向量缺失
  let needsBackfill = 0;
  const refreshedIndexedIds = await store.getIndexedMemoryIds();

  // 只检查 L1（experiences 有 embedding_id 字段）
  try {
    const embeddedRows = db.prepare(
      'SELECT id, embedding_id FROM experiences WHERE embedding_id IS NOT NULL'
    ).all() as Array<{ id: string; embedding_id: string }>;

    const timestamp = new Date().toISOString();
    for (const row of embeddedRows) {
      if (!refreshedIndexedIds.has(row.id)) {
        // SQLite 认为有 embedding 但向量缺失 → 标记回填
        needsBackfill++;
        try {
          const backfillId = `bf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          db.prepare(`
            INSERT OR IGNORE INTO compile_queue (id, source_type, content, target_page, priority, status, created_at)
            VALUES (?, 'embedding_backfill', ?, NULL, 8, 'pending', ?)
          `).run(backfillId, JSON.stringify({ memory_id: row.id, memory_type: 'L1' }), timestamp);
        } catch {
          // 忽略入队错误
        }
      }
    }
  } catch {
    log.warn('Failed to check embedding backfill during vector sync');
  }

  if (removed > 0 || needsBackfill > 0) {
    log.info({ removed, needsBackfill, total: store.size }, 'Vector index synced with database');
  }

  return { removed, total: store.size, needsBackfill };
}
