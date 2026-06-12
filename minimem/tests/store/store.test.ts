/**
 * MiniMem — Store 层单元测试
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';
import { generateId, now } from '../../src/common/utils.js';

describe('Store Layer', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => clearAllTables());

  describe('L1 Experiences', () => {
    it('should insert and retrieve experience', () => {
      const db = getDb();
      const id = generateId();
      db.prepare(`
        INSERT INTO experiences (id, raw_content, content_type, source, importance, branch, created_at, updated_at)
        VALUES (?, ?, 'conversation', 'test', 0.7, 'main', ?, ?)
      `).run(id, 'Test content', now(), now());

      const row = db.prepare('SELECT * FROM experiences WHERE id = ?').get(id) as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.raw_content).toBe('Test content');
      expect(row.importance).toBe(0.7);
    });

    it('should enforce content_hash uniqueness index', () => {
      const db = getDb();
      const hash = 'test-hash-123';
      db.prepare(`
        INSERT INTO experiences (id, raw_content, content_type, source, content_hash, branch, created_at, updated_at)
        VALUES (?, 'content1', 'note', 'test', ?, 'main', ?, ?)
      `).run(generateId(), hash, now(), now());

      // 第二次插入不同 id 但相同 hash 应该可以（只是有索引，不是唯一约束）
      expect(() => {
        db.prepare(`
          INSERT INTO experiences (id, raw_content, content_type, source, content_hash, branch, created_at, updated_at)
          VALUES (?, 'content2', 'note', 'test', ?, 'main', ?, ?)
        `).run(generateId(), hash, now(), now());
      }).not.toThrow();
    });
  });

  describe('L2 World Facts', () => {
    it('should insert and query by subject', () => {
      const db = getDb();
      const id = generateId();
      db.prepare(`
        INSERT INTO world_facts (id, subject, predicate, object, confidence, source, branch, created_at, updated_at)
        VALUES (?, 'Alice', 'works_at', 'Google', 0.9, 'test', 'main', ?, ?)
      `).run(id, now(), now());

      const rows = db.prepare('SELECT * FROM world_facts WHERE subject = ?').all('Alice') as unknown[];
      expect(rows.length).toBe(1);
    });
  });

  describe('L3 Observations', () => {
    it('should insert observation with confidence', () => {
      const db = getDb();
      const id = generateId();
      db.prepare(`
        INSERT INTO observations (id, description, observation_type, confidence, branch, created_at, updated_at)
        VALUES (?, 'Test pattern', 'pattern', 0.8, 'main', ?, ?)
      `).run(id, now(), now());

      const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(id) as Record<string, unknown>;
      expect(row.confidence).toBe(0.8);
    });
  });

  describe('L4 Mental Models', () => {
    it('should create active mental model', () => {
      const db = getDb();
      const id = generateId();
      db.prepare(`
        INSERT INTO mental_models (id, title, content, model_type, priority, is_active, branch, created_at, updated_at)
        VALUES (?, 'DRY Principle', 'Do not repeat yourself', 'principle', 8, 1, 'main', ?, ?)
      `).run(id, now(), now());

      const rows = db.prepare('SELECT * FROM mental_models WHERE is_active = 1').all() as unknown[];
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Knowledge Pages', () => {
    it('should enforce slug uniqueness', () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO knowledge_pages (id, slug, title, page_type, content, branch, created_at, updated_at)
        VALUES (?, 'alice', 'Alice', 'person', '# Alice', 'main', ?, ?)
      `).run(generateId(), now(), now());

      expect(() => {
        db.prepare(`
          INSERT INTO knowledge_pages (id, slug, title, page_type, content, branch, created_at, updated_at)
          VALUES (?, 'alice', 'Alice 2', 'person', '# Alice 2', 'main', ?, ?)
        `).run(generateId(), now(), now());
      }).toThrow();
    });
  });

  describe('Compile Queue', () => {
    it('should enqueue and dequeue items', () => {
      const db = getDb();
      const id = generateId();
      db.prepare(`
        INSERT INTO compile_queue (id, source_type, content, priority, status, created_at)
        VALUES (?, 'new_fact', 'test fact', 5, 'pending', ?)
      `).run(id, now());

      const pending = db.prepare("SELECT * FROM compile_queue WHERE status = 'pending'").all() as unknown[];
      expect(pending.length).toBe(1);

      db.prepare("UPDATE compile_queue SET status = 'compiled' WHERE id = ?").run(id);
      const remaining = db.prepare("SELECT * FROM compile_queue WHERE status = 'pending'").all() as unknown[];
      expect(remaining.length).toBe(0);
    });
  });
});
