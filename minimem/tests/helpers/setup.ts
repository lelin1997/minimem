/**
 * MiniMem — 测试辅助工具
 * 提供统一的 DB 初始化/清理方法
 */
import { loadConfig } from '../../src/config/index.js';
import { initDb, closeDb, getDb } from '../../src/store/database.js';
import { SCHEMA_SQL, SEED_SURFACE_FILES_SQL, SEED_BRANCH_SQL, SEED_META_SQL } from '../../src/store/schema.js';
import { runIncrementalMigrations } from '../../src/store/migrate.js';

let initialized = false;

/**
 * 初始化测试数据库（内存模式）
 * 所有 store 测试共用
 */
export function setupTestDb(): void {
  if (initialized) return;

  // 确保配置加载（使用默认配置）
  loadConfig();

  // 使用内存数据库
  initDb(':memory:');

  // 建表 + 种子数据
  const db = getDb();
  db.exec(SCHEMA_SQL);
  db.exec(SEED_SURFACE_FILES_SQL);
  db.exec(SEED_BRANCH_SQL);
  db.exec(SEED_META_SQL);

  // 运行增量迁移（确保新增字段和表存在）
  runIncrementalMigrations();

  initialized = true;
}

/**
 * 清理测试数据库
 */
export function teardownTestDb(): void {
  try {
    closeDb();
  } catch {
    // 忽略已关闭错误
  }
  initialized = false;
}

/**
 * 清空指定表（用于测试间隔离）
 */
export function clearTable(tableName: string): void {
  const db = getDb();
  db.exec(`DELETE FROM "${tableName}"`);
}

/**
 * 清空所有数据表（保留结构）
 */
export function clearAllTables(): void {
  const db = getDb();
  const tables = [
    'experiences', 'world_facts', 'observations', 'mental_models',
    'knowledge_pages', 'knowledge_page_links', 'knowledge_page_evidence',
    'compile_queue', 'condition_index', 'memory_links',
    'memory_temperature', 'memory_tombstones', 'gc_log',
    'source_reputation', 'audit_log', 'access_log',
    'snapshots', 'owner_profile', 'person_profiles',
    'dream_logs', 'work_tasks', 'memory_traces',
  ];
  for (const t of tables) {
    db.exec(`DELETE FROM "${t}"`);
  }
  // FTS 虚拟表
  db.exec('DELETE FROM memory_fts');
  // 分支表需要保留 main
  db.exec("DELETE FROM branches WHERE name != 'main'");
}
