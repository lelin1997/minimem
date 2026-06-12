// ============================================================
// MiniMem — Surface Syncer: life.md
// ============================================================
// Issue-28: 从生活相关的 L2 世界事实同步到 life.md

import { getDb } from '../../store/database.js';
import { registerSyncer, type SurfaceSyncer, type SyncData } from '../sync.js';

const lifeSyncer: SurfaceSyncer = {
  hasChanges(lastSyncAt: string | null): boolean {
    const db = getDb();
    if (!lastSyncAt) return true;

    // 检查是否有新的生活相关 L2 事实
    const lifeFactChanges = db.prepare(
      `SELECT COUNT(*) as count FROM world_facts
       WHERE created_at > ?
       AND (subject LIKE '%生活%' OR subject LIKE '%习惯%'
            OR predicate LIKE '%喜欢%' OR predicate LIKE '%经常%'
            OR predicate LIKE '%去过%' OR predicate LIKE '%住在%'
            OR predicate LIKE '%爱好%' OR predicate LIKE '%运动%')`
    ).get(lastSyncAt) as { count: number };

    return lifeFactChanges.count > 0;
  },

  collectData(): SyncData | null {
    const db = getDb();

    // 收集生活相关的 L2 事实
    const lifeFacts = db.prepare(
      `SELECT subject, predicate, object, confidence FROM world_facts
       WHERE (subject LIKE '%生活%' OR subject LIKE '%习惯%'
              OR predicate LIKE '%喜欢%' OR predicate LIKE '%经常%'
              OR predicate LIKE '%去过%' OR predicate LIKE '%住在%'
              OR predicate LIKE '%爱好%' OR predicate LIKE '%运动%')
       ORDER BY confidence DESC LIMIT 20`
    ).all() as Array<{
      subject: string; predicate: string; object: string; confidence: number;
    }>;

    if (lifeFacts.length === 0) {
      return null;
    }

    return {
      file_name: 'life.md',
      context: {
        life_facts: lifeFacts,
      },
      importance: 2,
    };
  },
};

registerSyncer('life.md', lifeSyncer);
