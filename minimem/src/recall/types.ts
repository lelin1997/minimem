// ============================================================
// MiniMem — Hint-Driven Recall 类型定义 (MINIMEM-006)
// ============================================================

import type { MemoryLayer } from '../common/types.js';

// ── 请求/响应类型 ──

export interface HintRequest {
  /** 当前用户消息 */
  message: string;
  /** 对话上下文摘要（提升检索精度） */
  context_summary?: string;
  /** 最近 2-3 轮对话 */
  conversation_history?: string[];
  /** 最大返回条数（默认 3） */
  max_hints?: number;
  /** Hint 总 token 预算（默认 200） */
  token_budget?: number;
  /** 领域过滤 */
  domain?: string;
}

export interface HintResponse {
  hints: Hint[];
  meta: HintMeta;
}

export interface Hint {
  /** Hint 唯一 ID */
  id: string;
  /** 关联的记忆 ID */
  memory_id: string;
  /** 一句话摘要 */
  summary: string;
  /** 时间标签（如 "10 天前"） */
  time_label: string;
  /** 相关性评分 0-1 */
  relevance_score: number;
  /** 预生成的深度检索 query */
  recall_query: string;
  /** 来源记忆层级 */
  layer: MemoryLayer;
  /** 标签 */
  tags: string[];
}

export interface HintMeta {
  /** 检索耗时（ms） */
  search_time_ms: number;
  /** 候选总数 */
  total_candidates: number;
  /** Hint 总 token 数 */
  token_count: number;
}

// ── Skip 判断 ──

export interface SkipResult {
  /** 是否跳过 */
  skip: boolean;
  /** 跳过原因 */
  reason: string;
}

// ── 信号系统 ──

export interface SignalResult {
  /** 记忆 ID */
  memory_id: string;
  /** 信号分数 0-1 */
  score: number;
  /** 信号来源 */
  source: SignalSource;
  /** 记忆层级 */
  layer: MemoryLayer;
}

export type SignalSource = 'semantic' | 'entity' | 'time' | 'graph';

// ── 融合评分 ──

export interface FusionCandidate {
  memory_id: string;
  layer: MemoryLayer;
  /** 各信号的原始分数 */
  signals: Partial<Record<SignalSource, number>>;
  /** 融合后的最终分数 */
  final_score: number;
}

// ── 配置 ──

export interface RecallConfig {
  enabled: boolean;
  hints: {
    max_hints: number;
    min_relevance: number;
    token_budget: number;
    summary_max_chars: number;
    skip_min_length: number;
    signals: {
      semantic_weight: number;
      entity_weight: number;
      time_weight: number;
      graph_weight: number;
    };
    cache: {
      embedding_ttl: number;
      summary_ttl: number;
      session_reuse_threshold: number;
    };
  };
  auto: {
    default_mode: 'hint' | 'full' | 'smart';
    intent_model: string;
    intent_timeout_ms: number;
  };
}

// ── Auto-Recall ──

export interface AutoRecallRequest {
  message: string;
  context_summary?: string;
  agent_type?: string;
  mode?: 'hint' | 'full' | 'smart';
}

export interface AutoRecallResponse {
  should_recall: boolean;
  reasoning?: string;
  hints?: Hint[];
  full_memories?: Array<{ id: string; layer: MemoryLayer; content: string }>;
  surface_delta?: string | null;
}
