import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/infra/store/database.js';
import {
  queryMemories,
  getMemoryById,
  countMemoriesByLayer,
  addL1Memory,
  addL2Fact,
  addL3Observation,
  addL4Model,
  deleteMemory,
  listMemoryDomains,
} from '../../src/infra/store/memory-repository.js';

beforeAll(async () => { await setupTestDb(); });
afterAll(async () => { await teardownTestDb(); });
beforeEach(() => clearAllTables(getDb()));

describe('TODO-039: memories 统一视图 + MemoryRepository', () => {
  describe('memories 视图', () => {
    it('should return empty when no data', () => {
      const result = queryMemories({});
      expect(result).toEqual([]);
    });

    it('should query across all 4 layers via view', () => {
      addL1Memory({ raw_content: 'L1 test', source: 'test' });
      addL2Fact({ subject: 'user', predicate: 'likes', object: 'coffee' });
      addL3Observation({ description: 'L3 pattern' });
      addL4Model({ title: 'L4 principle', content: 'test content' });

      const all = queryMemories({});
      expect(all).toHaveLength(4);

      const layers = all.map(m => m.layer).sort();
      expect(layers).toEqual(['L1', 'L2', 'L3', 'L4']);
    });

    it('should filter by layer', () => {
      addL1Memory({ raw_content: 'L1', source: 'test' });
      addL2Fact({ subject: 's', predicate: 'p', object: 'o' });
      addL2Fact({ subject: 's2', predicate: 'p2', object: 'o2' });

      const l2Only = queryMemories({ layer: 'L2' });
      expect(l2Only).toHaveLength(2);
      expect(l2Only.every(m => m.layer === 'L2')).toBe(true);
    });

    it('should filter by domain', () => {
      addL1Memory({ raw_content: 'work mem', source: 'test', domain: 'work' });
      addL1Memory({ raw_content: 'personal mem', source: 'test', domain: 'personal' });

      const workMems = queryMemories({ domain: 'work' });
      expect(workMems).toHaveLength(1);
      expect(workMems[0].domain).toBe('work');
    });

    it('should map layer-specific fields correctly', () => {
      const l2Id = addL2Fact({ subject: 'ProjectX', predicate: 'uses', object: 'TypeScript', confidence: 0.95 });
      const l4Id = addL4Model({ title: '简洁API', content: 'prefer simple', priority: 8 });

      const l2 = getMemoryById(l2Id)!;
      expect(l2.layer).toBe('L2');
      expect(l2.subject).toBe('ProjectX');
      expect(l2.predicate).toBe('uses');
      expect(l2.object).toBe('TypeScript');
      expect(l2.confidence).toBe(0.95);

      const l4 = getMemoryById(l4Id)!;
      expect(l4.layer).toBe('L4');
      expect(l4.title).toBe('简洁API');
      expect(l4.model_type).toBe('principle');
      expect(l4.priority).toBe(8);
    });
  });

  describe('countByLayer', () => {
    it('should count memories per layer', () => {
      addL1Memory({ raw_content: 'a', source: 't' });
      addL1Memory({ raw_content: 'b', source: 't' });
      addL1Memory({ raw_content: 'c', source: 't' });
      addL2Fact({ subject: 's', predicate: 'p', object: 'o' });

      const counts = countMemoriesByLayer();
      expect(counts.L1).toBe(3);
      expect(counts.L2).toBe(1);
      expect(counts.L3).toBe(0);
      expect(counts.L4).toBe(0);
    });
  });

  describe('addL1/L2/L3/L4 + delete', () => {
    it('should add and delete L1', () => {
      const id = addL1Memory({ raw_content: 'test', source: 'unit' });
      expect(getMemoryById(id)).not.toBeNull();
      expect(deleteMemory(id)).toBe(true);
      expect(getMemoryById(id)).toBeNull();
    });

    it('should return false when deleting non-existent id', () => {
      expect(deleteMemory('non-existent')).toBe(false);
    });

    it('should delete from correct physical table based on layer', () => {
      const l2Id = addL2Fact({ subject: 's', predicate: 'p', object: 'o' });
      const l4Id = addL4Model({ title: 't', content: 'c' });

      expect(deleteMemory(l2Id)).toBe(true);
      expect(deleteMemory(l4Id)).toBe(true);

      // 确认物理表也删了
      const db = getDb();
      const l2Exists = db.prepare('SELECT 1 FROM world_facts WHERE id = ?').get(l2Id);
      const l4Exists = db.prepare('SELECT 1 FROM mental_models WHERE id = ?').get(l4Id);
      expect(l2Exists).toBeUndefined();
      expect(l4Exists).toBeUndefined();
    });
  });

  describe('listMemoryDomains', () => {
    it('should list domains with counts and layers', () => {
      addL1Memory({ raw_content: 'work1', source: 't', domain: 'work' });
      addL1Memory({ raw_content: 'work2', source: 't', domain: 'work' });
      addL2Fact({ subject: 's', predicate: 'p', object: 'o', domain: 'work' });
      addL1Memory({ raw_content: 'personal', source: 't', domain: 'personal' });

      const domains = listMemoryDomains();
      expect(domains).toHaveLength(2);
      const work = domains.find(d => d.domain === 'work')!;
      expect(work.count).toBe(3);
      expect(work.layers).toContain('L1');
      expect(work.layers).toContain('L2');
    });
  });

  describe('orderBy and pagination', () => {
    it('should order by importance DESC', () => {
      addL1Memory({ raw_content: 'low', source: 't', importance: 0.1 });
      addL1Memory({ raw_content: 'high', source: 't', importance: 0.9 });
      addL1Memory({ raw_content: 'mid', source: 't', importance: 0.5 });

      const result = queryMemories({ orderBy: 'importance', order: 'DESC' });
      expect(result[0].importance).toBe(0.9);
      expect(result[2].importance).toBe(0.1);
    });

    it('should support limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        addL1Memory({ raw_content: `mem-${i}`, source: 't' });
      }
      const page1 = queryMemories({ limit: 2, offset: 0 });
      const page2 = queryMemories({ limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });
});
