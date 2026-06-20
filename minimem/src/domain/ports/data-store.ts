// ============================================================
// MiniMem — Data Store Port (P3.1 依赖倒置)
// ============================================================
// 聚合 domain 层需要的所有数据访问函数。
// infra/store/* 在 app 启动时通过 registerDataStore 注册实现。
//
// 设计权衡：理想方案是每个 store 模块独立 port，但当前 domain 代码
// 直接调这些函数，逐个抽象工作量过大。本 Port 采用 Facade 模式聚合
// 访问入口，让 domain 不直接 import infra，同时保留后续拆分空间。

import type { Database as BetterSqlite3Database } from 'better-sqlite3';

export interface DataStore {
  // ── database.ts ──
  getDb(): BetterSqlite3Database;

  // ── experiences.ts ──
  createExperience(data: any): any;
  experienceExistsByHash(hash: string): boolean;
  getUnprocessedExperiences(limit?: number): any[];
  getPendingExperiences(limit?: number): any[];
  markExperienceProcessed(id: string): void;

  // ── world_facts / mental_models ──
  findFactsBySubject(subject: string): any[];
  getActiveMentalModels(): any[];
  createWorldFactsBatch(facts: any[]): any[];

  // ── indexes.ts (FTS + 条件索引) ──
  addToFts(memoryId: string, memoryType: string, content: string, tags?: string[], conditionKeys?: string[]): void;
  removeFromFts(memoryId: string): void;
  searchFts(query: string, limit?: number): any[];
  lookupByCondition(key: string): any[];
  lookupByPrefix(prefix: string): any[];
  addConditionIndex(key: string, memoryType: string, memoryId: string): void;

  // ── knowledge-pages/ ──
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

  // ── scheduler ──
  incrementMemoryCount(): void;
}

// ── Registry ──

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

// ── 便捷函数: 保持 domain 代码的函数式调用风格 ──

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
