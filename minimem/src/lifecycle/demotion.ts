// ============================================================
// MiniMem — 降级（渐进压缩）模块
// ============================================================
// 负责批量提升 compression_level，以及删除已达最高压缩级别的记忆

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import { getVectorStore } from '../store/vectors.js';
import { MAX_COMPRESSION_LEVEL, LAYER_PROTECTION } from '../common/constants.js';
import { compressToLevel } from './compressor.js';
import type { TemperatureLevel, MemoryLayer } from '../common/types.js';

const log = getLogger('lifecycle:demotion');

/**
 * 按温度层级批量压缩记忆（提升 compression_level）
 *
 * @param temperature - 温度等级
 * @param count - 目标处理数量
 * @returns 实际压缩的数量
 */
export async function demoteByTemperature(temperature: TemperatureLevel, count: number): Promise<number> {
  const db = getDb();

  const rows = db.prepare(`
    SELECT mt.memory_id, mt.memory_type, mt.compression_level
    FROM memory_temperature mt
    WHERE mt.temperature = ? AND mt.pinned = 0
      AND mt.compression_level < ?
    ORDER BY mt.score ASC, mt.updated_at ASC
    LIMIT ?
  `).all(temperature, MAX_COMPRESSION_LEVEL, count) as Array<{
    memory_id: string; memory_type: string; compression_level: number;
  }>;

  let demoted = 0;
  for (const row of rows) {
    // 检查层级保护
    const protection = LAYER_PROTECTION[row.memory_type as MemoryLayer];
    if (protection) {
      const newLevel = row.compression_level + 1;
      if (newLevel > protection.maxCompression) {
        log.debug({ memoryId: row.memory_id, layer: row.memory_type, newLevel },
          'Skipping demotion: layer protection limit reached');
        continue;
      }
    }

    const success = await compressToLevel(row.memory_id, row.memory_type, row.compression_level + 1);
    if (success) demoted++;
  }

  if (demoted > 0) {
    log.info({ temperature, requested: count, demoted }, 'Demotion by temperature complete');
  }
  return demoted;
}

/**
 * 按记忆层级批量压缩记忆
 *
 * @param layer - 记忆层级 (L1/L2/L3/L4)
 * @param count - 目标处理数量
 * @returns 实际压缩的数量
 */
export async function demoteByLayer(layer: MemoryLayer, count: number): Promise<number> {
  const db = getDb();
  const protection = LAYER_PROTECTION[layer];

  const rows = db.prepare(`
    SELECT mt.memory_id, mt.memory_type, mt.compression_level
    FROM memory_temperature mt
    WHERE mt.memory_type = ? AND mt.pinned = 0
      AND mt.compression_level < ?
    ORDER BY mt.score ASC, mt.updated_at ASC
    LIMIT ?
  `).all(layer, protection.maxCompression, count) as Array<{
    memory_id: string; memory_type: string; compression_level: number;
  }>;

  let demoted = 0;
  for (const row of rows) {
    const success = await compressToLevel(row.memory_id, row.memory_type, row.compression_level + 1);
    if (success) demoted++;
  }

  if (demoted > 0) {
    log.info({ layer, requested: count, demoted }, 'Demotion by layer complete');
  }
  return demoted;
}

/**
 * 删除指定温度层级中已达最高压缩级别的记忆（最后手段）
 *
 * @param temperature - 温度等级
 * @param count - 最多删除数量
 * @returns 实际删除数量
 */
export function deleteFullyCompressed(temperature: TemperatureLevel, count: number): number {
  const db = getDb();

  const rows = db.prepare(`
    SELECT mt.memory_id, mt.memory_type
    FROM memory_temperature mt
    WHERE mt.temperature = ? AND mt.pinned = 0
      AND mt.compression_level = ?
    ORDER BY mt.score ASC, mt.updated_at ASC
    LIMIT ?
  `).all(temperature, MAX_COMPRESSION_LEVEL, count) as Array<{
    memory_id: string; memory_type: string;
  }>;

  return physicalDelete(rows);
}

/**
 * 删除指定记忆层级中已达最高压缩级别的记忆（最后手段）
 */
export function deleteFullyCompressedByLayer(layer: MemoryLayer, count: number): number {
  const protection = LAYER_PROTECTION[layer];
  if (!protection.canDelete) {
    log.warn({ layer }, 'Cannot physically delete memories from this layer (protection rule)');
    return 0;
  }

  const db = getDb();

  const rows = db.prepare(`
    SELECT mt.memory_id, mt.memory_type
    FROM memory_temperature mt
    WHERE mt.memory_type = ? AND mt.pinned = 0
      AND mt.compression_level = ?
    ORDER BY mt.score ASC, mt.updated_at ASC
    LIMIT ?
  `).all(layer, MAX_COMPRESSION_LEVEL, count) as Array<{
    memory_id: string; memory_type: string;
  }>;

  return physicalDelete(rows);
}

/**
 * 物理删除记忆（创建墓碑 + 清理所有关联数据）
 */
function physicalDelete(rows: Array<{ memory_id: string; memory_type: string }>): number {
  const db = getDb();
  const vectorStore = getVectorStore();
  let deleted = 0;

  for (const row of rows) {
    // 检查层级保护
    const protection = LAYER_PROTECTION[row.memory_type as MemoryLayer];
    if (protection && !protection.canDelete) {
      continue;
    }

    // 创建墓碑
    db.prepare(`
      INSERT INTO memory_tombstones (id, original_id, original_type, reason, created_at)
      VALUES (?, ?, ?, 'lifecycle_gc', ?)
    `).run(generateId(), row.memory_id, row.memory_type, now());

    // 删除温度记录
    db.prepare('DELETE FROM memory_temperature WHERE memory_id = ? AND memory_type = ?')
      .run(row.memory_id, row.memory_type);

    // 清理向量存储
    vectorStore.deleteByMemoryId(row.memory_id);

    // 清理 evidence 悬挂引用
    db.prepare('DELETE FROM knowledge_page_evidence WHERE evidence_id = ?')
      .run(row.memory_id);

    // 清理 FTS 和条件索引
    db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(row.memory_id);
    db.prepare('DELETE FROM condition_index WHERE memory_id = ?').run(row.memory_id);

    deleted++;
  }

  if (deleted > 0) {
    log.info({ deleted, total: rows.length }, 'Physical deletion complete');
  }
  return deleted;
}
