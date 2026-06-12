/**
 * MiniMem — 端到端测试（写入 → 检索 → 做梦 → 回顾）
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';
import { generateId, now } from '../../src/common/utils.js';
import { getVectorStore } from '../../src/store/vectors.js';
import { enrichResults } from '../../src/retrieval/search.js';
import type { MemoryLayer } from '../../src/common/types.js';

describe('End-to-End Flow', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => {
    clearAllTables();
    getVectorStore().clear();
  });

  it('should complete write → retrieve → enrich cycle', () => {
    const db = getDb();

    // 1. 写入 L1 经历
    const expId = generateId();
    db.prepare(`
      INSERT INTO experiences (id, raw_content, content_type, source, importance, tags, participants, branch, created_at, updated_at)
      VALUES (?, 'Alice 告诉我她下周要去东京出差', 'conversation', 'codebuddy', 0.8, '["travel","work"]', '["alice"]', 'main', ?, ?)
    `).run(expId, now(), now());

    // 2. 提取 L2 事实
    const factId = generateId();
    db.prepare(`
      INSERT INTO world_facts (id, subject, predicate, object, confidence, evidence_experience_ids, condition_keys, source, branch, created_at, updated_at)
      VALUES (?, 'Alice', '将出差到', '东京', 0.9, ?, '["person:alice","place:东京"]', 'codebuddy', 'main', ?, ?)
    `).run(factId, JSON.stringify([expId]), now(), now());

    // 3. 创建条件索引
    db.prepare('INSERT INTO condition_index (condition_key, memory_type, memory_id) VALUES (?, ?, ?)').run('person:alice', 'L2', factId);
    db.prepare('INSERT INTO condition_index (condition_key, memory_type, memory_id) VALUES (?, ?, ?)').run('place:东京', 'L2', factId);

    // 4. 创建 FTS 条目
    db.prepare(`
      INSERT INTO memory_fts (memory_id, memory_type, content, tags, condition_keys)
      VALUES (?, 'L1', 'Alice 告诉我她下周要去东京出差', 'travel,work', 'person:alice,place:东京')
    `).run(expId);

    // 5. 检索
    const conditionResults = db.prepare(
      "SELECT * FROM condition_index WHERE condition_key = 'person:alice'"
    ).all() as Array<Record<string, unknown>>;
    expect(conditionResults.length).toBe(1);

    const ftsResults = db.prepare(
      "SELECT * FROM memory_fts WHERE memory_fts MATCH '东京'"
    ).all() as unknown[];
    expect(ftsResults.length).toBeGreaterThanOrEqual(1);

    // 6. 内容补全
    const enriched = enrichResults([{
      id: factId,
      layer: 'L2' as MemoryLayer,
      content: '',
      score: 0.9,
      source_strategy: 'condition',
      metadata: {},
    }]);
    expect(enriched[0].content).toContain('Alice');
    expect(enriched[0].content).toContain('东京');
  });

  it('should complete snapshot → branch → merge cycle', () => {
    const db = getDb();

    // 1. 创建快照
    const snapshotId = generateId();
    db.prepare(`
      INSERT INTO snapshots (id, label, branch, trigger, stats_l1, stats_l2, stats_l3, stats_l4, stats_pages, created_at)
      VALUES (?, 'test-snapshot', 'main', 'manual', 0, 0, 0, 0, 0, ?)
    `).run(snapshotId, now());

    // 2. 创建分支
    const branchName = `dream-${Date.now()}`;
    db.prepare(`
      INSERT INTO branches (name, created_from_snapshot, is_active, created_at)
      VALUES (?, ?, 1, ?)
    `).run(branchName, snapshotId, now());

    // 3. 在分支上工作
    const expId = generateId();
    db.prepare(`
      INSERT INTO experiences (id, raw_content, content_type, source, branch, created_at, updated_at)
      VALUES (?, 'Dream generated insight', 'reflection', 'dream', ?, ?, ?)
    `).run(expId, branchName, now(), now());

    // 4. 验证分支隔离
    const mainCount = (db.prepare(
      "SELECT COUNT(*) as c FROM experiences WHERE branch = 'main'"
    ).get() as { c: number }).c;
    const branchCount = (db.prepare(
      'SELECT COUNT(*) as c FROM experiences WHERE branch = ?'
    ).get(branchName) as { c: number }).c;

    expect(branchCount).toBe(1);

    // 5. 合并分支
    db.prepare(`
      UPDATE experiences SET branch = 'main' WHERE branch = ?
    `).run(branchName);

    const afterMerge = (db.prepare(
      "SELECT COUNT(*) as c FROM experiences WHERE branch = 'main'"
    ).get() as { c: number }).c;
    expect(afterMerge).toBe(mainCount + 1);

    // 6. 停用分支
    db.prepare('UPDATE branches SET is_active = 0 WHERE name = ?').run(branchName);
    const branch = db.prepare('SELECT * FROM branches WHERE name = ?').get(branchName) as Record<string, unknown>;
    expect(branch.is_active).toBe(0);
  });

  it('should track temperature lifecycle', () => {
    const db = getDb();
    const memId = generateId();

    // 初始化温度
    db.prepare(`
      INSERT INTO memory_temperature (memory_id, memory_type, temperature, score, access_count, pinned, compression_level, created_at, updated_at)
      VALUES (?, 'L1', 'hot', 90, 0, 0, 0, ?, ?)
    `).run(memId, now(), now());

    // 模拟访问
    db.prepare(`
      UPDATE memory_temperature SET access_count = access_count + 1, score = MIN(100, score + 5)
      WHERE memory_id = ?
    `).run(memId);

    // 模拟衰减
    db.prepare(`
      UPDATE memory_temperature SET score = MAX(0, score - 10),
        temperature = CASE
          WHEN score - 10 >= 80 THEN 'hot'
          WHEN score - 10 >= 60 THEN 'warm'
          WHEN score - 10 >= 40 THEN 'cool'
          WHEN score - 10 >= 20 THEN 'cold'
          ELSE 'frozen'
        END
      WHERE memory_id = ?
    `).run(memId);

    const row = db.prepare('SELECT * FROM memory_temperature WHERE memory_id = ?').get(memId) as Record<string, unknown>;
    expect(row.access_count).toBe(1);
  });
});
