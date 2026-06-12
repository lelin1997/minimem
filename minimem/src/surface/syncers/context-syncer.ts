// ============================================================
// MiniMem — Surface Syncer: context.md
// ============================================================
// Issue-28: 从近期 L1 记忆 + 活跃 L3 观察同步到 context.md

import { getDb } from '../../store/database.js';
import { registerSyncer, type SurfaceSyncer, type SyncData } from '../sync.js';

const contextSyncer: SurfaceSyncer = {
  hasChanges(lastSyncAt: string | null): boolean {
    const db = getDb();
    if (!lastSyncAt) return true;

    const newMemories = db.prepare(
      `SELECT COUNT(*) as count FROM experiences WHERE created_at > ?`
    ).get(lastSyncAt) as { count: number };

    return newMemories.count > 0;
  },

  collectData(): SyncData | null {
    const db = getDb();

    // 最近 24 小时的 L1 记忆
    const recentMemories = db.prepare(
      `SELECT raw_content, source, created_at FROM experiences
       WHERE created_at > datetime('now', '-1 day')
       ORDER BY created_at DESC LIMIT 20`
    ).all() as Array<{ raw_content: string; source: string; created_at: string }>;

    // 高置信度的 L3 观察（按 confidence + 最近更新排序）
    const activeObservations = db.prepare(
      `SELECT description, confidence, observation_type FROM observations
       WHERE confidence > 0.5
       ORDER BY updated_at DESC LIMIT 5`
    ).all() as Array<{ description: string; confidence: number; observation_type: string }>;

    if (recentMemories.length === 0) {
      return null;
    }

    return {
      file_name: 'context.md',
      context: {
        recent_memories: recentMemories.map(m => ({
          content: m.raw_content.slice(0, 200), // 截断避免过长
          source: m.source,
          time: m.created_at,
        })),
        active_observations: activeObservations,
      },
      importance: 3,
    };
  },
};

registerSyncer('context.md', contextSyncer);
