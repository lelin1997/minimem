// ============================================================
// MiniMem — 压缩管线（4 级渐进压缩）
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { now, sanitizeUserContent } from '../common/utils.js';
import { getLLM } from '../llm/client.js';
import { COMPRESSION_LEVEL, MAX_COMPRESSION_LEVEL } from '../common/constants.js';
import { COMPRESS_SYSTEM_PROMPT } from '../llm/prompts.js';

const log = getLogger('lifecycle:compressor');

export interface CompressResult {
  compressed: number;
  by_level: { level_1: number; level_2: number; level_3: number };
  duration_ms: number;
}

/**
 * 压缩等级说明：
 * COMPRESSION_LEVEL.FULL (0) = 原始（无压缩）
 * COMPRESSION_LEVEL.SUMMARY (1) = Summary（保留摘要）
 * COMPRESSION_LEVEL.KEY_POINTS (2) = Key Points（仅保留关键点）
 * COMPRESSION_LEVEL.ONE_LINE (3) = One-line（一行描述）
 * 最高级别 = MAX_COMPRESSION_LEVEL (3)
 */

/**
 * 运行压缩管线
 * 
 * 对已标记压缩等级的 frozen 记忆进行渐进压缩：
 * - compression_level 1 且 30 天无访问 → 压缩到 level 2
 * - compression_level 2 且 60 天无访问 → 压缩到 level 3
 */
export async function runCompression(batchSize: number = 20): Promise<CompressResult> {
  const start = Date.now();
  const db = getDb();
  const llm = getLLM();
  const result: CompressResult = { compressed: 0, by_level: { level_1: 0, level_2: 0, level_3: 0 }, duration_ms: 0 };

  // Level 0→1: 尚未压缩的 frozen 记忆（30天无访问）
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toLevel1 = db.prepare(`
    SELECT mt.memory_id, mt.memory_type, e.raw_content
    FROM memory_temperature mt
    JOIN experiences e ON e.id = mt.memory_id AND mt.memory_type = 'L1'
    WHERE mt.temperature = 'frozen' AND mt.pinned = 0 AND mt.compression_level = 0
      AND (mt.last_accessed IS NULL OR mt.last_accessed < ?)
    LIMIT ?
  `).all(thirtyDaysAgo, batchSize) as Array<{ memory_id: string; memory_type: string; raw_content: string }>;

  for (const row of toLevel1) {
    try {
      const summary = await compressToSummary(llm, row.raw_content);
      if (summary) {
        // R-010: 保留原始内容到 context 字段（仅首次压缩时，避免覆盖）
        const existing = db.prepare('SELECT context FROM experiences WHERE id = ?').get(row.memory_id) as { context: string | null } | undefined;
        if (existing && !existing.context) {
          db.prepare('UPDATE experiences SET context = ? WHERE id = ?')
            .run(`[ORIGINAL] ${row.raw_content}`, row.memory_id);
        }
        db.prepare('UPDATE experiences SET raw_content = ?, updated_at = ? WHERE id = ?')
          .run(`[COMPRESSED:summary] ${summary}`, now(), row.memory_id);
        db.prepare('UPDATE memory_temperature SET compression_level = 1, updated_at = ? WHERE memory_id = ? AND memory_type = ?')
          .run(now(), row.memory_id, row.memory_type);
        result.by_level.level_1++;
        result.compressed++;
      }
    } catch (err) {
      log.warn({ id: row.memory_id, err }, 'Failed to compress to level 1');
    }
  }

  // Level 1→2: 已摘要的记忆，60天无访问 → 关键点
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const toLevel2 = db.prepare(`
    SELECT mt.memory_id, mt.memory_type, e.raw_content
    FROM memory_temperature mt
    JOIN experiences e ON e.id = mt.memory_id AND mt.memory_type = 'L1'
    WHERE mt.temperature = 'frozen' AND mt.pinned = 0 AND mt.compression_level = 1
      AND (mt.last_accessed IS NULL OR mt.last_accessed < ?)
    LIMIT ?
  `).all(sixtyDaysAgo, batchSize) as Array<{ memory_id: string; memory_type: string; raw_content: string }>;

  for (const row of toLevel2) {
    try {
      const keyPoints = await compressToKeyPoints(llm, row.raw_content);
      if (keyPoints) {
        db.prepare('UPDATE experiences SET raw_content = ?, updated_at = ? WHERE id = ?')
          .run(`[COMPRESSED:key-points] ${keyPoints}`, now(), row.memory_id);
        db.prepare('UPDATE memory_temperature SET compression_level = 2, updated_at = ? WHERE memory_id = ? AND memory_type = ?')
          .run(now(), row.memory_id, row.memory_type);
        result.by_level.level_2++;
        result.compressed++;
      }
    } catch (err) {
      log.warn({ id: row.memory_id, err }, 'Failed to compress to level 2');
    }
  }

  // Level 2→3: 90天无访问 → 一行
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const toLevel3 = db.prepare(`
    SELECT mt.memory_id, mt.memory_type, e.raw_content
    FROM memory_temperature mt
    JOIN experiences e ON e.id = mt.memory_id AND mt.memory_type = 'L1'
    WHERE mt.temperature = 'frozen' AND mt.pinned = 0 AND mt.compression_level = 2
      AND (mt.last_accessed IS NULL OR mt.last_accessed < ?)
    LIMIT ?
  `).all(ninetyDaysAgo, batchSize) as Array<{ memory_id: string; memory_type: string; raw_content: string }>;

  for (const row of toLevel3) {
    try {
      const oneLine = await compressToOneLine(llm, row.raw_content);
      if (oneLine) {
        db.prepare('UPDATE experiences SET raw_content = ?, updated_at = ? WHERE id = ?')
          .run(`[COMPRESSED:one-line] ${oneLine}`, now(), row.memory_id);
        db.prepare('UPDATE memory_temperature SET compression_level = 3, updated_at = ? WHERE memory_id = ? AND memory_type = ?')
          .run(now(), row.memory_id, row.memory_type);
        result.by_level.level_3++;
        result.compressed++;
      }
    } catch (err) {
      log.warn({ id: row.memory_id, err }, 'Failed to compress to level 3');
    }
  }

  result.duration_ms = Date.now() - start;
  log.info(result, 'Compression pipeline complete');
  return result;
}

// ── 按级别压缩入口（供 demotion.ts 调用） ──

/**
 * 将指定记忆压缩到目标级别
 *
 * @param memoryId   - 记忆 ID
 * @param memoryType - 记忆层级（L1/L2/L3/L4）
 * @param targetLevel - 目标压缩级别（1=Summary, 2=Key Points, 3=One-line）
 * @returns 是否成功
 */
export async function compressToLevel(
  memoryId: string,
  memoryType: string,
  targetLevel: number,
): Promise<boolean> {
  if (targetLevel < COMPRESSION_LEVEL.SUMMARY || targetLevel > MAX_COMPRESSION_LEVEL) {
    log.warn({ memoryId, targetLevel }, 'Invalid target compression level');
    return false;
  }

  const db = getDb();
  const llm = getLLM();

  if (!llm.isAvailable) {
    log.warn({ memoryId }, 'LLM not available, cannot compress');
    return false;
  }

  // 读取当前内容
  const row = db.prepare('SELECT raw_content, context FROM experiences WHERE id = ?')
    .get(memoryId) as { raw_content: string; context: string | null } | undefined;

  if (!row) {
    log.warn({ memoryId }, 'Memory not found for compression');
    return false;
  }

  try {
    let compressed: string | null = null;

    switch (targetLevel) {
      case COMPRESSION_LEVEL.SUMMARY:
        compressed = await compressToSummary(llm, row.raw_content);
        if (compressed) {
          // 首次压缩时备份原文到 context
          if (!row.context) {
            db.prepare('UPDATE experiences SET context = ? WHERE id = ?')
              .run(`[ORIGINAL] ${row.raw_content}`, memoryId);
          }
          db.prepare('UPDATE experiences SET raw_content = ?, updated_at = ? WHERE id = ?')
            .run(`[COMPRESSED:summary] ${compressed}`, now(), memoryId);
        }
        break;

      case COMPRESSION_LEVEL.KEY_POINTS:
        compressed = await compressToKeyPoints(llm, row.raw_content);
        if (compressed) {
          db.prepare('UPDATE experiences SET raw_content = ?, updated_at = ? WHERE id = ?')
            .run(`[COMPRESSED:key-points] ${compressed}`, now(), memoryId);
        }
        break;

      case COMPRESSION_LEVEL.ONE_LINE:
        compressed = await compressToOneLine(llm, row.raw_content);
        if (compressed) {
          db.prepare('UPDATE experiences SET raw_content = ?, updated_at = ? WHERE id = ?')
            .run(`[COMPRESSED:one-line] ${compressed}`, now(), memoryId);
          // Level 3 (one-line) 是不可逆的，清理 context 中的原文备份
          db.prepare('UPDATE experiences SET context = NULL WHERE id = ?').run(memoryId);
        }
        break;
    }

    if (compressed) {
      db.prepare('UPDATE memory_temperature SET compression_level = ?, updated_at = ? WHERE memory_id = ? AND memory_type = ?')
        .run(targetLevel, now(), memoryId, memoryType);
      log.debug({ memoryId, targetLevel }, 'Compressed to target level');
      return true;
    }

    return false;
  } catch (err) {
    log.warn({ memoryId, targetLevel, err }, 'compressToLevel failed');
    return false;
  }
}

// ── LLM 压缩函数（P1: 已加固 Prompt Injection 防护） ──
// COMPRESS_SYSTEM_PROMPT 已统一迁移至 src/llm/prompts.ts

async function compressToSummary(llm: ReturnType<typeof getLLM>, content: string): Promise<string | null> {
  try {
    // P1: sanitize 用户内容
    const { sanitized, injectionDetected } = sanitizeUserContent(content);
    if (injectionDetected) {
      log.debug({ level: 'summary' }, 'Prompt injection pattern detected in compress input, sanitized');
    }

    const result = await llm.chat({
      messages: [
        { role: 'system', content: COMPRESS_SYSTEM_PROMPT },
        { role: 'user', content: `将以下内容压缩为 2-3 句话的摘要，保留关键信息：\n\n${sanitized}` },
      ],
      tier: 'light',
    });
    return result.content || null;
  } catch {
    return null;
  }
}

async function compressToKeyPoints(llm: ReturnType<typeof getLLM>, content: string): Promise<string | null> {
  try {
    const { sanitized, injectionDetected } = sanitizeUserContent(content);
    if (injectionDetected) {
      log.debug({ level: 'key-points' }, 'Prompt injection pattern detected in compress input, sanitized');
    }

    const result = await llm.chat({
      messages: [
        { role: 'system', content: COMPRESS_SYSTEM_PROMPT },
        { role: 'user', content: `将以下内容提取为 3-5 个关键要点（每个要点不超过 10 个字），用分号分隔：\n\n${sanitized}` },
      ],
      tier: 'light',
    });
    return result.content || null;
  } catch {
    return null;
  }
}

async function compressToOneLine(llm: ReturnType<typeof getLLM>, content: string): Promise<string | null> {
  try {
    const { sanitized, injectionDetected } = sanitizeUserContent(content);
    if (injectionDetected) {
      log.debug({ level: 'one-line' }, 'Prompt injection pattern detected in compress input, sanitized');
    }

    const result = await llm.chat({
      messages: [
        { role: 'system', content: COMPRESS_SYSTEM_PROMPT },
        { role: 'user', content: `将以下内容压缩为一行话（不超过 20 个字）：\n\n${sanitized}` },
      ],
      tier: 'light',
    });
    return result.content || null;
  } catch {
    return null;
  }
}
