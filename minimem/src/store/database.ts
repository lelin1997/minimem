// ============================================================
// MiniMem — SQLite 数据库连接管理
// ============================================================

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { getLogger } from '../common/logger.js';
import { getConfig } from '../config/index.js';
import { StorageError } from '../common/errors.js';

const log = getLogger('database');

let _db: Database.Database | null = null;

/**
 * 获取数据库连接（单例）
 */
export function getDb(): Database.Database {
  if (!_db) {
    throw new StorageError('Database not initialized. Call initDb() first.', 'getDb');
  }
  return _db;
}

/**
 * 初始化数据库连接
 */
export function initDb(dbPath?: string): Database.Database {
  if (_db) return _db;

  const config = getConfig();
  const resolvedPath = dbPath ?? join(config.storage.data_dir, 'db', 'minimem.db');

  // 确保目录存在
  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  log.info({ path: resolvedPath }, 'Opening SQLite database');

  _db = new Database(resolvedPath);

  // 性能优化 pragmas
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('cache_size = -64000'); // 64MB
  _db.pragma('foreign_keys = ON');
  _db.pragma('temp_store = MEMORY');

  log.info('Database initialized with WAL mode');

  return _db;
}

/**
 * 关闭数据库
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    log.info('Database closed');
  }
}

/**
 * 在事务中执行（自动 commit/rollback）
 */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  return db.transaction(fn)();
}
