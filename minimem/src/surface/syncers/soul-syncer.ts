// ============================================================
// MiniMem — Surface Syncer: soul.md
// ============================================================
// Issue-27: 从 preferences + L4 心智模型同步到 soul.md

import { getDb } from '../../store/database.js';
import { registerSyncer, type SurfaceSyncer, type SyncData } from '../sync.js';

const soulSyncer: SurfaceSyncer = {
  hasChanges(lastSyncAt: string | null): boolean {
    const db = getDb();
    if (!lastSyncAt) return true;

    // 检查偏好和心智模型是否有变更
    const prefChanges = db.prepare(
      `SELECT COUNT(*) as count FROM owner_profile
       WHERE updated_at > ? AND (key LIKE 'preferences.%' OR key LIKE 'personality.%')`
    ).get(lastSyncAt) as { count: number };

    const modelChanges = db.prepare(
      `SELECT COUNT(*) as count FROM mental_models WHERE updated_at > ? AND is_active = 1`
    ).get(lastSyncAt) as { count: number };

    return prefChanges.count > 0 || modelChanges.count > 0;
  },

  collectData(): SyncData | null {
    const db = getDb();

    // 收集活跃的心智模型
    // Issue-REPAIR-7: mental_models 表没有 confidence 列，用 priority/10.0 作为近似值
    const mentalModels = db.prepare(
      `SELECT content, priority, model_type, created_at
       FROM mental_models
       WHERE is_active = 1
       ORDER BY priority DESC LIMIT 10`
    ).all() as Array<{
      content: string;
      priority: number; model_type: string; created_at: string;
    }>;

    // 收集偏好
    const preferences = db.prepare(
      `SELECT key, value FROM owner_profile WHERE key LIKE 'preferences.%'`
    ).all() as Array<{ key: string; value: string }>;

    // 收集性格数据
    const personality = db.prepare(
      `SELECT key, value FROM owner_profile WHERE key LIKE 'personality.%'`
    ).all() as Array<{ key: string; value: string }>;

    if (mentalModels.length === 0 && preferences.length === 0 && personality.length === 0) {
      return null;
    }

    return {
      file_name: 'soul.md',
      context: {
        mental_models: mentalModels.map(m => ({
          insight: m.content,
          type: m.model_type,
          priority: m.priority,
          confidence: m.priority / 10.0, // mental_models 无 confidence 列，用 priority 近似
        })),
        preferences: Object.fromEntries(
          preferences.map(p => [p.key.replace('preferences.', ''), p.value])
        ),
        personality: Object.fromEntries(
          personality.map(p => [p.key.replace('personality.', ''), p.value])
        ),
      },
      importance: 4,
    };
  },
};

registerSyncer('soul.md', soulSyncer);
