// ============================================================
// MiniMem — Surface Syncer: context.md
// ============================================================
// Issue-28: 从近期 L1 记忆 + 活跃 L3 观察同步到 context.md
// TODO-026: 扩展 — 加入 L2 world_facts + L4 mental_models 的活跃条目

import { getDb } from '../../../store/database.js';
import { registerSyncer, type SurfaceSyncer, type SyncData } from '../sync.js';

const contextSyncer: SurfaceSyncer = {
  hasChanges(lastSyncAt: string | null): boolean {
    const db = getDb();
    if (!lastSyncAt) return true;

    const newMemories = db.prepare(
      `SELECT COUNT(*) as count FROM experiences WHERE created_at > ?`
    ).get(lastSyncAt) as { count: number };

    // TODO-026: 也检查 L2 facts 变化
    const newFacts = db.prepare(
      `SELECT COUNT(*) as count FROM world_facts WHERE updated_at > ?`
    ).get(lastSyncAt) as { count: number };

    return newMemories.count > 0 || newFacts.count > 0;
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

    // TODO-026: 从 L2 提取最近活跃 facts（最近 7 天更新）
    const recentFacts = db.prepare(
      `SELECT subject, predicate, object, confidence FROM world_facts
       WHERE updated_at > datetime('now', '-7 days')
       ORDER BY confidence DESC, updated_at DESC LIMIT 10`
    ).all() as Array<{ subject: string; predicate: string; object: string; confidence: number }>;

    // TODO-026: 从 L4 提取活跃心智模型
    const activeModels = db.prepare(
      `SELECT title, content, model_type FROM mental_models
       WHERE is_active = 1
       ORDER BY priority DESC, updated_at DESC LIMIT 5`
    ).all() as Array<{ title: string; content: string; model_type: string }>;

    if (recentMemories.length === 0 && recentFacts.length === 0) {
      return null;
    }

    return {
      file_name: 'context.md',
      context: {
        recent_memories: recentMemories.map(m => ({
          content: m.raw_content.slice(0, 200),
          source: m.source,
          time: m.created_at,
        })),
        active_observations: activeObservations,
        // TODO-026: 新增 L2/L4 数据
        recent_facts: recentFacts,
        active_mental_models: activeModels,
      },
      importance: 3,
    };
  },
};

registerSyncer('context.md', contextSyncer);
