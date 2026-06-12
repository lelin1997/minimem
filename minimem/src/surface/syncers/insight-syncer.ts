// ============================================================
// MiniMem — Surface Syncer: insight.md
// ============================================================
// MINIMEM-002: 收集灵感池数据，生成灵感 Surface File

import { getDb } from '../../store/database.js';
import { registerSyncer, type SurfaceSyncer, type SyncData } from '../sync.js';

const insightSyncer: SurfaceSyncer = {
  hasChanges(lastSyncAt: string | null): boolean {
    const db = getDb();
    if (!lastSyncAt) return true;

    // 检查 inspirations 表是否有新增/更新
    const changes = db.prepare(
      `SELECT COUNT(*) as count FROM inspirations WHERE updated_at > ?`
    ).get(lastSyncAt) as { count: number };

    return changes.count > 0;
  },

  collectData(): SyncData | null {
    const db = getDb();

    // 成熟灵感（优先展示）
    const matureInspirations = db.prepare(`
      SELECT id, title, hypothesis, confidence, actionability, origin, domain, created_at
      FROM inspirations
      WHERE status = 'mature' AND branch = 'main'
      ORDER BY confidence DESC, actionability DESC
      LIMIT 10
    `).all() as Array<{
      id: string; title: string; hypothesis: string;
      confidence: number; actionability: number;
      origin: string; domain: string; created_at: string;
    }>;

    // 孵化中的灵感
    const incubatingInspirations = db.prepare(`
      SELECT id, title, content, confidence, incubation_count, origin, domain
      FROM inspirations
      WHERE status = 'incubating' AND branch = 'main'
      ORDER BY confidence DESC
      LIMIT 5
    `).all() as Array<{
      id: string; title: string; content: string;
      confidence: number; incubation_count: number;
      origin: string; domain: string;
    }>;

    // 新火花
    const sparkInspirations = db.prepare(`
      SELECT id, title, content, novelty, origin, domain, created_at
      FROM inspirations
      WHERE status = 'spark' AND branch = 'main'
      ORDER BY novelty DESC
      LIMIT 5
    `).all() as Array<{
      id: string; title: string; content: string;
      novelty: number; origin: string; domain: string; created_at: string;
    }>;

    // 已行动的灵感（最近 5 条，作为参考）
    const actedInspirations = db.prepare(`
      SELECT id, title, hypothesis, acted_outcome, updated_at
      FROM inspirations
      WHERE status = 'acted' AND branch = 'main'
      ORDER BY updated_at DESC
      LIMIT 5
    `).all() as Array<{
      id: string; title: string; hypothesis: string;
      acted_outcome: string; updated_at: string;
    }>;

    // 统计信息
    const stats = {
      total: (db.prepare("SELECT COUNT(*) as count FROM inspirations WHERE branch = 'main'").get() as { count: number }).count,
      spark: (db.prepare("SELECT COUNT(*) as count FROM inspirations WHERE status = 'spark' AND branch = 'main'").get() as { count: number }).count,
      incubating: (db.prepare("SELECT COUNT(*) as count FROM inspirations WHERE status = 'incubating' AND branch = 'main'").get() as { count: number }).count,
      mature: (db.prepare("SELECT COUNT(*) as count FROM inspirations WHERE status = 'mature' AND branch = 'main'").get() as { count: number }).count,
      acted: (db.prepare("SELECT COUNT(*) as count FROM inspirations WHERE status = 'acted' AND branch = 'main'").get() as { count: number }).count,
    };

    // 如果没有任何灵感，返回 null
    if (stats.total === 0) {
      return null;
    }

    return {
      file_name: 'insight.md',
      context: {
        stats,
        mature: matureInspirations,
        incubating: incubatingInspirations,
        sparks: sparkInspirations,
        acted: actedInspirations,
      },
      importance: matureInspirations.length > 0 ? 4 : 2,
    };
  },
};

registerSyncer('insight.md', insightSyncer);
