// ============================================================
// MiniMem — 工作模块：智能优先级排序
// ============================================================

import { getDb } from '../../store/database.js';
import { getLogger } from '../../common/logger.js';
import { now } from '../../common/utils.js';
import type { WorkTask, TaskStatus } from '../../common/types.js';

const log = getLogger('work:priority');

/**
 * 优先级因子权重
 */
const PRIORITY_WEIGHTS = {
  user_score: 0.3,      // 用户手动设定的优先级
  due_urgency: 0.25,    // 截止日期紧迫度
  memory_relevance: 0.2, // 相关记忆的重要性
  recency: 0.15,        // 最近更新优先
  dependency: 0.1,       // 被依赖数
};

/**
 * 智能排序所有活跃任务
 */
export function rankTasks(tasks?: WorkTask[]): WorkTask[] {
  const db = getDb();

  const allTasks = tasks ?? (db.prepare(`
    SELECT * FROM work_tasks WHERE status IN ('todo', 'in_progress')
    ORDER BY priority_score DESC
  `).all() as Array<Record<string, unknown>>).map(rowToTask);

  const ranked = allTasks.map(task => ({
    task,
    score: computePriorityScore(task, db),
  }));

  ranked.sort((a, b) => b.score - a.score);

  // 更新数据库中的优先级分数
  const stmt = db.prepare('UPDATE work_tasks SET priority_score = ?, updated_at = ? WHERE id = ?');
  const timestamp = now();
  db.transaction(() => {
    for (const { task, score } of ranked) {
      stmt.run(score, timestamp, task.id);
    }
  })();

  log.info({ tasksRanked: ranked.length }, 'Tasks priority re-ranked');
  return ranked.map(r => ({ ...r.task, priority_score: r.score }));
}

function computePriorityScore(task: WorkTask, db: ReturnType<typeof getDb>): number {
  let score = 0;

  // 1. 用户手动优先级 (0-10 → 0-1)
  score += (task.priority_score / 10) * PRIORITY_WEIGHTS.user_score;

  // 2. 截止日期紧迫度
  if (task.due_date) {
    const daysUntilDue = (new Date(task.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysUntilDue < 0) {
      score += 1.0 * PRIORITY_WEIGHTS.due_urgency; // 已过期，最高紧迫度
    } else if (daysUntilDue < 1) {
      score += 0.9 * PRIORITY_WEIGHTS.due_urgency;
    } else if (daysUntilDue < 3) {
      score += 0.7 * PRIORITY_WEIGHTS.due_urgency;
    } else if (daysUntilDue < 7) {
      score += 0.4 * PRIORITY_WEIGHTS.due_urgency;
    } else {
      score += 0.1 * PRIORITY_WEIGHTS.due_urgency;
    }
  }

  // 3. 相关记忆重要性
  if (task.linked_memories.length > 0) {
    try {
      const placeholders = task.linked_memories.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT AVG(importance) as avg_imp FROM experiences WHERE id IN (${placeholders})
      `).get(...task.linked_memories) as { avg_imp: number | null } | undefined;

      score += (rows?.avg_imp ?? 0) * PRIORITY_WEIGHTS.memory_relevance;
    } catch {
      // 忽略
    }
  }

  // 4. 最近更新优先
  const hoursSinceUpdate = (Date.now() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60);
  const recencyScore = Math.max(0, 1 - hoursSinceUpdate / (24 * 7)); // 7 天内线性衰减
  score += recencyScore * PRIORITY_WEIGHTS.recency;

  // 5. 进行中状态加成
  if (task.status === 'in_progress') {
    score += 0.5 * PRIORITY_WEIGHTS.dependency;
  }

  return Math.min(10, score * 10); // 映射回 0-10 范围
}

function rowToTask(row: Record<string, unknown>): WorkTask {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    status: row.status as TaskStatus,
    priority_score: row.priority_score as number,
    linked_memories: JSON.parse((row.linked_memories as string) || '[]'),
    due_date: (row.due_date as string) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
