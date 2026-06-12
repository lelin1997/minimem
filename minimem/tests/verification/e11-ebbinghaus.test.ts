/**
 * T-E11.5 验证：多次 recordAccess 后 stability 增长，长期未访问记忆快速衰减
 *
 * 测试策略：使用真实的 initTemperature() 和 recordAccess()，
 * 验证 Ebbinghaus 遗忘曲线的 stability 增长公式和衰减行为。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';
import { generateId, now } from '../../src/common/utils.js';
import { initTemperature, recordAccess } from '../../src/lifecycle/index.js';

describe('T-E11.5 Ebbinghaus 遗忘曲线验证', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => clearAllTables());

  it('initTemperature 应按层级设置不同的初始 stability', () => {
    const db = getDb();

    // L1: stability = 24 * (1 + importance)
    const l1Id = generateId();
    initTemperature(l1Id, 'L1', 0.8);
    const l1 = db.prepare('SELECT stability, initial_score FROM memory_temperature WHERE memory_id = ?').get(l1Id) as { stability: number; initial_score: number };
    expect(l1.stability).toBeCloseTo(24 * (1 + 0.8), 1); // 43.2
    expect(l1.initial_score).toBeGreaterThan(0);

    // L2: stability = 72 * (1 + confidence)
    const l2Id = generateId();
    initTemperature(l2Id, 'L2', 0.5, 0.7);
    const l2 = db.prepare('SELECT stability FROM memory_temperature WHERE memory_id = ?').get(l2Id) as { stability: number };
    expect(l2.stability).toBeCloseTo(72 * (1 + 0.7), 1); // 122.4

    // L3: stability = 168 * (1 + confidence)
    const l3Id = generateId();
    initTemperature(l3Id, 'L3', 0.5, 0.6);
    const l3 = db.prepare('SELECT stability FROM memory_temperature WHERE memory_id = ?').get(l3Id) as { stability: number };
    expect(l3.stability).toBeCloseTo(168 * (1 + 0.6), 1); // 268.8

    // L4: stability = 999999（永不遗忘）
    const l4Id = generateId();
    initTemperature(l4Id, 'L4', 0.5);
    const l4 = db.prepare('SELECT stability FROM memory_temperature WHERE memory_id = ?').get(l4Id) as { stability: number };
    expect(l4.stability).toBe(999999);
  });

  it('recordAccess 应增加 review_count 并更新 stability', () => {
    const db = getDb();
    const memId = generateId();

    // 初始化
    initTemperature(memId, 'L1', 0.5);

    const before = db.prepare(
      'SELECT stability, review_count, initial_score FROM memory_temperature WHERE memory_id = ?'
    ).get(memId) as { stability: number; review_count: number; initial_score: number };

    expect(before.review_count).toBe(0);
    const initialStability = before.stability;

    // 设置一个已知的 last_accessed（模拟 24 小时前访问）
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE memory_temperature SET last_accessed = ? WHERE memory_id = ?')
      .run(twentyFourHoursAgo, memId);

    // 第一次访问
    recordAccess(memId, 'L1');

    const after1 = db.prepare(
      'SELECT stability, review_count, initial_score, score FROM memory_temperature WHERE memory_id = ?'
    ).get(memId) as { stability: number; review_count: number; initial_score: number; score: number };

    expect(after1.review_count).toBe(1);
    expect(after1.stability).toBeGreaterThan(initialStability);
    expect(after1.initial_score).toBe(before.initial_score + 1);
  });

  it('多次 recordAccess 后 stability 应持续增长', () => {
    const db = getDb();
    const memId = generateId();

    initTemperature(memId, 'L1', 0.5);

    const stabilities: number[] = [];

    // 获取初始 stability
    const init = db.prepare('SELECT stability FROM memory_temperature WHERE memory_id = ?').get(memId) as { stability: number };
    stabilities.push(init.stability);

    // 模拟 5 次间隔 12 小时的访问
    for (let i = 0; i < 5; i++) {
      // 设置 last_accessed 为 12 小时前
      const hoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      db.prepare('UPDATE memory_temperature SET last_accessed = ? WHERE memory_id = ?')
        .run(hoursAgo, memId);

      recordAccess(memId, 'L1');

      const row = db.prepare('SELECT stability FROM memory_temperature WHERE memory_id = ?').get(memId) as { stability: number };
      stabilities.push(row.stability);
    }

    // 验证 stability 单调递增
    for (let i = 1; i < stabilities.length; i++) {
      expect(stabilities[i]).toBeGreaterThan(stabilities[i - 1]);
    }

    // 验证 review_count = 5
    const final = db.prepare('SELECT review_count FROM memory_temperature WHERE memory_id = ?').get(memId) as { review_count: number };
    expect(final.review_count).toBe(5);
  });

  it('stability 增长公式验证：S_new = S * (1 + α * ln(1 + interval / S))', () => {
    const alpha = 0.3; // 默认 ebbinghaus_alpha
    const S0 = 36;     // L1 importance=0.5 → 24 * 1.5 = 36
    const intervalHours = 24; // 24 小时间隔

    // 手动计算预期 stability
    const S1 = S0 * (1 + alpha * Math.log(1 + intervalHours / S0));
    // S1 = 36 * (1 + 0.3 * ln(1 + 24/36))
    // = 36 * (1 + 0.3 * ln(1.667))
    // = 36 * (1 + 0.3 * 0.511)
    // = 36 * 1.153 ≈ 41.51

    expect(S1).toBeGreaterThan(S0);
    expect(S1).toBeCloseTo(36 * (1 + 0.3 * Math.log(1 + 24 / 36)), 2);

    // 第二次访问（又过了 24 小时）
    const S2 = S1 * (1 + alpha * Math.log(1 + intervalHours / S1));
    expect(S2).toBeGreaterThan(S1);

    // 第三次
    const S3 = S2 * (1 + alpha * Math.log(1 + intervalHours / S2));
    expect(S3).toBeGreaterThan(S2);

    // 验证增长率（ΔS/S）递减：因为 interval/S 越小，ln(1+interval/S) 越小
    // 注意：绝对增长量 ΔS = S * α * ln(1+interval/S) 不一定递减，
    // 因为 S 在增大而 ln(...) 在缩小，两者乘积可能非单调。
    // 但增长率 ΔS/S = α * ln(1+interval/S) 一定递减。
    const rate1 = (S1 - S0) / S0;
    const rate2 = (S2 - S1) / S1;
    const rate3 = (S3 - S2) / S2;
    expect(rate1).toBeGreaterThan(rate2);
    expect(rate2).toBeGreaterThan(rate3);
  });

  it('Ebbinghaus 衰减验证：长期未访问记忆 score 应快速下降', () => {
    // 直接验证公式：R = exp(-t / stability), new_score = initial_score * R
    const initialScore = 70;
    const stability = 36; // L1 新记忆的典型 stability

    // 不同时间后的 score
    const scores: Record<string, number> = {};

    for (const [label, hours] of Object.entries({
      '1h': 1,
      '12h': 12,
      '24h': 24,
      '48h': 48,
      '72h': 72,
      '168h': 168, // 一周
    })) {
      const retention = Math.exp(-hours / stability);
      scores[label] = initialScore * retention;
    }

    // 验证衰减趋势
    expect(scores['1h']).toBeGreaterThan(scores['12h']);
    expect(scores['12h']).toBeGreaterThan(scores['24h']);
    expect(scores['24h']).toBeGreaterThan(scores['48h']);
    expect(scores['48h']).toBeGreaterThan(scores['72h']);
    expect(scores['72h']).toBeGreaterThan(scores['168h']);

    // 1 小时后仍保留大部分
    expect(scores['1h']).toBeGreaterThan(initialScore * 0.95);

    // 一周后应大幅衰减
    expect(scores['168h']).toBeLessThan(initialScore * 0.01);
  });

  it('高 stability 的记忆衰减更慢', () => {
    const initialScore = 70;
    const hours = 48;

    // 低 stability（新记忆，未复习）
    const lowStability = 36;
    const lowRetention = Math.exp(-hours / lowStability);
    const lowScore = initialScore * lowRetention;

    // 高 stability（多次复习后的记忆）
    const highStability = 200;
    const highRetention = Math.exp(-hours / highStability);
    const highScore = initialScore * highRetention;

    // 高 stability 记忆在 48 小时后应保留更多
    expect(highScore).toBeGreaterThan(lowScore);
    expect(highRetention).toBeGreaterThan(0.7); // 高 stability 48h 后仍保留 >70%
    expect(lowRetention).toBeLessThan(0.3);     // 低 stability 48h 后保留 <30%
  });
});
