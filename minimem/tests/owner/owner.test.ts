/**
 * MiniMem — Owner Profile 模块测试
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, clearAllTables } from '../helpers/setup.js';
import {
  setProfileEntry, getProfileEntry, getFullProfile,
  getProfileByCategory, getProfileByPrefix, deleteProfileEntry,
  setProfileEntries, listProfileCategories, countProfileEntries,
} from '../../src/owner/profile.js';
import {
  recordPreference, getPreference, getAllPreferences,
  getStrongPreferences, deletePreference,
} from '../../src/owner/preferences.js';
import {
  createPerson, getPersonById, findPersonByName,
  updatePerson, appendPersonInfo, listPersons,
  deletePerson, countPersons,
} from '../../src/owner/persons.js';

beforeAll(() => {
  setupTestDb();
});

describe('Owner Profile KV', () => {
  beforeEach(() => clearAllTables());

  it('should set and get profile entry', () => {
    const entry = setProfileEntry('identity.name', '张三', { category: 'identity', confidence: 0.9 });
    expect(entry.key).toBe('identity.name');
    expect(entry.value).toBe('张三');
    expect(entry.category).toBe('identity');
    expect(entry.confidence).toBe(0.9);

    const found = getProfileEntry('identity.name');
    expect(found).toBeTruthy();
    expect(found!.value).toBe('张三');
  });

  it('should upsert on conflict', () => {
    setProfileEntry('identity.name', 'Alice');
    setProfileEntry('identity.name', 'Bob', { confidence: 0.8 });
    const entry = getProfileEntry('identity.name');
    expect(entry!.value).toBe('Bob');
    expect(entry!.confidence).toBe(0.8);
  });

  it('should get by category', () => {
    setProfileEntry('identity.name', 'Alice', { category: 'identity' });
    setProfileEntry('identity.locale', 'zh-CN', { category: 'identity' });
    setProfileEntry('work.role', 'engineer', { category: 'work' });

    const identityEntries = getProfileByCategory('identity');
    expect(identityEntries.length).toBe(2);
  });

  it('should get by prefix', () => {
    setProfileEntry('work.tech.lang', 'TypeScript', { category: 'work' });
    setProfileEntry('work.tech.framework', 'React', { category: 'work' });
    setProfileEntry('social.style', 'friendly', { category: 'social' });

    const workTech = getProfileByPrefix('work.tech.');
    expect(workTech.length).toBe(2);
  });

  it('should build full nested profile', () => {
    setProfileEntry('identity.name', 'Alice', { category: 'identity' });
    setProfileEntry('identity.locale', 'zh-CN', { category: 'identity' });
    setProfileEntry('work.role', 'engineer', { category: 'work' });

    const profile = getFullProfile();
    expect((profile.identity as any).name).toBe('Alice');
    expect((profile.identity as any).locale).toBe('zh-CN');
    expect((profile.work as any).role).toBe('engineer');
  });

  it('should delete entry', () => {
    setProfileEntry('temp.key', 'value');
    expect(deleteProfileEntry('temp.key')).toBe(true);
    expect(getProfileEntry('temp.key')).toBeNull();
  });

  it('should batch set entries', () => {
    const count = setProfileEntries([
      { key: 'a.b', value: 1 },
      { key: 'c.d', value: 2 },
      { key: 'e.f', value: 3 },
    ]);
    expect(count).toBe(3);
    expect(countProfileEntries()).toBe(3);
  });

  it('should list categories', () => {
    setProfileEntry('cat1.key', 'v', { category: 'cat1' });
    setProfileEntry('cat2.key', 'v', { category: 'cat2' });
    const cats = listProfileCategories();
    expect(cats).toContain('cat1');
    expect(cats).toContain('cat2');
  });
});

describe('Preferences', () => {
  beforeEach(() => clearAllTables());

  it('should record and retrieve preference', () => {
    const pref = recordPreference('coding.language', 'TypeScript', 0.7, 'codebuddy');
    expect(pref.topic).toBe('coding.language');
    expect(pref.preference).toBe('TypeScript');
    expect(pref.confidence).toBe(0.7);
    expect(pref.evidence_count).toBe(1);

    const found = getPreference('coding.language');
    expect(found).toBeTruthy();
    expect(found!.preference).toBe('TypeScript');
  });

  it('should strengthen same preference', () => {
    recordPreference('editor', 'VS Code', 0.5);
    const pref = recordPreference('editor', 'VS Code', 0.5);
    expect(pref.evidence_count).toBe(2);
    expect(pref.confidence).toBeGreaterThan(0.5);
  });

  it('should replace with higher confidence', () => {
    recordPreference('framework', 'React', 0.3);
    const pref = recordPreference('framework', 'Vue', 0.8);
    expect(pref.preference).toBe('Vue');
    expect(pref.confidence).toBe(0.8);
  });

  it('should get all preferences', () => {
    recordPreference('a', 'A');
    recordPreference('b', 'B');
    const all = getAllPreferences();
    expect(all.length).toBe(2);
  });

  it('should get strong preferences', () => {
    recordPreference('weak', 'x', 0.3);
    recordPreference('strong', 'y', 0.9);
    const strong = getStrongPreferences(0.7);
    expect(strong.length).toBe(1);
    expect(strong[0].topic).toBe('strong');
  });

  it('should delete preference', () => {
    recordPreference('temp', 'value');
    expect(deletePreference('temp')).toBe(true);
    expect(getPreference('temp')).toBeNull();
  });
});

describe('Person Profiles', () => {
  beforeEach(() => clearAllTables());

  it('should create and retrieve person', () => {
    const person = createPerson({
      name: 'Alice',
      aliases: ['小A'],
      personality: '开朗活泼',
      interests: ['编程', '阅读'],
    });
    expect(person.id).toBeDefined();
    expect(person.name).toBe('Alice');
    expect(person.aliases).toEqual(['小A']);
    expect(person.interests).toEqual(['编程', '阅读']);

    const found = getPersonById(person.id);
    expect(found).toBeTruthy();
    expect(found!.name).toBe('Alice');
  });

  it('should find person by name', () => {
    createPerson({ name: 'Bob' });
    const found = findPersonByName('Bob');
    expect(found).toBeTruthy();
    expect(found!.name).toBe('Bob');
  });

  it('should find person by alias', () => {
    createPerson({ name: 'Charlie', aliases: ['小C', 'Charles'] });
    const found = findPersonByName('Charles');
    expect(found).toBeTruthy();
    expect(found!.name).toBe('Charlie');
  });

  it('should update person', () => {
    const person = createPerson({ name: 'Dave' });
    const updated = updatePerson(person.id, { personality: '安静内向', interests: ['音乐'] });
    expect(updated).toBeTruthy();
    expect(updated!.personality).toBe('安静内向');
    expect(updated!.interests).toEqual(['音乐']);
  });

  it('should append info without overwrite', () => {
    const person = createPerson({ name: 'Eve', interests: ['编程'] });
    const updated = appendPersonInfo(person.id, { interests: ['设计', '编程'] });
    expect(updated).toBeTruthy();
    expect(updated!.interests).toEqual(['编程', '设计']); // 合并去重
  });

  it('should append relationships', () => {
    const person = createPerson({ name: 'Frank', relationships: [{ person: 'Grace', type: 'friend' }] });
    const updated = appendPersonInfo(person.id, {
      relationships: [{ person: 'Henry', type: 'colleague' }, { person: 'Grace', type: 'friend' }], // Grace 重复
    });
    expect(updated!.relationships.length).toBe(2); // 不重复
  });

  it('should list persons', () => {
    createPerson({ name: 'P1' });
    createPerson({ name: 'P2' });
    createPerson({ name: 'P3' });
    const list = listPersons();
    expect(list.length).toBe(3);
  });

  it('should delete person', () => {
    const person = createPerson({ name: 'Temp' });
    expect(deletePerson(person.id)).toBe(true);
    expect(getPersonById(person.id)).toBeNull();
  });

  it('should count persons', () => {
    expect(countPersons()).toBe(0);
    createPerson({ name: 'A' });
    createPerson({ name: 'B' });
    expect(countPersons()).toBe(2);
  });
});
