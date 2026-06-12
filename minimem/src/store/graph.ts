// ============================================================
// MiniMem — 知识图谱存储
// ============================================================

import { getDb } from './database.js';
import { generateId, now } from '../common/utils.js';
import type { MemoryLink, MemoryLayer, LinkType } from '../common/types.js';

/**
 * 创建图边
 */
export function createLink(
  sourceId: string, sourceType: MemoryLayer,
  targetId: string, targetType: MemoryLayer,
  linkType: LinkType = 'related',
  weight: number = 0.5,
): MemoryLink {
  const db = getDb();
  const id = generateId();

  db.prepare(`
    INSERT INTO memory_links (id, source_id, source_type, target_id, target_type, link_type, weight, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sourceId, sourceType, targetId, targetType, linkType, weight, now());

  return { id, source_id: sourceId, source_type: sourceType, target_id: targetId, target_type: targetType, link_type: linkType, weight, created_at: now() };
}

/**
 * 获取某节点的所有出边
 */
export function getOutboundLinks(sourceId: string): MemoryLink[] {
  const db = getDb();
  return db.prepare('SELECT * FROM memory_links WHERE source_id = ?').all(sourceId) as MemoryLink[];
}

/**
 * 获取某节点的所有入边
 */
export function getInboundLinks(targetId: string): MemoryLink[] {
  const db = getDb();
  return db.prepare('SELECT * FROM memory_links WHERE target_id = ?').all(targetId) as MemoryLink[];
}

/**
 * N 跳图遍历（BFS）
 */
export function traverseGraph(startId: string, maxHops: number = 2, maxResults: number = 50): MemoryLink[] {
  const db = getDb();
  const visited = new Set<string>([startId]);
  const results: MemoryLink[] = [];
  let frontier = [startId];

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      const links = db.prepare(
        'SELECT * FROM memory_links WHERE source_id = ? OR target_id = ?'
      ).all(nodeId, nodeId) as MemoryLink[];

      for (const link of links) {
        if (results.length >= maxResults) return results;
        results.push(link);

        const neighbor = link.source_id === nodeId ? link.target_id : link.source_id;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
  }

  return results;
}

/**
 * 删除某节点的所有边
 */
export function deleteNodeLinks(nodeId: string): number {
  const db = getDb();
  return db.prepare(
    'DELETE FROM memory_links WHERE source_id = ? OR target_id = ?'
  ).run(nodeId, nodeId).changes;
}
