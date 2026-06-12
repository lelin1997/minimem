// ============================================================
// MiniMem — 启动恢复：WAL + 数据库完整性
// ============================================================

import { existsSync } from 'fs';
import { join } from 'path';
import { getDb } from './database.js';
import { getLogger } from '../common/logger.js';
import { getConfig } from '../config/index.js';

const log = getLogger('store:recovery');

/**
 * WAL 恢复（启动时调用）
 *
 * SQLite WAL 模式下如果进程异常退出，
 * WAL 文件可能没有 checkpoint 到主数据库。
 * 启动时执行 checkpoint 确保数据一致性。
 */
export function recoverWAL(): boolean {
  try {
    const db = getDb();

    // 检查 WAL 模式
    const mode = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    if (mode[0]?.journal_mode !== 'wal') {
      log.info('Not in WAL mode, skipping WAL recovery');
      return true;
    }

    // 执行 passive checkpoint（不阻塞写入）
    const result = db.pragma('wal_checkpoint(PASSIVE)') as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;

    if (result[0]) {
      log.info({
        busy: result[0].busy,
        walFrames: result[0].log,
        checkpointed: result[0].checkpointed,
      }, 'WAL checkpoint completed');
    }

    return true;
  } catch (err) {
    log.error({ err }, 'WAL recovery failed');
    return false;
  }
}

/**
 * 检查数据库完整性
 */
export function checkDatabaseIntegrity(): { ok: boolean; errors: string[] } {
  try {
    const db = getDb();
    const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>;

    const errors: string[] = [];
    for (const row of result) {
      if (row.integrity_check !== 'ok') {
        errors.push(row.integrity_check);
      }
    }

    if (errors.length === 0) {
      log.info('Database integrity check passed');
    } else {
      log.error({ errors }, 'Database integrity issues found');
    }

    return { ok: errors.length === 0, errors };
  } catch (err) {
    log.error({ err }, 'Integrity check failed');
    return { ok: false, errors: [(err as Error).message] };
  }
}

/**
 * 检查孤立的 WAL/SHM 文件
 */
export function checkOrphanedFiles(): string[] {
  const config = getConfig();
  const dbPath = join(config.storage.data_dir, 'db', 'minimem.db');
  const orphaned: string[] = [];

  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  // 如果主数据库不存在但 WAL/SHM 存在，标记为孤立
  if (!existsSync(dbPath)) {
    if (existsSync(walPath)) orphaned.push(walPath);
    if (existsSync(shmPath)) orphaned.push(shmPath);
  }

  return orphaned;
}

/**
 * 启动恢复入口（聚合所有恢复步骤）
 */
export function runStartupRecovery(): {
  wal_recovered: boolean;
  integrity_ok: boolean;
  errors: string[];
} {
  log.info('Starting startup recovery...');

  const walResult = recoverWAL();
  const integrityResult = checkDatabaseIntegrity();

  const result = {
    wal_recovered: walResult,
    integrity_ok: integrityResult.ok,
    errors: integrityResult.errors,
  };

  if (result.wal_recovered && result.integrity_ok) {
    log.info('Startup recovery completed successfully');
  } else {
    log.warn(result, 'Startup recovery completed with issues');
  }

  return result;
}
