// ============================================================
// MiniMem — Store 模块统一导出
// ============================================================

// 数据库
export { initDb, getDb, closeDb, transaction } from './database.js';
export { runMigrations, getSchemaVersion, getSchemaVersionNumber, getMigrationStatus, rollbackMigrations, runIncrementalMigrations } from './migrate.js';

// L1-L4 四层存储
export * from './experiences.js';
export * from './world-facts.js';
export * from './observations.js';
export * from './mental-models.js';

// Knowledge Pages (Karpathy Compile)
export * from './knowledge-pages/index.js';

// 图存储
export * as graph from './graph.js';

// 向量存储
export { MemoryVectorStore, getVectorStore, initVectorStore } from './vectors.js';
export type { VectorProvider, VectorSearchResult } from './vector-provider.js';

// 索引
export * from './indexes.js';
