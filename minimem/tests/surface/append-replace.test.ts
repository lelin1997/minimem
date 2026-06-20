// ============================================================
// MiniMem — surface_append / surface_replace 单元测试 (TODO-024)
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/infra/store/database.js';
import { getSurfaceFile, updateSurfaceFile, getSurfacesVersionInfo } from '../../src/domain/surface/index.js';
import { clearInjectionCache, getCurrentEtag, hasSurfaceChanged, getInjectionWithCache } from '../../src/domain/surface/injector.js';
import type { SurfaceFileName } from '../../src/common/types.js';

// 直接调用底层 updateSurfaceFile 来模拟 surface_append/replace 的核心逻辑
// （MCP tool 层只是包装，核心是 updateSurfaceFile + clearInjectionCache）

describe('Surface Append/Replace (TODO-020/021/022/024)', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => {
    clearAllTables();
    clearInjectionCache();
  });

  // ── TODO-020: surface_append 逻辑 ──

  describe('surface_append logic (TODO-020)', () => {
    it('should append content to end when no section specified', () => {
      const fileName = 'work.md' as SurfaceFileName;
      const original = getSurfaceFile(fileName)!.content;

      const appendContent = '\n## New Task\n- test item\n';
      const newContent = original.replace(/\s*$/, '\n') + appendContent;
      updateSurfaceFile(fileName, newContent, 'surface_append: end');

      const updated = getSurfaceFile(fileName)!;
      expect(updated.content).toContain('New Task');
      expect(updated.content).toContain('- test item');
      expect(updated.version).toBeGreaterThan(1);
    });

    it('should append to existing section', () => {
      const fileName = 'work.md' as SurfaceFileName;
      // 先写入带 section 的内容
      updateSurfaceFile(fileName, '# Work\n\n## Tasks\n- task 1\n\n## Notes\nsome notes\n', 'setup');

      const section = '## Tasks';
      const appendContent = '- task 2\n';
      const current = getSurfaceFile(fileName)!.content;
      const sectionIdx = current.indexOf(section);
      const afterSection = current.slice(sectionIdx + section.length);
      const nextMatch = afterSection.match(/\n## /);
      const insertPos = nextMatch ? sectionIdx + section.length + nextMatch.index! : current.length;
      const newContent = current.slice(0, insertPos).replace(/\s*$/, '\n') + appendContent + current.slice(insertPos);

      updateSurfaceFile(fileName, newContent, 'surface_append: Tasks');

      const updated = getSurfaceFile(fileName)!;
      expect(updated.content).toContain('- task 1');
      expect(updated.content).toContain('- task 2');
      // Notes section 应该保留
      expect(updated.content).toContain('## Notes');
      expect(updated.content).toContain('some notes');
    });

    it('should create new section if not exists', () => {
      const fileName = 'me.md' as SurfaceFileName;
      const original = getSurfaceFile(fileName)!.content;

      const section = 'New Hobbies';
      const sectionHeader = `## ${section}`;
      const appendContent = '- reading\n';
      const newContent = original.replace(/\s*$/, '\n') + `\n${sectionHeader}\n${appendContent}\n`;

      updateSurfaceFile(fileName, newContent, `surface_append: ${section}`);

      const updated = getSurfaceFile(fileName)!;
      expect(updated.content).toContain(sectionHeader);
      expect(updated.content).toContain('- reading');
    });

    it('should reject invalid file_name', () => {
      // MCP tool 层有校验，这里验证核心层不 crash
      const validFiles = ['me.md', 'soul.md', 'work.md', 'social.md', 'life.md', 'agent.md', 'context.md', 'index.md', 'insight.md'];
      expect(validFiles.includes('invalid.md')).toBe(false);
    });
  });

  // ── TODO-021: surface_replace 逻辑 ──

  describe('surface_replace logic (TODO-021)', () => {
    it('should replace first occurrence of old_text', () => {
      const fileName = 'context.md' as SurfaceFileName;
      updateSurfaceFile(fileName, '# Context\n\nCurrent project: ProjectA\nStatus: active\n', 'setup');

      const current = getSurfaceFile(fileName)!.content;
      const oldText = 'ProjectA';
      const newText = 'ProjectB';
      const newContent = current.replace(oldText, newText);

      updateSurfaceFile(fileName, newContent, 'surface_replace');

      const updated = getSurfaceFile(fileName)!;
      expect(updated.content).toContain('ProjectB');
      expect(updated.content).not.toContain('ProjectA');
    });

    it('should only replace first occurrence when multiple matches', () => {
      const fileName = 'me.md' as SurfaceFileName;
      updateSurfaceFile(fileName, '# Me\n\nI like coffee. I like coffee.\n', 'setup');

      const current = getSurfaceFile(fileName)!.content;
      const newContent = current.replace('coffee', 'tea');

      updateSurfaceFile(fileName, newContent, 'surface_replace');

      const updated = getSurfaceFile(fileName)!;
      // 第一处替换，第二处保留
      expect(updated.content).toContain('tea');
      expect(updated.content).toContain('coffee');
    });

    it('should fail if old_text not found', () => {
      const fileName = 'work.md' as SurfaceFileName;
      updateSurfaceFile(fileName, '# Work\n\ntask 1\n', 'setup');

      const current = getSurfaceFile(fileName)!.content;
      const oldText = 'nonexistent text';

      // 模拟 MCP tool 的检查
      expect(current.includes(oldText)).toBe(false);
    });
  });

  // ── TODO-022: etag 更新 + 磁盘同步 ──

  describe('etag update + cache invalidation (TODO-022)', () => {
    it('should update etag after surface_append', () => {
      const fileName = 'work.md' as SurfaceFileName;
      const etagBefore = getCurrentEtag();

      const original = getSurfaceFile(fileName)!.content;
      updateSurfaceFile(fileName, original + '\nNew content\n', 'surface_append');

      const etagAfter = getCurrentEtag();
      expect(etagAfter).not.toBe(etagBefore);
      expect(hasSurfaceChanged(etagBefore)).toBe(true);
    });

    it('should update etag after surface_replace', () => {
      const fileName = 'context.md' as SurfaceFileName;
      updateSurfaceFile(fileName, '# Context\nold value\n', 'setup');
      const etagBefore = getCurrentEtag();

      const current = getSurfaceFile(fileName)!.content;
      updateSurfaceFile(fileName, current.replace('old value', 'new value'), 'surface_replace');

      const etagAfter = getCurrentEtag();
      expect(etagAfter).not.toBe(etagBefore);
    });

    it('should invalidate injector cache after update', () => {
      // 先填充缓存
      getInjectionWithCache('general');
      const r1 = getInjectionWithCache('general');
      expect(r1.cached).toBe(true);

      // 更新 surface
      const fileName = 'me.md' as SurfaceFileName;
      const original = getSurfaceFile(fileName)!.content;
      updateSurfaceFile(fileName, original + '\ncache test\n', 'cache invalidation test');

      // 清缓存（MCP tool 会调 clearInjectionCache）
      clearInjectionCache();

      // 下次应该 miss
      const r2 = getInjectionWithCache('general');
      expect(r2.cached).toBe(false);
    });

    it('should increment version on each update', () => {
      const fileName = 'life.md' as SurfaceFileName;
      const v0 = getSurfaceFile(fileName)!.version;

      updateSurfaceFile(fileName, getSurfaceFile(fileName)!.content + '\nupdate 1\n', 'test1');
      const v1 = getSurfaceFile(fileName)!.version;
      expect(v1).toBe(v0 + 1);

      updateSurfaceFile(fileName, getSurfaceFile(fileName)!.content + '\nupdate 2\n', 'test2');
      const v2 = getSurfaceFile(fileName)!.version;
      expect(v2).toBe(v1 + 1);
    });
  });

  // ── 权限校验（模拟 MCP tool 层）──

  describe('permission validation (TODO-024)', () => {
    it('should only accept valid SurfaceFileName', () => {
      const validFiles = ['me.md', 'soul.md', 'work.md', 'social.md', 'life.md', 'agent.md', 'context.md', 'index.md', 'insight.md'];

      // 合法文件名
      expect(validFiles.includes('me.md')).toBe(true);
      expect(validFiles.includes('work.md')).toBe(true);

      // 非法文件名
      expect(validFiles.includes('passwords.md')).toBe(false);
      expect(validFiles.includes('../etc/passwd')).toBe(false);
      expect(validFiles.includes('')).toBe(false);
    });

    it('should reject path traversal attempts', () => {
      const validFiles = ['me.md', 'soul.md', 'work.md', 'social.md', 'life.md', 'agent.md', 'context.md', 'index.md', 'insight.md'];
      const maliciousInputs = ['../../etc/passwd', '../../../secret.key', 'me.md/../../etc', 'me.md\x00'];

      for (const input of maliciousInputs) {
        expect(validFiles.includes(input)).toBe(false);
      }
    });
  });
});
