// ============================================================
// MiniMem — 唤醒（Promotion）模块
// ============================================================
// 当已压缩的记忆被检索命中时，逆向恢复 compression_level

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { now, generateId } from '../common/utils.js';
import { getLLM } from '../llm/client.js';
import { getVectorStore } from '../store/vectors.js';
import { addToFts, removeFromFts } from '../store/indexes.js';
import { COMPRESSION_LEVEL, IRREVERSIBLE_COMPRESSION_LEVEL } from '../common/constants.js';
import type { MemoryLayer } from '../common/types.js';

const log = getLogger('lifecycle:promotion');

/**
 * 唤醒（升级）已压缩的记忆
 *
 * 当检索命中一条 compression_level > 0 的记忆时调用此函数：
 * - Level 1 (Summary): 从 context 恢复原文 → 重建 FTS
 * - Level 2 (Key Points): 从 context 恢复原文 → 重建向量 + FTS
 * - Level 3 (One-line): 不可恢复（原文已丢失），仅记录日志
 *
 * @param memoryId   - 记忆 ID
 * @param memoryType - 记忆层级
 * @returns 是否成功唤醒
 */
export async function promoteMemory(
  memoryId: string,
  memoryType: MemoryLayer,
): Promise<boolean> {
  const db = getDb();

  const temp = db.prepare(`
    SELECT compression_level FROM memory_temperature
    WHERE memory_id = ? AND memory_type = ?
  `).get(memoryId, memoryType) as { compression_level: number } | undefined;

  if (!temp || temp.compression_level === COMPRESSION_LEVEL.FULL) return false;

  switch (temp.compression_level) {
    case COMPRESSION_LEVEL.SUMMARY: {
      // Summary → Full: 从 context 恢复原文
      const row = db.prepare(
        'SELECT context FROM experiences WHERE id = ?'
      ).get(memoryId) as { context: string | null } | undefined;

      if (row?.context?.startsWith('[ORIGINAL] ')) {
        const originalContent = row.context.slice('[ORIGINAL] '.length);

        // 恢复原文
        db.prepare('UPDATE experiences SET raw_content = ?, updated_at = ? WHERE id = ?')
          .run(originalContent, now(), memoryId);

        // 重建 FTS 索引
        rebuildFTSForMemory(memoryId, memoryType, originalContent);

        // 设回 level 0
        setCompressionLevel(memoryId, memoryType, COMPRESSION_LEVEL.FULL);

        log.info({ memoryId, from: 'summary', to: 'full' }, 'Memory promoted');
        return true;
      }

      log.warn({ memoryId }, 'Cannot promote: original content not found in context');
      return false;
    }

    case COMPRESSION_LEVEL.KEY_POINTS: {
      // Key Points → Full: 从 context 恢复原文 → 重建向量 + FTS
      const row = db.prepare(
        'SELECT context FROM experiences WHERE id = ?'
      ).get(memoryId) as { context: string | null } | undefined;

      if (row?.context?.startsWith('[ORIGINAL] ')) {
        const originalContent = row.context.slice('[ORIGINAL] '.length);

        // 恢复原文
        db.prepare('UPDATE experiences SET raw_content = ?, updated_at = ? WHERE id = ?')
          .run(originalContent, now(), memoryId);

        // 重建向量
        await rebuildEmbedding(memoryId, originalContent);

        // 重建 FTS
        rebuildFTSForMemory(memoryId, memoryType, originalContent);

        // 设回 level 0
        setCompressionLevel(memoryId, memoryType, COMPRESSION_LEVEL.FULL);

        log.info({ memoryId, from: 'key_points', to: 'full' }, 'Memory promoted');
        return true;
      }

      log.warn({ memoryId }, 'Cannot promote: original content not found in context');
      return false;
    }

    default: {
      // Level >= IRREVERSIBLE_COMPRESSION_LEVEL (3): 不可自动升级（原文已丢失）
      if (temp.compression_level >= IRREVERSIBLE_COMPRESSION_LEVEL) {
        log.info({ memoryId, memoryType, compressionLevel: temp.compression_level },
          'Archived memory accessed but cannot auto-promote (original deleted)');
        return false;
      }
      return false;
    }
  }
}

// ═══════════════ 内部工具 ═══════════════

/**
 * 设置记忆的 compression_level
 */
function setCompressionLevel(memoryId: string, memoryType: string, level: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE memory_temperature SET compression_level = ?, updated_at = ?
    WHERE memory_id = ? AND memory_type = ?
  `).run(level, now(), memoryId, memoryType);
}

/**
 * 重建 FTS 索引
 */
function rebuildFTSForMemory(memoryId: string, memoryType: MemoryLayer, content: string): void {
  removeFromFts(memoryId);
  addToFts(memoryId, memoryType, content);
}

/**
 * 重建向量嵌入
 */
async function rebuildEmbedding(memoryId: string, content: string): Promise<void> {
  const llm = getLLM();
  if (!llm.isAvailable) {
    log.warn({ memoryId }, 'LLM not available, cannot rebuild embedding');
    return;
  }

  try {
    const embResult = await llm.embed(content);
    const vectorStore = getVectorStore();
    // 先删旧的，再插新的
    vectorStore.deleteByMemoryId(memoryId);
    vectorStore.add(generateId(), memoryId, 'L1', embResult.embedding);
  } catch (err) {
    log.warn({ memoryId, err }, 'Failed to rebuild embedding');
  }
}
