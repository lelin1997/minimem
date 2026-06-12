/**
 * 后台任务 Store 层
 * 管理异步任务的生命周期
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db.js';

// ── 类型 ──

export type TaskType = 'dream-trigger' | 'inspiration-trigger' | 'pipeline-run';
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed';

export interface TaskRow {
  id: string;
  type: TaskType;
  status: TaskStatus;
  label: string;
  params: string;         // JSON
  result: string | null;  // JSON
  error: string | null;
  progress: number;       // 0-100
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TaskDTO {
  id: string;
  type: TaskType;
  status: TaskStatus;
  label: string;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
}

// ── 初始化表 ──

export function initTasksTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS background_tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      label TEXT NOT NULL DEFAULT '',
      params TEXT NOT NULL DEFAULT '{}',
      result TEXT,
      error TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON background_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON background_tasks(created_at DESC);
  `);
}

// ── 行转 DTO ──

function rowToDTO(row: TaskRow): TaskDTO {
  const startedAt = row.started_at ? new Date(row.started_at).getTime() : null;
  const finishedAt = row.finished_at ? new Date(row.finished_at).getTime() : null;
  const durationMs = startedAt && finishedAt ? finishedAt - startedAt : null;

  return {
    id: row.id,
    type: row.type as TaskType,
    status: row.status as TaskStatus,
    label: row.label,
    params: safeParse(row.params, {}),
    result: row.result ? safeParse(row.result, null) : null,
    error: row.error,
    progress: row.progress,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms: durationMs,
  };
}

// ── CRUD ──

/** 创建任务（返回 task ID） */
export function createTask(data: {
  type: TaskType;
  label: string;
  params?: Record<string, unknown>;
}): TaskDTO {
  const db = getDb();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO background_tasks (id, type, label, params, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(id, data.type, data.label, JSON.stringify(data.params || {}));

  return getTask(id)!;
}

/** 获取单个任务 */
export function getTask(id: string): TaskDTO | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM background_tasks WHERE id = ?').get(id) as TaskRow | undefined;
  return row ? rowToDTO(row) : null;
}

/** 列出任务（按创建时间倒序） */
export function listTasks(options: {
  status?: TaskStatus;
  limit?: number;
} = {}): TaskDTO[] {
  const db = getDb();
  const conditions: string[] = [];
  const values: any[] = [];

  if (options.status) {
    conditions.push('status = ?');
    values.push(options.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit || 50;
  values.push(limit);

  const rows = db.prepare(`
    SELECT * FROM background_tasks ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...values) as TaskRow[];

  return rows.map(rowToDTO);
}

/** 获取活跃任务（pending + running） */
export function getActiveTasks(): TaskDTO[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM background_tasks
    WHERE status IN ('pending', 'running')
    ORDER BY created_at ASC
  `).all() as TaskRow[];
  return rows.map(rowToDTO);
}

/** 标记任务开始 */
export function markTaskRunning(id: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE background_tasks
    SET status = 'running', started_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

/** 更新进度 */
export function updateTaskProgress(id: string, progress: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE background_tasks SET progress = ? WHERE id = ?
  `).run(Math.min(100, Math.max(0, progress)), id);
}

/** 标记任务成功 */
export function markTaskSuccess(id: string, result?: Record<string, unknown>): void {
  const db = getDb();
  db.prepare(`
    UPDATE background_tasks
    SET status = 'success', progress = 100, finished_at = datetime('now'), result = ?
    WHERE id = ?
  `).run(result ? JSON.stringify(result) : null, id);
}

/** 标记任务失败 */
export function markTaskFailed(id: string, error: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE background_tasks
    SET status = 'failed', finished_at = datetime('now'), error = ?
    WHERE id = ?
  `).run(error, id);
}

/** 清理旧任务（保留最近 N 天） */
export function cleanupOldTasks(days = 7): number {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM background_tasks
    WHERE finished_at IS NOT NULL
      AND finished_at < datetime('now', '-' || ? || ' days')
  `).run(days);
  return result.changes;
}

/** 取消/终止任务（将 pending/running 标记为 failed） */
export function cancelTask(id: string, reason = '用户取消'): TaskDTO | null {
  const db = getDb();
  const task = getTask(id);
  if (!task) return null;
  if (task.status !== 'pending' && task.status !== 'running') {
    return null; // 只能取消待处理或运行中的任务
  }
  
  db.prepare(`
    UPDATE background_tasks
    SET status = 'failed', finished_at = datetime('now'), error = ?
    WHERE id = ?
  `).run(reason, id);
  
  return getTask(id);
}

/** 删除任务 */
export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM background_tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

/** 重试失败任务（创建一个新任务副本） */
export function retryTask(id: string): TaskDTO | null {
  const db = getDb();
  const task = getTask(id);
  if (!task || task.status !== 'failed') return null;
  
  const newId = randomUUID();
  db.prepare(`
    INSERT INTO background_tasks (id, type, label, params, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(newId, task.type, `${task.label} (重试)`, JSON.stringify(task.params));
  
  return getTask(newId);
}

// ── 工具 ──

function safeParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
