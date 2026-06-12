#!/usr/bin/env node
// ============================================================
// MiniMem — CLI 工具
// ============================================================

import { resolve } from 'path';
import { loadConfig } from '../config/index.js';
import { initDb, closeDb, getDb } from '../store/database.js';
import { SCHEMA_SQL, SEED_SURFACE_FILES_SQL, SEED_BRANCH_SQL, SEED_META_SQL } from '../store/schema.js';
import { getMigrationStatus, rollbackMigrations, runMigrations } from '../store/migrate.js';
import { createBackup, listBackups, restoreBackup } from '../store/backup.js';
import { runStartupRecovery } from '../store/recovery.js';
import { checkAndRepairIntegrity } from '../store/integrity.js';
import { checkHealth } from '../lifecycle/health.js';
import { syncAllSurfacesToDisk } from '../surface/index.js';
import { getLogger } from '../common/logger.js';

const log = getLogger('cli');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  // 初始化配置和数据库（除了 init 命令）
  loadConfig();

  switch (command) {
    case 'init':
      await cmdInit();
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'health':
      await cmdHealth();
      break;
    case 'backup':
      await cmdBackup(args[1]);
      break;
    case 'restore':
      await cmdRestore(args[1]);
      break;
    case 'check':
      await cmdCheck(args.includes('--repair'));
      break;
    case 'recover':
      await cmdRecover();
      break;
    case 'stats':
      await cmdStats();
      break;
    case 'migrate:status':
      await cmdMigrateStatus();
      break;
    case 'migrate:rollback':
      await cmdMigrateRollback(parseInt(args[1] || '1', 10));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }

  closeDb();
}

function printHelp(): void {
  console.log(`
MiniMem CLI — 个人统一记忆系统

用法: minimem <command> [options]

命令:
  init              初始化数据库和目录结构
  status            显示系统状态
  health            健康检查（各层存储数/温度分布/告警）
  stats             详细统计信息
  backup [path]     创建数据库备份
  restore <path>    从备份恢复
  check [--repair]  引用完整性检查（--repair 自动修复）
  recover           启动恢复（WAL + 完整性检查）
  migrate:status    查看迁移状态（当前版本/待执行迁移）
  migrate:rollback [N]  回滚最近 N 个迁移（默认 1）
  help              显示帮助

环境变量:
  MINIMEM_DATA_DIR      数据目录（默认 ~/.minimem）
  MINIMEM_LLM_API_KEY   LLM API 密钥
  MINIMEM_CONFIG_PATH   配置文件路径
  `);
}

async function cmdInit(): Promise<void> {
  console.log('🚀 Initializing MiniMem...');
  loadConfig();
  initDb();
  const db = getDb();
  db.exec(SCHEMA_SQL);
  db.exec(SEED_SURFACE_FILES_SQL);
  db.exec(SEED_BRANCH_SQL);
  db.exec(SEED_META_SQL);
  console.log('✅ Database initialized');
  console.log('✅ Schema created (28 tables + 1 FTS5)');
  console.log('✅ Seed data inserted');

  // 同步 Surface Files 到磁盘
  const synced = syncAllSurfacesToDisk();
  console.log(`✅ Surface files synced to disk (${synced} files)`);
}

async function cmdStatus(): Promise<void> {
  initDb();
  const db = getDb();

  const l1 = (db.prepare('SELECT COUNT(*) as c FROM experiences').get() as { c: number }).c;
  const l2 = (db.prepare('SELECT COUNT(*) as c FROM world_facts').get() as { c: number }).c;
  const l3 = (db.prepare('SELECT COUNT(*) as c FROM observations').get() as { c: number }).c;
  const l4 = (db.prepare('SELECT COUNT(*) as c FROM mental_models').get() as { c: number }).c;
  const pages = (db.prepare('SELECT COUNT(*) as c FROM knowledge_pages').get() as { c: number }).c;

  console.log('📊 MiniMem Status');
  console.log('━━━━━━━━━━━━━━━━');
  console.log(`L1 经历:     ${l1}`);
  console.log(`L2 事实:     ${l2}`);
  console.log(`L3 观察:     ${l3}`);
  console.log(`L4 心智模型: ${l4}`);
  console.log(`知识页面:    ${pages}`);
  console.log(`总计:        ${l1 + l2 + l3 + l4} 条记忆`);
}

async function cmdHealth(): Promise<void> {
  initDb();
  const report = checkHealth();
  console.log(`\n🏥 Health Status: ${report.status.toUpperCase()}`);
  console.log('━━━━━━━━━━━━━━━━');
  console.log(`Layers: L1=${report.layers.L1} L2=${report.layers.L2} L3=${report.layers.L3} L4=${report.layers.L4} Pages=${report.layers.knowledge_pages}`);
  console.log(`Vectors: ${report.storage.vector_count} | Graph Edges: ${report.storage.graph_edges}`);
  console.log(`Last GC: ${report.gc.last_run ?? 'Never'}`);
  console.log(`Last Dream: ${report.dream.last_dream ?? 'Never'}`);

  if (report.alerts.length > 0) {
    console.log('\n⚠️  Alerts:');
    for (const alert of report.alerts) {
      console.log(`  [${alert.level}] ${alert.message}`);
    }
  }
}

async function cmdBackup(path?: string): Promise<void> {
  initDb();
  const result = createBackup(path || undefined);
  if (result) {
    console.log(`✅ Backup created: ${result}`);
  } else {
    console.error('❌ Backup failed');
  }
}

async function cmdRestore(path: string): Promise<void> {
  if (!path) {
    console.error('Usage: minimem restore <backup-path>');
    process.exit(1);
  }
  const success = restoreBackup(path);
  console.log(success ? '✅ Backup restored' : '❌ Restore failed');
}

async function cmdCheck(repair: boolean): Promise<void> {
  initDb();
  const report = checkAndRepairIntegrity(repair);
  console.log('\n🔍 Integrity Check');
  console.log('━━━━━━━━━━━━━━━━');
  console.log(`Orphaned links:        ${report.orphaned_links}`);
  console.log(`Orphaned evidence:     ${report.orphaned_evidence}`);
  console.log(`Orphaned conditions:   ${report.orphaned_conditions}`);
  console.log(`Orphaned temperatures: ${report.orphaned_temperatures}`);
  if (repair) {
    console.log(`Repaired:              ${report.repaired}`);
  }
}

async function cmdRecover(): Promise<void> {
  initDb();
  const result = runStartupRecovery();
  console.log('\n🔧 Recovery Result');
  console.log('━━━━━━━━━━━━━━━━');
  console.log(`WAL recovered:   ${result.wal_recovered ? '✅' : '❌'}`);
  console.log(`Integrity OK:    ${result.integrity_ok ? '✅' : '❌'}`);
  if (result.errors.length > 0) {
    console.log('Errors:');
    for (const err of result.errors) console.log(`  - ${err}`);
  }
}

async function cmdStats(): Promise<void> {
  initDb();
  const db = getDb();

  const tables = ['experiences', 'world_facts', 'observations', 'mental_models',
    'knowledge_pages', 'memory_links', 'condition_index', 'memory_temperature',
    'dream_logs', 'work_tasks', 'person_profiles', 'gc_log', 'access_log', 'audit_log'];

  console.log('\n📈 Detailed Statistics');
  console.log('━━━━━━━━━━━━━━━━━━━━');
  for (const table of tables) {
    const count = (db.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as { c: number }).c;
    console.log(`${table.padEnd(25)} ${count}`);
  }

  // 备份统计
  const backups = listBackups();
  console.log(`\nBackups: ${backups.length}`);
  if (backups[0]) console.log(`Latest: ${backups[0].created_at}`);
}

async function cmdMigrateStatus(): Promise<void> {
  initDb();
  runMigrations(); // 确保基础 schema 存在
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
  if (info.pendingCount === 0) {
    console.log('\n✅ Database is up to date.');
  }
}

async function cmdMigrateRollback(count: number): Promise<void> {
  initDb();
  runMigrations(); // 确保基础 schema 存在
  const rolled = rollbackMigrations(count);
  console.log(rolled > 0 ? `✅ Rolled back ${rolled} migration(s).` : '✅ Nothing to rollback.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
