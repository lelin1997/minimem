// ============================================================
// MiniMem — Data Store Ports (B01: 拆分为 4 个 Repository)
// ============================================================
// 原 DataStore Facade (31 方法) 拆分为:
// - ExperienceRepository: L1 经验 CRUD
// - FactRepository: L2 事实 + L4 心智模型
// - IndexRepository: FTS + 条件索引
// - KnowledgePageRepository: 知识页 + 编译队列
//
// 保留 DataStore 接口和便捷函数向后兼容
// domain 代码可按需 import 具体 Repository 或继续用便捷函数

import type { Database as BetterSqlite3Database } from 'better-sqlite3';

// ── 拆分后的 4 个 Repository 接口 ──

export interface ExperienceRepository {
  getDb(): BetterSqlite3Database;
  createExperience(data: any): any;
  experienceExistsByHash(hash: string): boolean;
  getUnprocessedExperiences(limit?: number): any[];
  getPendingExperiences(limit?: number): any[];
  markExperienceProcessed(id: string): void;
}

export interface FactRepository {
  findFactsBySubject(subject: string): any[];
  getActiveMentalModels(): any[];
  createWorldFactsBatch(facts: any[]): any[];
}

export interface IndexRepository {
  addToFts(memoryId: string, memoryType: string, content: string, tags?: string[], conditionKeys?: string[]): void;
  removeFromFts(memoryId: string): void;
  searchFts(query: string, limit?: number): any[];
  lookupByCondition(key: string): any[];
  lookupByPrefix(prefix: string): any[];
  addConditionIndex(key: string, memoryType: string, memoryId: string): void;
}

export interface KnowledgePageRepository {
  createKnowledgePage(input: any): any;
  getKnowledgePageBySlug(slug: string): any | null;
  getAllKnowledgePages(): any[];
  getStalePages(threshold?: number): any[];
  getPendingCompileItems(limit?: number): any[];
  enqueueCompile(sourceType: string, content: string, targetPage?: string, priority?: number): void;
  markCompiled(pageId: string, status?: string): void;
  markCompiledBatch(pageIds: string[], status?: string): void;
  updateKnowledgePageContent(pageId: string, content: string): void;
  updateKnowledgePageMeta(pageId: string, meta: any): void;
  updateLintStatus(pageId: string, status: string, stalenessScore?: number): void;
  searchKnowledgePages(query: string, limit?: number): any[];
  incrementMemoryCount(): void;
}

// ── 向后兼容: DataStore 聚合接口 (extends 4 个 Repository) ──

export interface DataStore extends ExperienceRepository, FactRepository, IndexRepository, KnowledgePageRepository {}

// ── Registry (统一注册, 内部拆 4 个) ──

let _factory: (() => DataStore) | null = null;

export function registerDataStore(factory: () => DataStore): void {
  _factory = factory;
}

export function getDataStore(): DataStore {
  if (!_factory) {
    throw new Error('DataStore factory not registered. Call registerDataStore() at app startup.');
  }
  return _factory();
}

// ── 按需获取具体 Repository ──

export function getExperienceRepository(): ExperienceRepository {
  return getDataStore();
}

export function getFactRepository(): FactRepository {
  return getDataStore();
}

export function getIndexRepository(): IndexRepository {
  return getDataStore();
}

export function getKnowledgePageRepository(): KnowledgePageRepository {
  return getDataStore();
}

// ── 便捷函数: 保持 domain 代码的函数式调用风格 (向后兼容) ──

export function getDb(): BetterSqlite3Database { return getDataStore().getDb(); }
export function createExperience(data: any): any { return getDataStore().createExperience(data); }
export function experienceExistsByHash(hash: string): boolean { return getDataStore().experienceExistsByHash(hash); }
export function getUnprocessedExperiences(limit?: number): any[] { return getDataStore().getUnprocessedExperiences(limit); }
export function getPendingExperiences(limit?: number): any[] { return getDataStore().getPendingExperiences(limit); }
export function markExperienceProcessed(id: string): void { return getDataStore().markExperienceProcessed(id); }
export function findFactsBySubject(subject: string): any[] { return getDataStore().findFactsBySubject(subject); }
export function getActiveMentalModels(): any[] { return getDataStore().getActiveMentalModels(); }
export function createWorldFactsBatch(facts: any[]): any[] { return getDataStore().createWorldFactsBatch(facts); }
export function addToFts(memoryId: string, memoryType: string, content: string, tags?: string[], conditionKeys?: string[]): void { return getDataStore().addToFts(memoryId, memoryType, content, tags, conditionKeys); }
export function removeFromFts(memoryId: string): void { return getDataStore().removeFromFts(memoryId); }
export function searchFts(query: string, limit?: number): any[] { return getDataStore().searchFts(query, limit); }
export function lookupByCondition(key: string): any[] { return getDataStore().lookupByCondition(key); }
export function lookupByPrefix(prefix: string): any[] { return getDataStore().lookupByPrefix(prefix); }
export function addConditionIndex(key: string, memoryType: string, memoryId: string): void { return getDataStore().addConditionIndex(key, memoryType, memoryId); }
export function createKnowledgePage(input: any): any { return getDataStore().createKnowledgePage(input); }
export function getKnowledgePageBySlug(slug: string): any | null { return getDataStore().getKnowledgePageBySlug(slug); }
export function getAllKnowledgePages(): any[] { return getDataStore().getAllKnowledgePages(); }
export function getStalePages(threshold?: number): any[] { return getDataStore().getStalePages(threshold); }
export function getPendingCompileItems(limit?: number): any[] { return getDataStore().getPendingCompileItems(limit); }
export function enqueueCompile(sourceType: string, content: string, targetPage?: string, priority?: number): void { return getDataStore().enqueueCompile(sourceType, content, targetPage, priority); }
export function markCompiled(pageId: string, status?: string): void { return getDataStore().markCompiled(pageId, status); }
export function markCompiledBatch(pageIds: string[], status?: string): void { return getDataStore().markCompiledBatch(pageIds, status); }
export function updateKnowledgePageContent(pageId: string, content: string): void { return getDataStore().updateKnowledgePageContent(pageId, content); }
export function updateKnowledgePageMeta(pageId: string, meta: any): void { return getDataStore().updateKnowledgePageMeta(pageId, meta); }
export function updateLintStatus(pageId: string, status: string, stalenessScore?: number): void { return getDataStore().updateLintStatus(pageId, status, stalenessScore); }
export function searchKnowledgePages(query: string, limit?: number): any[] { return getDataStore().searchKnowledgePages(query, limit); }
export function incrementMemoryCount(): void { return getDataStore().incrementMemoryCount(); }
