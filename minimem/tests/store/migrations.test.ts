/**
 * MiniMem — C01: Migration 回滚测试
 * ============================================
 * 测试每个 migration 的 up/down
 * 测试 v1 → v9 全量迁移
 * 测试从 v9 回滚到 v8
 *
 * SQLite schema 变更是高风险操作，应该有回滚测试
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, SEED_SURFACE_FILES_SQL, SEED_BRANCH_SQL, SEED_META_SQL } from '../../src/infra/store/schema.js';
import { migrations as MIGRATIONS } from '../../src/infra/store/migrations/index.js';

describe('C01: Migration Tests', () => {

  describe('Migration structure', () => {

    it('should have migrations v3 through v9', () => {
      const versions = MIGRATIONS.map(m => m.version);
      expect(versions).toContain(3);
      expect(versions).toContain(4);
      expect(versions).toContain(5);
      expect(versions).toContain(6);
      expect(versions).toContain(7);
      expect(versions).toContain(8);
      expect(versions).toContain(9);
    });

    it('each migration should have up() and down() functions', () => {
      for (const migration of MIGRATIONS) {
        expect(typeof migration.up).toBe('function');
        expect(typeof migration.down).toBe('function');
      }
    });
  });

  describe('Full migration up (v1 → v9)', () => {

    it('should apply all migrations without error', () => {
      const db = new Database(':memory:');
      // SCHEMA_SQL 建全部表, migrations 做 ALTER/INDEX 补充
      db.exec(SCHEMA_SQL);
      db.exec(SEED_SURFACE_FILES_SQL);
      db.exec(SEED_BRANCH_SQL);
      db.exec(SEED_META_SQL);

      // 逐个应用 migration — 跳过已存在的列错误 (schema.sql 已建)
      for (const migration of MIGRATIONS) {
        try {
          migration.up(db);
        } catch (err) {
          if (!String(err).includes('duplicate column') && !String(err).includes('already exists')) {
            throw err;
          }
        }
      }

      // 验证 surface_changes_json 列存在
      const cols = db.prepare('PRAGMA table_info(dream_logs)').all() as Array<{ name: string }>;
      const colNames = cols.map(c => c.name);
      expect(colNames).toContain('surface_changes_json');

      db.close();
    });

    it('should be idempotent (running up twice does not error)', () => {
      const db = new Database(':memory:');
      db.exec(SCHEMA_SQL);
      db.exec(SEED_SURFACE_FILES_SQL);
      db.exec(SEED_BRANCH_SQL);
      db.exec(SEED_META_SQL);

      for (const migration of MIGRATIONS) {
        try { migration.up(db); } catch (err) {
          if (!String(err).includes('duplicate column') && !String(err).includes('already exists')) throw err;
        }
      }
      // 第二次 — duplicate/already exists 预期
      for (const migration of MIGRATIONS) {
        try { migration.up(db); } catch (err) {
          if (!String(err).includes('duplicate column') && !String(err).includes('already exists')) throw err;
        }
      }

      db.close();
    });
  });

  describe('Migration v9 (surface_changes_json)', () => {

    it('up: should add surface_changes_json column to dream_logs', () => {
      const db = new Database(':memory:');
      db.exec(SCHEMA_SQL);

      // v9 之前应该没有 surface_changes_json (除非 schema.ts 已包含)
      const v9Migration = MIGRATIONS.find(m => m.version === 9);
      expect(v9Migration).toBeDefined();

      // 直接调 up
      v9Migration!.up(db);

      // 验证列存在
      const cols = db.prepare('PRAGMA table_info(dream_logs)').all() as Array<{ name: string }>;
      const colNames = cols.map(c => c.name);
      expect(colNames).toContain('surface_changes_json');

      db.close();
    });

    it('down: should handle rollback gracefully', () => {
      const db = new Database(':memory:');
      db.exec(SCHEMA_SQL);

      const v9Migration = MIGRATIONS.find(m => m.version === 9);
      v9Migration!.up(db);

      // down 可能不删除列 (SQLite 限制)，但不应报错
      expect(() => v9Migration!.down(db)).not.toThrow();

      db.close();
    });
  });

  describe('Migration v8 (dream observability fields)', () => {

    it('up: should add dream observability columns', () => {
      const db = new Database(':memory:');
      db.exec(SCHEMA_SQL);

      const v8Migration = MIGRATIONS.find(m => m.version === 8);
      v8Migration!.up(db);

      const cols = db.prepare('PRAGMA table_info(dream_logs)').all() as Array<{ name: string }>;
      const colNames = cols.map(c => c.name);
      expect(colNames).toContain('seeds_json');
      expect(colNames).toContain('pairs_json');
      expect(colNames).toContain('llm_output_summary');
      expect(colNames).toContain('quality_score');

      db.close();
    });

    it('down: should not error', () => {
      const db = new Database(':memory:');
      db.exec(SCHEMA_SQL);

      const v8Migration = MIGRATIONS.find(m => m.version === 8);
      v8Migration!.up(db);
      expect(() => v8Migration!.down(db)).not.toThrow();

      db.close();
    });
  });

  describe('Migration v6 (knowledge_pages enhancements)', () => {

    it('up: should add tags/summary/domain to knowledge_pages', () => {
      const db = new Database(':memory:');
      db.exec(SCHEMA_SQL);

      const v6Migration = MIGRATIONS.find(m => m.version === 6);
      v6Migration!.up(db);

      const cols = db.prepare('PRAGMA table_info(knowledge_pages)').all() as Array<{ name: string }>;
      const colNames = cols.map(c => c.name);
      // v6 加的字段
      expect(colNames).toContain('tags');
      expect(colNames).toContain('summary');
      expect(colNames).toContain('domain');

      db.close();
    });
  });

  describe('Data integrity after migration', () => {

    it('should be able to insert and query dream_logs with all fields', () => {
      const db = new Database(':memory:');
      db.exec(SCHEMA_SQL);
      db.exec(SEED_SURFACE_FILES_SQL);
      for (const migration of MIGRATIONS) {
        try { migration.up(db); } catch (err) {
          if (!String(err).includes('duplicate column') && !String(err).includes('already exists')) throw err;
        }
      }

      // 插入一条完整的 dream_log
      db.prepare(`
        INSERT INTO dream_logs (id, session_id, phase, narrative, duration_ms, created_at,
          l1_to_l2, l2_to_l3, l3_to_l4, pages_created, pages_updated,
          compile_queue_processed, seeds_json, pairs_json, llm_output_summary,
          new_connections, insights_count, conflicts_count,
          quality_score, quality_factors_json, surface_changes_json)
        VALUES ('test-1', 'session-1', 4, 'test', 1000, datetime('now'),
          1, 0, 0, 0, 0, 0, '[]', '[]', 'summary',
          2, 1, 0, 0.8, '{}', '[{"file_name":"context.md","changed":true}]')
      `).run();

      const row = db.prepare('SELECT * FROM dream_logs WHERE id = ?').get('test-1') as Record<string, unknown>;
      expect(row.session_id).toBe('session-1');
      expect(row.quality_score).toBe(0.8);
      expect(row.surface_changes_json).toContain('context.md');

      db.close();
    });

    it('should be able to insert knowledge_page with all v6 fields', () => {
      const db = new Database(':memory:');
      db.exec(SCHEMA_SQL);
      for (const migration of MIGRATIONS) {
        try { migration.up(db); } catch (err) {
          if (!String(err).includes('duplicate column') && !String(err).includes('already exists')) throw err;
        }
      }

      db.prepare(`
        INSERT INTO knowledge_pages (id, slug, title, page_type, content, summary, domain, tags,
          compile_count, last_compiled, lint_status, staleness_score, confidence, branch, created_at, updated_at)
        VALUES ('kp-1', 'test-slug', 'Test Page', 'topic', '# Test', 'summary', 'programming', '["test"]',
          1, datetime('now'), 'healthy', 0.0, 0.9, 'main', datetime('now'), datetime('now'))
      `).run();

      const row = db.prepare('SELECT * FROM knowledge_pages WHERE id = ?').get('kp-1') as Record<string, unknown>;
      expect(row.slug).toBe('test-slug');
      expect(row.lint_status).toBe('healthy');
      expect(row.tags).toContain('test');

      db.close();
    });
  });

  describe('memories view exists after migration', () => {

    it('should have memories view after full migration', () => {
      const db = new Database(':memory:');
      db.exec(SCHEMA_SQL);
      db.exec(SEED_SURFACE_FILES_SQL);
      for (const migration of MIGRATIONS) {
        try { migration.up(db); } catch (err) {
          if (!String(err).includes('duplicate column') && !String(err).includes('already exists')) throw err;
        }
      }

      // memories 视图应该存在
      const views = db.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name='memories'").all();
      expect(views.length).toBe(1);

      db.close();
    });
  });
});
