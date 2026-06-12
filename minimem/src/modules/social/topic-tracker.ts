// ============================================================
// MiniMem — 社交模块：话题追踪
// ============================================================

import { getDb } from '../../store/database.js';
import { getLogger } from '../../common/logger.js';

const log = getLogger('social:topic-tracker');

export interface TopicStat {
  topic: string;
  mention_count: number;
  first_seen: string;
  last_seen: string;
  related_people: string[];
}

/**
 * 追踪话题趋势
 */
export function getTopicTrends(days: number = 30, limit: number = 20): TopicStat[] {
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  // 从条件索引中提取 topic: 前缀
  const topicRows = db.prepare(`
    SELECT condition_key, COUNT(*) as cnt,
           MIN(ci.memory_id) as first_id
    FROM condition_index ci
    WHERE condition_key LIKE 'topic:%'
    GROUP BY condition_key
    ORDER BY cnt DESC
    LIMIT ?
  `).all(limit) as Array<{ condition_key: string; cnt: number; first_id: string }>;

  const results: TopicStat[] = [];

  for (const row of topicRows) {
    const topic = row.condition_key.replace('topic:', '');

    // 获取时间范围
    const timeRange = db.prepare(`
      SELECT MIN(e.created_at) as first_seen, MAX(e.created_at) as last_seen
      FROM condition_index ci
      JOIN experiences e ON ci.memory_id = e.id AND ci.memory_type = 'L1'
      WHERE ci.condition_key = ?
    `).get(row.condition_key) as { first_seen: string | null; last_seen: string | null } | undefined;

    // 获取相关人物
    const people = db.prepare(`
      SELECT DISTINCT REPLACE(ci2.condition_key, 'person:', '') as person_name
      FROM condition_index ci
      JOIN condition_index ci2 ON ci.memory_id = ci2.memory_id AND ci.memory_type = ci2.memory_type
      WHERE ci.condition_key = ? AND ci2.condition_key LIKE 'person:%'
      LIMIT 5
    `).all(row.condition_key) as Array<{ person_name: string }>;

    results.push({
      topic,
      mention_count: row.cnt,
      first_seen: timeRange?.first_seen ?? '',
      last_seen: timeRange?.last_seen ?? '',
      related_people: people.map(p => p.person_name),
    });
  }

  log.debug({ topicCount: results.length, days }, 'Topic trends retrieved');
  return results;
}

/**
 * 获取某人相关的话题
 */
export function getPersonTopics(personName: string): TopicStat[] {
  const db = getDb();
  const personKey = `person:${personName}`;

  const topics = db.prepare(`
    SELECT DISTINCT ci2.condition_key, COUNT(*) as cnt
    FROM condition_index ci
    JOIN condition_index ci2 ON ci.memory_id = ci2.memory_id AND ci.memory_type = ci2.memory_type
    WHERE ci.condition_key = ? AND ci2.condition_key LIKE 'topic:%'
    GROUP BY ci2.condition_key
    ORDER BY cnt DESC
    LIMIT 20
  `).all(personKey) as Array<{ condition_key: string; cnt: number }>;

  return topics.map(t => ({
    topic: t.condition_key.replace('topic:', ''),
    mention_count: t.cnt,
    first_seen: '',
    last_seen: '',
    related_people: [personName],
  }));
}

/**
 * 获取某话题的详细信息（最近记忆）
 */
export function getTopicDetails(topic: string, limit: number = 10): {
  topic: string;
  memories: Array<{ id: string; content: string; importance: number; created_at: string }>;
} {
  const db = getDb();
  const topicKey = `topic:${topic}`;

  const rows = db.prepare(`
    SELECT e.id, e.raw_content, e.importance, e.created_at
    FROM condition_index ci
    JOIN experiences e ON ci.memory_id = e.id AND ci.memory_type = 'L1'
    WHERE ci.condition_key = ? AND e.branch = 'main'
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(topicKey, limit) as Array<{ id: string; raw_content: string; importance: number; created_at: string }>;

  return {
    topic,
    memories: rows.map(r => ({
      id: r.id,
      content: r.raw_content,
      importance: r.importance,
      created_at: r.created_at,
    })),
  };
}
