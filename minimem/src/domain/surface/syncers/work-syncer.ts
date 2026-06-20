// ============================================================
// MiniMem — Surface Syncer: work.md
// ============================================================
// Issue-25: 从 work_tasks + dream_logs(daily summary) 同步到 work.md
// TODO-026: 扩展数据源 — 从 L1 experiences 提取最近工作记忆

import { getDb } from '../../../infra/store/database.js';
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

    // TODO-026: 检查 L1 experiences 是否有工作相关的新记忆
    // 注意 experiences 表字段是 raw_content，不是 content
    const expChanges = db.prepare(
      `SELECT COUNT(*) as count FROM experiences
       WHERE created_at > ? AND (source LIKE '%work%' OR source LIKE '%task%' OR raw_content LIKE '%project%')`
    ).get(lastSyncAt) as { count: number };

    return taskChanges.count > 0 || summaryChanges.count > 0 || expChanges.count > 0;
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

    // TODO-026: 从 L1 experiences 提取最近工作记忆（最近 7 天，最多 10 条）
    const recentWorkExperiences = db.prepare(
      `SELECT raw_content, created_at FROM experiences
       WHERE created_at > datetime('now', '-7 days')
         AND (source LIKE '%work%' OR source LIKE '%task%' OR raw_content LIKE '%project%')
       ORDER BY created_at DESC LIMIT 10`
    ).all() as Array<{ raw_content: string; created_at: string }>;

    if (activeTasks.length === 0 && recentSummaries.length === 0 && recentWorkExperiences.length === 0) {
      return null;
    }

    return {
      file_name: 'work.md',
      context: {
        active_tasks: activeTasks,
        recent_summaries: recentSummaries,
        recently_completed: completedTasks,
        // TODO-026: 新增 L1 工作记忆
        recent_work_experiences: recentWorkExperiences,
      },
      importance: 4,
    };
  },
};

registerSyncer('work.md', workSyncer);
