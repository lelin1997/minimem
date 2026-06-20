// ============================================================
// MiniMem — 工作模块：任务管理（work_tasks CRUD）
// ============================================================

import { getDb } from '../../store/database.js';
import { getLogger } from '../../common/logger.js';
import { generateId, now } from '../../common/utils.js';
import type { WorkTask, TaskStatus, PaginatedResult, PaginationParams } from '../../common/types.js';

const log = getLogger('work:tasks');

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority_score?: number;
  linked_memories?: string[];
  due_date?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority_score?: number;
  linked_memories?: string[];
  due_date?: string;
}

/**
 * 创建工作任务
 */
export function createTask(input: CreateTaskInput): WorkTask {
  const db = getDb();
  const id = generateId();
  const timestamp = now();

  db.prepare(`
    INSERT INTO work_tasks (id, title, description, status, priority_score, linked_memories, due_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.title,
    input.description ?? null,
    input.status ?? 'todo',
    input.priority_score ?? 5.0,
    JSON.stringify(input.linked_memories ?? []),
    input.due_date ?? null,
    timestamp,
    timestamp,
  );

  log.info({ id, title: input.title }, 'Task created');

  return {
    id,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? 'todo',
    priority_score: input.priority_score ?? 5.0,
    linked_memories: input.linked_memories ?? [],
    due_date: input.due_date ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * 获取任务
 */
export function getTaskById(id: string): WorkTask | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM work_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToTask(row) : null;
}

/**
 * 更新任务
 */
export function updateTask(id: string, input: UpdateTaskInput): WorkTask | null {
  const db = getDb();
  const existing = getTaskById(id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.title !== undefined) { updates.push('title = ?'); values.push(input.title); }
  if (input.description !== undefined) { updates.push('description = ?'); values.push(input.description); }
  if (input.status !== undefined) { updates.push('status = ?'); values.push(input.status); }
  if (input.priority_score !== undefined) { updates.push('priority_score = ?'); values.push(input.priority_score); }
  if (input.linked_memories !== undefined) { updates.push('linked_memories = ?'); values.push(JSON.stringify(input.linked_memories)); }
  if (input.due_date !== undefined) { updates.push('due_date = ?'); values.push(input.due_date); }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);

  db.prepare(`UPDATE work_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  log.info({ id }, 'Task updated');
  return getTaskById(id);
}

/**
 * 删除任务
 */
export function deleteTask(id: string): boolean {
  const db = getDb();
  const changes = db.prepare('DELETE FROM work_tasks WHERE id = ?').run(id).changes;
  if (changes > 0) log.info({ id }, 'Task deleted');
  return changes > 0;
}

/**
 * 列出任务（分页 + 状态筛选）
 */
export function listTasks(
  pagination: PaginationParams = { page: 1, page_size: 20 },
  status?: TaskStatus,
): PaginatedResult<WorkTask> {
  const db = getDb();
  const offset = (pagination.page - 1) * pagination.page_size;

  let where = '';
  const params: unknown[] = [];
  if (status) {
    where = 'WHERE status = ?';
    params.push(status);
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM work_tasks ${where}`).get(...params) as { count: number }).count;
  const rows = db.prepare(
    `SELECT * FROM work_tasks ${where} ORDER BY priority_score DESC, created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, pagination.page_size, offset) as Array<Record<string, unknown>>;

  return {
    items: rows.map(rowToTask),
    total,
    page: pagination.page,
    page_size: pagination.page_size,
    has_more: offset + rows.length < total,
  };
}

/**
 * 获取今日任务
 */
export function getTodayTasks(): WorkTask[] {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT * FROM work_tasks
    WHERE (due_date = ? OR (status != 'done' AND status != 'cancelled'))
    ORDER BY priority_score DESC
  `).all(today) as Array<Record<string, unknown>>;
  return rows.map(rowToTask);
}

/**
 * 按状态统计
 */
export function getTaskStats(): Record<TaskStatus, number> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count FROM work_tasks GROUP BY status
  `).all() as Array<{ status: TaskStatus; count: number }>;

  const stats: Record<TaskStatus, number> = { todo: 0, in_progress: 0, done: 0, cancelled: 0 };
  for (const r of rows) stats[r.status] = r.count;
  return stats;
}

/**
 * 关联记忆到任务
 */
export function linkMemoryToTask(taskId: string, memoryId: string): void {
  const task = getTaskById(taskId);
  if (!task) return;

  const memories = task.linked_memories;
  if (!memories.includes(memoryId)) {
    memories.push(memoryId);
    updateTask(taskId, { linked_memories: memories });
  }
}

// ── 行转对象 ──

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
