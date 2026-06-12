/**
 * MiniMem — Core 层单元测试（感知层 + 加工层）
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';
import { generateId, now, slugify, estimateTokens, truncate } from '../../src/common/utils.js';

describe('Core Layer', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => clearAllTables());

  describe('Utils', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
      expect(id1.length).toBe(21);
    });

    it('should generate ISO timestamps', () => {
      const ts = now();
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should slugify correctly', () => {
      expect(slugify('Hello World')).toBe('hello-world');
      expect(slugify('Alice Chen')).toBe('alice-chen');
      expect(slugify('TypeScript 项目')).toBe('typescript-项目');
    });

    it('should estimate tokens', () => {
      const english = estimateTokens('Hello World');
      expect(english).toBeGreaterThan(0);
      const chinese = estimateTokens('你好世界');
      expect(chinese).toBeGreaterThan(0);
    });

    it('should truncate strings', () => {
      expect(truncate('short', 10)).toBe('short');
      expect(truncate('a very long string that needs truncation', 20)).toBe('a very long strin...');
    });
  });

  describe('Perception Pipeline (via DB)', () => {
    it('should store experience with all fields', () => {
      const db = getDb();
      const id = generateId();
      const ts = now();

      db.prepare(`
        INSERT INTO experiences (id, raw_content, content_type, source, importance, tags, participants, context, branch, created_at, updated_at)
        VALUES (?, ?, 'conversation', 'codebuddy', 0.8, '["typescript"]', '["alice"]', 'test context', 'main', ?, ?)
      `).run(id, '用户说他喜欢 TypeScript', ts, ts);

      const row = db.prepare('SELECT * FROM experiences WHERE id = ?').get(id) as Record<string, unknown>;
      expect(row.raw_content).toBe('用户说他喜欢 TypeScript');
      expect(JSON.parse(row.tags as string)).toEqual(['typescript']);
      expect(JSON.parse(row.participants as string)).toEqual(['alice']);
    });

    it('should support FTS search', () => {
      const db = getDb();
      const id = generateId();

      // 插入 FTS 数据
      db.prepare(`
        INSERT INTO memory_fts (memory_id, memory_type, content, tags, condition_keys)
        VALUES (?, 'L1', 'TypeScript is a great programming language', 'typescript', 'topic:typescript')
      `).run(id);

      const results = db.prepare(
        "SELECT * FROM memory_fts WHERE memory_fts MATCH 'typescript'"
      ).all() as unknown[];
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Processing Layer (via DB)', () => {
    it('should store extracted facts', () => {
      const db = getDb();
      const factId = generateId();
      const expId = generateId();

      db.prepare(`
        INSERT INTO world_facts (id, subject, predicate, object, confidence, evidence_experience_ids, condition_keys, source, branch, created_at, updated_at)
        VALUES (?, 'Alice', 'prefers', 'TypeScript', 0.9, ?, '["person:alice","topic:typescript"]', 'test', 'main', ?, ?)
      `).run(factId, JSON.stringify([expId]), now(), now());

      const facts = db.prepare("SELECT * FROM world_facts WHERE subject = 'Alice'").all() as Array<Record<string, unknown>>;
      expect(facts.length).toBe(1);
      expect(facts[0].object).toBe('TypeScript');
    });
  });
});
