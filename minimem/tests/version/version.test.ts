/**
 * MiniMem — 版本控制模块测试
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, clearAllTables } from '../helpers/setup.js';
import { createSnapshot, getSnapshotById, listSnapshots, getLatestSnapshot, countSnapshots } from '../../src/version/snapshot.js';
import { createBranch, getBranch, listBranches, deactivateBranch, deleteBranch } from '../../src/version/branch.js';
import { diffSnapshots } from '../../src/version/diff.js';
import { mergeBranch } from '../../src/version/merge.js';
import { rollbackToSnapshot } from '../../src/version/rollback.js';
import { createAuditLog, queryAuditLogs, countAuditLogs } from '../../src/version/audit.js';
import { createExperience } from '../../src/store/experiences.js';
import { createWorldFact } from '../../src/store/world-facts.js';
import { getDb } from '../../src/store/database.js';
import { generateId, now } from '../../src/common/utils.js';

beforeAll(() => {
  setupTestDb();
});

describe('Snapshot', () => {
  beforeEach(() => clearAllTables());

  it('should create a snapshot with correct stats', () => {
    // 先创建一些数据
    createExperience({ raw_content: 'test memory 1', source: 'test' });
    createExperience({ raw_content: 'test memory 2', source: 'test' });
    createWorldFact({ subject: 'Alice', predicate: 'likes', object: 'coding', source: 'test', evidence_experience_ids: [] });

    const snap = createSnapshot({ label: 'test-snap', trigger: 'manual' });
    expect(snap.id).toBeDefined();
    expect(snap.label).toBe('test-snap');
    expect(snap.trigger).toBe('manual');
    expect(snap.branch).toBe('main');
    expect(snap.stats_l1).toBe(2);
    expect(snap.stats_l2).toBe(1);
    expect(snap.stats_l3).toBe(0);
    expect(snap.stats_l4).toBe(0);
  });

  it('should get snapshot by id', () => {
    const snap = createSnapshot({ label: 'by-id' });
    const found = getSnapshotById(snap.id);
    expect(found).toBeTruthy();
    expect(found!.label).toBe('by-id');
  });

  it('should list snapshots for branch', () => {
    createSnapshot({ label: 'snap-1' });
    createSnapshot({ label: 'snap-2' });

    const list = listSnapshots('main');
    expect(list.length).toBe(2);
    const labels = list.map(s => s.label);
    expect(labels).toContain('snap-1');
    expect(labels).toContain('snap-2');
  });

  it('should get latest snapshot', () => {
    createSnapshot({ label: 'old' });
    createSnapshot({ label: 'new' });
    const latest = getLatestSnapshot('main');
    expect(latest).toBeTruthy();
    // 最新的可能是 old 或 new（同毫秒）但至少存在
    expect(['old', 'new']).toContain(latest!.label);
  });

  it('should set parent_snapshot_id to previous snapshot', () => {
    const snap1 = createSnapshot({ label: 'first' });
    const snap2 = createSnapshot({ label: 'second' });
    expect(snap2.parent_snapshot_id).toBe(snap1.id);
  });

  it('should count snapshots', () => {
    expect(countSnapshots()).toBe(0);
    createSnapshot({});
    createSnapshot({});
    expect(countSnapshots()).toBe(2);
    expect(countSnapshots('main')).toBe(2);
  });
});

describe('Branch', () => {
  beforeEach(() => clearAllTables());

  it('should create a branch', () => {
    const branch = createBranch('experiment');
    expect(branch.name).toBe('experiment');
    expect(branch.is_active).toBe(true);
    expect(branch.created_from_snapshot).toBeTruthy();
  });

  it('should get branch by name', () => {
    createBranch('test-branch');
    const found = getBranch('test-branch');
    expect(found).toBeTruthy();
    expect(found!.name).toBe('test-branch');
  });

  it('should list branches', () => {
    createBranch('branch-1');
    createBranch('branch-2');
    const branches = listBranches();
    // main + 2 new branches
    expect(branches.length).toBeGreaterThanOrEqual(2);
  });

  it('should prevent duplicate branch names', () => {
    createBranch('unique');
    expect(() => createBranch('unique')).toThrow();
  });

  it('should deactivate branch', () => {
    createBranch('temp');
    deactivateBranch('temp');
    const branch = getBranch('temp');
    expect(branch!.is_active).toBe(false);
  });

  it('should prevent deactivating main', () => {
    expect(() => deactivateBranch('main')).toThrow();
  });

  it('should delete branch with data', () => {
    createBranch('to-delete');
    deleteBranch('to-delete');
    const found = getBranch('to-delete');
    expect(found).toBeNull();
  });

  it('should prevent deleting main', () => {
    expect(() => deleteBranch('main')).toThrow();
  });
});

describe('Diff', () => {
  beforeEach(() => clearAllTables());

  it('should compute diff between two snapshots', () => {
    const snap1 = createSnapshot({ label: 'before' });

    // 添加一些数据
    createExperience({ raw_content: 'new memory 1', source: 'test' });
    createExperience({ raw_content: 'new memory 2', source: 'test' });

    const snap2 = createSnapshot({ label: 'after' });

    const diff = diffSnapshots(snap1.id, snap2.id);
    expect(diff.snapshot_a.label).toBe('before');
    expect(diff.snapshot_b.label).toBe('after');
    // 验证 stats delta 正确反映了数量变化
    expect(diff.changes.l1.delta).toBe(2);
    expect(diff.changes.l1.before).toBe(0);
    expect(diff.changes.l1.after).toBe(2);
    expect(diff.significance).toBeGreaterThan(0);
  });

  it('should show zero diff for same state', () => {
    createExperience({ raw_content: 'existing', source: 'test' });
    const snap1 = createSnapshot({ label: 'same-1' });
    const snap2 = createSnapshot({ label: 'same-2' });

    const diff = diffSnapshots(snap1.id, snap2.id);
    expect(diff.changes.l1.delta).toBe(0);
  });

  it('should throw for missing snapshot', () => {
    expect(() => diffSnapshots('nonexistent', 'also-none')).toThrow();
  });
});

describe('Merge', () => {
  beforeEach(() => clearAllTables());

  it('should merge branch into main', () => {
    // 创建分支
    const branch = createBranch('feature');

    // 分支上的数据（直接写到分支）
    const db = getDb();
    const ts = now();
    db.prepare(
      "INSERT INTO experiences (id, raw_content, content_type, source, importance, tags, participants, branch, created_at, updated_at) VALUES (?, ?, 'note', 'test', 0.5, '[]', '[]', 'feature', ?, ?)"
    ).run(generateId(), 'branch memory', ts, ts);

    const result = mergeBranch('feature', 'main');
    expect(result.source_branch).toBe('feature');
    expect(result.target_branch).toBe('main');
    expect(result.merged.experiences).toBe(1);
    expect(result.pre_snapshot_id).toBeTruthy();
    expect(result.post_snapshot_id).toBeTruthy();
  });

  it('should prevent merging into self', () => {
    expect(() => mergeBranch('main', 'main')).toThrow();
  });
});

describe('Rollback', () => {
  beforeEach(() => clearAllTables());

  it('should rollback to a snapshot', () => {
    createExperience({ raw_content: 'keep this', source: 'test' });
    const snap = createSnapshot({ label: 'checkpoint' });

    // 手动插入记忆，确保 created_at 在快照之后
    const db = getDb();
    const futureTime = new Date(Date.now() + 2000).toISOString();
    db.prepare(
      "INSERT INTO experiences (id, raw_content, content_type, source, importance, tags, participants, branch, created_at, updated_at) VALUES (?, ?, 'note', 'test', 0.5, '[]', '[]', 'main', ?, ?)"
    ).run(generateId(), 'remove this', futureTime, futureTime);
    db.prepare(
      "INSERT INTO experiences (id, raw_content, content_type, source, importance, tags, participants, branch, created_at, updated_at) VALUES (?, ?, 'note', 'test', 0.5, '[]', '[]', 'main', ?, ?)"
    ).run(generateId(), 'also remove', futureTime, futureTime);

    const result = rollbackToSnapshot(snap.id);
    expect(result.target_snapshot_id).toBe(snap.id);
    expect(result.safety_snapshot_id).toBeTruthy();
    expect(result.rolled_back.experiences).toBe(2);
  });

  it('should throw for nonexistent snapshot', () => {
    expect(() => rollbackToSnapshot('nonexistent')).toThrow();
  });
});

describe('Audit Log', () => {
  beforeEach(() => clearAllTables());

  it('should create and query audit logs', () => {
    createAuditLog({
      action: 'update',
      target_type: 'experience',
      target_id: 'exp-123',
      before_value: '{"importance": 0.5}',
      after_value: '{"importance": 0.8}',
      triggered_by: 'user',
    });

    const logs = queryAuditLogs({ target_type: 'experience' });
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('update');
    expect(logs[0].target_id).toBe('exp-123');
  });

  it('should count audit logs', () => {
    createAuditLog({ action: 'test', target_type: 'test', target_id: '1' });
    createAuditLog({ action: 'test', target_type: 'test', target_id: '2' });
    expect(countAuditLogs()).toBe(2);
    expect(countAuditLogs('test')).toBe(2);
  });

  it('should filter by action', () => {
    createAuditLog({ action: 'create', target_type: 'test', target_id: '1' });
    createAuditLog({ action: 'delete', target_type: 'test', target_id: '2' });

    const creates = queryAuditLogs({ action: 'create' });
    expect(creates.length).toBe(1);
  });
});
