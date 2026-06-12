/**
 * MiniMem — Dream Engine 集成测试
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';
import { generateId, now } from '../../src/common/utils.js';

describe('Dream Engine', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => clearAllTables());

  describe('Dream Logs', () => {
    it('should store dream session records', () => {
      const db = getDb();
      const id = generateId();
      const sessionId = generateId();
      const snapshotId = generateId();

      db.prepare(`
        INSERT INTO dream_logs (id, session_id, phase, narrative, l1_to_l2, l2_to_l3, l3_to_l4, pages_created, pages_updated, compile_queue_processed, pre_snapshot_id, duration_ms, created_at)
        VALUES (?, ?, 1, 'Phase 1 audit completed', 5, 2, 1, 3, 2, 4, ?, 1500, ?)
      `).run(id, sessionId, snapshotId, now());

      const rows = db.prepare('SELECT * FROM dream_logs WHERE session_id = ?').all(sessionId) as Array<Record<string, unknown>>;
      expect(rows.length).toBe(1);
      expect(rows[0].phase).toBe(1);
      expect(rows[0].l1_to_l2).toBe(5);
    });

    it('should support multi-phase sessions', () => {
      const db = getDb();
      const sessionId = generateId();
      const snapshotId = generateId();

      for (let phase = 1; phase <= 4; phase++) {
        db.prepare(`
          INSERT INTO dream_logs (id, session_id, phase, narrative, pre_snapshot_id, duration_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(generateId(), sessionId, phase, `Phase ${phase} done`, snapshotId, phase * 1000, now());
      }

      const rows = db.prepare('SELECT * FROM dream_logs WHERE session_id = ? ORDER BY phase').all(sessionId) as Array<Record<string, unknown>>;
      expect(rows.length).toBe(4);
      expect(rows[0].phase).toBe(1);
      expect(rows[3].phase).toBe(4);
    });
  });

  describe('Version Control for Dreams', () => {
    it('should create dream branch and snapshot', () => {
      const db = getDb();
      const snapshotId = generateId();
      const branchName = `dream-test-${Date.now()}`;

      // Create snapshot
      db.prepare(`
        INSERT INTO snapshots (id, label, branch, trigger, created_at)
        VALUES (?, 'pre-dream', 'main', 'dream', ?)
      `).run(snapshotId, now());

      // Create branch
      db.prepare(`
        INSERT INTO branches (name, created_from_snapshot, is_active, created_at)
        VALUES (?, ?, 1, ?)
      `).run(branchName, snapshotId, now());

      const branch = db.prepare('SELECT * FROM branches WHERE name = ?').get(branchName) as Record<string, unknown>;
      expect(branch).toBeTruthy();
      expect(branch.created_from_snapshot).toBe(snapshotId);
    });
  });

  describe('Compile Queue Integration', () => {
    it('should process pending compile items during dream', () => {
      const db = getDb();

      // 入队
      for (let i = 0; i < 5; i++) {
        db.prepare(`
          INSERT INTO compile_queue (id, source_type, content, priority, status, created_at)
          VALUES (?, 'new_fact', ?, ?, 'pending', ?)
        `).run(generateId(), `Fact ${i}`, 5 + i, now());
      }

      const pending = db.prepare("SELECT COUNT(*) as c FROM compile_queue WHERE status = 'pending'").get() as { c: number };
      expect(pending.c).toBe(5);

      // 模拟处理
      db.prepare("UPDATE compile_queue SET status = 'compiled', processed_at = ? WHERE status = 'pending'").run(now());

      const after = db.prepare("SELECT COUNT(*) as c FROM compile_queue WHERE status = 'pending'").get() as { c: number };
      expect(after.c).toBe(0);
    });
  });
});
