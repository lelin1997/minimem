// ============================================================
// MiniMem — Surface Syncer: agent.md
// ============================================================
// REQ-008: 收集系统配置、MCP 工具数量、用户画像摘要、近期交互统计

import { getDb } from '../../store/database.js';
import { registerSyncer, type SurfaceSyncer, type SyncData } from '../sync.js';

const agentSyncer: SurfaceSyncer = {
  hasChanges(lastSyncAt: string | null): boolean {
    const db = getDb();
    if (!lastSyncAt) return true;

    // 检查 owner_profile 或 _meta 是否有变更
    const profileChanges = db.prepare(
      `SELECT COUNT(*) as count FROM owner_profile WHERE updated_at > ?`
    ).get(lastSyncAt) as { count: number };

    // 检查近期是否有新记忆写入
    const newMemories = db.prepare(
      `SELECT COUNT(*) as count FROM experiences WHERE branch = 'main' AND created_at > ?`
    ).get(lastSyncAt) as { count: number };

    return profileChanges.count > 0 || newMemories.count > 10;
  },

  collectData(): SyncData | null {
    const db = getDb();

    // 收集系统元数据
    const meta = db.prepare(
      `SELECT key, value FROM _meta`
    ).all() as Array<{ key: string; value: string }>;

    // 收集用户画像摘要（身份信息）
    const identity = db.prepare(
      `SELECT key, value FROM owner_profile WHERE category = 'identity'`
    ).all() as Array<{ key: string; value: string }>;

    // 各层记忆数量统计
    const layerCounts = {
      L1: (db.prepare("SELECT COUNT(*) as count FROM experiences WHERE branch = 'main'").get() as { count: number }).count,
      L2: (db.prepare("SELECT COUNT(*) as count FROM world_facts WHERE branch = 'main'").get() as { count: number }).count,
      L3: (db.prepare("SELECT COUNT(*) as count FROM observations WHERE branch = 'main'").get() as { count: number }).count,
      L4: (db.prepare("SELECT COUNT(*) as count FROM mental_models WHERE is_active = 1").get() as { count: number }).count,
    };

    // 近期交互统计（7天）
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentStats = {
      memories_7d: (db.prepare(
        "SELECT COUNT(*) as count FROM experiences WHERE branch = 'main' AND created_at > ?"
      ).get(sevenDaysAgo) as { count: number }).count,
      top_sources: db.prepare(
        "SELECT source, COUNT(*) as count FROM experiences WHERE branch = 'main' AND created_at > ? GROUP BY source ORDER BY count DESC LIMIT 5"
      ).all(sevenDaysAgo) as Array<{ source: string; count: number }>,
    };

    // 活跃心智模型（Top 5）
    const topModels = db.prepare(
      `SELECT title, model_type, priority FROM mental_models
       WHERE is_active = 1 ORDER BY priority DESC LIMIT 5`
    ).all() as Array<{ title: string; model_type: string; priority: number }>;

    if (layerCounts.L1 === 0 && identity.length === 0) {
      return null;
    }

    return {
      file_name: 'agent.md',
      context: {
        system_meta: Object.fromEntries(meta.map(m => [m.key, m.value])),
        owner_identity: Object.fromEntries(identity.map(i => [i.key, i.value])),
        layer_counts: layerCounts,
        recent_stats: recentStats,
        top_mental_models: topModels,
      },
      importance: 3,
    };
  },
};

registerSyncer('agent.md', agentSyncer);
