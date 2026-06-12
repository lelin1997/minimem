/**
 * MiniMem — Retrieval 单元测试
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';
import { generateId, now } from '../../src/common/utils.js';
import { enrichResults } from '../../src/retrieval/search.js';
import type { MemoryLayer } from '../../src/common/types.js';

describe('Retrieval Engine', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => clearAllTables());

  describe('enrichResults', () => {
    it('should enrich L1 results with raw_content', () => {
      const db = getDb();
      const id = generateId();
      db.prepare(`
        INSERT INTO experiences (id, raw_content, content_type, source, branch, created_at, updated_at)
        VALUES (?, 'This is test content', 'note', 'test', 'main', ?, ?)
      `).run(id, now(), now());

      const results = enrichResults([{
        id,
        layer: 'L1' as MemoryLayer,
        content: '',
        score: 0.8,
        source_strategy: 'semantic',
        metadata: {},
      }]);

      expect(results[0].content).toBe('This is test content');
    });

    it('should enrich L2 results with SPO triple', () => {
      const db = getDb();
      const id = generateId();
      db.prepare(`
        INSERT INTO world_facts (id, subject, predicate, object, source, branch, created_at, updated_at)
        VALUES (?, 'Alice', 'works_at', 'Google', 'test', 'main', ?, ?)
      `).run(id, now(), now());

      const results = enrichResults([{
        id,
        layer: 'L2' as MemoryLayer,
        content: '',
        score: 0.7,
        source_strategy: 'keyword',
        metadata: {},
      }]);

      expect(results[0].content).toBe('Alice works_at Google');
    });

    it('should skip already enriched results', () => {
      const results = enrichResults([{
        id: 'fake-id',
        layer: 'L1' as MemoryLayer,
        content: 'Already has content',
        score: 0.5,
        source_strategy: 'condition',
        metadata: {},
      }]);

      expect(results[0].content).toBe('Already has content');
    });
  });

  describe('Condition Index', () => {
    it('should support O(1) lookup', () => {
      const db = getDb();
      const memId = generateId();
      db.prepare(
        'INSERT INTO condition_index (condition_key, memory_type, memory_id) VALUES (?, ?, ?)'
      ).run('person:alice', 'L2', memId);

      const rows = db.prepare(
        'SELECT * FROM condition_index WHERE condition_key = ?'
      ).all('person:alice') as unknown[];
      expect(rows.length).toBe(1);
    });
  });

  describe('FTS5 Search', () => {
    it('should find matching documents', () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO memory_fts (memory_id, memory_type, content, tags, condition_keys)
        VALUES (?, 'L1', 'Learning about machine learning algorithms', 'ml,ai', 'topic:ml')
      `).run(generateId());

      const results = db.prepare(
        "SELECT * FROM memory_fts WHERE memory_fts MATCH 'machine learning'"
      ).all() as unknown[];
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });
});
