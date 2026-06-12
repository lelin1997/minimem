// ============================================================
// MiniMem — Surface Syncer: social.md
// ============================================================
// Issue-26: 从 person_profiles 同步人设画像到 social.md
// 注意：没有独立的 relationships 表，关系数据在 person_profiles.relationships JSON 字段中

import { getDb } from '../../store/database.js';
import { registerSyncer, type SurfaceSyncer, type SyncData } from '../sync.js';
import { safeJsonParse } from '../../common/utils.js';

const socialSyncer: SurfaceSyncer = {
  hasChanges(lastSyncAt: string | null): boolean {
    const db = getDb();
    if (!lastSyncAt) return true;

    // 检查人设画像是否有变更
    const profileChanges = db.prepare(
      `SELECT COUNT(*) as count FROM person_profiles WHERE updated_at > ?`
    ).get(lastSyncAt) as { count: number };

    return profileChanges.count > 0;
  },

  collectData(): SyncData | null {
    const db = getDb();

    // 收集人物画像（按最近互动排序）
    const topPersons = db.prepare(
      `SELECT name, aliases, personality, interests, relationships, last_seen
       FROM person_profiles
       ORDER BY last_seen DESC LIMIT 10`
    ).all() as Array<{
      name: string;
      aliases: string;
      personality: string | null;
      interests: string;
      relationships: string;
      last_seen: string;
    }>;

    if (topPersons.length === 0) {
      return null;
    }

    // 解析 JSON 字段
    const parsedPersons = topPersons.map(p => ({
      name: p.name,
      aliases: safeJsonParse<string[]>(p.aliases, []),
      personality: p.personality,
      interests: safeJsonParse<string[]>(p.interests, []),
      relationships: safeJsonParse<Array<{ person: string; type: string }>>(p.relationships, []),
      last_seen: p.last_seen,
    }));

    return {
      file_name: 'social.md',
      context: {
        key_persons: parsedPersons,
      },
      importance: 3,
    };
  },
};

registerSyncer('social.md', socialSyncer);
