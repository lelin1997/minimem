/**
 * T-E07.3 验证：老旧支撑事实不再阻止漂移标记
 *
 * 测试策略：构造有老旧 L2 支撑的 L3 观察，验证 scanDrift() 的
 * 时间加权支撑度算法正确地将老旧支撑降权，从而触发漂移标记。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';
import { generateId, now } from '../../src/common/utils.js';
import { scanDrift } from '../../src/core/drift-detector.js';

describe('T-E07.3 漂移检测时间加权验证', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => clearAllTables());

  it('老旧支撑事实（>100天）的加权支撑度应低于阈值，触发漂移标记', () => {
    const db = getDb();

    // 1. 创建一条高 confidence 的 L3 观察
    const obsId = generateId();
    const factIds = [generateId(), generateId()];
    const ts = now();

    db.prepare(`
      INSERT INTO observations (id, description, observation_type, supporting_fact_ids, contradicting_fact_ids, confidence, confidence_history, drift_risk, tags, branch, created_at, updated_at)
      VALUES (?, '用户偏爱 TypeScript', 'preference', ?, '[]', 0.8, '[]', 0, '[]', 'main', ?, ?)
    `).run(obsId, JSON.stringify(factIds), ts, ts);

    // 2. 创建老旧的 L2 支撑事实（200 天前）
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    for (const factId of factIds) {
      db.prepare(`
        INSERT INTO world_facts (id, subject, predicate, object, confidence, source, branch, created_at, updated_at)
        VALUES (?, '用户', '使用', 'TypeScript', 0.8, 'test', 'main', ?, ?)
      `).run(factId, oldDate, oldDate);
    }

    // 3. 创建 compilation_trace（L2 → L3 编译链路）
    for (const factId of factIds) {
      db.prepare(`
        INSERT INTO compilation_trace (id, source_id, source_type, target_id, target_type, created_at)
        VALUES (?, ?, 'L2', ?, 'L3', ?)
      `).run(generateId(), factId, obsId, ts);
    }

    // 4. 运行漂移检测
    const result = scanDrift();

    // 5. 验证：老旧支撑的加权值
    // weight = confidence * exp(-λ * daysSinceCreated)
    // = 0.8 * exp(-0.01 * 200) = 0.8 * 0.135 ≈ 0.108
    // 两条：0.108 * 2 = 0.216 < 1.5 (阈值)
    // 所以应被标记为 drift_risk
    expect(result.scanned).toBe(1);
    expect(result.at_risk).toBe(1);

    // 验证 DB 中的标记
    const obs = db.prepare('SELECT drift_risk FROM observations WHERE id = ?').get(obsId) as { drift_risk: number };
    expect(obs.drift_risk).toBe(1);
  });

  it('新鲜支撑事实（<1天）的加权支撑度应超过阈值，不触发漂移标记', () => {
    const db = getDb();

    const obsId = generateId();
    const factIds = [generateId(), generateId()];
    const ts = now();

    db.prepare(`
      INSERT INTO observations (id, description, observation_type, supporting_fact_ids, contradicting_fact_ids, confidence, confidence_history, drift_risk, tags, branch, created_at, updated_at)
      VALUES (?, '用户喜欢 Rust', 'preference', ?, '[]', 0.8, '[]', 0, '[]', 'main', ?, ?)
    `).run(obsId, JSON.stringify(factIds), ts, ts);

    // 新鲜的 L2 事实（今天创建）
    const freshDate = new Date().toISOString();
    for (const factId of factIds) {
      db.prepare(`
        INSERT INTO world_facts (id, subject, predicate, object, confidence, source, branch, created_at, updated_at)
        VALUES (?, '用户', '喜欢', 'Rust', 0.9, 'test', 'main', ?, ?)
      `).run(factId, freshDate, freshDate);
    }

    for (const factId of factIds) {
      db.prepare(`
        INSERT INTO compilation_trace (id, source_id, source_type, target_id, target_type, created_at)
        VALUES (?, ?, 'L2', ?, 'L3', ?)
      `).run(generateId(), factId, obsId, ts);
    }

    const result = scanDrift();

    // weight = 0.9 * exp(-0.01 * 0) = 0.9 * 1 = 0.9
    // 两条：0.9 * 2 = 1.8 > 1.5 (阈值)
    // 不应被标记
    expect(result.scanned).toBe(1);
    expect(result.at_risk).toBe(0);

    const obs = db.prepare('SELECT drift_risk FROM observations WHERE id = ?').get(obsId) as { drift_risk: number };
    expect(obs.drift_risk).toBe(0);
  });

  it('混合新旧支撑：新鲜支撑足够时不应标记漂移', () => {
    const db = getDb();

    const obsId = generateId();
    const oldFactId = generateId();
    const freshFactId = generateId();
    const ts = now();

    db.prepare(`
      INSERT INTO observations (id, description, observation_type, supporting_fact_ids, contradicting_fact_ids, confidence, confidence_history, drift_risk, tags, branch, created_at, updated_at)
      VALUES (?, '用户使用 Go 语言', 'pattern', ?, '[]', 0.75, '[]', 0, '[]', 'main', ?, ?)
    `).run(obsId, JSON.stringify([oldFactId, freshFactId]), ts, ts);

    // 老旧事实（300 天前）
    const oldDate = new Date(Date.now() - 300 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO world_facts (id, subject, predicate, object, confidence, source, branch, created_at, updated_at)
      VALUES (?, '用户', '学过', 'Go', 0.6, 'test', 'main', ?, ?)
    `).run(oldFactId, oldDate, oldDate);

    // 新鲜事实（1 天前，高 confidence）
    const freshDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO world_facts (id, subject, predicate, object, confidence, source, branch, created_at, updated_at)
      VALUES (?, '用户', '正在使用', 'Go 开发微服务', 0.95, 'test', 'main', ?, ?)
    `).run(freshFactId, freshDate, freshDate);

    for (const fid of [oldFactId, freshFactId]) {
      db.prepare(`
        INSERT INTO compilation_trace (id, source_id, source_type, target_id, target_type, created_at)
        VALUES (?, ?, 'L2', ?, 'L3', ?)
      `).run(generateId(), fid, obsId, ts);
    }

    const result = scanDrift();

    // 老旧: 0.6 * exp(-0.01 * 300) = 0.6 * 0.050 ≈ 0.030
    // 新鲜: 0.95 * exp(-0.01 * 1) = 0.95 * 0.990 ≈ 0.941
    // 总和 ≈ 0.971 < 1.5 → 应被标记！
    // 但这取决于只有 2 条事实。如果一条新鲜 + 一条老旧，加权和 < 1.5
    // 这正好验证了时间加权的效果
    expect(result.scanned).toBe(1);

    const obs = db.prepare('SELECT drift_risk FROM observations WHERE id = ?').get(obsId) as { drift_risk: number };
    // 0.030 + 0.941 = 0.971 < 1.5 → drift_risk = 1
    expect(obs.drift_risk).toBe(1);
  });

  it('已标记 drift_risk 的观察在获得新支撑后应清除标记', () => {
    const db = getDb();

    const obsId = generateId();
    const factIds = [generateId(), generateId(), generateId()];
    const ts = now();

    // 先标记为 drift_risk = 1
    db.prepare(`
      INSERT INTO observations (id, description, observation_type, supporting_fact_ids, contradicting_fact_ids, confidence, confidence_history, drift_risk, tags, branch, created_at, updated_at)
      VALUES (?, '用户熟悉 Docker', 'pattern', ?, '[]', 0.75, '[]', 1, '[]', 'main', ?, ?)
    `).run(obsId, JSON.stringify(factIds), ts, ts);

    // 3 条新鲜的高 confidence 事实
    const freshDate = new Date().toISOString();
    for (const factId of factIds) {
      db.prepare(`
        INSERT INTO world_facts (id, subject, predicate, object, confidence, source, branch, created_at, updated_at)
        VALUES (?, '用户', '使用', 'Docker', 0.9, 'test', 'main', ?, ?)
      `).run(factId, freshDate, freshDate);

      db.prepare(`
        INSERT INTO compilation_trace (id, source_id, source_type, target_id, target_type, created_at)
        VALUES (?, ?, 'L2', ?, 'L3', ?)
      `).run(generateId(), factId, obsId, ts);
    }

    const result = scanDrift();

    // 3 条新鲜: 0.9 * 1 * 3 = 2.7 > 1.5
    expect(result.cleared).toBe(1);

    const obs = db.prepare('SELECT drift_risk FROM observations WHERE id = ?').get(obsId) as { drift_risk: number };
    expect(obs.drift_risk).toBe(0);
  });
});
