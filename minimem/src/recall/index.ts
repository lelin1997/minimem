// ============================================================
// MiniMem — Recall Module Entry (MINIMEM-006)
// ============================================================

export { HintsEngine } from './hints-engine.js';
export { shouldSkip } from './skip-rules.js';
export { fuseScores } from './score-fusion.js';
export { formatHints } from './hint-formatter.js';
export { HintsCache, getHintsCache, resetHintsCache, hashMessage } from './cache.js';
export {
  computeSemanticSignal,
  computeEntitySignal,
  extractEntities,
  computeTimeSignal,
  computeGraphSignal,
} from './signals/index.js';
export {
  recordHintsRequest,
  recordAutoRequest,
  recordSkip,
  recordSignal,
  recordCacheHit,
  getRecallMetrics,
  resetRecallMetrics,
} from './metrics.js';

// Types
export type {
  HintRequest,
  HintResponse,
  Hint,
  HintMeta,
  SkipResult,
  SignalResult,
  SignalSource,
  FusionCandidate,
  RecallConfig,
  AutoRecallRequest,
  AutoRecallResponse,
} from './types.js';
export type { HintsCacheConfig, CacheStats } from './cache.js';
