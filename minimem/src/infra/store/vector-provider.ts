// ============================================================
// MiniMem — 向量存储 Provider (向后兼容 re-export)
// ============================================================
// P3.1: 接口定义已移至 domain/ports/vector-store.ts
// 本文件 re-export 以保持现有 infra 代码 import 路径不变

export type {
  VectorProvider,
  VectorSearchResult,
  VectorWalkTrail,
} from '../../domain/ports/vector-store.js';
