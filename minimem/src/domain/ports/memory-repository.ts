// ============================================================
// MiniMem — MemoryRepository 接口 (TODO-039 P3 C4)
// ============================================================
// 四层记忆表的统一访问接口。
// 物理表保持不变 (experiences/world_facts/observations/mental_models)，
// 但通过此接口统一 CRUD 入口，为未来物理合并做准备。
// ============================================================

import type { MemoryLayer } from '../../common/types.js';

/**
 * 统一记忆条目 — 通过 memories 视图查询时返回的结构
 */
export interface UnifiedMemory {
  id: string;
  layer: MemoryLayer;
  content: string;
  source: string | null;
  importance: number | null;
  tags: string[];
  participants: string[];
  context: string | null;
  embedding_id: string | null;
  snapshot_id: string | null;
  branch: string;
  domain: string;
  created_at: string;
  updated_at: string;
  // L2 特有
  subject?: string | null;
  predicate?: string | null;
  object?: string | null;
  confidence?: number | null;
  // L3 特有
  description?: string | null;
  observation_type?: string | null;
  // L4 特有
  title?: string | null;
  model_type?: string | null;
  priority?: number | null;
  is_active?: number | null;
}

/**
 * 统一记忆查询条件
 */
export interface MemoryQuery {
  layer?: MemoryLayer;
  domain?: string;
  branch?: string;
  tags?: string[];
  minImportance?: number;
  minConfidence?: number;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'updated_at' | 'importance' | 'confidence';
  order?: 'ASC' | 'DESC';
}

/**
 * 四层记忆表统一 Repository 接口
 *
 * 实现方: src/infra/store/memory-repository.ts
 * 使用方: domain 层通过此接口访问记忆，不直接操作物理表
 */
export interface MemoryRepository {
  // ── 查询 ──
  /** 通过 memories 视图统一查询 */
  query(query: MemoryQuery): Promise<UnifiedMemory[]>;

  /** 按 ID 查询（自动识别 layer） */
  getById(id: string): Promise<UnifiedMemory | null>;

  /** 按 layer 统计数量 */
  countByLayer(layer?: MemoryLayer): Promise<Record<MemoryLayer, number>>;

  // ── 写入（按 layer 路由到物理表）──
  /** 添加 L1 记忆 */
  addL1(data: {
    raw_content: string;
    source: string;
    content_type?: string;
    importance?: number;
    tags?: string[];
    participants?: string[];
    context?: string;
    domain?: string;
  }): Promise<string>;

  /** 添加 L2 事实 */
  addL2(data: {
    subject: string;
    predicate: string;
    object: string;
    confidence?: number;
    source?: string;
    domain?: string;
  }): Promise<string>;

  /** 添加 L3 观察 */
  addL3(data: {
    description: string;
    observation_type?: string;
    confidence?: number;
    tags?: string[];
    domain?: string;
  }): Promise<string>;

  /** 添加 L4 心智模型 */
  addL4(data: {
    title: string;
    content: string;
    model_type?: string;
    priority?: number;
    domain?: string;
  }): Promise<string>;

  // ── 删除 ──
  /** 按 ID 删除（自动识别 layer 并路由） */
  delete(id: string): Promise<boolean>;

  // ── 域操作 ──
  /** 列出所有 domain 的记忆分布 */
  listDomains(): Promise<Array<{ domain: string; count: number; layers: MemoryLayer[] }>>;
}
