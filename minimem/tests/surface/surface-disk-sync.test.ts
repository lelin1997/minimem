/**
 * MiniMem — Surface Files 磁盘同步测试
 * ============================================
 * 验证 Surface Files 数据库内容能同步到磁盘 .md 文件
 * 使用临时目录，测试后自动清理
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { updateSurfaceFile, getSurfaceFile, syncAllSurfacesToDisk } from '../../src/surface/index.js';
import { getConfig } from '../../src/config/index.js';
import type { SurfaceFileName } from '../../src/common/types.js';

// 测试用临时目录
const TEST_DATA_DIR = join(tmpdir(), `minimem-test-surface-${Date.now()}`);
const TEST_SURFACES_DIR = join(TEST_DATA_DIR, 'surfaces');

describe('Surface Files Disk Sync', () => {
  beforeAll(() => {
    setupTestDb();

    // 劫持 config 的 data_dir 指向临时目录
    const config = getConfig();
    (config.storage as { data_dir: string }).data_dir = TEST_DATA_DIR;

    // 确保目录存在
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterAll(() => {
    teardownTestDb();
    // 清理临时目录
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    // 清理 surfaces 子目录
    try {
      rmSync(TEST_SURFACES_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should sync a single surface file to disk on update', () => {
    // 更新 me.md —— updateSurfaceFile 内部会自动调用 syncSurfaceFileToDisk
    updateSurfaceFile(
      'me.md',
      '# 关于我\n\n我是一个热爱技术的全栈开发者。\n\n## 近况\n正在开发 MiniMem 个人记忆系统。',
      '磁盘同步测试',
    );

    // 验证磁盘文件存在
    const filePath = join(TEST_SURFACES_DIR, 'me.md');
    expect(existsSync(filePath)).toBe(true);

    // 验证内容一致
    const diskContent = readFileSync(filePath, 'utf-8');
    expect(diskContent).toContain('MiniMem');
    expect(diskContent).toContain('关于我');

    // 验证与数据库内容一致
    const dbFile = getSurfaceFile('me.md');
    expect(dbFile).not.toBeNull();
    expect(diskContent).toBe(dbFile!.content);
  });

  it('should create surfaces directory automatically', () => {
    // 确保目录不存在
    expect(existsSync(TEST_SURFACES_DIR)).toBe(false);

    // 更新触发同步——应自动创建目录
    updateSurfaceFile('work.md', '# 工作\n\n## 当前项目\n- MiniMem 个人记忆系统', '自动创建目录测试');

    // 目录和文件都应存在
    expect(existsSync(TEST_SURFACES_DIR)).toBe(true);
    expect(existsSync(join(TEST_SURFACES_DIR, 'work.md'))).toBe(true);
  });

  it('should sync all surface files to disk in batch', () => {
    // 先更新几个文件到数据库
    const testFiles: Array<{ name: SurfaceFileName; content: string }> = [
      { name: 'me.md', content: '# 关于我\n开发者，热爱开源' },
      { name: 'soul.md', content: '# 灵魂\n好奇心驱动，追求卓越' },
      { name: 'work.md', content: '# 工作\n正在做 MiniMem' },
      { name: 'social.md', content: '# 社交\nAlice: 后端专家\nBob: Rust 爱好者' },
      { name: 'context.md', content: '# 上下文\n当前正在进行端到端测试' },
    ];

    for (const f of testFiles) {
      updateSurfaceFile(f.name, f.content, '批量同步测试');
    }

    // 清掉磁盘文件后再批量同步
    rmSync(TEST_SURFACES_DIR, { recursive: true, force: true });
    expect(existsSync(TEST_SURFACES_DIR)).toBe(false);

    // 批量同步
    const synced = syncAllSurfacesToDisk();
    expect(synced).toBeGreaterThanOrEqual(testFiles.length);

    // 验证所有文件都在磁盘上
    for (const f of testFiles) {
      const filePath = join(TEST_SURFACES_DIR, f.name);
      expect(existsSync(filePath)).toBe(true);
      const diskContent = readFileSync(filePath, 'utf-8');
      expect(diskContent).toBe(f.content);
    }

    // 验证磁盘上的文件数量（种子数据有 8 个文件）
    const diskFiles = readdirSync(TEST_SURFACES_DIR).filter(f => f.endsWith('.md'));
    expect(diskFiles.length).toBeGreaterThanOrEqual(testFiles.length);
  });

  it('should overwrite disk file on re-update', () => {
    // 第一次写入
    updateSurfaceFile('life.md', '# 生活\nV1: 今天天气很好', '第一次更新');
    const v1 = readFileSync(join(TEST_SURFACES_DIR, 'life.md'), 'utf-8');
    expect(v1).toContain('V1');

    // 第二次写入——应覆盖
    updateSurfaceFile('life.md', '# 生活\nV2: 开始学习 Rust', '第二次更新');
    const v2 = readFileSync(join(TEST_SURFACES_DIR, 'life.md'), 'utf-8');
    expect(v2).toContain('V2');
    expect(v2).not.toContain('V1');
  });

  it('should keep db and disk in sync after multiple operations', () => {
    const ALL_FILES: SurfaceFileName[] = ['me.md', 'soul.md', 'work.md', 'social.md', 'life.md', 'agent.md', 'context.md', 'index.md'];

    // 更新所有文件
    for (const name of ALL_FILES) {
      updateSurfaceFile(name, `# ${name}\n\n测试内容 for ${name}`, `sync test: ${name}`);
    }

    // 逐个对比 DB 与磁盘
    for (const name of ALL_FILES) {
      const dbFile = getSurfaceFile(name);
      expect(dbFile).not.toBeNull();

      const diskPath = join(TEST_SURFACES_DIR, name);
      expect(existsSync(diskPath)).toBe(true);

      const diskContent = readFileSync(diskPath, 'utf-8');
      expect(diskContent).toBe(dbFile!.content);
    }
  });
});
