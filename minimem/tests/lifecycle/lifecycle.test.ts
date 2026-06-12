/**
 * MiniMem — Lifecycle 单元测试（温度 + GC + 来源信誉）
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';
import { generateId, now } from '../../src/common/utils.js';
import { initTemperature, recordAccess } from '../../src/lifecycle/index.js';

describe('Lifecycle Management', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => clearAllTables());

  describe('Temperature Engine', () => {
    it('should initialize temperature for new memory', () => {
      const memId = generateId();
      initTemperature(memId, 'L1', 0.8);

      const db = getDb();
      const row = db.prepare(
        'SELECT * FROM memory_temperature WHERE memory_id = ?'
      ).get(memId) as Record<string, unknown>;

      expect(row).toBeTruthy();
      expect(row.temperature).toBe('hot'); // importance 0.8 → high score
      expect(row.pinned).toBe(0);
    });

    it('should record access and increase score', () => {
      const memId = generateId();
      initTemperature(memId, 'L1', 0.3);

      const db = getDb();
      const before = db.prepare(
        'SELECT score, access_count FROM memory_temperature WHERE memory_id = ?'
      ).get(memId) as { score: number; access_count: number };

      recordAccess(memId, 'L1');

      const after = db.prepare(
        'SELECT score, access_count FROM memory_temperature WHERE memory_id = ?'
      ).get(memId) as { score: number; access_count: number };

      expect(after.access_count).toBe(before.access_count + 1);
      expect(after.score).toBeGreaterThanOrEqual(before.score);
    });
  });

  describe('GC Log', () => {
    it('should record GC runs', () => {
      const db = getDb();
      const id = generateId();
      const runId = generateId();

      db.prepare(`
        INSERT INTO gc_log (id, run_id, gc_type, memories_scanned, duplicates_merged, compressed, deleted, duration_ms, created_at)
        VALUES (?, ?, 'light', 100, 2, 5, 3, 1500, ?)
      `).run(id, runId, now());

      const row = db.prepare('SELECT * FROM gc_log WHERE run_id = ?').get(runId) as Record<string, unknown>;
      expect(row.gc_type).toBe('light');
      expect(row.memories_scanned).toBe(100);
      expect(row.deleted).toBe(3);
    });
  });

  describe('Source Reputation', () => {
    it('should track client reputation', () => {
      const db = getDb();
      const clientId = 'test-client';

      db.prepare(`
        INSERT INTO source_reputation (client_id, reputation_score, total_memories, gc_cleaned_count, gc_cleaned_rate, importance_penalty, updated_at)
        VALUES (?, 80, 100, 20, 0.2, 0.1, ?)
      `).run(clientId, now());

      const row = db.prepare('SELECT * FROM source_reputation WHERE client_id = ?').get(clientId) as Record<string, unknown>;
      expect(row.reputation_score).toBe(80);
      expect(row.gc_cleaned_rate).toBe(0.2);
    });
  });
});
