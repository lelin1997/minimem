// ============================================================
// MiniMem — 信念漂移检测器 (REQ-012 / TODO-017)
// ============================================================
// 检测高 confidence 但低支撑度的 L3 观察，标记 drift_risk
//
// 核心算法：
//   对每条 L3 观察，计算"支撑度"（活跃 L2 数量）
//   高 confidence（≥0.7）且低支撑度（<2 条活跃 L2）→ drift_risk = 1

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { getConfig } from '../config/index.js';

const log = getLogger('core:drift-detector');

// ── 配置常量（后续可迁移到 config） ──

/** 触发漂移标记的最低 confidence 阈值 */
const DRIFT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * MINIMEM-003 T-E07: 低于此加权支撑和视为"低支撑度"
 * 原逻辑: < 2 条活跃 L2（计数）
 * 新逻辑: < 1.5 加权和（时间加权）
 */
const DRIFT_MIN_SUPPORT_WEIGHTED = 1.5;

/** L2 事实被视为"活跃"的最低 confidence */
const ACTIVE_FACT_CONFIDENCE = 0.4;

/**
 * MINIMEM-003 T-E07: 支撑度时间衰减系数 λ
 * weight = confidence * exp(-λ * daysSinceCreated)
 * 默认 0.01: 100 天后权重衰减到 ~37%
 */
const DEFAULT_SUPPORT_DECAY_LAMBDA = 0.01;

// ── 接口 ──

export interface DriftScanResult {
  scanned: number;         // 扫描的 L3 总数
  at_risk: number;         // 新标记为 drift_risk 的数量
  cleared: number;         // 清除 drift_risk 标记的数量
  already_at_risk: number; // 已标记且维持不变的数量
  duration_ms: number;
}

export interface BeliefHealthReport {
  total_observations: number;
  at_risk_count: number;
  at_risk_rate: number;       // 0-1
  high_confidence_count: number;
  average_support: number;
  drift_observations: Array<{
    id: string;
    description: string;
    confidence: number;
    support_count: number;
    drift_risk: boolean;
  }>;
}

// ── 核心函数 ──

/**
 * 扫描所有活跃 L3 观察，检测信念漂移风险
 *
 * 算法：
 * 1. 遍历所有 branch='main' 的 L3 观察
 * 2. 对每条 L3，从 compilation_trace + supporting_fact_ids 获取关联的 L2 ID
 * 3. 查询这些 L2 中仍然活跃（confidence ≥ 0.4）的数量
 * 4. 如果 confidence ≥ 0.7 且 活跃支撑 < 2 → drift_risk = 1
 * 5. 否则如果之前被标记 → 清除 drift_risk = 0
 *
 * @returns 扫描结果统计
 */
export function scanDrift(): DriftScanResult {
  const start = Date.now();
  const db = getDb();
  const nowMs = Date.now();

  // MINIMEM-003 T-E07: 从配置读取时间衰减参数
  let supportDecayLambda = DEFAULT_SUPPORT_DECAY_LAMBDA;
  let minSupportWeighted = DRIFT_MIN_SUPPORT_WEIGHTED;
  try {
    const cfg = getConfig();
    const dreamingCfg = cfg.dreaming as Record<string, unknown>;
    if (dreamingCfg.support_decay_lambda !== undefined) {
      supportDecayLambda = dreamingCfg.support_decay_lambda as number;
    }
    if (dreamingCfg.drift_min_support_weighted !== undefined) {
      minSupportWeighted = dreamingCfg.drift_min_support_weighted as number;
    }
  } catch {
    // 使用默认值
  }

  // 获取所有活跃的 L3 观察
  const observations = db.prepare(`
    SELECT id, confidence, supporting_fact_ids, drift_risk
    FROM observations
    WHERE branch = 'main'
  `).all() as Array<{
    id: string;
    confidence: number;
    supporting_fact_ids: string;
    drift_risk: number;
  }>;

  let atRisk = 0;
  let cleared = 0;
  let alreadyAtRisk = 0;

  // 预编译查询语句
  const getTraceSupports = db.prepare(`
    SELECT DISTINCT source_id FROM compilation_trace
    WHERE target_id = ? AND target_type = 'L3' AND source_type = 'L2'
  `);

  // MINIMEM-003 T-E07: 查询活跃 L2 事实的 confidence 和 created_at（用于时间加权）
  const getActiveFactDetails = db.prepare(`
    SELECT id, confidence, created_at FROM world_facts
    WHERE id IN (SELECT value FROM json_each(?))
      AND branch = 'main'
      AND confidence >= ?
  `);

  const markDriftRisk = db.prepare(`
    UPDATE observations SET drift_risk = ?, updated_at = datetime('now') WHERE id = ?
  `);

  // 批量处理在事务内
  db.transaction(() => {
    for (const obs of observations) {
      // 1. 收集所有关联的 L2 ID（从 supporting_fact_ids + compilation_trace）
      const supportIds = new Set<string>();

      // 从 supporting_fact_ids JSON 数组
      try {
        const ids = JSON.parse(obs.supporting_fact_ids || '[]') as string[];
        for (const id of ids) supportIds.add(id);
      } catch {
        // 无效 JSON，跳过
      }

      // 从 compilation_trace 表
      const traces = getTraceSupports.all(obs.id) as Array<{ source_id: string }>;
      for (const t of traces) supportIds.add(t.source_id);

      // 2. MINIMEM-003 T-E07: 计算时间加权支撑和
      const allIds = Array.from(supportIds);
      let weightedSupport = 0;

      if (allIds.length > 0) {
        const facts = getActiveFactDetails.all(
          JSON.stringify(allIds),
          ACTIVE_FACT_CONFIDENCE,
        ) as Array<{ id: string; confidence: number; created_at: string }>;

        for (const fact of facts) {
          // weight = confidence * exp(-λ * daysSinceCreated)
          const daysSinceCreated = Math.max(0, (nowMs - new Date(fact.created_at).getTime()) / (1000 * 60 * 60 * 24));
          const timeWeight = Math.exp(-supportDecayLambda * daysSinceCreated);
          weightedSupport += fact.confidence * timeWeight;
        }
      }

      // 3. 判断漂移风险（使用加权支撑和而非简单计数）
      const shouldBeAtRisk = obs.confidence >= DRIFT_CONFIDENCE_THRESHOLD && weightedSupport < minSupportWeighted;
      const currentlyAtRisk = obs.drift_risk === 1;

      if (shouldBeAtRisk && !currentlyAtRisk) {
        // 新标记为漂移风险
        markDriftRisk.run(1, obs.id);
        atRisk++;
        log.info({ id: obs.id, confidence: obs.confidence, weightedSupport: Math.round(weightedSupport * 100) / 100 },
          'Observation marked as drift risk');
      } else if (!shouldBeAtRisk && currentlyAtRisk) {
        // 清除漂移风险
        markDriftRisk.run(0, obs.id);
        cleared++;
        log.debug({ id: obs.id, confidence: obs.confidence, weightedSupport: Math.round(weightedSupport * 100) / 100 },
          'Observation drift risk cleared');
      } else if (shouldBeAtRisk && currentlyAtRisk) {
        alreadyAtRisk++;
      }
    }
  })();

  const result: DriftScanResult = {
    scanned: observations.length,
    at_risk: atRisk,
    cleared,
    already_at_risk: alreadyAtRisk,
    duration_ms: Date.now() - start,
  };

  log.info(result, 'Drift scan complete');
  return result;
}

/**
 * 获取信念健康报告（供 MCP get_belief_health 工具使用）
 *
 * @param limit 最多返回多少条漂移风险观察的详情（默认 20）
 * @returns 信念健康报告
 */
export function getBeliefHealth(limit: number = 20): BeliefHealthReport {
  const db = getDb();

  // 总量统计
  const totalRow = db.prepare(
    "SELECT COUNT(*) as count FROM observations WHERE branch = 'main'"
  ).get() as { count: number };

  const atRiskRow = db.prepare(
    "SELECT COUNT(*) as count FROM observations WHERE branch = 'main' AND drift_risk = 1"
  ).get() as { count: number };

  const highConfRow = db.prepare(
    "SELECT COUNT(*) as count FROM observations WHERE branch = 'main' AND confidence >= ?"
  ).get(DRIFT_CONFIDENCE_THRESHOLD) as { count: number };

  // 平均支撑度（通过 compilation_trace 计算）
  const avgSupportRow = db.prepare(`
    SELECT AVG(support_count) as avg_support FROM (
      SELECT o.id, COUNT(ct.source_id) as support_count
      FROM observations o
      LEFT JOIN compilation_trace ct ON ct.target_id = o.id AND ct.target_type = 'L3' AND ct.source_type = 'L2'
      WHERE o.branch = 'main'
      GROUP BY o.id
    )
  `).get() as { avg_support: number | null };

  // 漂移风险观察详情
  const driftObs = db.prepare(`
    SELECT o.id, o.description, o.confidence, o.drift_risk,
           COUNT(ct.source_id) as support_count
    FROM observations o
    LEFT JOIN compilation_trace ct ON ct.target_id = o.id AND ct.target_type = 'L3' AND ct.source_type = 'L2'
    LEFT JOIN world_facts wf ON wf.id = ct.source_id AND wf.confidence >= ?
    WHERE o.branch = 'main' AND o.drift_risk = 1
    GROUP BY o.id
    ORDER BY o.confidence DESC
    LIMIT ?
  `).all(ACTIVE_FACT_CONFIDENCE, limit) as Array<{
    id: string;
    description: string;
    confidence: number;
    drift_risk: number;
    support_count: number;
  }>;

  return {
    total_observations: totalRow.count,
    at_risk_count: atRiskRow.count,
    at_risk_rate: totalRow.count > 0 ? atRiskRow.count / totalRow.count : 0,
    high_confidence_count: highConfRow.count,
    average_support: avgSupportRow.avg_support ?? 0,
    drift_observations: driftObs.map(o => ({
      id: o.id,
      description: o.description,
      confidence: o.confidence,
      support_count: o.support_count,
      drift_risk: o.drift_risk === 1,
    })),
  };
}
