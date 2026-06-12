// ============================================================
// MiniMem — Surface Syncer: me.md
// ============================================================
// Issue-24: 从 owner_profile 表同步 identity + personality 到 me.md

import { getDb } from '../../store/database.js';
import { registerSyncer, type SurfaceSyncer, type SyncData } from '../sync.js';

const meSyncer: SurfaceSyncer = {
  hasChanges(lastSyncAt: string | null): boolean {
    const db = getDb();
    if (!lastSyncAt) return true;

    // 检查 owner_profile 表中 identity.* 或 personality.* 是否有更新
    const updated = db.prepare(
      `SELECT COUNT(*) as count FROM owner_profile
       WHERE updated_at > ? AND (key LIKE 'identity.%' OR key LIKE 'personality.%')`
    ).get(lastSyncAt) as { count: number };

    return updated.count > 0;
  },

  collectData(): SyncData | null {
    const db = getDb();

    // 收集所有 identity.* 条目
    const identityRows = db.prepare(
      `SELECT key, value FROM owner_profile WHERE key LIKE 'identity.%'`
    ).all() as Array<{ key: string; value: string }>;

    // 收集 personality.* 条目
    const personalityRows = db.prepare(
      `SELECT key, value FROM owner_profile WHERE key LIKE 'personality.%'`
    ).all() as Array<{ key: string; value: string }>;

    if (identityRows.length === 0 && personalityRows.length === 0) {
      return null;
    }

    return {
      file_name: 'me.md',
      context: {
        identity: Object.fromEntries(
          identityRows.map(r => [r.key.replace('identity.', ''), r.value])
        ),
        personality: Object.fromEntries(
          personalityRows.map(r => [r.key.replace('personality.', ''), r.value])
        ),
      },
      importance: 3,
    };
  },
};

// 模块加载时自动注册
registerSyncer('me.md', meSyncer);
