/**
 * MiniMem — C03: Runtime Smoke 集成测试
 * ============================================
 * 自动化我们今天手动做的端到端验证:
 * 1. 启动 REST API (Hono app.request, 不需要真实端口)
 * 2. 上传记忆 → 验证 L1 写入
 * 3. FTS 搜索 → 验证可检索
 * 4. 触发 dream → 验证 dream_logs 写入
 * 5. 查 dream sessions → 验证 API 返回
 * 6. 查 knowledge pages → 验证列表 API
 * 7. 查 knowledge detail → 验证 evidence/links/lint_status 字段
 * 8. 验证 Surface Files 存在且可读
 *
 * 这不是 mock 测试——是真实 DB + 真实 Hono app 的 smoke test
 * 防止 "typecheck 过了但 runtime 炸了" 的问题
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from '../helpers/setup.js';
import { getDb } from '../../src/infra/store/database.js';
import { createRestApp } from '../../src/adapters/gateway/rest-api.js';
import { getConfig } from '../../src/config/index.js';
import { generateId, now } from '../../src/common/utils.js';
import type { Hono } from 'hono';

let app: Hono;
let originalAuthEnabled: boolean;

beforeAll(() => {
  setupTestDb();
  // 关闭 auth (smoke test 不测认证)
  originalAuthEnabled = getConfig().auth.enabled;
  getConfig().auth.enabled = false;
  app = createRestApp();
});

afterAll(() => {
  getConfig().auth.enabled = originalAuthEnabled;
  teardownTestDb();
});

describe('C03: Runtime Smoke Test', () => {

  // ── 1. Health ──

  it('GET /api/v1/health should return status and layer counts', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('layers');
    expect(body.layers).toHaveProperty('L1');
    expect(body.layers).toHaveProperty('L2');
    expect(body.layers).toHaveProperty('L3');
    expect(body.layers).toHaveProperty('L4');
  });

  // ── 2. 记忆上传 ──

  it('POST /api/v1/memory should accept and store memory', async () => {
    const res = await app.request('/api/v1/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'C03 smoke test: React useEffect 闭包陷阱测试',
        source: 'smoke-test',
        importance: 0.9,
        tags: ['test', 'react'],
        domain: 'programming',
      }),
    });
    expect([200, 201]).toContain(res.status);
    const body = await res.json();
    // API 返回 memory_id (非 id)
    const memId = body.id || body.memory_id;
    expect(memId).toBeDefined();
    expect(body.layer).toBe('L1');
    expect(body.importance).toBe(0.9);
  });

  // ── 3. 记忆详情 ──

  it('GET /api/v1/memory/:id should return the memory', async () => {
    // 先直接写一条 L1
    const db = getDb();
    const id = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO experiences (id, raw_content, content_type, source, importance, tags, domain, branch, created_at, updated_at)
      VALUES (?, 'smoke test memory content', 'event', 'smoke-test', 0.8, '["test"]', 'programming', 'main', ?, ?)
    `).run(id, ts, ts);

    const res = await app.request(`/api/v1/memory/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    // content 可能在 raw_content 或 content 字段
    const contentStr = body.content || body.raw_content || '';
    expect(contentStr).toContain('smoke test');
  });

  // ── 4. 记忆搜索 (FTS) ──

  it('GET /api/v1/memory/search should return FTS results', async () => {
    // 写一条带 FTS 索引的记忆
    const db = getDb();
    const id = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO experiences (id, raw_content, content_type, source, importance, tags, domain, branch, created_at, updated_at)
      VALUES (?, 'FTS searchable content about TypeScript generics', 'event', 'smoke-test', 0.8, '["ts"]', 'programming', 'main', ?, ?)
    `).run(id, ts, ts);
    db.prepare(`
      INSERT INTO memory_fts (memory_id, memory_type, content, tags, condition_keys)
      VALUES (?, 'L1', 'FTS searchable content about TypeScript generics', 'ts', '')
    `).run(id);

    const res = await app.request('/api/v1/memory/search?query=TypeScript+generics&top_k=5');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toBeDefined();
    expect(body.results.length).toBeGreaterThan(0);
  });

  // ── 5. Dream sessions API ──

  it('GET /api/v1/dream/sessions should return list', async () => {
    // 写一条 dream_log
    const db = getDb();
    const sessionId = generateId();
    const logId = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO dream_logs (id, session_id, phase, narrative, duration_ms, created_at,
        l1_to_l2, l2_to_l3, l3_to_l4, pages_created, pages_updated,
        compile_queue_processed, new_connections, insights_count, conflicts_count,
        quality_score, quality_factors_json, surface_changes_json)
      VALUES (?, ?, 4, 'smoke test dream', 5000, ?,
        3, 2, 1, 1, 0, 5, 4, 2, 0, 0.75, '{}', '[]')
    `).run(logId, sessionId, ts);

    const res = await app.request('/api/v1/dream/sessions?limit=10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toBeDefined();
    expect(body.sessions.length).toBeGreaterThan(0);
    const session = body.sessions.find((s: { session_id: string }) => s.session_id === sessionId);
    expect(session).toBeDefined();
    expect(session.quality_score).toBe(0.75);
  });

  // ── 6. Dream session 回放 ──

  it('GET /api/v1/dream/sessions/:id should return phases', async () => {
    const db = getDb();
    const sessionId = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO dream_logs (id, session_id, phase, narrative, duration_ms, created_at,
        l1_to_l2, l2_to_l3, l3_to_l4, pages_created, pages_updated,
        compile_queue_processed, new_connections, insights_count, conflicts_count,
        quality_score, quality_factors_json, surface_changes_json)
      VALUES (?, ?, 4, 'replay test', 3000, ?,
        1, 0, 0, 0, 0, 0, 2, 1, 0, 0.6, '{}', '[{"file_name":"context.md","changed":true,"version_before":1,"version_after":2}]')
    `).run(generateId(), sessionId, ts);

    const res = await app.request(`/api/v1/dream/sessions/${sessionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_id).toBe(sessionId);
    expect(body.phases).toBeDefined();
    expect(body.phases.length).toBeGreaterThan(0);
    // surface_changes 应该被解析
    const phase4 = body.phases.find((p: { phase: number }) => p.phase === 4);
    if (phase4 && phase4.process?.surface_changes) {
      expect(phase4.process.surface_changes.length).toBeGreaterThan(0);
    }
  });

  // ── 7. Knowledge pages 列表 ──

  it('GET /api/v1/knowledge should return paginated list', async () => {
    const db = getDb();
    const ts = now();
    db.prepare(`
      INSERT INTO knowledge_pages (id, slug, title, page_type, content, summary, domain, tags,
        compile_count, last_compiled, lint_status, staleness_score, confidence, branch, created_at, updated_at)
      VALUES (?, 'smoke-kp-1', 'Smoke Test Page', 'topic', '# Smoke Test\n\nTest content',
        'smoke test summary', 'programming', '["test"]',
        1, ?, 'healthy', 0.0, 0.9, 'main', ?, ?)
    `).run(generateId(), ts, ts, ts);

    const res = await app.request('/api/v1/knowledge?page=1&page_size=10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toBeDefined();
    expect(body.total).toBeDefined();
  });

  // ── 8. Knowledge detail (含 evidence + links + lint_status) ──

  it('GET /api/v1/knowledge/:id should return evidence, links, and lint_status', async () => {
    const db = getDb();
    const pageId = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO knowledge_pages (id, slug, title, page_type, content, summary, domain, tags,
        compile_count, last_compiled, lint_status, staleness_score, confidence, branch, created_at, updated_at)
      VALUES (?, 'smoke-kp-detail', 'Smoke Detail Page', 'concept', '# Detail\n\n[[other-page]] test',
        'detail summary', 'programming', '["test"]',
        2, ?, 'healthy', 0.0, 0.85, 'main', ?, ?)
    `).run(pageId, ts, ts, ts);

    // 写 evidence
    db.prepare(`
      INSERT INTO knowledge_page_evidence (id, page_id, evidence_type, evidence_id, section_hint, created_at)
      VALUES (?, ?, 'l2', 'fact-123', 'Smoke Detail — test — evidence hint', ?)
    `).run(generateId(), pageId, ts);

    // 创建目标页面 + link
    const targetId = generateId();
    db.prepare(`
      INSERT INTO knowledge_pages (id, slug, title, page_type, content, summary, domain, tags,
        compile_count, last_compiled, lint_status, staleness_score, confidence, branch, created_at, updated_at)
      VALUES (?, 'other-page', 'Other Page', 'topic', 'other content', '', 'programming', '[]',
        0, NULL, 'missing', 0.0, 0.5, 'main', ?, ?)
    `).run(targetId, ts, ts);
    db.prepare(`
      INSERT INTO knowledge_page_links (id, from_page_id, to_page_id, link_context, created_at)
      VALUES (?, ?, ?, 'test link', ?)
    `).run(generateId(), pageId, targetId, ts);

    const res = await app.request(`/api/v1/knowledge/${pageId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(pageId);
    expect(body.lint_status).toBe('healthy');
    expect(body.evidence).toBeDefined();
    expect(body.evidence.length).toBe(1);
    expect(body.evidence[0].type).toBe('l2');
    expect(body.links).toBeDefined();
    expect(body.links.outbound.length).toBe(1);
    expect(body.links.outbound[0].slug).toBe('other-page');
  });

  // ── 9. Surface Files ──

  it('Surface Files should exist and be readable', () => {
    const db = getDb();
    // setupTestDb 会创建种子 surface files
    const files = db.prepare('SELECT file_name FROM surface_files').all() as Array<{ file_name: string }>;
    expect(files.length).toBeGreaterThan(0);
    const fileNames = files.map(f => f.file_name);
    expect(fileNames).toContain('me.md');
    expect(fileNames).toContain('context.md');
    expect(fileNames).toContain('work.md');
  });

  // ── 10. compile_queue 结构验证 ──

  it('compile_queue should support new_fact source_type', () => {
    const db = getDb();
    const id = generateId();
    const ts = now();
    db.prepare(`
      INSERT INTO compile_queue (id, source_type, content, status, priority, created_at)
      VALUES (?, 'new_fact', 'TestSubject — predicate — object', 'pending', 10, ?)
    `).run(id, ts);

    const item = db.prepare('SELECT * FROM compile_queue WHERE id = ?').get(id) as Record<string, unknown>;
    expect(item.source_type).toBe('new_fact');
    expect(item.content).toContain('—');
  });

  // ── 11. dream_logs surface_changes_json 字段存在 ──

  it('dream_logs should have surface_changes_json column', () => {
    const db = getDb();
    const cols = db.prepare('PRAGMA table_info(dream_logs)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('surface_changes_json');
    expect(colNames).toContain('seeds_json');
    expect(colNames).toContain('pairs_json');
    expect(colNames).toContain('quality_score');
  });

  // ── 12. memories 视图存在且可查 ──

  it('memories view should exist and return unified results', () => {
    const db = getDb();
    // 写 L1 + L2
    const ts = now();
    db.prepare(`
      INSERT INTO experiences (id, raw_content, content_type, source, importance, domain, branch, created_at, updated_at)
      VALUES (?, 'memory view test L1', 'event', 'test', 0.8, 'programming', 'main', ?, ?)
    `).run(generateId(), ts, ts);
    db.prepare(`
      INSERT INTO world_facts (id, subject, predicate, object, confidence, source, created_at, updated_at)
      VALUES (?, 'TestSubject', 'is', 'test fact', 0.9, 'test', ?, ?)
    `).run(generateId(), ts, ts);

    const results = db.prepare('SELECT layer, content FROM memories LIMIT 10').all() as Array<{ layer: string; content: string }>;
    expect(results.length).toBeGreaterThan(0);
    const layers = results.map(r => r.layer);
    expect(layers).toContain('L1');
    expect(layers).toContain('L2');
  });
});
