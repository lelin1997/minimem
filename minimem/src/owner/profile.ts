// ============================================================
// MiniMem — Owner Profile: KV 存储
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { now } from '../common/utils.js';
import type { OwnerProfileEntry, MemorySource } from '../common/types.js';

const log = getLogger('owner:profile');

/**
 * 设置一个 Owner Profile 条目
 */
export function setProfileEntry(
  key: string,
  value: unknown,
  options: { category?: string; confidence?: number; source?: MemorySource } = {},
): OwnerProfileEntry {
  const db = getDb();
  const timestamp = now();

  db.prepare(`
    INSERT INTO owner_profile (key, value, category, confidence, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = ?,
      category = COALESCE(?, category),
      confidence = ?,
      source = ?,
      updated_at = ?
  `).run(
    key,
    JSON.stringify(value),
    options.category ?? inferCategory(key),
    options.confidence ?? 0.5,
    options.source ?? 'system',
    timestamp,
    // ON CONFLICT values
    JSON.stringify(value),
    options.category ?? null,
    options.confidence ?? 0.5,
    options.source ?? 'system',
    timestamp,
  );

  log.debug({ key, category: options.category }, 'Profile entry set');
  return getProfileEntry(key)!;
}

/**
 * 获取单个 Profile 条目
 */
export function getProfileEntry(key: string): OwnerProfileEntry | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM owner_profile WHERE key = ?').get(key) as Record<string, unknown> | undefined;
  return row ? rowToEntry(row) : null;
}

/**
 * 获取一个分类下的所有条目
 */
export function getProfileByCategory(category: string): OwnerProfileEntry[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM owner_profile WHERE category = ? ORDER BY key'
  ).all(category) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

/**
 * 获取完整的 Owner Profile（所有条目）
 */
export function getFullProfile(): Record<string, unknown> {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM owner_profile ORDER BY category, key').all() as Record<string, unknown>[];

  const profile: Record<string, unknown> = {};
  for (const row of rows) {
    const key = row.key as string;
    const value = JSON.parse(row.value as string);
    // 构建嵌套对象: "identity.name" → { identity: { name: value } }
    setNestedValue(profile, key, value);
  }
  return profile;
}

/**
 * 获取指定前缀下的所有条目（如 "preferences.*"）
 */
export function getProfileByPrefix(prefix: string): OwnerProfileEntry[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM owner_profile WHERE key LIKE ? ORDER BY key"
  ).all(`${prefix}%`) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

/**
 * 删除一个 Profile 条目
 */
export function deleteProfileEntry(key: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM owner_profile WHERE key = ?').run(key);
  return result.changes > 0;
}

/**
 * 批量设置 Profile 条目
 */
export function setProfileEntries(
  entries: Array<{ key: string; value: unknown; category?: string; confidence?: number; source?: MemorySource }>,
): number {
  const db = getDb();
  let count = 0;

  db.transaction(() => {
    for (const entry of entries) {
      setProfileEntry(entry.key, entry.value, {
        category: entry.category,
        confidence: entry.confidence,
        source: entry.source,
      });
      count++;
    }
  })();

  log.info({ count }, 'Profile entries batch set');
  return count;
}

/**
 * 列出所有分类
 */
export function listProfileCategories(): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT DISTINCT category FROM owner_profile ORDER BY category'
  ).all() as Array<{ category: string }>;
  return rows.map(r => r.category);
}

/**
 * 统计 Profile 条目数
 */
export function countProfileEntries(category?: string): number {
  const db = getDb();
  if (category) {
    return (db.prepare('SELECT COUNT(*) as count FROM owner_profile WHERE category = ?').get(category) as { count: number }).count;
  }
  return (db.prepare('SELECT COUNT(*) as count FROM owner_profile').get() as { count: number }).count;
}

// ── 内部工具 ──

function inferCategory(key: string): string {
  const parts = key.split('.');
  return parts[0] || 'general';
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function rowToEntry(row: Record<string, unknown>): OwnerProfileEntry {
  return {
    key: row.key as string,
    value: JSON.parse(row.value as string),
    category: row.category as string,
    confidence: row.confidence as number,
    source: row.source as string,
    updated_at: row.updated_at as string,
  };
}
