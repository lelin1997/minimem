// ============================================================
// MiniMem — Surface Syncer: work.md
// ============================================================
// Issue-25: 从 work_tasks + dream_logs(daily summary) 同步到 work.md

import { getDb } from '../../store/database.js';
import { registerSyncer, type SurfaceSyncer, type SyncData } from '../sync.js';

const workSyncer: SurfaceSyncer = {
  hasChanges(lastSyncAt: string | null): boolean {
    const db = getDb();
    if (!lastSyncAt) return true;

    // 检查是否有新的任务变更
    const taskChanges = db.prepare(
      `SELECT COUNT(*) as count FROM work_tasks WHERE updated_at > ?`
    ).get(lastSyncAt) as { count: number };

    // 检查是否有新的日总结（phase=0 是 daily summary）
    const summaryChanges = db.prepare(
      `SELECT COUNT(*) as count FROM dream_logs WHERE phase = 0 AND created_at > ?`
    ).get(lastSyncAt) as { count: number };

    return taskChanges.count > 0 || summaryChanges.count > 0;
  },

  collectData(): SyncData | null {
    const db = getDb();

    // 收集活跃任务
    const activeTasks = db.prepare(
      `SELECT title, status, priority_score, due_date FROM work_tasks
       WHERE status IN ('todo', 'in_progress')
       ORDER BY priority_score DESC LIMIT 20`
    ).all() as Array<{
      title: string; status: string;
      priority_score: number; due_date: string | null;
    }>;

    // 收集最近 3 天的日总结
    const recentSummaries = db.prepare(
      `SELECT narrative, created_at FROM dream_logs
       WHERE phase = 0
       ORDER BY created_at DESC LIMIT 3`
    ).all() as Array<{ narrative: string; created_at: string }>;

    // 收集最近完成的任务
    const completedTasks = db.prepare(
      `SELECT title, updated_at FROM work_tasks
       WHERE status = 'done'
       ORDER BY updated_at DESC LIMIT 5`
    ).all() as Array<{ title: string; updated_at: string }>;

    if (activeTasks.length === 0 && recentSummaries.length === 0) {
      return null;
    }

    return {
      file_name: 'work.md',
      context: {
        active_tasks: activeTasks,
        recent_summaries: recentSummaries,
        recently_completed: completedTasks,
      },
      importance: 4,
    };
  },
};

registerSyncer('work.md', workSyncer);
