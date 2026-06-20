// ============================================================
// MiniMem — Infra Ports Registration (P3.1)
// ============================================================
// 在 app 启动时调用 registerInfraPorts()，把 infra 实现注入 domain/ports。
// 调用后 domain 代码可通过 getLLMClient() / getVectorStore() 等访问 infra。

import { registerLLMClient, getLLMClient } from '../domain/ports/llm-client.js';
import { registerVectorStore, getVectorStore } from '../domain/ports/vector-store.js';
import { registerGraphRepository, getGraphRepository } from '../domain/ports/graph-repository.js';
import { registerDataStore, getDataStore } from '../domain/ports/data-store.js';
import type { DataStore } from '../domain/ports/data-store.js';

import { getLLM } from './llm/client.js';
import { getVectorStore as infraGetVectorStore } from './store/vectors.js';
import { getDb } from './store/database.js';
import {
  createExperience,
  experienceExistsByHash,
  getUnprocessedExperiences,
  getPendingExperiences,
  markExperienceProcessed,
} from './store/experiences.js';
import {
  findFactsBySubject,
  createWorldFactsBatch,
} from './store/world-facts.js';
import { getActiveMentalModels } from './store/mental-models.js';
import {
  addToFts,
  removeFromFts,
  searchFts,
  lookupByCondition,
  lookupByPrefix,
  addConditionIndex,
} from './store/indexes.js';
import {
  createKnowledgePage,
  getKnowledgePageBySlug,
  getAllKnowledgePages,
  getStalePages,
  updateKnowledgePageContent,
  updateKnowledgePageMeta,
  updateLintStatus,
  searchKnowledgePages,
} from './store/knowledge-pages/page-store.js';
import {
  enqueueCompile,
  getPendingCompileItems,
  markCompiled,
  markCompiledBatch,
} from './store/knowledge-pages/compile-queue.js';
import * as graphModule from './store/graph.js';
import { incrementMemoryCount } from './scheduler/index.js';

let _registered = false;

/**
 * 注册所有 infra 实现到 domain/ports。
 * 幂等：多次调用安全。
 */
export function registerInfraPorts(): void {
  if (_registered) return;

  // LLM Client
  registerLLMClient(() => getLLM() as never);

  // Vector Store
  registerVectorStore(() => infraGetVectorStore());

  // Graph Repository
  registerGraphRepository(() => ({
    createLink: graphModule.createLink,
    getOutboundLinks: graphModule.getOutboundLinks,
    getInboundLinks: graphModule.getInboundLinks,
    traverseGraph: graphModule.traverseGraph,
    deleteNodeLinks: graphModule.deleteNodeLinks,
  }));

  // Data Store (Facade)
  const dataStore: DataStore = {
    getDb,
    createExperience: (data: any) => createExperience(data),
    experienceExistsByHash,
    getUnprocessedExperiences,
    getPendingExperiences,
    markExperienceProcessed,
    findFactsBySubject,
    getActiveMentalModels,
    createWorldFactsBatch: (facts: any[]) => createWorldFactsBatch(facts),
    addToFts,
    removeFromFts,
    searchFts,
    lookupByCondition,
    lookupByPrefix,
    addConditionIndex,
    createKnowledgePage,
    getKnowledgePageBySlug,
    getAllKnowledgePages,
    getStalePages,
    getPendingCompileItems,
    enqueueCompile,
    markCompiled,
    markCompiledBatch,
    updateKnowledgePageContent,
    updateKnowledgePageMeta: (pageId: string, meta: any) => updateKnowledgePageMeta(pageId, meta),
    updateLintStatus,
    searchKnowledgePages,
    incrementMemoryCount,
  };
  registerDataStore(() => dataStore);

  _registered = true;
}

// 向后兼容: 让 domain 代码迁移期间仍可用旧 API
// 这些 re-export 在 P3.2 完成后可移除
export { getLLMClient, getVectorStore, getGraphRepository, getDataStore };
