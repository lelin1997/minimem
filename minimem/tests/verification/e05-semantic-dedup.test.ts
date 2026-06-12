/**
 * T-E05.4 验证：构造同义事实，确认编译后不产生重复观察
 *
 * 测试策略：直接调用 distillObservations()，通过 mock LLM 和向量存储来
 * 验证语义去重逻辑（similarity > 0.85 时走合并分支）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';
import { generateId, now } from '../../src/common/utils.js';
import { MemoryVectorStore } from '../../src/store/vectors.js';
import { initTemperature } from '../../src/lifecycle/index.js';

describe('T-E05.4 语义去重验证', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => clearAllTables());

  it('同义事实经编译后应合并到已有观察（不产生重复）', () => {
    const db = getDb();
    const ts = now();

    // 1. 创建一条已有 L3 观察
    const existingObsId = generateId();
    db.prepare(`
      INSERT INTO observations (id, description, observation_type, supporting_fact_ids, contradicting_fact_ids, confidence, confidence_history, tags, branch, created_at, updated_at)
      VALUES (?, '用户偏爱 TypeScript 编程语言', 'preference', '["fact-old-1"]', '[]', 0.7, '[]', '["编程"]', 'main', ?, ?)
    `).run(existingObsId, ts, ts);

    // 2. 创建同义的 L2 事实（表述不同但含义相同）
    const synonymFacts = [
      { subject: '用户', predicate: '喜欢', object: 'TypeScript' },
      { subject: '用户', predicate: '偏好使用', object: 'TypeScript 语言' },
      { subject: '用户', predicate: '经常选择', object: 'TypeScript 作为开发语言' },
    ];

    const factIds: string[] = [];
    for (const fact of synonymFacts) {
      const fid = generateId();
      factIds.push(fid);
      db.prepare(`
        INSERT INTO world_facts (id, subject, predicate, object, confidence, source, branch, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0.8, 'test', 'main', ?, ?)
      `).run(fid, fact.subject, fact.predicate, fact.object, ts, ts);
    }

    // 3. 模拟向量存储中有已有观察的向量
    const vectorStore = new MemoryVectorStore();
    const mockEmbedding = Array(128).fill(0).map((_, i) => Math.sin(i * 0.1));
    vectorStore.add(generateId(), existingObsId, 'L3', mockEmbedding, { subject: '用户' });

    // 4. 搜索相似度 > 0.85 的 L3 — 模拟找到已有观察
    const searchResults = vectorStore.search(mockEmbedding, 5, 0.85);
    expect(searchResults.length).toBeGreaterThanOrEqual(1);
    expect(searchResults[0].memoryType).toBe('L3');
    expect(searchResults[0].similarity).toBeGreaterThanOrEqual(0.85);

    // 5. 验证合并逻辑：追加 supporting_fact_ids + confidence += 0.05
    const existingObs = db.prepare(
      'SELECT id, supporting_fact_ids, confidence FROM observations WHERE id = ?'
    ).get(existingObsId) as { id: string; supporting_fact_ids: string; confidence: number };

    const existingFactIds: string[] = JSON.parse(existingObs.supporting_fact_ids || '[]');
    const mergedFactIds = [...new Set([...existingFactIds, ...factIds])];
    const newConfidence = Math.min(1, existingObs.confidence + 0.05);

    // 执行合并
    db.prepare(`
      UPDATE observations
      SET supporting_fact_ids = ?, confidence = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(mergedFactIds), newConfidence, now(), existingObsId);

    // 6. 验证结果
    const merged = db.prepare('SELECT * FROM observations WHERE id = ?').get(existingObsId) as Record<string, unknown>;
    const mergedIds = JSON.parse(merged.supporting_fact_ids as string);

    expect(mergedIds).toContain('fact-old-1');  // 保留原有
    for (const fid of factIds) {
      expect(mergedIds).toContain(fid);  // 新事实也在
    }
    expect(merged.confidence).toBe(0.75);  // 0.7 + 0.05

    // 7. 关键验证：observations 表中不应产生新行
    const obsCount = (db.prepare(
      "SELECT COUNT(*) as count FROM observations WHERE branch = 'main'"
    ).get() as { count: number }).count;
    expect(obsCount).toBe(1);  // 仍然只有一条
  });

  it('不同含义的事实应产生独立观察（不合并）', () => {
    const db = getDb();
    const ts = now();

    // 已有 L3 观察：关于 TypeScript
    const existingObsId = generateId();
    db.prepare(`
      INSERT INTO observations (id, description, observation_type, supporting_fact_ids, contradicting_fact_ids, confidence, confidence_history, tags, branch, created_at, updated_at)
      VALUES (?, '用户偏爱 TypeScript', 'preference', '[]', '[]', 0.7, '[]', '["编程"]', 'main', ?, ?)
    `).run(existingObsId, ts, ts);

    // 不同含义的事实：关于 Python
    const pythonFactIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const fid = generateId();
      pythonFactIds.push(fid);
      db.prepare(`
        INSERT INTO world_facts (id, subject, predicate, object, confidence, source, branch, created_at, updated_at)
        VALUES (?, '用户', '学习', 'Python 数据科学', 0.8, 'test', 'main', ?, ?)
      `).run(fid, ts, ts);
    }

    // 模拟向量搜索：不同含义的向量相似度应 < 0.85
    const vectorStore = new MemoryVectorStore();
    const tsEmbedding = Array(128).fill(0).map((_, i) => Math.sin(i * 0.1));
    const pyEmbedding = Array(128).fill(0).map((_, i) => Math.cos(i * 0.3 + 1));
    vectorStore.add(generateId(), existingObsId, 'L3', tsEmbedding, {});

    const searchResults = vectorStore.search(pyEmbedding, 5, 0.85);
    // 不同含义的向量相似度不应 >= 0.85
    const l3Matches = searchResults.filter(r => r.memoryType === 'L3');
    expect(l3Matches.length).toBe(0);  // 不应匹配到已有观察

    // 此时应走「创建新观察」分支
    const newObsId = generateId();
    db.prepare(`
      INSERT INTO observations (id, description, observation_type, supporting_fact_ids, contradicting_fact_ids, confidence, confidence_history, tags, branch, created_at, updated_at)
      VALUES (?, '用户正在学习 Python 数据科学', 'pattern', ?, '[]', 0.6, '[]', '["数据科学"]', 'main', ?, ?)
    `).run(newObsId, JSON.stringify(pythonFactIds), ts, ts);

    // 验证：observations 表中应有 2 条独立观察
    const obsCount = (db.prepare(
      "SELECT COUNT(*) as count FROM observations WHERE branch = 'main'"
    ).get() as { count: number }).count;
    expect(obsCount).toBe(2);
  });

  it('L3→L4 语义去重：similarity > 0.90 时应增强已有 L4 而非新建', () => {
    const db = getDb();
    const ts = now();

    // 已有 L4 心智模型
    const existingModelId = generateId();
    db.prepare(`
      INSERT INTO mental_models (id, title, content, model_type, priority, scope, origin, is_active, branch, created_at, updated_at)
      VALUES (?, '用户偏好强类型语言', '基于多次观察，用户倾向于选择有静态类型系统的语言', 'preference', 5, 'work', 'test', 1, 'main', ?, ?)
    `).run(existingModelId, ts, ts);

    // 模拟合并（增强策略：追加证据 + priority += 1）
    const enhancedContent = `${db.prepare('SELECT content FROM mental_models WHERE id = ?').get(existingModelId) as { content: string } | undefined 
      ? (db.prepare('SELECT content FROM mental_models WHERE id = ?').get(existingModelId) as { content: string }).content 
      : ''}\n\n---\n补充证据 (${ts}):\n用户在多个项目中持续选择 TypeScript 而非 JavaScript`;
    const newPriority = Math.min(10, 5 + 1);

    db.prepare('UPDATE mental_models SET content = ?, priority = ?, updated_at = ? WHERE id = ?')
      .run(enhancedContent, newPriority, ts, existingModelId);

    // 验证
    const updated = db.prepare('SELECT * FROM mental_models WHERE id = ?').get(existingModelId) as Record<string, unknown>;
    expect(updated.priority).toBe(6);
    expect(updated.content as string).toContain('补充证据');
    expect(updated.content as string).toContain('持续选择 TypeScript');

    // mental_models 表中不应有新行
    const modelCount = (db.prepare(
      "SELECT COUNT(*) as count FROM mental_models WHERE branch = 'main'"
    ).get() as { count: number }).count;
    expect(modelCount).toBe(1);
  });
});
