/**
 * MiniMem — Surface Files 预算降级 & Skill References 同步测试
 * =============================================================
 * 验证：
 * 1. 分层降级策略（段落删除 → 段落边界截断 → 硬截断）
 * 2. 动态预算借用
 * 3. Surface → Skill references 目录同步
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { updateSurfaceFile, getSurfaceFile, syncAllSurfacesToDisk, getSurfaceStats } from '../../src/surface/index.js';
import { getConfig } from '../../src/config/index.js';
import { estimateTokens } from '../../src/common/utils.js';
import type { SurfaceFileName } from '../../src/common/types.js';

// 测试用临时目录
const TEST_DATA_DIR = join(tmpdir(), `minimem-test-budget-${Date.now()}`);
const TEST_SURFACES_DIR = join(TEST_DATA_DIR, 'surfaces');
const TEST_SKILL_DIR = join(tmpdir(), `minimem-test-skill-${Date.now()}`);
const TEST_REFERENCES_DIR = join(TEST_SKILL_DIR, 'references');

describe('Surface Files Budget & References', () => {
  beforeAll(() => {
    setupTestDb();

    // 劫持 config 和环境变量
    const config = getConfig();
    (config.storage as { data_dir: string }).data_dir = TEST_DATA_DIR;
    process.env.MINIMEM_SKILL_DIR = TEST_SKILL_DIR;

    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterAll(() => {
    teardownTestDb();
    delete process.env.MINIMEM_SKILL_DIR;
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
      rmSync(TEST_SKILL_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    try {
      rmSync(TEST_SURFACES_DIR, { recursive: true, force: true });
      rmSync(TEST_REFERENCES_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ── 分层降级策略测试 ──

  describe('Graceful Budget Reduction', () => {
    it('should apply Level 1 (section pruning) when content has multiple sections', () => {
      // me.md 预算为 800 tokens，创建一个超预算的多段落内容
      const sections = [
        '# 关于我\n\n我是一名 SRE 工程师。',
        '## 技能\n\n精通 TypeScript、Go、Python、Rust 等多种语言。' + '在大厂工作多年负责基础设施和可靠性工程负责服务监控告警和自动化运维。'.repeat(20),
        '## 经历\n\n' + '在大厂工作多年，负责基础设施和可靠性工程，参与了多个重要项目的架构设计和实施。'.repeat(60),
        '## 项目\n\n正在开发 MiniMem 个人记忆系统，这是一个为 AI Agent 设计的长期记忆管理系统。',
        '## 兴趣\n\n' + '对分布式系统、AI Agent 和内存管理有浓厚兴趣，经常阅读相关论文和参加技术会议。'.repeat(60),
      ];
      const bigContent = sections.join('\n\n');

      // 确认内容确实超预算
      expect(estimateTokens(bigContent)).toBeGreaterThan(800);

      // 更新应成功（降级处理）
      updateSurfaceFile('me.md', bigContent, 'Level 1 test');

      const file = getSurfaceFile('me.md');
      expect(file).not.toBeNull();
      // 应在动态预算内（基础 800，最大借用到 1200）
      expect(file!.token_count).toBeLessThanOrEqual(1200);
      // 应保留第一段（标题/概述）
      expect(file!.content).toContain('关于我');
      // 应有精简标记
      expect(file!.content).toMatch(/精简|省略|截断/);
    });

    it('should apply Level 2 (paragraph-boundary truncation) for single long section', () => {
      // 构造一个只有单段但超长的内容（无 ## 分隔）
      const paragraphs = Array.from({ length: 200 }, (_, i) =>
        `第 ${i + 1} 段内容：这是一段用于测试段落边界截断的文本，包含中英文混合 content for testing paragraph boundary truncation logic。`
      );
      const longContent = '# 工作笔记\n\n' + paragraphs.join('\n\n');

      expect(estimateTokens(longContent)).toBeGreaterThan(1500);

      updateSurfaceFile('work.md', longContent, 'Level 2 test');

      const file = getSurfaceFile('work.md');
      expect(file).not.toBeNull();
      // 应在动态预算内
      expect(file!.token_count).toBeLessThanOrEqual(2250); // 1500 * 1.5
      // 应保留开头内容
      expect(file!.content).toContain('工作笔记');
      expect(file!.content).toContain('第 1 段');
      // 不应在字符中间断裂，应有截断标记
      expect(file!.content).toMatch(/省略|截断/);
    });

    it('should not truncate content within budget', () => {
      const shortContent = '# 关于我\n\n我是一名开发者。';
      expect(estimateTokens(shortContent)).toBeLessThan(800);

      updateSurfaceFile('me.md', shortContent, 'within budget');

      const file = getSurfaceFile('me.md');
      expect(file).not.toBeNull();
      expect(file!.content).toBe(shortContent);
      // 不应有任何截断标记
      expect(file!.content).not.toMatch(/精简|省略|截断/);
    });
  });

  // ── 动态预算借用测试 ──

  describe('Dynamic Budget Borrowing', () => {
    it('should allow borrowing from unused budget of other files', () => {
      // 先让其他文件保持很小的内容（接近空）
      const smallFiles: SurfaceFileName[] = ['soul.md', 'social.md', 'life.md', 'agent.md', 'index.md'];
      for (const name of smallFiles) {
        updateSurfaceFile(name, `# ${name}\n\n空`, `small ${name}`);
      }

      // work.md 基础预算 1500，动态上限 1500*1.5=2250
      // 构造一个略超 1500 但不超 2250 的内容
      const mediumContent = '# 工作\n\n' + '当前正在开发 MiniMem 系统。'.repeat(70);
      const tokens = estimateTokens(mediumContent);

      // 确认在基础预算和动态上限之间
      if (tokens > 1500 && tokens <= 2250) {
        updateSurfaceFile('work.md', mediumContent, 'borrowing test');
        const file = getSurfaceFile('work.md');
        expect(file).not.toBeNull();
        // 内容应该完整保留（因为动态预算允许借用）
        expect(file!.content).toBe(mediumContent);
      }
    });

    it('should report correct stats including all files', () => {
      updateSurfaceFile('me.md', '# 我\n\n测试内容', 'stats test');
      updateSurfaceFile('work.md', '# 工作\n\n测试内容', 'stats test');

      const stats = getSurfaceStats();
      expect(stats.total_tokens).toBeGreaterThan(0);
      expect(stats.budget).toBe(10000);
      expect(stats.files['me.md']).toBeDefined();
      expect(stats.files['work.md']).toBeDefined();
    });
  });

  // ── Skill References 同步测试 ──

  describe('Skill References Sync', () => {
    it('should sync surface file to Skill references directory on update', () => {
      const content = '# 关于我\n\n我是一名 SRE 工程师，热爱开源。';
      updateSurfaceFile('me.md', content, 'references sync test');

      // 验证 references 目录和文件存在
      expect(existsSync(TEST_REFERENCES_DIR)).toBe(true);
      const refPath = join(TEST_REFERENCES_DIR, 'me.md');
      expect(existsSync(refPath)).toBe(true);

      // 验证内容一致
      const refContent = readFileSync(refPath, 'utf-8');
      expect(refContent).toBe(content);
    });

    it('should create references directory automatically', () => {
      // 确保目录不存在
      rmSync(TEST_REFERENCES_DIR, { recursive: true, force: true });
      expect(existsSync(TEST_REFERENCES_DIR)).toBe(false);

      updateSurfaceFile('work.md', '# 工作\n\n开发 MiniMem', 'auto create refs dir');

      expect(existsSync(TEST_REFERENCES_DIR)).toBe(true);
      expect(existsSync(join(TEST_REFERENCES_DIR, 'work.md'))).toBe(true);
    });

    it('should sync all files to references via syncAllSurfacesToDisk', () => {
      const files: Array<{ name: SurfaceFileName; content: string }> = [
        { name: 'me.md', content: '# 我\n\nSRE 工程师' },
        { name: 'work.md', content: '# 工作\n\nMiniMem 开发' },
        { name: 'agent.md', content: '# Agent\n\n协作配置' },
        { name: 'context.md', content: '# 上下文\n\n当前焦点：预算策略' },
      ];

      for (const f of files) {
        updateSurfaceFile(f.name, f.content, 'batch refs sync');
      }

      // 清除 references 目录后批量同步
      rmSync(TEST_REFERENCES_DIR, { recursive: true, force: true });
      expect(existsSync(TEST_REFERENCES_DIR)).toBe(false);

      syncAllSurfacesToDisk();

      // 验证所有文件都同步到了 references
      for (const f of files) {
        const refPath = join(TEST_REFERENCES_DIR, f.name);
        expect(existsSync(refPath)).toBe(true);
        const refContent = readFileSync(refPath, 'utf-8');
        expect(refContent).toBe(f.content);
      }
    });

    it('should keep disk and references in sync after update', () => {
      const content = '# 上下文\n\nV1: 初始内容';
      updateSurfaceFile('context.md', content, 'sync v1');

      // 两个位置都应有文件
      const diskPath = join(TEST_SURFACES_DIR, 'context.md');
      const refPath = join(TEST_REFERENCES_DIR, 'context.md');
      expect(readFileSync(diskPath, 'utf-8')).toBe(content);
      expect(readFileSync(refPath, 'utf-8')).toBe(content);

      // 更新后两边都应同步
      const contentV2 = '# 上下文\n\nV2: 更新后内容';
      updateSurfaceFile('context.md', contentV2, 'sync v2');
      expect(readFileSync(diskPath, 'utf-8')).toBe(contentV2);
      expect(readFileSync(refPath, 'utf-8')).toBe(contentV2);
    });
  });
});
