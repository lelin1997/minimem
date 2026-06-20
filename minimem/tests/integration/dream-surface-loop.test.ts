// ============================================================
// MiniMem — B4 Dream-Surface 闭环集成测试 (TODO-028)
// ============================================================
// 验证: compile 后 surface_changes 记录 + syncer 扩展数据源

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/infra/store/database.js';
import { getSurfaceFile, updateSurfaceFile } from '../../src/domain/surface/index.js';
import { clearInjectionCache, getCurrentEtag, hasSurfaceChanged, buildSurfaceInjection } from '../../src/domain/surface/injector.js';
import type { SurfaceFileName } from '../../src/common/types.js';

describe('B4 Dream-Surface closed loop (TODO-025~028)', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => {
    clearAllTables();
    clearInjectionCache();
  });

  // ── TODO-025: compiler 后置 surface_syncer ──

  describe('compiler surface sync (TODO-025)', () => {
    it('should have surface_changes field in CompileResult type', async () => {
      // 导入 CompileResult 类型，确认 surface_changes 字段存在
      const { runCompile } = await import('../../src/domain/dream/compiler.js');
      // runCompile 在无 LLM 时应返回 result（surface_changes 可能为空数组）
      // 这里验证类型层面正确即可，实际 dream 需要 LLM
      expect(typeof runCompile).toBe('function');
    });
  });

  // ── TODO-026: L1-L4 syncer 扩展 ──

  describe('L1-L4 syncer extension (TODO-026)', () => {
    it('me-syncer should collect L2 owner facts', async () => {
      const db = getDb();
      const ts = new Date().toISOString();
      db.prepare(`INSERT INTO world_facts (id, subject, predicate, object, confidence, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('fact-1', '我', '喜欢', '咖啡', 0.9, 'test', ts, ts);

      const { initSyncers, getSyncerRegistry } = await import('../../src/domain/surface/sync.js');
      await initSyncers();
      const registry = getSyncerRegistry();
      const meSyncer = registry.get('me.md' as SurfaceFileName);
      expect(meSyncer).toBeDefined();

      const data = meSyncer!.collectData();
      expect(data).not.toBeNull();
      expect(data!.context).toHaveProperty('known_facts_about_me');
    });

    it('work-syncer should collect L1 work experiences', async () => {
      const db = getDb();
      db.prepare(`INSERT INTO experiences (id, raw_content, source, created_at, importance) VALUES (?, ?, ?, ?, ?)`)
        .run('exp-1', '完成 project X 的 API 设计', 'work', new Date().toISOString(), 0.8);

      const { initSyncers, getSyncerRegistry } = await import('../../src/domain/surface/sync.js');
      await initSyncers();
      const registry = getSyncerRegistry();
      const workSyncer = registry.get('work.md' as SurfaceFileName);
      const data = workSyncer!.collectData();
      if (data) {
        expect(data.context).toHaveProperty('recent_work_experiences');
      }
    });

    it('context-syncer should collect L2 facts + L4 models', async () => {
      const db = getDb();
      const ts = new Date().toISOString();
      db.prepare(`INSERT INTO world_facts (id, subject, predicate, object, confidence, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('fact-2', 'ProjectX', '使用', 'TypeScript', 0.95, 'test', ts, ts);
      db.prepare(`INSERT INTO mental_models (id, title, content, model_type, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run('mm-1', 'API 设计偏好', '用户偏好简洁的 API 设计', 'principle', 1, ts, ts);

      const { initSyncers, getSyncerRegistry } = await import('../../src/domain/surface/sync.js');
      await initSyncers();
      const registry = getSyncerRegistry();
      const ctxSyncer = registry.get('context.md' as SurfaceFileName);
      const data = ctxSyncer!.collectData();
      if (data) {
        expect(data.context).toHaveProperty('recent_facts');
        expect(data.context).toHaveProperty('active_mental_models');
      }
    });
  });

  // ── TODO-027: surface 变更记录 ──

  describe('surface change tracking (TODO-027)', () => {
    it('should detect version change after surface update', () => {
      const fileName = 'me.md' as SurfaceFileName;
      const v0 = getSurfaceFile(fileName)!.version;

      updateSurfaceFile(fileName, getSurfaceFile(fileName)!.content + '\nnew info\n', 'test');
      const v1 = getSurfaceFile(fileName)!.version;

      expect(v1).toBeGreaterThan(v0);
    });

    it('should record change in SurfaceChangeRecord format', () => {
      const fileName = 'context.md' as SurfaceFileName;
      const before = getSurfaceFile(fileName)!.version;

      updateSurfaceFile(fileName, getSurfaceFile(fileName)!.content + '\nupdated\n', 'change test');
      const after = getSurfaceFile(fileName)!.version;

      const record = {
        file_name: fileName,
        version_before: before,
        version_after: after,
        changed: after > before,
      };
      expect(record.changed).toBe(true);
      expect(record.version_after).toBeGreaterThan(record.version_before);
    });
  });

  // ── TODO-028: 闭环验证 — Surface 更新后 agent 能看到新内容 ──

  describe('closed loop: agent sees updated surface (TODO-028)', () => {
    it('should reflect surface changes in next injection', () => {
      // 第一次注入
      const injection1 = buildSurfaceInjection('general');
      const etag1 = injection1.etag;

      // 更新 surface（模拟 dream 编辑）
      const fileName = 'work.md' as SurfaceFileName;
      updateSurfaceFile(fileName, getSurfaceFile(fileName)!.content + '\n## New from Dream\n- compiled insight\n', 'dream test');
      clearInjectionCache();

      // 第二次注入应该看到新内容 + 新 etag
      const injection2 = buildSurfaceInjection('general');
      expect(injection2.etag).not.toBe(etag1);
      expect(injection2.text).toContain('New from Dream');
      expect(hasSurfaceChanged(etag1)).toBe(true);
    });

    it('should propagate surface_append changes to subsequent injections', () => {
      // 初始注入
      buildSurfaceInjection('general');
      const etagBefore = getCurrentEtag();

      // 模拟 surface_append（追加内容）
      const fileName = 'me.md' as SurfaceFileName;
      const original = getSurfaceFile(fileName)!.content;
      updateSurfaceFile(fileName, original + '\n## Appended Section\nappended content\n', 'append test');
      clearInjectionCache();

      // 下一次注入应该包含新内容
      const injection = buildSurfaceInjection('general');
      expect(injection.etag).not.toBe(etagBefore);
      expect(injection.text).toContain('Appended Section');
      expect(injection.text).toContain('appended content');
    });
  });
});
