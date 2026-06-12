import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getConfig } from './config.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const config = getConfig();
  const dataDir = config.storage.data_dir;

  // 确保数据目录存在
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, config.storage.db_name);
  _db = new Database(dbPath);

  // 启用 WAL 模式（提升并发读写性能）
  _db.pragma('journal_mode = DELETE');

  // 初始化 Schema
  initSchema(_db);

  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    -- Pipeline 定义
    CREATE TABLE IF NOT EXISTS pipelines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      tags TEXT NOT NULL DEFAULT '[]',
      schedule_type TEXT NOT NULL DEFAULT 'cron',
      schedule_cron TEXT,
      schedule_event TEXT,
      nodes TEXT NOT NULL DEFAULT '[]',
      edges TEXT NOT NULL DEFAULT '[]',
      variables TEXT NOT NULL DEFAULT '{}',
      default_llm TEXT NOT NULL DEFAULT '{}',
      last_run_at TEXT,
      last_run_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Pipeline 运行记录
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      duration_ms INTEGER,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline ON pipeline_runs(pipeline_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created ON pipeline_runs(created_at DESC);

    -- 节点运行记录
    CREATE TABLE IF NOT EXISTS node_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      node_label TEXT NOT NULL DEFAULT '',
      node_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      input_snapshot TEXT,
      output_snapshot TEXT,
      error TEXT,
      llm_usage TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_node_runs_run ON node_runs(run_id);

    -- Pipeline 输出记录
    CREATE TABLE IF NOT EXISTS pipeline_outputs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      node_label TEXT NOT NULL DEFAULT '',
      output_type TEXT NOT NULL,
      preview TEXT NOT NULL DEFAULT '',
      full_content TEXT NOT NULL DEFAULT '',
      file_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_outputs_run ON pipeline_outputs(run_id);

    -- 内置模板
    CREATE TABLE IF NOT EXISTS pipeline_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      schedule_type TEXT NOT NULL DEFAULT 'cron',
      schedule_cron TEXT,
      nodes TEXT NOT NULL DEFAULT '[]',
      edges TEXT NOT NULL DEFAULT '[]',
      variables TEXT NOT NULL DEFAULT '{}',
      default_llm TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
