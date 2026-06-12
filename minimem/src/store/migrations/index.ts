// ============================================================
// MiniMem — 增量 Schema 迁移注册表
// ============================================================
// 所有迁移按版本号顺序注册，系统启动时自动执行 > current version 的迁移

import type Database from 'better-sqlite3';

/**
 * 迁移文件接口
 */
export interface Migration {
  version: number;
  name: string;
  up(db: Database.Database): void;
  down(db: Database.Database): void;
}

/**
 * 迁移注册表 — 按 version 升序排列
 * 
 * 规则：
 * - version 从 3 开始（schema_version='2' 是 Wave 1-2 的基线）
 * - 每个迁移必须实现 up() 和 down()
 * - up/down 内部无需事务，迁移运行器会自动包裹事务
 */
export const migrations: Migration[] = [
  // ── Wave 3 迁移 ──

  // Version 3: 为 observations 表添加 drift_risk 字段（TODO-017: 信念漂移检测）
  {
    version: 3,
    name: 'add_drift_risk_to_observations',
    up(db) {
      db.exec('ALTER TABLE observations ADD COLUMN drift_risk INTEGER NOT NULL DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_observations_drift_risk ON observations(drift_risk)');
    },
    down(db) {
      // SQLite >= 3.35.0 支持 DROP COLUMN
      // 但为兼容性，先尝试 DROP COLUMN，失败则忽略（字段仍存在但不影响功能）
      try {
        db.exec('DROP INDEX IF EXISTS idx_observations_drift_risk');
        db.exec('ALTER TABLE observations DROP COLUMN drift_risk');
      } catch {
        // SQLite < 3.35.0 不支持 DROP COLUMN，忽略
        // 字段会留在表中但默认值为 0，不影响功能
      }
    },
  },

  // Version 4: MINIMEM-002 灵感池 — 新增 inspirations 表
  {
    version: 4,
    name: 'add_inspirations_table',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS inspirations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          hypothesis TEXT NOT NULL DEFAULT '',
          origin TEXT NOT NULL DEFAULT 'dream_association',
          source_memory_ids TEXT NOT NULL DEFAULT '[]',
          source_layers TEXT NOT NULL DEFAULT '[]',
          source_domains TEXT NOT NULL DEFAULT '[]',
          novelty REAL NOT NULL DEFAULT 0.5,
          actionability REAL NOT NULL DEFAULT 0.5,
          confidence REAL NOT NULL DEFAULT 0.3,
          status TEXT NOT NULL DEFAULT 'spark',
          incubation_count INTEGER NOT NULL DEFAULT 0,
          incubation_log TEXT NOT NULL DEFAULT '[]',
          acted_outcome TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          embedding_id TEXT,
          domain TEXT NOT NULL DEFAULT 'default',
          branch TEXT NOT NULL DEFAULT 'main',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_inspirations_status ON inspirations(status);
        CREATE INDEX IF NOT EXISTS idx_inspirations_origin ON inspirations(origin);
        CREATE INDEX IF NOT EXISTS idx_inspirations_domain ON inspirations(domain);
        CREATE INDEX IF NOT EXISTS idx_inspirations_confidence ON inspirations(confidence DESC);
        CREATE INDEX IF NOT EXISTS idx_inspirations_expires ON inspirations(expires_at);
        CREATE INDEX IF NOT EXISTS idx_inspirations_created ON inspirations(created_at DESC);
      `);
      // 新增 insight.md surface file
      db.exec(`INSERT OR IGNORE INTO surface_files (file_name, content, token_count, budget_tokens) VALUES ('insight.md', '# 灵感洞察\n\n（等待做梦后自动生成）\n', 10, 1000)`);
    },
    down(db) {
      db.exec('DROP TABLE IF EXISTS inspirations');
      db.exec("DELETE FROM surface_files WHERE file_name = 'insight.md'");
    },
  },

  // Version 5: MINIMEM-003 E10 — Ebbinghaus 遗忘曲线数据模型扩展
  // 为 memory_temperature 表添加 stability / review_count / initial_score 字段
  {
    version: 5,
    name: 'add_ebbinghaus_fields_to_memory_temperature',
    up(db) {
      db.exec('ALTER TABLE memory_temperature ADD COLUMN stability REAL NOT NULL DEFAULT 24.0');
      db.exec('ALTER TABLE memory_temperature ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0');
      db.exec('ALTER TABLE memory_temperature ADD COLUMN initial_score REAL NOT NULL DEFAULT 50.0');
    },
    down(db) {
      try {
        db.exec('ALTER TABLE memory_temperature DROP COLUMN stability');
        db.exec('ALTER TABLE memory_temperature DROP COLUMN review_count');
        db.exec('ALTER TABLE memory_temperature DROP COLUMN initial_score');
      } catch {
        // SQLite < 3.35.0 不支持 DROP COLUMN，忽略
      }
    },
  },

  // Version 6: Console Knowledge API — 为 knowledge_pages 添加 summary/domain/tags/status 列
  {
    version: 6,
    name: 'add_knowledge_pages_console_fields',
    up(db) {
      db.exec("ALTER TABLE knowledge_pages ADD COLUMN summary TEXT NOT NULL DEFAULT ''");
      db.exec("ALTER TABLE knowledge_pages ADD COLUMN domain TEXT NOT NULL DEFAULT 'default'");
      db.exec("ALTER TABLE knowledge_pages ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
      db.exec("ALTER TABLE knowledge_pages ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_pages_status ON knowledge_pages(status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_pages_domain ON knowledge_pages(domain)');
    },
    down(db) {
      try {
        db.exec('DROP INDEX IF EXISTS idx_knowledge_pages_status');
        db.exec('DROP INDEX IF EXISTS idx_knowledge_pages_domain');
        db.exec('ALTER TABLE knowledge_pages DROP COLUMN summary');
        db.exec('ALTER TABLE knowledge_pages DROP COLUMN domain');
        db.exec('ALTER TABLE knowledge_pages DROP COLUMN tags');
        db.exec('ALTER TABLE knowledge_pages DROP COLUMN status');
      } catch {
        // SQLite < 3.35.0 不支持 DROP COLUMN，忽略
      }
    },
  },
];
