// ============================================================
// MiniMem — Surface Syncer: index.md
// ============================================================
// REQ-008: 收集各层记忆数量、Surface Files 概览、最近 Dream 时间

import { getDb } from '../../store/database.js';
import { registerSyncer, type SurfaceSyncer, type SyncData } from '../sync.js';

const indexSyncer: SurfaceSyncer = {
  hasChanges(lastSyncAt: string | null): boolean {
    const db = getDb();
    if (!lastSyncAt) return true;

    // 总记忆数变化超过 10% 或 Surface 版本变化
    const currentCount = (db.prepare(
      "SELECT COUNT(*) as count FROM experiences WHERE branch = 'main'"
    ).get() as { count: number }).count;

    // 检查 surface_files 是否有更新
    const surfaceChanges = db.prepare(
      `SELECT COUNT(*) as count FROM surface_files WHERE updated_at > ?`
    ).get(lastSyncAt) as { count: number };

    // 检查是否有新 dream
    const dreamChanges = db.prepare(
      `SELECT COUNT(*) as count FROM dream_logs WHERE created_at > ?`
    ).get(lastSyncAt) as { count: number };

    return surfaceChanges.count > 0 || dreamChanges.count > 0 || currentCount > 0;
  },

  collectData(): SyncData | null {
    const db = getDb();

    // 各层记忆数量
    const layerCounts = {
      L1_experiences: (db.prepare("SELECT COUNT(*) as count FROM experiences WHERE branch = 'main'").get() as { count: number }).count,
      L2_world_facts: (db.prepare("SELECT COUNT(*) as count FROM world_facts WHERE branch = 'main'").get() as { count: number }).count,
      L3_observations: (db.prepare("SELECT COUNT(*) as count FROM observations WHERE branch = 'main'").get() as { count: number }).count,
      L4_mental_models: (db.prepare("SELECT COUNT(*) as count FROM mental_models WHERE is_active = 1").get() as { count: number }).count,
      knowledge_pages: (db.prepare("SELECT COUNT(*) as count FROM knowledge_pages WHERE branch = 'main'").get() as { count: number }).count,
    };

    // Surface Files 概览
    const surfaceFiles = db.prepare(
      `SELECT file_name, token_count, budget_tokens, version, updated_at FROM surface_files ORDER BY file_name`
    ).all() as Array<{ file_name: string; token_count: number; budget_tokens: number; version: number; updated_at: string }>;

    // 最近 Dream 信息
    const lastDream = db.prepare(
      `SELECT session_id, phase, l1_to_l2, l2_to_l3, l3_to_l4, duration_ms, created_at
       FROM dream_logs WHERE phase = 4 ORDER BY created_at DESC LIMIT 1`
    ).get() as { session_id: string; phase: number; l1_to_l2: number; l2_to_l3: number; l3_to_l4: number; duration_ms: number; created_at: string } | undefined;

    const totalMemories = layerCounts.L1_experiences + layerCounts.L2_world_facts +
      layerCounts.L3_observations + layerCounts.L4_mental_models;

    if (totalMemories === 0) {
      return null;
    }

    return {
      file_name: 'index.md',
      context: {
        total_memories: totalMemories,
        layer_counts: layerCounts,
        surface_files: surfaceFiles.map(f => ({
          name: f.file_name,
          tokens: f.token_count,
          budget: f.budget_tokens,
          version: f.version,
          updated: f.updated_at,
        })),
        last_dream: lastDream ? {
          session_id: lastDream.session_id,
          l1_to_l2: lastDream.l1_to_l2,
          l2_to_l3: lastDream.l2_to_l3,
          l3_to_l4: lastDream.l3_to_l4,
          duration_ms: lastDream.duration_ms,
          at: lastDream.created_at,
        } : null,
      },
      importance: 2,
    };
  },
};

registerSyncer('index.md', indexSyncer);
