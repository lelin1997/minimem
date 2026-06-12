// ============================================================
// MiniMem — 社交模块：关系图谱管理
// ============================================================

import { getDb } from '../../store/database.js';
import { getLogger } from '../../common/logger.js';
import { generateId, now } from '../../common/utils.js';
import { createLink } from '../../store/graph.js';
import type { PersonProfile } from '../../common/types.js';

const log = getLogger('social:relationships');

export interface Relationship {
  person_a: string;
  person_b: string;
  type: string;        // 'colleague' | 'friend' | 'family' | 'mentor' | 'mentee' | ...
  strength: number;    // 0-1
  context: string;     // 关系描述
  last_interaction: string;
}

/**
 * 获取某人的所有关系
 */
export function getRelationships(personName: string): Relationship[] {
  const db = getDb();

  // 从 person_profiles 的 relationships 字段
  const row = db.prepare(
    "SELECT id, relationships FROM person_profiles WHERE name = ? OR aliases LIKE ?"
  ).get(personName, `%${personName}%`) as { id: string; relationships: string } | undefined;

  if (!row) return [];

  const rels = JSON.parse(row.relationships || '[]') as Array<{ person: string; type: string }>;

  return rels.map(r => ({
    person_a: personName,
    person_b: r.person,
    type: r.type,
    strength: 0.5,
    context: '',
    last_interaction: '',
  }));
}

/**
 * 添加关系
 */
export function addRelationship(
  personA: string,
  personB: string,
  type: string,
  context?: string,
): void {
  const db = getDb();

  // 更新 A 的 relationships
  const rowA = db.prepare(
    "SELECT id, relationships FROM person_profiles WHERE name = ?"
  ).get(personA) as { id: string; relationships: string } | undefined;

  if (rowA) {
    const rels = JSON.parse(rowA.relationships || '[]') as Array<{ person: string; type: string }>;
    if (!rels.some(r => r.person === personB)) {
      rels.push({ person: personB, type });
      db.prepare('UPDATE person_profiles SET relationships = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(rels), now(), rowA.id);
    }
  }

  // 反向：更新 B 的 relationships
  const rowB = db.prepare(
    "SELECT id, relationships FROM person_profiles WHERE name = ?"
  ).get(personB) as { id: string; relationships: string } | undefined;

  if (rowB) {
    const rels = JSON.parse(rowB.relationships || '[]') as Array<{ person: string; type: string }>;
    const reverseType = reverseRelationType(type);
    if (!rels.some(r => r.person === personA)) {
      rels.push({ person: personA, type: reverseType });
      db.prepare('UPDATE person_profiles SET relationships = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(rels), now(), rowB.id);
    }
  }

  // 创建图边
  if (rowA && rowB) {
    createLink(rowA.id, 'L3', rowB.id, 'L3', 'related', 0.7);
  }

  log.info({ personA, personB, type }, 'Relationship added');
}

/**
 * 从记忆中自动检测关系
 */
export function detectRelationshipsFromMemories(): number {
  const db = getDb();

  // 找到有多个参与者的经历
  const rows = db.prepare(`
    SELECT participants FROM experiences
    WHERE branch = 'main' AND participants != '[]'
    ORDER BY created_at DESC
    LIMIT 100
  `).all() as Array<{ participants: string }>;

  const pairCounts = new Map<string, number>();

  for (const row of rows) {
    const participants = JSON.parse(row.participants) as string[];
    // 两两配对
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        const key = [participants[i], participants[j]].sort().join('::');
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // 出现次数 >= 3 的认为有关系
  let detected = 0;
  for (const [pair, count] of pairCounts) {
    if (count >= 3) {
      const [a, b] = pair.split('::');
      addRelationship(a, b, 'connected');
      detected++;
    }
  }

  log.info({ detected }, 'Relationships detected from memories');
  return detected;
}

/**
 * 获取社交网络概览
 */
export function getSocialNetworkOverview(): {
  people: number;
  relationships: number;
  mostConnected: Array<{ name: string; connections: number }>;
} {
  const db = getDb();

  const people = (db.prepare('SELECT COUNT(*) as count FROM person_profiles').get() as { count: number }).count;
  const allProfiles = db.prepare('SELECT name, relationships FROM person_profiles').all() as Array<{ name: string; relationships: string }>;

  let totalRels = 0;
  const connectionCounts: Array<{ name: string; connections: number }> = [];

  for (const p of allProfiles) {
    const rels = JSON.parse(p.relationships || '[]') as unknown[];
    totalRels += rels.length;
    connectionCounts.push({ name: p.name, connections: rels.length });
  }

  connectionCounts.sort((a, b) => b.connections - a.connections);

  return {
    people,
    relationships: Math.floor(totalRels / 2), // 双向计数除以 2
    mostConnected: connectionCounts.slice(0, 5),
  };
}

function reverseRelationType(type: string): string {
  const reverseMap: Record<string, string> = {
    mentor: 'mentee',
    mentee: 'mentor',
    manager: 'report',
    report: 'manager',
  };
  return reverseMap[type] ?? type;
}
