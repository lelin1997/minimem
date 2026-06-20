#!/usr/bin/env node
// ============================================================
// MiniMem — CLI 工具
// ============================================================

import { resolve, join, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import { loadConfig } from '../config/index.js';
import { initDb, closeDb, getDb } from '../infra/store/database.js';
import { SCHEMA_SQL, SEED_SURFACE_FILES_SQL, SEED_BRANCH_SQL, SEED_META_SQL } from '../infra/store/schema.js';
import { getMigrationStatus, rollbackMigrations, runMigrations } from '../infra/store/migrate.js';
import { createBackup, listBackups, restoreBackup } from '../infra/store/backup.js';
import { runStartupRecovery } from '../infra/store/recovery.js';
import { checkAndRepairIntegrity } from '../infra/store/integrity.js';
import { checkHealth } from '../domain/lifecycle/health.js';
import { syncAllSurfacesToDisk } from '../domain/surface/index.js';
import { getLogger } from '../common/logger.js';

const log = getLogger('cli');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  // init 命令在配置生成前执行（配置可能还不存在）
  if (command === 'init') {
    await cmdInit();
    return;
  }

  // 其他命令需要配置已加载
  loadConfig();

  switch (command) {
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

// ── minimem init 交互式配置 ──

interface InitAnswers {
  provider: 'deepseek' | 'openai' | 'dashscope' | 'custom';
  apiKey: string;
  baseUrl: string;
  heavyModel: string;
  mediumModel: string;
  lightModel: string;
  dataDir: string;
}

const PROVIDER_PRESETS: Record<string, { baseUrl: string; heavy: string; medium: string; light: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', heavy: 'deepseek-chat', medium: 'deepseek-chat', light: 'deepseek-chat' },
  openai: { baseUrl: 'https://api.openai.com/v1', heavy: 'gpt-4o', medium: 'gpt-4o-mini', light: 'gpt-4o-mini' },
  dashscope: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', heavy: 'qwen-max', medium: 'qwen-plus', light: 'qwen-turbo' },
};

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const hint = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise(resolve => {
    rl.question(`${question}${hint}: `, answer => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function runInteractiveInit(): Promise<InitAnswers> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🚀 MiniMem 初始化向导\n');
  console.log('将在 ~/.minimem/ 下生成配置文件并创建数据目录。\n');

  console.log('选择 LLM 提供商:');
  console.log('  1. DeepSeek  (推荐, 性价比高)');
  console.log('  2. OpenAI');
  console.log('  3. 阿里云百炼 (DashScope)');
  console.log('  4. 自定义 (OpenAI 兼容接口)');
  const providerChoice = await ask(rl, '请选择 (1-4)', '1');
  const providerMap: Record<string, InitAnswers['provider']> = {
    '1': 'deepseek', '2': 'openai', '3': 'dashscope', '4': 'custom',
  };
  const provider = providerMap[providerChoice] || 'deepseek';

  const preset = PROVIDER_PRESETS[provider];
  const apiKey = await ask(rl, '请输入 API Key');
  const baseUrl = preset ? await ask(rl, 'API Base URL', preset.baseUrl) : await ask(rl, 'API Base URL');
  const heavyModel = preset ? await ask(rl, 'Heavy 模型 (深度推理)', preset.heavy) : await ask(rl, 'Heavy 模型 (深度推理)');
  const mediumModel = preset ? await ask(rl, 'Medium 模型 (结构化提取)', preset.medium) : await ask(rl, 'Medium 模型 (结构化提取)');
  const lightModel = preset ? await ask(rl, 'Light 模型 (快速分类)', preset.light) : await ask(rl, 'Light 模型 (快速分类)');
  const dataDir = await ask(rl, '数据目录', resolve(process.env.HOME || '~', '.minimem'));

  rl.close();

  return { provider, apiKey, baseUrl, heavyModel, mediumModel, lightModel, dataDir };
}

function generateConfigToml(a: InitAnswers): string {
  return `# MiniMem 配置文件 — 由 minimem init 生成
# 生成时间: ${new Date().toISOString()}

[server]
host = "127.0.0.1"
port = 6677

[llm]
provider = "openai-compatible"
api_key_env = "MINIMEM_LLM_API_KEY"
base_url = "${a.baseUrl}"

[llm.models]
heavy = "${a.heavyModel}"
medium = "${a.mediumModel}"
light = "${a.lightModel}"

[llm.embedding]
enabled = true
model = "text-embedding-v3"
dimensions = 1024

[storage]
data_dir = "${a.dataDir}"
`;
}

async function cmdInit(): Promise<void> {
  const args = process.argv.slice(2);
  const configPath = resolve(process.env.HOME || '~', '.minimem', 'config.toml');
  const configExists = existsSync(configPath);

  // 如果配置已存在且没有 --force，直接走 DB 初始化
  if (configExists && !args.includes('--force')) {
    console.log('ℹ️  配置文件已存在:', configPath);
    console.log('   如需重新配置，请使用: minimem init --force\n');
  } else {
    // 交互式配置生成
    const answers = await runInteractiveInit();

    // 创建数据目录
    const dataDir = answers.dataDir.replace('~', process.env.HOME || '~');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
      console.log(`\n✅ 数据目录已创建: ${dataDir}`);
    }

    // 写入配置文件
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeFileSync(configPath, generateConfigToml(answers), 'utf-8');
    console.log(`✅ 配置文件已生成: ${configPath}`);

    // 提示设置环境变量
    console.log(`\n⚠️  请设置环境变量:`);
    console.log(`    export MINIMEM_LLM_API_KEY="${answers.apiKey}"`);
    console.log(`    (或写入 ${dataDir}/.env 文件)\n`);
  }

  // 初始化数据库
  console.log('🚀 Initializing MiniMem database...');
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
  console.log('\n🎉 MiniMem 初始化完成！使用 `minimem dev` 启动服务。');
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
