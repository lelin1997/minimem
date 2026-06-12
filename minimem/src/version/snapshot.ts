// ============================================================
// MiniMem — 版本控制：快照管理
// ============================================================

import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import { getConfig } from '../config/index.js';
import type { Snapshot } from '../common/types.js';

const log = getLogger('version:snapshot');

// Issue-31: 快照节流 — 同分支同 trigger 最少间隔 60 秒
const SNAPSHOT_THROTTLE_MS = 60_000;
const lastSnapshotTime = new Map<string, number>();

/**
 * 创建一个快照（捕获当前记忆状态的统计信息）
 */
export function createSnapshot(
  options: {
    label?: string;
    trigger?: Snapshot['trigger'];
    branch?: string;
    parent_snapshot_id?: string;
  } = {},
): Snapshot {
  const db = getDb();
  const id = generateId();
  const branch = options.branch ?? 'main';
  const trigger = options.trigger ?? 'manual';
  const label = options.label ?? `snapshot-${new Date().toISOString().slice(0, 10)}`;
  const timestamp = now();

  // Issue-31: 节流检查（manual trigger 不受限制）
  if (trigger !== 'manual') {
    const throttleKey = `${branch}:${trigger}`;
    const lastTime = lastSnapshotTime.get(throttleKey);
    if (lastTime && Date.now() - lastTime < SNAPSHOT_THROTTLE_MS) {
      log.debug({ throttleKey, msSinceLastSnapshot: Date.now() - lastTime },
        'Snapshot creation throttled');
      // 返回最新的现有快照而非创建新的
      const latest = getLatestSnapshot(branch);
      if (latest) return latest;
    }
    lastSnapshotTime.set(throttleKey, Date.now());
  }

  // 统计各层记忆数量
  const statsL1 = (db.prepare(
    'SELECT COUNT(*) as count FROM experiences WHERE branch = ?'
  ).get(branch) as { count: number }).count;

  const statsL2 = (db.prepare(
    'SELECT COUNT(*) as count FROM world_facts WHERE branch = ?'
  ).get(branch) as { count: number }).count;

  const statsL3 = (db.prepare(
    'SELECT COUNT(*) as count FROM observations WHERE branch = ?'
  ).get(branch) as { count: number }).count;

  const statsL4 = (db.prepare(
    'SELECT COUNT(*) as count FROM mental_models WHERE branch = ?'
  ).get(branch) as { count: number }).count;

  const statsPages = (db.prepare(
    'SELECT COUNT(*) as count FROM knowledge_pages WHERE branch = ?'
  ).get(branch) as { count: number }).count;

  // 查找父快照（当前分支最新的快照）
  const parentId = options.parent_snapshot_id ?? (() => {
    const latest = db.prepare(
      'SELECT id FROM snapshots WHERE branch = ? ORDER BY created_at DESC LIMIT 1'
    ).get(branch) as { id: string } | undefined;
    return latest?.id ?? null;
  })();

  db.prepare(`
    INSERT INTO snapshots (id, label, branch, trigger, parent_snapshot_id, stats_l1, stats_l2, stats_l3, stats_l4, stats_pages, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, label, branch, trigger, parentId,
    statsL1, statsL2, statsL3, statsL4, statsPages,
    timestamp,
  );

  log.info({ id, label, branch, trigger, stats: { l1: statsL1, l2: statsL2, l3: statsL3, l4: statsL4, pages: statsPages } }, 'Snapshot created');

  const snapshot = getSnapshotById(id)!;

  // 同步快照到磁盘 JSON 文件 (data/snapshots/)
  try {
    saveSnapshotToDisk(snapshot);
  } catch (err) {
    log.warn({ err, id }, 'Failed to save snapshot to disk (non-critical)');
  }

  return snapshot;
}

/**
 * 按 ID 获取快照
 */
export function getSnapshotById(id: string): Snapshot | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToSnapshot(row) : null;
}

/**
 * 列出指定分支的所有快照
 */
export function listSnapshots(branch: string = 'main', limit: number = 50): Snapshot[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM snapshots WHERE branch = ? ORDER BY created_at DESC LIMIT ?'
  ).all(branch, limit) as Record<string, unknown>[];
  return rows.map(rowToSnapshot);
}

/**
 * 获取分支最新快照
 */
export function getLatestSnapshot(branch: string = 'main'): Snapshot | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM snapshots WHERE branch = ? ORDER BY created_at DESC LIMIT 1'
  ).get(branch) as Record<string, unknown> | undefined;
  return row ? rowToSnapshot(row) : null;
}

/**
 * 统计快照数量
 */
export function countSnapshots(branch?: string): number {
  const db = getDb();
  if (branch) {
    return (db.prepare('SELECT COUNT(*) as count FROM snapshots WHERE branch = ?').get(branch) as { count: number }).count;
  }
  return (db.prepare('SELECT COUNT(*) as count FROM snapshots').get() as { count: number }).count;
}

// ── 行转对象 ──

function rowToSnapshot(row: Record<string, unknown>): Snapshot {
  return {
    id: row.id as string,
    label: row.label as string,
    branch: row.branch as string,
    trigger: row.trigger as Snapshot['trigger'],
    parent_snapshot_id: (row.parent_snapshot_id as string) || null,
    stats_l1: row.stats_l1 as number,
    stats_l2: row.stats_l2 as number,
    stats_l3: row.stats_l3 as number,
    stats_l4: row.stats_l4 as number,
    stats_pages: row.stats_pages as number,
    created_at: row.created_at as string,
  };
}

// ── 磁盘持久化 ──

/**
 * 将快照信息保存到 data/snapshots/ 目录
 * 文件名: snapshot-{branch}-{date}-{shortId}.json
 */
function saveSnapshotToDisk(snapshot: Snapshot): void {
  const config = getConfig();
  const snapshotsDir = join(config.storage.data_dir, 'snapshots');

  if (!existsSync(snapshotsDir)) {
    mkdirSync(snapshotsDir, { recursive: true });
  }

  const dateStr = snapshot.created_at.slice(0, 10);
  const shortId = snapshot.id.slice(0, 8);
  const fileName = `snapshot-${snapshot.branch}-${dateStr}-${shortId}.json`;
  const filePath = join(snapshotsDir, fileName);

  const payload = {
    ...snapshot,
    saved_at: new Date().toISOString(),
  };

  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  log.debug({ filePath, id: snapshot.id }, 'Snapshot saved to disk');

  // Issue-31: 写完后执行磁盘清理
  cleanupOldSnapshotFiles(snapshotsDir);
}

/**
 * Issue-31: 磁盘快照保留策略 — 保留最近 maxFiles 个快照文件
 */
function cleanupOldSnapshotFiles(snapshotsDir: string, maxFiles: number = 100): void {
  try {
    const files = readdirSync(snapshotsDir)
      .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: join(snapshotsDir, f),
        mtime: statSync(join(snapshotsDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime); // 最新在前

    if (files.length <= maxFiles) return;

    const toDelete = files.slice(maxFiles);
    for (const file of toDelete) {
      unlinkSync(file.path);
    }
    log.info({ removed: toDelete.length, kept: maxFiles }, 'Old snapshot files cleaned up');
  } catch (err) {
    log.warn({ err }, 'Snapshot file cleanup failed');
  }
}
