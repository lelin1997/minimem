// ============================================================
// MiniMem — 全局常量定义
// ============================================================

/**
 * 压缩级别常量
 *
 * 0 = Full（完整原文）
 * 1 = Summary（保留摘要，原文备份到 context）
 * 2 = Key Points（仅保留关键点，原文备份到 context）
 * 3 = One-line（一行描述，原文不可恢复）
 */
export const COMPRESSION_LEVEL = {
  FULL: 0,
  SUMMARY: 1,
  KEY_POINTS: 2,
  ONE_LINE: 3,
} as const;

/** 最高压缩级别 */
export const MAX_COMPRESSION_LEVEL = COMPRESSION_LEVEL.ONE_LINE; // = 3

/** 超过此级别的压缩不可逆（原文已丢失） */
export const IRREVERSIBLE_COMPRESSION_LEVEL = COMPRESSION_LEVEL.ONE_LINE; // = 3

/** 可逆压缩的最高级别（原文仍在 context 中） */
export const MAX_REVERSIBLE_COMPRESSION_LEVEL = COMPRESSION_LEVEL.KEY_POINTS; // = 2

/**
 * 层级保护规则
 *
 * 每个记忆层级允许的最大压缩级别和是否允许物理删除。
 * L1 经历可以完全压缩和删除；
 * L2 事实最多到关键点，不允许物理删除；
 * L3 观察最多到摘要，不允许物理删除；
 * L4 心智模型永不压缩，永不删除。
 */
export const LAYER_PROTECTION = {
  L1: { maxCompression: MAX_COMPRESSION_LEVEL, canDelete: true },
  L2: { maxCompression: COMPRESSION_LEVEL.KEY_POINTS, canDelete: false },
  L3: { maxCompression: COMPRESSION_LEVEL.SUMMARY, canDelete: false },
  L4: { maxCompression: COMPRESSION_LEVEL.FULL, canDelete: false },
} as const;

// ── MINIMEM-002: 灵感层常量 ──

/** 灵感保鲜期（天） */
export const INSPIRATION_TTL = {
  SPARK_DAYS: 7,
  INCUBATING_DAYS: 14,
  MATURE_DAYS: 30,
} as const;

/** 灵感评分公式权重和门槛 */
export const INSPIRATION_SCORE = {
  PERSIST_THRESHOLD: 0.5,    // 入库最低分
  GRAPH_LINK_THRESHOLD: 0.7, // 创建图连接的门槛
  WEIGHTS: {
    NOVELTY: 0.3,
    ACTIONABILITY: 0.4,
    CONFIDENCE: 0.3,
  },
} as const;

/** 习惯检测负面信号关键词 */
export const HABIT_NEGATIVE_KEYWORDS = [
  '失误', '错误', '忘记', '遗漏', '延迟', 'bug', '失败', '后悔',
  '问题', '事故', '回滚', 'mistake', 'error', 'forgot', 'miss',
  'delay', 'fail', 'regret', 'incident', 'rollback',
] as const;
