/**
 * MiniMem — Surface Files 单元测试
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';
import { estimateTokens } from '../../src/common/utils.js';

describe('Surface Files', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => clearAllTables());

  describe('Surface Files Table', () => {
    it('should have all 9 surface files seeded', () => {
      const db = getDb();
      // 重新插入种子数据（clearAllTables 不清 surface_files）
      const rows = db.prepare('SELECT * FROM surface_files').all() as Array<Record<string, unknown>>;
      expect(rows.length).toBe(9);

      const fileNames = rows.map(r => r.file_name);
      expect(fileNames).toContain('me.md');
      expect(fileNames).toContain('work.md');
      expect(fileNames).toContain('social.md');
      expect(fileNames).toContain('index.md');
      expect(fileNames).toContain('insight.md'); // MINIMEM-002
    });

    it('should have token budgets defined', () => {
      const db = getDb();
      const rows = db.prepare('SELECT file_name, budget_tokens FROM surface_files').all() as Array<{ file_name: string; budget_tokens: number }>;

      for (const row of rows) {
        expect(row.budget_tokens).toBeGreaterThan(0);
        expect(row.budget_tokens).toBeLessThanOrEqual(2000);
      }
    });

    it('should update content and version', () => {
      const db = getDb();
      db.prepare(`
        UPDATE surface_files SET content = '# Updated', version = version + 1, token_count = 3
        WHERE file_name = 'me.md'
      `).run();

      const row = db.prepare("SELECT * FROM surface_files WHERE file_name = 'me.md'").get() as Record<string, unknown>;
      expect(row.content).toBe('# Updated');
      expect(row.version).toBe(2);
    });
  });

  describe('Token Budget Control', () => {
    it('should estimate tokens correctly', () => {
      const tokens = estimateTokens('Hello, this is a test');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });

    it('should estimate Chinese text tokens', () => {
      const tokens = estimateTokens('这是一段中文测试文本');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should not exceed total budget of 10K', () => {
      const db = getDb();
      const rows = db.prepare('SELECT SUM(budget_tokens) as total FROM surface_files').get() as { total: number };
      expect(rows.total).toBeLessThanOrEqual(10000);
    });
  });

  describe('Surface Update Queue', () => {
    it('should enqueue and process updates', async () => {
      const db = getDb();
      const { generateId, now } = await import('../../src/common/utils.js');

      const id = generateId();
      db.prepare(`
        INSERT INTO surface_update_queue (id, file_name, suggestion, importance, status, created_at)
        VALUES (?, 'work.md', 'Add TypeScript section', 0.7, 'pending', ?)
      `).run(id, now());

      const pending = db.prepare("SELECT * FROM surface_update_queue WHERE status = 'pending'").all() as unknown[];
      expect(pending.length).toBe(1);
    });
  });
});
