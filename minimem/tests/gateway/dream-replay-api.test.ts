import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/infra/store/database.js';
import { createRestApp } from '../../src/adapters/gateway/rest-api.js';
import { getConfig } from '../../src/config/index.js';
import { generateId } from '../../src/common/utils.js';
import type { Hono } from 'hono';

let app: Hono;
let originalAuthEnabled: boolean;

beforeAll(async () => {
  await setupTestDb();
  // 关闭认证以便测试 REST API（恢复在 afterAll）
  originalAuthEnabled = getConfig().auth.enabled;
  getConfig().auth.enabled = false;
  app = createRestApp();
});

afterAll(async () => {
  getConfig().auth.enabled = originalAuthEnabled;
  await teardownTestDb();
});

beforeEach(() => {
  clearAllTables(getDb());
});

// 对齐 schema.ts dream_logs 实际字段名
function insertDreamLog(overrides: Partial<Record<string, unknown>> = {}) {
  const db = getDb();
  const id = overrides.id as string ?? generateId();
  const sessionId = overrides.session_id as string ?? 'sess-test-1';
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO dream_logs (
      id, session_id, phase, narrative, l1_to_l2, l2_to_l3, l3_to_l4,
      pages_created, pages_updated, compile_queue_processed,
      pre_snapshot_id, post_snapshot_id, duration_ms, created_at,
      seeds_json, pairs_json, llm_output_summary,
      new_connections, insights_count, conflicts_count,
      quality_score, quality_factors_json, surface_changes_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, sessionId, overrides.phase ?? 4,
    overrides.narrative ?? 'test narrative',
    overrides.l1_to_l2 ?? 3, overrides.l2_to_l3 ?? 2, overrides.l3_to_l4 ?? 1,
    overrides.pages_created ?? 5, overrides.pages_updated ?? 2, overrides.compile_queue_processed ?? 7,
    overrides.pre_snapshot_id ?? null, overrides.post_snapshot_id ?? 'snap-1',
    overrides.duration_ms ?? 1500, overrides.created_at ?? now,
    overrides.seeds_json ?? JSON.stringify([{ id: 's1', content: 'seed content' }]),
    overrides.pairs_json ?? JSON.stringify([{ a: 's1', b: 's2' }]),
    overrides.llm_output_summary ?? 'LLM association result',
    overrides.new_connections ?? 4,
    overrides.insights_count ?? 2,
    overrides.conflicts_count ?? 0,
    overrides.quality_score ?? 0.75,
    overrides.quality_factors_json ?? JSON.stringify({ connections: 0.3, output: 0.25 }),
    overrides.surface_changes_json ?? '[]',
  );
  return { id, sessionId };
}

describe('TODO-032: Dream 梦境回放 API', () => {
  describe('GET /api/v1/dream/sessions', () => {
    it('should return empty list when no dream logs', async () => {
      const res = await app.request('/api/v1/dream/sessions');
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.sessions).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('should list dream sessions aggregated by session_id', async () => {
      insertDreamLog({ session_id: 'sess-A', phase: 1, created_at: '2026-06-20T01:00:00Z', quality_score: 0 });
      insertDreamLog({ session_id: 'sess-A', phase: 4, created_at: '2026-06-20T01:05:00Z', quality_score: 0.8 });
      insertDreamLog({ session_id: 'sess-B', phase: 4, created_at: '2026-06-20T02:00:00Z', quality_score: 0.2 });

      const res = await app.request('/api/v1/dream/sessions');
      const body = await res.json();
      expect(body.sessions).toHaveLength(2);
      // 按开始时间倒序，sess-B 在前
      expect(body.sessions[0].session_id).toBe('sess-B');
      expect(body.sessions[1].session_id).toBe('sess-A');

      // 聚合字段
      const sessA = body.sessions.find((s: any) => s.session_id === 'sess-A');
      expect(sessA.max_phase).toBe(4);
      expect(sessA.quality_score).toBe(0.8);
      expect(sessA.quality_grade).toBe('A'); // 0.8 >= 0.8 → A
      expect(sessA.consolidation.l1_to_l2).toBe(6); // 3+3
      expect(sessA.process_stats.new_connections).toBe(8); // 4+4

      // 低质量标记
      const sessB = body.sessions[0];
      expect(sessB.is_low_quality).toBe(true);
      expect(sessB.quality_grade).toBe('F');
    });

    it('should respect limit query param', async () => {
      for (let i = 0; i < 5; i++) {
        insertDreamLog({ session_id: `sess-${i}`, phase: 4 });
      }
      const res = await app.request('/api/v1/dream/sessions?limit=2');
      const body = await res.json();
      expect(body.sessions).toHaveLength(2);
    });
  });

  describe('GET /api/v1/dream/sessions/:sessionId', () => {
    it('should return 404 for non-existent session', async () => {
      const res = await app.request('/api/v1/dream/sessions/nonexistent');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe('NOT_FOUND');
    });

    it('should return full replay with process data (seeds/pairs/llm/insights)', async () => {
      insertDreamLog({
        session_id: 'sess-replay', phase: 1,
        seeds_json: JSON.stringify([{ id: 's1', content: 'seed1' }, { id: 's2', content: 'seed2' }]),
        pairs_json: JSON.stringify([{ a: 's1', b: 's2', reason: 'related' }]),
        new_connections: 0, insights_count: 0,
      });
      insertDreamLog({
        session_id: 'sess-replay', phase: 3,
        llm_output_summary: 'LLM generated new association',
        new_connections: 3, insights_count: 2,
        quality_score: 0.85,
        quality_factors_json: JSON.stringify({ connections: 0.35, output: 0.25, conflict: -0.05, llm: 0.3 }),
      });

      const res = await app.request('/api/v1/dream/sessions/sess-replay');
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.session_id).toBe('sess-replay');
      expect(body.phases).toHaveLength(2);
      // 按 phase 升序
      expect(body.phases[0].phase).toBe(1);
      expect(body.phases[1].phase).toBe(3);

      // phase 1: 种子 + 配对
      const phase1 = body.phases[0];
      expect(phase1.process.seeds).toHaveLength(2);
      expect(phase1.process.pairs).toHaveLength(1);
      expect(phase1.process.pairs[0].reason).toBe('related');

      // phase 3: LLM 联想 + 产出
      const phase3 = body.phases[1];
      expect(phase3.process.llm_output).toBe('LLM generated new association');
      expect(phase3.process.new_connections).toBe(3);
      expect(phase3.process.insights_count).toBe(2);
      expect(phase3.quality.score).toBe(0.85);
      expect(phase3.quality.grade).toBe('A');
    });

    it('should parse surface_changes from phase 2 llm_output_summary', async () => {
      insertDreamLog({
        session_id: 'sess-surf', phase: 2,
        llm_output_summary: JSON.stringify([{ file_name: 'work.md', changed: true, version_after: 3 }]),
      });
      const res = await app.request('/api/v1/dream/sessions/sess-surf');
      const body = await res.json();
      const phase2 = body.phases[0];
      // phase 2 的 llm_output_summary 被解析为 surface_changes
      expect(phase2.process.surface_changes).toHaveLength(1);
      expect(phase2.process.surface_changes[0].file_name).toBe('work.md');
      expect(phase2.process.llm_output).toBe(''); // 已转移到 surface_changes
    });

    it('should parse surface_changes from phase 4 surface_changes_json (TODO-027 fix)', async () => {
      const phase4Changes = [
        { file_name: 'context.md', changed: true, version_before: 2, version_after: 3 },
        { file_name: 'me.md', changed: false, version_before: 1, version_after: 1 },
      ];
      insertDreamLog({
        session_id: 'sess-p4', phase: 4,
        surface_changes_json: JSON.stringify(phase4Changes),
      });
      const res = await app.request('/api/v1/dream/sessions/sess-p4');
      const body = await res.json();
      const phase4 = body.phases[0];
      // phase 4 的 surface_changes 从 surface_changes_json 字段读取
      expect(phase4.process.surface_changes).toHaveLength(2);
      expect(phase4.process.surface_changes[0].file_name).toBe('context.md');
      expect(phase4.process.surface_changes[0].changed).toBe(true);
      expect(phase4.process.surface_changes[1].file_name).toBe('me.md');
      expect(phase4.process.surface_changes[1].changed).toBe(false);
    });

    it('should handle null/zero quality score gracefully', async () => {
      insertDreamLog({
        session_id: 'sess-noq', phase: 1,
        quality_score: 0,
        quality_factors_json: '{}',
      });
      const res = await app.request('/api/v1/dream/sessions/sess-noq');
      const body = await res.json();
      // score=0 视为无质量数据
      expect(body.phases[0].quality).toBeNull();
    });
  });
});
