// ============================================================
// MiniMem — 数据库迁移工具（增量迁移 + 全量创建）
// ============================================================

import { getLogger } from '../common/logger.js';
import { initDb, getDb, closeDb } from './database.js';
import { SCHEMA_SQL, SEED_SURFACE_FILES_SQL, SEED_BRANCH_SQL, SEED_META_SQL, SEED_DOMAINS_SQL } from './schema.js';
import { getConfig, loadConfig } from '../config/index.js';
import { migrations } from './migrations/index.js';

const log = getLogger('migrate');

/**
 * 执行数据库迁移（全量创建 + 增量迁移）
 */
export function runMigrations(reset: boolean = false): void {
  const config = getConfig();
  const db = initDb();

  if (reset) {
    log.warn('Resetting database — dropping all tables');
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
    ).all() as Array<{ name: string }>;

    for (const { name } of tables) {
      db.exec(`DROP TABLE IF EXISTS "${name}"`);
    }

    // FTS5 虚拟表需要单独删除
    db.exec('DROP TABLE IF EXISTS memory_fts');

    log.info('All tables dropped');
  }

  // 创建所有表（IF NOT EXISTS，幂等）
  log.info('Creating schema...');
  db.exec(SCHEMA_SQL);

  // 种子数据（INSERT OR IGNORE，幂等）
  log.info('Seeding initial data...');
  db.exec(SEED_SURFACE_FILES_SQL);
  db.exec(SEED_BRANCH_SQL);
  db.exec(SEED_META_SQL);
  db.exec(SEED_DOMAINS_SQL);

  // 运行增量迁移
  const migrated = runIncrementalMigrations();
  if (migrated > 0) {
    log.info({ migrated }, 'Incremental migrations applied');
  }

  // 检查表数量
  const tableCount = db.prepare(
    "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
  ).get() as { count: number };

  log.info({ tables: tableCount.count }, 'Migration complete');
}

/**
 * 运行增量迁移
 * 
 * 逻辑：
 * 1. 读取 _meta.schema_version（当前版本号）
 * 2. 筛选 version > current 的迁移
 * 3. 按 version 升序逐一执行（每个在事务内）
 * 4. 更新 _meta.schema_version
 * 
 * @returns 已应用的迁移数量
 */
export function runIncrementalMigrations(): number {
  const db = getDb();
  const currentVersion = getSchemaVersionNumber();

  // 筛选需要执行的迁移
  const pendingMigrations = migrations
    .filter(m => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (pendingMigrations.length === 0) {
    log.debug({ currentVersion }, 'No pending migrations');
    return 0;
  }

  log.info({
    currentVersion,
    pending: pendingMigrations.length,
    targetVersion: pendingMigrations[pendingMigrations.length - 1].version,
  }, 'Running incremental migrations...');

  let applied = 0;

  for (const migration of pendingMigrations) {
    try {
      log.info({ version: migration.version, name: migration.name }, `Applying migration ${migration.version}: ${migration.name}`);

      // 每个迁移在独立事务内执行
      db.transaction(() => {
        migration.up(db);

        // 更新 schema_version
        db.prepare(
          "UPDATE _meta SET value = ? WHERE key = 'schema_version'"
        ).run(String(migration.version));
      })();

      applied++;
      log.info({ version: migration.version, name: migration.name }, 'Migration applied successfully');
    } catch (err) {
      log.error({ version: migration.version, name: migration.name, err }, 'Migration FAILED — aborting remaining migrations');
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return applied;
}

/**
 * 回滚最近 N 个迁移
 * 
 * @param count 回滚数量（默认 1）
 * @returns 回滚的迁移数量
 */
export function rollbackMigrations(count: number = 1): number {
  const db = getDb();
  const currentVersion = getSchemaVersionNumber();

  // 找到需要回滚的迁移（按 version 降序）
  const appliedMigrations = migrations
    .filter(m => m.version <= currentVersion)
    .sort((a, b) => b.version - a.version)
    .slice(0, count);

  if (appliedMigrations.length === 0) {
    log.info('No migrations to rollback');
    return 0;
  }

  let rolled = 0;

  for (const migration of appliedMigrations) {
    try {
      log.info({ version: migration.version, name: migration.name }, `Rolling back migration ${migration.version}: ${migration.name}`);

      db.transaction(() => {
        migration.down(db);

        // 更新 schema_version 为前一个版本
        const prevVersion = migration.version - 1;
        db.prepare(
          "UPDATE _meta SET value = ? WHERE key = 'schema_version'"
        ).run(String(prevVersion));
      })();

      rolled++;
      log.info({ version: migration.version, name: migration.name }, 'Migration rolled back successfully');
    } catch (err) {
      log.error({ version: migration.version, name: migration.name, err }, 'Rollback FAILED — aborting');
      throw new Error(`Rollback of migration ${migration.version} (${migration.name}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return rolled;
}

/**
 * 获取迁移状态
 */
export function getMigrationStatus(): {
  currentVersion: number;
  latestVersion: number;
  pendingCount: number;
  pending: Array<{ version: number; name: string }>;
  applied: Array<{ version: number; name: string }>;
} {
  const currentVersion = getSchemaVersionNumber();
  const latestVersion = migrations.length > 0
    ? Math.max(...migrations.map(m => m.version))
    : currentVersion;

  const pending = migrations
    .filter(m => m.version > currentVersion)
    .sort((a, b) => a.version - b.version)
    .map(m => ({ version: m.version, name: m.name }));

  const applied = migrations
    .filter(m => m.version <= currentVersion)
    .sort((a, b) => a.version - b.version)
    .map(m => ({ version: m.version, name: m.name }));

  return {
    currentVersion,
    latestVersion,
    pendingCount: pending.length,
    pending,
    applied,
  };
}

/**
 * 获取当前 schema 版本（字符串）
 */
export function getSchemaVersion(): string {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
    return row?.value ?? '0';
  } catch {
    return '0';
  }
}

/**
 * 获取当前 schema 版本（数字）
 */
export function getSchemaVersionNumber(): number {
  return parseInt(getSchemaVersion(), 10) || 0;
}

// ── CLI 入口 ──

if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const status = args.includes('--status') || args.includes('status');
  const rollback = args.includes('--rollback') || args.includes('rollback');
  const rollbackCount = parseInt(args[args.indexOf('--count') + 1] || '1', 10);

  loadConfig();

  if (status) {
    // migrate:status
    initDb();
    const info = getMigrationStatus();
    console.log('\n📊 Migration Status');
    console.log('━━━━━━━━━━━━━━━━');
    console.log(`Current version: ${info.currentVersion}`);
    console.log(`Latest version:  ${info.latestVersion}`);
    console.log(`Pending:         ${info.pendingCount}`);
    if (info.applied.length > 0) {
      console.log('\nApplied migrations:');
      for (const m of info.applied) {
        console.log(`  ✅ v${m.version}: ${m.name}`);
      }
    }
    if (info.pending.length > 0) {
      console.log('\nPending migrations:');
      for (const m of info.pending) {
        console.log(`  ⬜ v${m.version}: ${m.name}`);
      }
    }
    closeDb();
  } else if (rollback) {
    // migrate:rollback
    initDb();
    runMigrations(); // 确保基础 schema 存在
    const rolled = rollbackMigrations(rollbackCount);
    closeDb();
    console.log(rolled > 0 ? `✅ Rolled back ${rolled} migration(s).` : '✅ Nothing to rollback.');
  } else {
    // 正常迁移
    runMigrations(reset);
    closeDb();
    console.log(reset ? '✅ Database reset and migrated.' : '✅ Database migrated.');
  }
}
