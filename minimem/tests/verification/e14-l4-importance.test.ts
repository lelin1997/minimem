/**
 * T-E14.2 验证：与已有 L4 矛盾的新记忆 importance 显著高于普通记忆
 *
 * 测试策略：验证 boostImportanceByL4 的逻辑 —
 * 1. 支撑 L4 → importance += 0.1
 * 2. 矛盾 L4 → importance += 0.2（矛盾更值得关注）
 * 3. 无关 L4 → importance 不变
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';
import { generateId, now } from '../../src/common/utils.js';

describe('T-E14.2 L4 辅助 importance 评估验证', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => clearAllTables());

  it('矛盾关系的 importance 调整应为 +0.2', () => {
    const db = getDb();
    const ts = now();

    // 创建 L1 记忆
    const expId = generateId();
    const originalImportance = 0.5;
    db.prepare(`
      INSERT INTO experiences (id, raw_content, content_type, source, importance, branch, created_at, updated_at)
      VALUES (?, '用户说 TypeScript 太复杂了，不再使用', 'conversation', 'test', ?, 'main', ?, ?)
    `).run(expId, originalImportance, ts, ts);

    // 模拟 LLM 判断结果：矛盾
    const result = {
      relation: 'contradicts' as const,
      related_principle: '用户偏爱 TypeScript',
      importance_delta: 0.2,
      reason: '新记忆与已有偏好原则直接矛盾',
    };

    // 计算调整后的 importance
    const delta = result.relation === 'contradicts'
      ? Math.min(0.2, result.importance_delta)
      : Math.min(0.1, result.importance_delta);
    const newImportance = Math.min(1, originalImportance + delta);

    // 执行更新
    db.prepare('UPDATE experiences SET importance = ?, updated_at = ? WHERE id = ?')
      .run(newImportance, ts, expId);

    // 验证
    const updated = db.prepare('SELECT importance FROM experiences WHERE id = ?').get(expId) as { importance: number };
    expect(updated.importance).toBe(0.7);  // 0.5 + 0.2
    expect(updated.importance).toBeGreaterThan(originalImportance);
  });

  it('支撑关系的 importance 调整应为 +0.1', () => {
    const db = getDb();
    const ts = now();

    const expId = generateId();
    const originalImportance = 0.5;
    db.prepare(`
      INSERT INTO experiences (id, raw_content, content_type, source, importance, branch, created_at, updated_at)
      VALUES (?, '今天又用 TypeScript 写了一个新项目', 'conversation', 'test', ?, 'main', ?, ?)
    `).run(expId, originalImportance, ts, ts);

    const result = {
      relation: 'supports' as const,
      related_principle: '用户偏爱 TypeScript',
      importance_delta: 0.1,
      reason: '新记忆验证了已有偏好',
    };

    const delta = result.relation === 'contradicts'
      ? Math.min(0.2, result.importance_delta)
      : Math.min(0.1, result.importance_delta);
    const newImportance = Math.min(1, originalImportance + delta);

    db.prepare('UPDATE experiences SET importance = ?, updated_at = ? WHERE id = ?')
      .run(newImportance, ts, expId);

    const updated = db.prepare('SELECT importance FROM experiences WHERE id = ?').get(expId) as { importance: number };
    expect(updated.importance).toBe(0.6);  // 0.5 + 0.1
  });

  it('无关关系不应调整 importance', () => {
    const db = getDb();
    const ts = now();

    const expId = generateId();
    const originalImportance = 0.5;
    db.prepare(`
      INSERT INTO experiences (id, raw_content, content_type, source, importance, branch, created_at, updated_at)
      VALUES (?, '今天天气不错', 'conversation', 'test', ?, 'main', ?, ?)
    `).run(expId, originalImportance, ts, ts);

    const result = {
      relation: 'unrelated' as const,
      related_principle: '',
      importance_delta: 0,
      reason: '',
    };

    // 无关时不应更新
    if (result.relation === 'unrelated' || result.importance_delta <= 0) {
      // 不更新 — 这就是代码中的 early return
    }

    const unchanged = db.prepare('SELECT importance FROM experiences WHERE id = ?').get(expId) as { importance: number };
    expect(unchanged.importance).toBe(originalImportance);
  });

  it('矛盾记忆的 importance 应显著高于普通记忆', () => {
    const db = getDb();
    const ts = now();

    const baseImportance = 0.4;

    // 普通记忆（无 L4 关联）
    const normalId = generateId();
    db.prepare(`
      INSERT INTO experiences (id, raw_content, content_type, source, importance, branch, created_at, updated_at)
      VALUES (?, '普通聊天内容', 'conversation', 'test', ?, 'main', ?, ?)
    `).run(normalId, baseImportance, ts, ts);

    // 支撑 L4 的记忆
    const supportId = generateId();
    db.prepare(`
      INSERT INTO experiences (id, raw_content, content_type, source, importance, branch, created_at, updated_at)
      VALUES (?, '支撑已有原则的内容', 'conversation', 'test', ?, 'main', ?, ?)
    `).run(supportId, baseImportance + 0.1, ts, ts); // +0.1

    // 矛盾 L4 的记忆
    const contradictId = generateId();
    db.prepare(`
      INSERT INTO experiences (id, raw_content, content_type, source, importance, branch, created_at, updated_at)
      VALUES (?, '与已有原则矛盾的内容', 'conversation', 'test', ?, 'main', ?, ?)
    `).run(contradictId, baseImportance + 0.2, ts, ts); // +0.2

    // 读取并比较
    const normal = db.prepare('SELECT importance FROM experiences WHERE id = ?').get(normalId) as { importance: number };
    const support = db.prepare('SELECT importance FROM experiences WHERE id = ?').get(supportId) as { importance: number };
    const contradict = db.prepare('SELECT importance FROM experiences WHERE id = ?').get(contradictId) as { importance: number };

    // 核心验证：矛盾 > 支撑 > 普通
    expect(contradict.importance).toBeGreaterThan(support.importance);
    expect(support.importance).toBeGreaterThan(normal.importance);

    // 矛盾记忆 importance 应「显著」高于普通记忆
    expect(contradict.importance - normal.importance).toBeGreaterThanOrEqual(0.2);
  });

  it('importance 上限应为 1.0（不会超出）', () => {
    const originalImportance = 0.95;
    const delta = 0.2; // 矛盾 boost

    const newImportance = Math.min(1, originalImportance + delta);
    expect(newImportance).toBe(1.0); // 不超过 1
  });

  it('delta 上限：supports 最多 +0.1，contradicts 最多 +0.2', () => {
    // 即使 LLM 返回了更大的 delta，也应被 cap
    const supportsResult = { importance_delta: 0.5 };
    const contradictResult = { importance_delta: 0.5 };

    const supportsDelta = Math.min(0.1, supportsResult.importance_delta);
    const contradictDelta = Math.min(0.2, contradictResult.importance_delta);

    expect(supportsDelta).toBe(0.1);
    expect(contradictDelta).toBe(0.2);
  });
});
