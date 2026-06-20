// ============================================================
// MiniMem — Dream Quality Score (TODO-031)
// ============================================================
// 计算做梦质量评分 (0-1)。
// 因子: 新连接数 + insight 数 + 冲突数 + LLM 自评分
// <0.3 标记为低质量

export interface QualityFactors {
  /** 新建记忆连接数 */
  newConnections: number;
  /** 产出 insight 数 */
  insights: number;
  /** 冲突数（矛盾/重复） */
  conflicts: number;
  /** LLM 自评分 (0-1) */
  llmSelfScore: number;
  /** 处理的记忆数（归一化基数） */
  processedMemories: number;
}

export interface QualityResult {
  /** 综合评分 0-1 */
  score: number;
  /** 评分因子明细 */
  factors: QualityFactors;
  /** 是否低质量 (<0.3) */
  isLowQuality: boolean;
  /** 评分说明 */
  explanation: string;
}

/**
 * 计算做梦质量评分 (TODO-031)
 *
 * 评分公式:
 *   connectivity = min(newConnections / max(processedMemories * 0.3, 1), 1) * 0.3
 *   productivity = min(insights / max(processedMemories * 0.1, 1), 1) * 0.25
 *   conflictPenalty = min(conflicts / max(processedMemories * 0.2, 1), 1) * 0.15
 *   llmScore = llmSelfScore * 0.3
 *   score = connectivity + productivity - conflictPenalty + llmScore
 *
 * 权重: 连接 30% + 产出 25% - 冲突 15% + LLM 30%
 */
export function calculateDreamQuality(factors: QualityFactors): QualityResult {
  const { newConnections, insights, conflicts, llmSelfScore, processedMemories } = factors;

  // 防止除零
  const base = Math.max(processedMemories, 1);

  // 连接密度（新建连接占处理记忆的比例，30% 权重）
  const connectivityRaw = Math.min(newConnections / (base * 0.3), 1);
  const connectivity = connectivityRaw * 0.3;

  // 产出效率（insight 占处理记忆的比例，25% 权重）
  const productivityRaw = Math.min(insights / (base * 0.1), 1);
  const productivity = productivityRaw * 0.25;

  // 冲突惩罚（冲突占处理记忆的比例，15% 扣分）
  const conflictRatio = Math.min(conflicts / (base * 0.2), 1);
  const conflictPenalty = conflictRatio * 0.15;

  // LLM 自评分（30% 权重）
  const clampedLlmScore = Math.max(0, Math.min(1, llmSelfScore));
  const llmWeighted = clampedLlmScore * 0.3;

  // 综合评分
  const score = Math.max(0, Math.min(1, connectivity + productivity - conflictPenalty + llmWeighted));

  const isLowQuality = score < 0.3;

  const explanation = `score=${score.toFixed(3)} | conn=${connectivityRaw.toFixed(2)}×0.3 + prod=${productivityRaw.toFixed(2)}×0.25 - conflict=${conflictRatio.toFixed(2)}×0.15 + llm=${clampedLlmScore.toFixed(2)}×0.3`;

  return {
    score: Math.round(score * 1000) / 1000, // 保留 3 位小数
    factors,
    isLowQuality,
    explanation,
  };
}

/**
 * 从 dream report 提取 quality 因子（便捷方法）
 */
export function extractQualityFactors(
  report: {
    consolidation?: {
      l1_to_l2_extracted?: number;
      l2_to_l3_induced?: number;
      l3_to_l4_proposed?: number;
    };
    pages?: {
      created?: number;
      updated?: number;
    };
    dream?: {
      narrative_summary?: string;
    };
  },
  options?: {
    newConnections?: number;
    insights?: number;
    conflicts?: number;
    llmSelfScore?: number;
    processedMemories?: number;
  },
): QualityFactors {
  return {
    newConnections: options?.newConnections ?? 0,
    insights: options?.insights ?? (report.pages?.created ?? 0),
    conflicts: options?.conflicts ?? 0,
    llmSelfScore: options?.llmSelfScore ?? 0.5, // 默认中性
    processedMemories: options?.processedMemories ??
      (report.consolidation?.l1_to_l2_extracted ?? 0) +
      (report.consolidation?.l2_to_l3_induced ?? 0) +
      (report.consolidation?.l3_to_l4_proposed ?? 0),
  };
}
