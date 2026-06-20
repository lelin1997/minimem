// ============================================================
// MiniMem — Domain Ports Barrel (P3.1)
// ============================================================
// domain 层通过此 barrel 访问所有基础设施能力。
// 禁止 domain 代码直接 import 'infra/*'。

// MemoryRepository (C4 已建)
export type { MemoryRepository, UnifiedMemory, MemoryQuery } from './memory-repository.js';

// LLM Client
export type { LLMClient, ChatMessage, ChatCompletionOptions, ChatCompletionResult, EmbeddingResult, ModelTier } from './llm-client.js';
export { registerLLMClient, getLLMClient } from './llm-client.js';

// Vector Store
export type { VectorProvider, VectorSearchResult, VectorWalkTrail } from './vector-store.js';
export { registerVectorStore, getVectorStore } from './vector-store.js';

// Graph Repository
export type { GraphRepository } from './graph-repository.js';
export { registerGraphRepository, getGraphRepository } from './graph-repository.js';

// Data Store (Facade)
export type { DataStore } from './data-store.js';
export { registerDataStore, getDataStore } from './data-store.js';
