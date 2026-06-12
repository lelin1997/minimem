// ============================================================
// MiniMem — 生命周期管理（温度 + GC + 压缩 + 来源信誉）
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import { getVectorStore } from '../store/vectors.js';
import { getConfig } from '../config/index.js';
import { MAX_COMPRESSION_LEVEL, LAYER_PROTECTION } from '../common/constants.js';
import { demoteByTemperature, deleteFullyCompressed, demoteByLayer, deleteFullyCompressedByLayer } from './demotion.js';
import type { TemperatureLevel, GCType, MemoryLayer } from '../common/types.js';

const log = getLogger('lifecycle');

// ═══════════════ 温度引擎 ═══════════════

/**
 * 温度等级阈值
 */
const TEMP_THRESHOLDS: Array<{ level: TemperatureLevel; min: number }> = [
  { level: 'hot', min: 80 },
  { level: 'warm', min: 60 },
  { level: 'cool', min: 40 },
  { level: 'cold', min: 20 },
  { level: 'frozen', min: 0 },
];

function scoreToLevel(score: number): TemperatureLevel {
  for (const t of TEMP_THRESHOLDS) {
    if (score >= t.min) return t.level;
  }
  return 'frozen';
}

/**
 * 初始化一条记忆的温度
 *
 * MINIMEM-003 E10: 设置初始 stability 和 initial_score
 * - L1: 24 * (1 + importance) 小时
 * - L2: 72 * (1 + confidence) 小时
 * - L3: 168 * (1 + confidence) 小时
 * - L4: 999999（永不遗忘）
 */
export function initTemperature(
  memoryId: string,
  memoryType: string,
  importance: number = 0.5,
  confidence: number = 0.5,
): void {
  const db = getDb();
  const score = Math.min(100, importance * 100 + 20); // 初始 = importance * 100 + 基础分

  // E10: 按层级计算初始 stability
  let stability: number;
  switch (memoryType) {
    case 'L1': stability = 24 * (1 + importance); break;
    case 'L2': stability = 72 * (1 + confidence); break;
    case 'L3': stability = 168 * (1 + confidence); break;
    case 'L4': stability = 999999; break;
    default:   stability = 24; break;
  }

  db.prepare(`
    INSERT OR IGNORE INTO memory_temperature (memory_id, memory_type, temperature, score, access_count, pinned, compression_level, stability, review_count, initial_score, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 0, 0, ?, 0, ?, ?, ?)
  `).run(memoryId, memoryType, scoreToLevel(score), score, stability, score, now(), now());
}

/**
 * 记录访问（升温）
 *
 * MINIMEM-003 E11: 增强版
 * - review_count += 1
 * - stability 更新：S_new = S * (1 + α * ln(1 + interval / S))
 * - initial_score 小幅提升（被检索 = 重要）
 */
export function recordAccess(memoryId: string, memoryType: string): void {
  const db = getDb();
  const timestamp = now();

  // E11: 读取当前记录用于计算 stability 更新
  const current = db.prepare(`
    SELECT score, stability, review_count, initial_score, last_accessed
    FROM memory_temperature
    WHERE memory_id = ? AND memory_type = ?
  `).get(memoryId, memoryType) as {
    score: number; stability: number; review_count: number;
    initial_score: number; last_accessed: string | null;
  } | undefined;

  if (!current) {
    // 如果温度记录不存在，先初始化
    initTemperature(memoryId, memoryType);
    return;
  }

  // 读取 ebbinghaus_alpha 配置
  let alpha = 0.3;
  try {
    const cfg = getConfig();
    const gcCfg = cfg.gc as Record<string, unknown>;
    if (gcCfg.ebbinghaus_alpha !== undefined) alpha = gcCfg.ebbinghaus_alpha as number;
  } catch {
    // 使用默认值
  }

  // 计算距上次访问的小时数
  let intervalHours = 0;
  if (current.last_accessed) {
    intervalHours = Math.max(0, (Date.now() - new Date(current.last_accessed).getTime()) / (1000 * 60 * 60));
  }

  // E11: stability 更新公式 S_new = S * (1 + α * ln(1 + interval / S))
  const newStability = current.stability * (1 + alpha * Math.log(1 + intervalHours / current.stability));

  // E11: initial_score 小幅提升（每次访问 +1，上限 100）
  const newInitialScore = Math.min(100, current.initial_score + 1);

  const newScore = Math.min(100, current.score + 5);
  const newReviewCount = current.review_count + 1;

  db.prepare(`
    UPDATE memory_temperature
    SET score = ?,
        temperature = CASE
          WHEN ? >= 80 THEN 'hot'
          WHEN ? >= 60 THEN 'warm'
          WHEN ? >= 40 THEN 'cool'
          WHEN ? >= 20 THEN 'cold'
          ELSE 'frozen'
        END,
        access_count = access_count + 1,
        last_accessed = ?,
        review_count = ?,
        stability = ?,
        initial_score = ?,
        updated_at = ?
    WHERE memory_id = ? AND memory_type = ?
  `).run(
    newScore, newScore, newScore, newScore, newScore,
    timestamp, newReviewCount, newStability, newInitialScore, timestamp,
    memoryId, memoryType,
  );
}

/**
 * 温度衰减（定期执行）
 *
 * MINIMEM-003 T-E06: 支持多种衰减模型
 * - "linear": 固定衰减 score -= decayRate（原逻辑）
 * - "logarithmic": decay = baseRate * ln(1 + hoursSinceLastAccess / 24)，距上次访问越久衰减越快
 * - "ebbinghaus": 遗忘曲线（Phase 7 实现后接入）
 */
export function decayTemperatures(decayRate: number = 2): number {
  const db = getDb();
  const timestamp = now();

  // 读取衰减模型配置
  let decayModel = 'linear';
  let decayBaseRate = decayRate;
  try {
    const cfg = getConfig();
    const gcCfg = cfg.gc as Record<string, unknown>;
    if (gcCfg.decay_model) decayModel = gcCfg.decay_model as string;
    if (gcCfg.decay_base_rate !== undefined) decayBaseRate = gcCfg.decay_base_rate as number;
  } catch {
    // 使用默认值
  }

  if (decayModel === 'logarithmic') {
    return decayLogarithmic(decayBaseRate, timestamp);
  }

  // MINIMEM-003 E11: Ebbinghaus 遗忘曲线模型
  if (decayModel === 'ebbinghaus') {
    return decayByEbbinghaus(timestamp);
  }

  // 默认 linear 模型：全局统一衰减
  const result = db.prepare(`
    UPDATE memory_temperature
    SET score = MAX(0, score - ?),
        temperature = CASE
          WHEN MAX(0, score - ?) >= 80 THEN 'hot'
          WHEN MAX(0, score - ?) >= 60 THEN 'warm'
          WHEN MAX(0, score - ?) >= 40 THEN 'cool'
          WHEN MAX(0, score - ?) >= 20 THEN 'cold'
          ELSE 'frozen'
        END,
        updated_at = ?
    WHERE pinned = 0
  `).run(decayRate, decayRate, decayRate, decayRate, decayRate, timestamp);

  log.info({ affected: result.changes, decayRate, model: 'linear' }, 'Temperature decay applied');
  return result.changes;
}

/**
 * MINIMEM-003 T-E06.1: 对数衰减模型
 *
 * 公式: decay = baseRate * ln(1 + hoursSinceLastAccess / 24)
 * 特性: 刚访问过的记忆衰减很慢，长期未访问的衰减加速
 */
function decayLogarithmic(baseRate: number, timestamp: string): number {
  const db = getDb();
  const nowMs = Date.now();

  // 逐条计算衰减量（每 6 小时执行一次，性能可接受）
  const rows = db.prepare(`
    SELECT memory_id, memory_type, score, last_accessed
    FROM memory_temperature
    WHERE pinned = 0 AND score > 0
  `).all() as Array<{ memory_id: string; memory_type: string; score: number; last_accessed: string | null }>;

  const updateStmt = db.prepare(`
    UPDATE memory_temperature
    SET score = ?,
        temperature = CASE
          WHEN ? >= 80 THEN 'hot'
          WHEN ? >= 60 THEN 'warm'
          WHEN ? >= 40 THEN 'cool'
          WHEN ? >= 20 THEN 'cold'
          ELSE 'frozen'
        END,
        updated_at = ?
    WHERE memory_id = ? AND memory_type = ?
  `);

  let affected = 0;

  db.transaction(() => {
    for (const row of rows) {
      // 计算距上次访问的小时数
      let hoursSinceAccess: number;
      if (row.last_accessed) {
        hoursSinceAccess = Math.max(0, (nowMs - new Date(row.last_accessed).getTime()) / (1000 * 60 * 60));
      } else {
        // 从未被访问过，使用较大的默认值
        hoursSinceAccess = 168; // 7 天
      }

      // 对数衰减: 刚访问的 ~= baseRate * ln(1) = 0, 24h后 ~= baseRate * ln(2) ≈ 0.69 * baseRate
      const decay = baseRate * Math.log(1 + hoursSinceAccess / 24);
      const newScore = Math.max(0, row.score - decay);

      if (Math.abs(newScore - row.score) >= 0.01) { // 避免无意义的更新
        updateStmt.run(newScore, newScore, newScore, newScore, newScore, timestamp, row.memory_id, row.memory_type);
        affected++;
      }
    }
  })();

  log.info({ affected, total: rows.length, baseRate, model: 'logarithmic' }, 'Temperature decay applied');
  return affected;
}

/**
 * MINIMEM-003 E11: Ebbinghaus 遗忘曲线衰减模型
 *
 * 公式:
 *   R = exp(-t / stability)       — 保留率
 *   new_score = initial_score * R  — 新分数
 *
 * 特性: 稳定性越高（被复习越多），衰减越慢
 */
function decayByEbbinghaus(timestamp: string): number {
  const db = getDb();
  const nowMs = Date.now();

  // 逐条计算衰减量
  const rows = db.prepare(`
    SELECT memory_id, memory_type, score, stability, initial_score, last_accessed
    FROM memory_temperature
    WHERE pinned = 0 AND score > 0
  `).all() as Array<{
    memory_id: string; memory_type: string; score: number;
    stability: number; initial_score: number; last_accessed: string | null;
  }>;

  const updateStmt = db.prepare(`
    UPDATE memory_temperature
    SET score = ?,
        temperature = CASE
          WHEN ? >= 80 THEN 'hot'
          WHEN ? >= 60 THEN 'warm'
          WHEN ? >= 40 THEN 'cool'
          WHEN ? >= 20 THEN 'cold'
          ELSE 'frozen'
        END,
        updated_at = ?
    WHERE memory_id = ? AND memory_type = ?
  `);

  let affected = 0;

  db.transaction(() => {
    for (const row of rows) {
      // 计算距上次访问的小时数
      let hoursSinceAccess: number;
      if (row.last_accessed) {
        hoursSinceAccess = Math.max(0, (nowMs - new Date(row.last_accessed).getTime()) / (1000 * 60 * 60));
      } else {
        hoursSinceAccess = 168; // 从未访问：默认 7 天
      }

      // 安全检查：stability 至少为 1（避免除零）
      const stability = Math.max(1, row.stability ?? 24);
      const initialScore = row.initial_score ?? 50;

      // Ebbinghaus 保留率
      const retention = Math.exp(-hoursSinceAccess / stability);
      const newScore = Math.max(0, initialScore * retention);

      if (Math.abs(newScore - row.score) >= 0.01) {
        updateStmt.run(newScore, newScore, newScore, newScore, newScore, timestamp, row.memory_id, row.memory_type);
        affected++;
      }
    }
  })();

  log.info({ affected, total: rows.length, model: 'ebbinghaus' }, 'Temperature decay applied');
  return affected;
}

/**
 * 置顶/取消置顶
 */
export function pinMemory(memoryId: string, memoryType: string, pinned: boolean): void {
  const db = getDb();
  db.prepare(`
    UPDATE memory_temperature SET pinned = ?, updated_at = ? WHERE memory_id = ? AND memory_type = ?
  `).run(pinned ? 1 : 0, now(), memoryId, memoryType);
}

/**
 * 获取温度分布统计
 */
export function getTemperatureDistribution(): Record<TemperatureLevel, number> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT temperature, COUNT(*) as count FROM memory_temperature GROUP BY temperature'
  ).all() as Array<{ temperature: TemperatureLevel; count: number }>;

  const dist: Record<TemperatureLevel, number> = { hot: 0, warm: 0, cool: 0, cold: 0, frozen: 0 };
  for (const row of rows) {
    dist[row.temperature] = row.count;
  }
  return dist;
}

// ═══════════════ GC 策略 ═══════════════

export interface GCResult {
  gc_type: GCType;
  scanned: number;
  merged: number;
  compressed: number;
  deleted: number;
  duration_ms: number;
}

/**
 * 轻量 GC（每 6 小时）：温度衰减 + 噪音过滤
 */
export function runLightGC(): GCResult {
  const start = Date.now();
  const db = getDb();

  // 1. 温度衰减
  const decayed = decayTemperatures(2);

  // 2. 噪音过滤：importance < 0.2 且 access_count = 0 且创建超过 14 天
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const noiseRows = db.prepare(`
    SELECT mt.memory_id, mt.memory_type FROM memory_temperature mt
    JOIN experiences e ON e.id = mt.memory_id AND mt.memory_type = 'L1'
    WHERE mt.access_count = 0
      AND e.importance < 0.2
      AND e.created_at < ?
      AND mt.pinned = 0
      AND mt.temperature IN ('cold', 'frozen')
  `).all(fourteenDaysAgo) as Array<{ memory_id: string; memory_type: string }>;

  // 快速降温
  for (const row of noiseRows) {
    db.prepare(
      "UPDATE memory_temperature SET score = 0, temperature = 'frozen', updated_at = ? WHERE memory_id = ? AND memory_type = ?"
    ).run(now(), row.memory_id, row.memory_type);
  }

  const result: GCResult = {
    gc_type: 'light',
    scanned: decayed,
    merged: 0,
    compressed: 0,
    deleted: 0,
    duration_ms: Date.now() - start,
  };

  // 记录 GC 日志
  logGC(result);
  return result;
}

/**
 * 标准 GC（每日做梦时）：+ 重复合并 + 过时清理
 */
export function runStandardGC(): GCResult {
  const start = Date.now();
  const db = getDb();

  // 1. 先执行轻量 GC
  const light = runLightGC();

  // 2. 过时清理：valid_until 已过期的 L2 事实 — 不再物理删除，只降温
  const expiredIds = db.prepare(`
    SELECT id FROM world_facts
    WHERE valid_until IS NOT NULL AND valid_until < datetime('now') AND branch = 'main'
  `).all() as Array<{ id: string }>;

  if (expiredIds.length > 0) {
    const stmt = db.prepare(`
      UPDATE memory_temperature
      SET temperature = 'frozen', score = CASE WHEN score > 5 THEN 5 ELSE score END, updated_at = ?
      WHERE memory_id = ? AND memory_type = 'L2'
    `);
    const timestamp = now();
    for (const row of expiredIds) {
      stmt.run(timestamp, row.id);
    }
    log.info({ expired: expiredIds.length }, 'Expired L2 facts demoted to frozen (not deleted)');
  }

  // 3. frozen 记忆如果超过 30 天无访问，标记为待压缩
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toCompress = db.prepare(`
    UPDATE memory_temperature
    SET compression_level = MAX(compression_level, 1), updated_at = ?
    WHERE temperature = 'frozen'
      AND pinned = 0
      AND compression_level = 0
      AND (last_accessed IS NULL OR last_accessed < ?)
  `).run(now(), thirtyDaysAgo);

  const result: GCResult = {
    gc_type: 'standard',
    scanned: light.scanned,
    merged: 0,
    compressed: toCompress.changes,
    deleted: expiredIds.length,
    duration_ms: Date.now() - start,
  };

  logGC(result);
  return result;
}

/**
 * 深度 GC（每周）：+ 存储配额检查（所有温度层级）+ 先压缩后删除 + 来源信誉
 */
export async function runDeepGC(): Promise<GCResult> {
  const start = Date.now();

  // 1. 标准 GC
  const standard = runStandardGC();

  // 2. 存储配额检查 — 从配置读取，不再硬编码
  const dist = getTemperatureDistribution();
  const quotas = getConfig().gc.storage_quotas;

  let totalDeleted = standard.deleted;
  let totalCompressed = standard.compressed;

  // 检查所有温度层级配额（从最冷到最热）
  for (const level of ['frozen', 'cold', 'cool', 'warm', 'hot'] as const) {
    if (dist[level] > quotas[level]) {
      const excess = dist[level] - quotas[level];
      log.info({ level, count: dist[level], quota: quotas[level], excess }, 'Temperature level over quota');

      // 第一步：尝试压缩（提升 compression_level）
      const demoted = await demoteByTemperature(level, excess);
      totalCompressed += demoted;

      // 第二步：重新检查，只删除已达 MAX_COMPRESSION_LEVEL 且仍超额的
      const newDist = getTemperatureDistribution();
      const stillExcess = newDist[level] - quotas[level];
      if (stillExcess > 0) {
        const deleted = deleteFullyCompressed(level, stillExcess);
        totalDeleted += deleted;
      }
    }
  }

  // 3. 来源信誉更新
  updateSourceReputations();

  const result: GCResult = {
    gc_type: 'deep',
    scanned: standard.scanned,
    merged: standard.merged,
    compressed: totalCompressed,
    deleted: totalDeleted,
    duration_ms: Date.now() - start,
  };

  logGC(result);
  return result;
}

// ═══════════════ 来源信誉 ═══════════════

/**
 * 更新所有来源的信誉分
 */
function updateSourceReputations(): void {
  const db = getDb();

  // 统计每个来源被 GC 清理的比率
  const sources = db.prepare(`
    SELECT source, COUNT(*) as total FROM experiences WHERE branch = 'main' GROUP BY source
  `).all() as Array<{ source: string; total: number }>;

  for (const src of sources) {
    const cleaned = db.prepare(`
      SELECT COUNT(*) as count FROM memory_tombstones WHERE original_type = 'L1'
    `).get() as { count: number };

    const rate = src.total > 0 ? cleaned.count / src.total : 0;
    const score = Math.max(0, 100 - rate * 100);
    const penalty = rate > 0.5 ? Math.min(0.5, (rate - 0.5)) : 0;

    db.prepare(`
      INSERT INTO source_reputation (client_id, reputation_score, total_memories, gc_cleaned_count, gc_cleaned_rate, importance_penalty, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET
        reputation_score = ?,
        total_memories = ?,
        gc_cleaned_count = ?,
        gc_cleaned_rate = ?,
        importance_penalty = ?,
        updated_at = ?
    `).run(
      src.source, score, src.total, cleaned.count, rate, penalty, now(),
      score, src.total, cleaned.count, rate, penalty, now(),
    );
  }
}

// ═══════════════ 内部工具 ═══════════════

function deleteOldestFrozen(count: number): number {
  const db = getDb();

  const rows = db.prepare(`
    SELECT memory_id, memory_type FROM memory_temperature
    WHERE temperature = 'frozen' AND pinned = 0
    ORDER BY score ASC, updated_at ASC
    LIMIT ?
  `).all(count) as Array<{ memory_id: string; memory_type: string }>;

  let deleted = 0;
  const vectorStore = getVectorStore();
  for (const row of rows) {
    // 创建墓碑
    db.prepare(`
      INSERT INTO memory_tombstones (id, original_id, original_type, reason, created_at)
      VALUES (?, ?, ?, 'lifecycle_gc', ?)
    `).run(generateId(), row.memory_id, row.memory_type, now());

    // 删除温度记录
    db.prepare('DELETE FROM memory_temperature WHERE memory_id = ? AND memory_type = ?').run(row.memory_id, row.memory_type);

    // R-004: 清理向量存储
    vectorStore.deleteByMemoryId(row.memory_id);

    // R-012: 清理 evidence 悬挂引用
    db.prepare('DELETE FROM knowledge_page_evidence WHERE evidence_id = ?').run(row.memory_id);

    // 清理 FTS 和条件索引
    db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(row.memory_id);
    db.prepare('DELETE FROM condition_index WHERE memory_id = ?').run(row.memory_id);

    deleted++;
  }

  return deleted;
}

function logGC(result: GCResult): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO gc_log (id, run_id, gc_type, memories_scanned, duplicates_merged, compressed, deleted, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateId(), generateId(), result.gc_type,
    result.scanned, result.merged, result.compressed, result.deleted,
    result.duration_ms, now(),
  );

  log.info(result, 'GC completed');
}

// ═══════════════ 紧急 GC ═══════════════

/**
 * 分层配额定义
 */
interface LayerQuota {
  layer: MemoryLayer;
  maxTotal: number;
  protectionLevel: number; // 0-3 (3=最高)
}

const LAYER_QUOTAS: LayerQuota[] = [
  { layer: 'L1', maxTotal: 150000, protectionLevel: 0 },  // 经历：量大，保护低
  { layer: 'L2', maxTotal: 30000,  protectionLevel: 1 },  // 事实：中等保护
  { layer: 'L3', maxTotal: 15000,  protectionLevel: 2 },  // 观察：高保护
  { layer: 'L4', maxTotal: 5000,   protectionLevel: 3 },  // 心智模型：最高保护
];

/**
 * 获取指定层级的记忆总数
 */
function getLayerCount(layer: MemoryLayer): number {
  const db = getDb();
  return (db.prepare(
    'SELECT COUNT(*) as count FROM memory_temperature WHERE memory_type = ?'
  ).get(layer) as { count: number }).count;
}

/**
 * 紧急 GC：当存储超过 80% 配额时触发
 *
 * 修复说明：
 * - 配额从 getConfig().gc.storage_quotas 读取，不再硬编码
 * - 按记忆层级分层处理（L1 先清理，L4 永不删除）
 * - 先尝试压缩（提升 compression_level），后删除已达最高压缩级别的
 */
export async function runEmergencyGC(): Promise<GCResult> {
  const start = Date.now();
  const db = getDb();

  // 从配置读取配额，总量上限 = 各层配额之和
  const quotas = getConfig().gc.storage_quotas;
  const quotaLimit = Object.values(quotas).reduce((a, b) => a + b, 0);

  const totalCount = (db.prepare(`
    SELECT COUNT(*) as count FROM memory_temperature
  `).get() as { count: number }).count;

  const threshold80 = quotaLimit * 0.8;
  const target60 = quotaLimit * 0.6;

  if (totalCount < threshold80) {
    log.info({ totalCount, threshold80 }, 'Emergency GC not needed');
    return { gc_type: 'emergency', scanned: totalCount, merged: 0, compressed: 0, deleted: 0, duration_ms: Date.now() - start };
  }

  log.warn({ totalCount, quotaLimit, threshold80 }, 'Emergency GC triggered');

  let totalDeleted = 0;
  let totalCompressed = 0;

  // 按保护等级从低到高处理（先清理 L1，最后才动 L4）
  for (const quota of LAYER_QUOTAS) {
    const layerCount = getLayerCount(quota.layer);

    if (layerCount <= quota.maxTotal) continue;
    const excess = layerCount - quota.maxTotal;

    log.info({ layer: quota.layer, count: layerCount, maxTotal: quota.maxTotal, excess },
      'Layer over quota, processing');

    // 第一步：压缩（提升 compression_level）
    const demoted = await demoteByLayer(quota.layer, excess);
    totalCompressed += demoted;

    // 第二步：只删除已达 MAX_COMPRESSION_LEVEL 的（仅 L1/L2 允许删除）
    const protection = LAYER_PROTECTION[quota.layer];
    if (protection.canDelete) {
      const stillExcess = getLayerCount(quota.layer) - quota.maxTotal;
      if (stillExcess > 0) {
        totalDeleted += deleteFullyCompressedByLayer(quota.layer, stillExcess);
      }
    }
    // L3/L4: 只压缩，永不物理删除
  }

  // 如果分层处理后总量仍超 80%，再做全局清理（仅限 L1）
  const remainingTotal = (db.prepare(`
    SELECT COUNT(*) as count FROM memory_temperature
  `).get() as { count: number }).count;

  if (remainingTotal > quotaLimit * 0.8) {
    const remaining = remainingTotal - Math.floor(target60);
    totalDeleted += deleteFullyCompressedByLayer('L1', remaining);
  }

  const result: GCResult = {
    gc_type: 'emergency',
    scanned: totalCount,
    merged: 0,
    compressed: totalCompressed,
    deleted: totalDeleted,
    duration_ms: Date.now() - start,
  };

  logGC(result);
  return result;
}
