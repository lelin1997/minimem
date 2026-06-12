// ============================================================
// MiniMem — Owner Profile: 人设画像管理
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import type { PersonProfile } from '../common/types.js';

const log = getLogger('owner:persons');

export interface CreatePersonInput {
  name: string;
  aliases?: string[];
  personality?: string;
  interests?: string[];
  opinions?: Record<string, string>;
  speech_patterns?: string[];
  relationships?: Array<{ person: string; type: string }>;
}

/**
 * 创建一个人设画像
 */
export function createPerson(input: CreatePersonInput): PersonProfile {
  const db = getDb();
  const id = generateId();
  const timestamp = now();

  db.prepare(`
    INSERT INTO person_profiles (id, name, aliases, personality, interests, opinions, speech_patterns, relationships, first_seen, last_seen, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    JSON.stringify(input.aliases ?? []),
    input.personality ?? null,
    JSON.stringify(input.interests ?? []),
    JSON.stringify(input.opinions ?? {}),
    JSON.stringify(input.speech_patterns ?? []),
    JSON.stringify(input.relationships ?? []),
    timestamp, timestamp, timestamp, timestamp,
  );

  log.info({ id, name: input.name }, 'Person profile created');
  return getPersonById(id)!;
}

/**
 * 按 ID 获取
 */
export function getPersonById(id: string): PersonProfile | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM person_profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToPerson(row) : null;
}

/**
 * 按名称搜索（精确匹配名称和别名）
 * R-018: 使用 json_each() 进行 JSON 数组精确匹配
 */
export function findPersonByName(name: string): PersonProfile | null {
  const db = getDb();

  // 先精确匹配名称
  let row = db.prepare('SELECT * FROM person_profiles WHERE name = ?').get(name) as Record<string, unknown> | undefined;
  if (row) return rowToPerson(row);

  // R-018: 使用 json_each 精确匹配别名（大小写不敏感）
  row = db.prepare(`
    SELECT pp.* FROM person_profiles pp, json_each(pp.aliases) AS alias
    WHERE LOWER(alias.value) = LOWER(?)
    LIMIT 1
  `).get(name) as Record<string, unknown> | undefined;
  if (row) return rowToPerson(row);

  // 名称模糊匹配（降级）
  row = db.prepare(
    'SELECT * FROM person_profiles WHERE LOWER(name) LIKE ? LIMIT 1'
  ).get(`%${name.toLowerCase()}%`) as Record<string, unknown> | undefined;
  if (row) return rowToPerson(row);

  return null;
}

/**
 * 更新人设画像
 */
export function updatePerson(id: string, updates: Partial<CreatePersonInput>): PersonProfile | null {
  const db = getDb();
  const existing = getPersonById(id);
  if (!existing) return null;

  const timestamp = now();
  const sets: string[] = ['updated_at = ?', 'last_seen = ?'];
  const values: unknown[] = [timestamp, timestamp];

  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.aliases !== undefined) { sets.push('aliases = ?'); values.push(JSON.stringify(updates.aliases)); }
  if (updates.personality !== undefined) { sets.push('personality = ?'); values.push(updates.personality); }
  if (updates.interests !== undefined) { sets.push('interests = ?'); values.push(JSON.stringify(updates.interests)); }
  if (updates.opinions !== undefined) { sets.push('opinions = ?'); values.push(JSON.stringify(updates.opinions)); }
  if (updates.speech_patterns !== undefined) { sets.push('speech_patterns = ?'); values.push(JSON.stringify(updates.speech_patterns)); }
  if (updates.relationships !== undefined) { sets.push('relationships = ?'); values.push(JSON.stringify(updates.relationships)); }

  values.push(id);
  db.prepare(`UPDATE person_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  log.debug({ id }, 'Person profile updated');
  return getPersonById(id);
}

/**
 * 追加信息到现有人设（增量更新，不覆盖）
 */
export function appendPersonInfo(id: string, info: {
  aliases?: string[];
  interests?: string[];
  opinions?: Record<string, string>;
  speech_patterns?: string[];
  relationships?: Array<{ person: string; type: string }>;
}): PersonProfile | null {
  const existing = getPersonById(id);
  if (!existing) return null;

  const updates: Partial<CreatePersonInput> = {};

  if (info.aliases) {
    const merged = [...new Set([...existing.aliases, ...info.aliases])];
    updates.aliases = merged;
  }
  if (info.interests) {
    const merged = [...new Set([...existing.interests, ...info.interests])];
    updates.interests = merged;
  }
  if (info.opinions) {
    updates.opinions = { ...existing.opinions, ...info.opinions };
  }
  if (info.speech_patterns) {
    const merged = [...new Set([...existing.speech_patterns, ...info.speech_patterns])];
    updates.speech_patterns = merged;
  }
  if (info.relationships) {
    const existingKeys = new Set(existing.relationships.map(r => `${r.person}:${r.type}`));
    const newRels = info.relationships.filter(r => !existingKeys.has(`${r.person}:${r.type}`));
    updates.relationships = [...existing.relationships, ...newRels];
  }

  return updatePerson(id, updates);
}

/**
 * 列出所有人设画像
 */
export function listPersons(limit: number = 100): PersonProfile[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM person_profiles ORDER BY last_seen DESC LIMIT ?'
  ).all(limit) as Record<string, unknown>[];
  return rows.map(rowToPerson);
}

/**
 * 更新最后见面时间
 */
export function touchPerson(id: string): void {
  const db = getDb();
  db.prepare('UPDATE person_profiles SET last_seen = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
}

/**
 * 删除人设画像
 */
export function deletePerson(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM person_profiles WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * 统计人设数量
 */
export function countPersons(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as count FROM person_profiles').get() as { count: number }).count;
}

// ── 行转对象 ──

function rowToPerson(row: Record<string, unknown>): PersonProfile {
  return {
    id: row.id as string,
    name: row.name as string,
    aliases: JSON.parse((row.aliases as string) || '[]'),
    personality: (row.personality as string) || null,
    interests: JSON.parse((row.interests as string) || '[]'),
    opinions: JSON.parse((row.opinions as string) || '{}'),
    speech_patterns: JSON.parse((row.speech_patterns as string) || '[]'),
    relationships: JSON.parse((row.relationships as string) || '[]'),
    first_seen: row.first_seen as string,
    last_seen: row.last_seen as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
