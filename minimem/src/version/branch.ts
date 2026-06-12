// ============================================================
// MiniMem — 版本控制：分支管理
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { now } from '../common/utils.js';
import type { Branch } from '../common/types.js';
import { createSnapshot } from './snapshot.js';
import { ValidationError } from '../common/errors.js';

const log = getLogger('version:branch');

/**
 * 创建一个新分支（从指定快照或当前状态分叉）
 */
export function createBranch(name: string, fromSnapshotId?: string): Branch {
  const db = getDb();
  const timestamp = now();

  // 检查分支是否已存在
  const existing = db.prepare('SELECT name FROM branches WHERE name = ?').get(name);
  if (existing) {
    throw new Error(`Branch '${name}' already exists`);
  }

  // 如果没有指定快照，先在 main 分支创建一个快照
  let snapshotId = fromSnapshotId ?? null;
  if (!snapshotId) {
    const snap = createSnapshot({ label: `before-branch-${name}`, trigger: 'auto', branch: 'main' });
    snapshotId = snap.id;
  }

  db.prepare(`
    INSERT INTO branches (name, created_from_snapshot, is_active, created_at)
    VALUES (?, ?, 1, ?)
  `).run(name, snapshotId, timestamp);

  log.info({ name, fromSnapshot: snapshotId }, 'Branch created');
  return getBranch(name)!;
}

/**
 * 获取分支信息
 */
export function getBranch(name: string): Branch | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM branches WHERE name = ?').get(name) as Record<string, unknown> | undefined;
  return row ? rowToBranch(row) : null;
}

/**
 * 列出所有分支
 */
export function listBranches(): Branch[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM branches ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(rowToBranch);
}

/**
 * 列出活跃分支
 */
export function listActiveBranches(): Branch[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM branches WHERE is_active = 1 ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(rowToBranch);
}

/**
 * 停用分支（软删除）
 */
export function deactivateBranch(name: string): void {
  if (name === 'main') {
    throw new Error("Cannot deactivate the 'main' branch");
  }
  const db = getDb();
  db.prepare('UPDATE branches SET is_active = 0 WHERE name = ?').run(name);
  log.info({ name }, 'Branch deactivated');
}

/**
 * 激活分支
 */
export function activateBranch(name: string): void {
  const db = getDb();
  db.prepare('UPDATE branches SET is_active = 1 WHERE name = ?').run(name);
  log.info({ name }, 'Branch activated');
}

/**
 * 删除分支（硬删除，含关联数据清理）
 */
export function deleteBranch(name: string): void {
  if (name === 'main') {
    throw new ValidationError("Cannot delete the 'main' branch", { branch: name });
  }

  const db = getDb();

  db.transaction(() => {
    // 删除分支上的记忆数据
    db.prepare('DELETE FROM experiences WHERE branch = ?').run(name);
    db.prepare('DELETE FROM world_facts WHERE branch = ?').run(name);
    db.prepare('DELETE FROM observations WHERE branch = ?').run(name);
    db.prepare('DELETE FROM mental_models WHERE branch = ?').run(name);
    db.prepare('DELETE FROM knowledge_pages WHERE branch = ?').run(name);

    // 删除分支上的快照
    db.prepare('DELETE FROM snapshots WHERE branch = ?').run(name);

    // 删除分支记录
    db.prepare('DELETE FROM branches WHERE name = ?').run(name);
  })();

  log.info({ name }, 'Branch deleted with all associated data');
}

// ── 行转对象 ──

function rowToBranch(row: Record<string, unknown>): Branch {
  return {
    name: row.name as string,
    created_from_snapshot: (row.created_from_snapshot as string) || null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at as string,
  };
}
