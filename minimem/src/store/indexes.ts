// ============================================================
// MiniMem — 条件索引 + FTS 全文搜索
// ============================================================

import { getDb } from './database.js';
import type { MemoryLayer } from '../common/types.js';

// ═══════════════ 条件索引 (O(1) 查找) ═══════════════

/**
 * 添加条件索引
 */
export function addConditionIndex(key: string, memoryType: MemoryLayer, memoryId: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO condition_index (condition_key, memory_type, memory_id)
    VALUES (?, ?, ?)
  `).run(key, memoryType, memoryId);
}

/**
 * 批量添加
 */
export function addConditionIndexBatch(entries: Array<{ key: string; memoryType: MemoryLayer; memoryId: string }>): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO condition_index (condition_key, memory_type, memory_id)
    VALUES (?, ?, ?)
  `);

  db.transaction(() => {
    for (const entry of entries) {
      stmt.run(entry.key, entry.memoryType, entry.memoryId);
    }
  })();
}

/**
 * 按条件键查找记忆 ID
 */
export function lookupByCondition(key: string): Array<{ memory_type: MemoryLayer; memory_id: string }> {
  const db = getDb();
  return db.prepare(
    'SELECT memory_type, memory_id FROM condition_index WHERE condition_key = ?'
  ).all(key) as Array<{ memory_type: MemoryLayer; memory_id: string }>;
}

/**
 * 前缀查找（如 "person:" 开头的所有）
 */
export function lookupByPrefix(prefix: string): Array<{ condition_key: string; memory_type: MemoryLayer; memory_id: string }> {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM condition_index WHERE condition_key LIKE ?'
  ).all(`${prefix}%`) as Array<{ condition_key: string; memory_type: MemoryLayer; memory_id: string }>;
}

/**
 * 删除某记忆的所有条件索引
 */
export function removeConditionIndex(memoryId: string): number {
  const db = getDb();
  return db.prepare('DELETE FROM condition_index WHERE memory_id = ?').run(memoryId).changes;
}

// ═══════════════ FTS5 全文搜索 ═══════════════

/**
 * REQ-005: FTS5 查询清洗 — 防止语法注入 + 改善中文检索
 *
 * 1. 移除 FTS5 操作符和特殊字符
 * 2. 按空格分词，每个词用引号包裹
 * 3. 中文连续字符用 bigram 拆分（改善 FTS5 对中文的支持）
 */
function sanitizeFtsQuery(query: string): string {
  // 移除 FTS5 特殊字符和操作符
  let cleaned = query
    .replace(/["*(){}[\]^~]/g, '')
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '');

  // 按空格分词
  const tokens = cleaned.split(/\s+/).filter(t => t.length > 0);

  if (tokens.length === 0) return '""';

  // 处理每个 token：中文连续字符做 bigram，英文直接引号包裹
  const processed: string[] = [];
  for (const token of tokens) {
    // 检测是否包含中文字符
    const chineseChars = token.match(/[\u4e00-\u9fff]/g);
    if (chineseChars && chineseChars.length >= 2) {
      // 中文 bigram 拆分：系统设计 → "系统" "统设" "设计"
      const chars = [...token].filter(c => /[\u4e00-\u9fff]/.test(c));
      for (let i = 0; i < chars.length - 1; i++) {
        processed.push(`"${chars[i]}${chars[i + 1]}"`);
      }
    } else if (token.length > 0) {
      processed.push(`"${token}"`);
    }
  }

  return processed.length > 0 ? processed.join(' ') : '""';
}

/**
 * 添加到全文索引
 */
export function addToFts(memoryId: string, memoryType: string, content: string, tags: string[] = [], conditionKeys: string[] = []): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO memory_fts (memory_id, memory_type, content, tags, condition_keys)
    VALUES (?, ?, ?, ?, ?)
  `).run(memoryId, memoryType, content, tags.join(' '), conditionKeys.join(' '));
}

/**
 * FTS5 全文搜索
 */
export function searchFts(query: string, limit: number = 20): Array<{ memory_id: string; memory_type: string; rank: number }> {
  const db = getDb();

  // REQ-005: 清洗查询，防止 FTS5 语法注入
  const sanitized = sanitizeFtsQuery(query);
  if (sanitized === '""') return []; // 空查询

  // FTS5 查询，BM25 排序
  try {
    const rows = db.prepare(`
      SELECT memory_id, memory_type, rank
      FROM memory_fts
      WHERE memory_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(sanitized, limit) as Array<{ memory_id: string; memory_type: string; rank: number }>;

    return rows;
  } catch (err) {
    // FTS5 查询语法仍然失败时（极端边缘情况），降级到空结果
    return [];
  }
}

/**
 * 从 FTS 索引中删除
 */
export function removeFromFts(memoryId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(memoryId);
}
