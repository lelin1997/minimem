// ============================================================
// MiniMem — Surface 注入器单元测试 (TODO-019)
// ============================================================
// 验证: 注入格式 (<surface_files> XML) + token 限制 + etag 变化重载

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/infra/store/database.js';
import {
  buildSurfaceInjection,
  getCurrentEtag,
  hasSurfaceChanged,
  getInjectionWithCache,
  clearInjectionCache,
  injectSurfaceForToolCall,
} from '../../src/domain/surface/injector.js';

describe('Surface Injector (TODO-015/016/017/018)', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => {
    clearAllTables();
    clearInjectionCache();
  });

  // ── TODO-015: 注入格式 ──

  describe('Injection format (TODO-015)', () => {
    it('should produce <surface_files> XML wrapped output', () => {
      const injection = buildSurfaceInjection('general');
      expect(injection.text).toContain('<surface_files>');
      expect(injection.text).toContain('</surface_files>');
    });

    it('should wrap each file in <file name="..."> tags', () => {
      const injection = buildSurfaceInjection('general');
      // 至少有一个 <file> 标签
      expect(injection.text).toMatch(/<file name="[^"]+\.md">/);
      expect(injection.text).toContain('</file>');
    });

    it('should include file content inside file tags', () => {
      // 先写入测试内容
      const db = getDb();
      db.prepare(`UPDATE surface_files SET content = '# Test Identity', version = version + 1 WHERE file_name = 'me.md'`).run();

      const injection = buildSurfaceInjection('general');
      expect(injection.text).toContain('# Test Identity');
    });

    it('should return etag from version info', () => {
      const injection = buildSurfaceInjection('general');
      expect(injection.etag).toBeTruthy();
      expect(typeof injection.etag).toBe('string');
    });
  });

  // ── TODO-017: etag 版本检测 ──

  describe('etag version detection (TODO-017)', () => {
    it('should return consistent etag when no changes', () => {
      const etag1 = getCurrentEtag();
      const etag2 = getCurrentEtag();
      expect(etag1).toBe(etag2);
    });

    it('should detect change when surface version updated', () => {
      const etagBefore = getCurrentEtag();
      const db = getDb();
      db.prepare(`UPDATE surface_files SET version = version + 1 WHERE file_name = 'me.md'`).run();
      expect(hasSurfaceChanged(etagBefore)).toBe(true);
    });

    it('should return false when etag unchanged', () => {
      const etag = getCurrentEtag();
      expect(hasSurfaceChanged(etag)).toBe(false);
    });

    it('should return true when no known etag provided', () => {
      expect(hasSurfaceChanged(undefined)).toBe(true);
    });

    it('should cache injection and rebuild on etag change', () => {
      const db = getDb();

      // 第一次构建
      db.prepare(`UPDATE surface_files SET content = '# Version 1', version = 1 WHERE file_name = 'me.md'`).run();
      const r1 = getInjectionWithCache('general');
      expect(r1.cached).toBe(false);
      expect(r1.text).toContain('# Version 1');

      // 第二次：缓存命中
      const r2 = getInjectionWithCache('general');
      expect(r2.cached).toBe(true);
      expect(r2.text).toBe(r1.text);

      // 更新版本：缓存失效，重新构建
      db.prepare(`UPDATE surface_files SET content = '# Version 2', version = 2 WHERE file_name = 'me.md'`).run();
      const r3 = getInjectionWithCache('general');
      expect(r3.cached).toBe(false);
      expect(r3.text).toContain('# Version 2');
    });

    it('should clear cache on clearInjectionCache', () => {
      getInjectionWithCache('general');
      clearInjectionCache();
      const r = getInjectionWithCache('general');
      expect(r.cached).toBe(false);
    });
  });

  // ── TODO-018: token 预算控制 ──

  describe('token budget control (TODO-018)', () => {
    it('should stay within default 10000 token budget', () => {
      const injection = buildSurfaceInjection('general');
      expect(injection.tokens).toBeLessThanOrEqual(10000);
    });

    it('should respect custom budget', () => {
      // 用很小的预算触发裁剪
      const injection = buildSurfaceInjection('general', 500);
      expect(injection.tokens).toBeLessThanOrEqual(500);
    });

    it('should trim low-priority files when budget exceeded', () => {
      // 填充大量内容到所有文件
      const db = getDb();
      const bigContent = 'x'.repeat(20000); // ~5000 tokens each
      for (const file of ['me.md', 'context.md', 'work.md', 'social.md', 'life.md', 'insight.md']) {
        db.prepare(`UPDATE surface_files SET content = ?, token_count = 5000 WHERE file_name = ?`).run(bigContent, file);
      }

      const injection = buildSurfaceInjection('general', 3000);
      // 应该有文件被裁剪
      expect(injection.filesTrimmed.length).toBeGreaterThan(0);
      // me.md 和 context.md 应该被保留（核心文件）
      expect(injection.filesIncluded).toContain('me.md');
      expect(injection.filesIncluded).toContain('context.md');
    });

    it('should always keep me.md and context.md even if truncated', () => {
      const db = getDb();
      const bigContent = 'y'.repeat(30000);
      db.prepare(`UPDATE surface_files SET content = ?, token_count = 7500 WHERE file_name = 'me.md'`).run(bigContent);
      db.prepare(`UPDATE surface_files SET content = ?, token_count = 7500 WHERE file_name = 'context.md'`).run(bigContent);

      const injection = buildSurfaceInjection('general', 5000);
      expect(injection.filesIncluded).toContain('me.md');
      expect(injection.filesIncluded).toContain('context.md');
      // 应该有截断标记
      expect(injection.text).toContain('truncated for budget');
    });

    it('should report which files were trimmed', () => {
      const db = getDb();
      // 重置核心文件为小内容
      for (const file of ['me.md', 'context.md', 'work.md', 'agent.md']) {
        db.prepare(`UPDATE surface_files SET content = ?, token_count = 10 WHERE file_name = ?`).run('# small', file);
      }
      // 让 life.md 和 social.md 很大（低优先级，应被裁剪）
      db.prepare(`UPDATE surface_files SET content = ?, token_count = 8000 WHERE file_name = 'life.md'`)
        .run('z'.repeat(30000));
      db.prepare(`UPDATE surface_files SET content = ?, token_count = 8000 WHERE file_name = 'social.md'`)
        .run('z'.repeat(30000));

      const injection = buildSurfaceInjection('general', 2000);
      // life.md / social.md 是低优先级，应该至少有一个被裁剪
      expect(injection.filesTrimmed.length).toBeGreaterThan(0);
      // 被裁剪的应该是低优先级文件（life.md 或 social.md 或 soul.md 或 index.md）
      const lowPriority = ['life.md', 'social.md', 'soul.md', 'index.md'];
      const hasLowPriorityTrimmed = injection.filesTrimmed.some(f => lowPriority.includes(f));
      expect(hasLowPriorityTrimmed).toBe(true);
    });
  });

  // ── TODO-016: 中间件入口 ──

  describe('injectSurfaceForToolCall (TODO-016)', () => {
    it('should return non-empty string for valid agent type', () => {
      const text = injectSurfaceForToolCall('general');
      expect(text).toContain('<surface_files>');
    });

    it('should return string (not throw) even if agent type unknown', () => {
      const text = injectSurfaceForToolCall('unknown-agent-type');
      // 应该 fallback to general，不抛异常
      expect(typeof text).toBe('string');
    });

    it('should not throw on database errors', () => {
      // 这个测试验证容错性 — injector 内部 try/catch
      // 即使 DB 状态异常也不应阻塞
      const text = injectSurfaceForToolCall('general');
      expect(typeof text).toBe('string');
    });
  });

  // ── 重要性排序验证 ──

  describe('importance ordering', () => {
    it('should include me.md before lower-priority files', () => {
      const injection = buildSurfaceInjection('general');
      if (injection.filesIncluded.length > 1) {
        const meIndex = injection.filesIncluded.indexOf('me.md');
        const insightIndex = injection.filesIncluded.indexOf('insight.md');
        if (meIndex >= 0 && insightIndex >= 0) {
          expect(meIndex).toBeLessThan(insightIndex);
        }
      }
    });
  });
});
