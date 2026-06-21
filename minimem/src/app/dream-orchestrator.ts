// ============================================================
// MiniMem — A02: Dream 编排器 (app 层)
// ============================================================
// 职责：dream session 的编排逻辑 — phase 顺序控制、错误恢复、
//       session 管理、snapshot 创建、报告生成、磁盘持久化
//
// 从 domain/dream/dream-engine.ts 迁移而来 (A02)
// domain 层保留纯逻辑函数 (runCompile/runDream/runCleanup 等)

import { getLogger } from '../common/logger.js';
import { getDb } from '../domain/ports/data-store.js';
import { generateId, now } from '../common/utils.js';
import { getConfig } from '../config/index.js';
import { createSnapshot } from '../domain/version/snapshot.js';
import { createBranch } from '../domain/version/branch.js';
import { syncAllSurfacesToDisk } from '../domain/surface/index.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// domain 层纯逻辑
import { runAudit, type AuditResult } from '../domain/dream/auditor.js';
import { runCompile, type CompileResult } from '../domain/dream/compiler.js';
import { runDream, type DreamResult } from '../domain/dream/dreamer.js';
import { runCleanup, type CleanupResult } from '../domain/dream/cleaner.js';
import { type KnowledgeAuditResult } from '../domain/dream/knowledge-auditor.js';
import { generateDreamReport, dreamReportToMarkdown, type DreamReport } from '../domain/dream/dream-report.js';
import type { ModelTier } from '../domain/ports/llm-client.js';
import type { SurfaceFileName } from '../common/types.js';

const log = getLogger('app:dream-orchestrator');

// ── 类型 re-export (从 domain 保留) ──

export type { DreamMode, DreamOptions, DreamProfile, CompileProfile } from '../domain/dream/dream-engine.js';
export type { DreamSession } from '../domain/dream/dream-engine.js';

import type { DreamMode, DreamOptions, DreamProfile, DreamSession } from '../domain/dream/dream-engine.js';

// ── Profile 定义 (编排配置) ──

const DREAM_PROFILES: Record<DreamMode, DreamProfile> = {
  daily: {
    compile: { extractFacts: 20, distillObservations: 10, promoteToMentalModels: 3, compileQueue: 20 },
    dream: { seedCount: 3, vectorWalkSteps: 2, vectorWalkBreadth: 3, graphDepth: 2, graphMaxNodes: 5, maxPairs: 5, llmTier: 'light' as ModelTier, llmTemperature: 0.7, maxDreamIterations: 2 },
    surfaceFiles: ['context.md', 'work.md', 'agent.md'] as SurfaceFileName[],
  },
  weekly: {
    compile: { extractFacts: 50, distillObservations: 30, promoteToMentalModels: 15, compileQueue: 50 },
    dream: { seedCount: 8, vectorWalkSteps: 4, vectorWalkBreadth: 5, graphDepth: 4, graphMaxNodes: 15, maxPairs: 15, llmTier: 'heavy' as ModelTier, llmTemperature: 0.85, maxDreamIterations: 3 },
    surfaceFiles: ['soul.md', 'me.md', 'life.md', 'social.md', 'context.md', 'work.md', 'agent.md', 'index.md', 'insight.md'] as SurfaceFileName[],
  },
};

// ── 编排主函数 ──

/**
 * 触发做梦流程 (编排层)
 *
 * 从 domain/dream/dream-engine.ts 迁移 (A02)
 * 负责编排：冷启动检查 → snapshot/branch → phase 1-4 → 报告 → 持久化
 * domain 层只暴露 runCompile/runDream/runCleanup 纯函数
 */
export async function triggerDream(options?: DreamOptions): Promise<DreamSession> {
  const sessionId = generateId();
  const mode = options?.mode ?? 'daily';
  const phasesToRun = options?.phases ?? [1, 2, 3, 4];
  const profile = DREAM_PROFILES[mode];
  const start = Date.now();
  const db = getDb();

  log.info({ sessionId, mode, phases: phasesToRun }, '🌙 Dream session started');

  // 冷启动检查
  const coldStartThreshold = getConfig().dreaming.cold_start_threshold;
  if (coldStartThreshold > 0) {
    const memoryCount = (db.prepare("SELECT COUNT(*) as count FROM experiences WHERE branch = 'main'").get() as { count: number }).count;
    if (memoryCount < coldStartThreshold) {
      log.info({ memoryCount, coldStartThreshold }, '[dream] skipped: memory count below cold_start_threshold');
      return { session_id: sessionId, mode, phases: phasesToRun, status: 'skipped', report: null };
    }
  }

  const session: DreamSession = {
    session_id: sessionId, mode, phases: phasesToRun, status: 'running', report: null,
  };

  // Pre-dream Safety: snapshot + branch
  let preSnapshotId: string;
  const dreamBranch = `dream-${sessionId.slice(0, 8)}`;
  let inspirationResult: import('../domain/dream/inspiration-engine.js').InspirationEngineResult | null = null;

  try {
    const preSnapshot = createSnapshot({ label: `pre-dream-${new Date().toISOString().slice(0, 10)}`, trigger: 'dream', branch: 'main' });
    preSnapshotId = preSnapshot.id;
    createBranch(dreamBranch, preSnapshotId);
    log.info({ preSnapshotId, dreamBranch }, 'Pre-dream safety: snapshot + branch created');
  } catch (err) {
    log.error({ err }, 'Failed to create pre-dream snapshot');
    session.status = 'failed';
    session.error = `Pre-dream safety failed: ${(err as Error).message}`;
    return session;
  }

  let auditResult: AuditResult | null = null;
  let compileResult: CompileResult | null = null;
  let dreamResult: DreamResult | null = null;
  let cleanupResult: CleanupResult | null = null;
  let knowledgeAuditResult: KnowledgeAuditResult | null = null;

  try {
    // Phase 1: 审计 (domain 纯逻辑)
    if (phasesToRun.includes(1)) {
      log.info('Running Phase 1: Audit');
      auditResult = runAudit();
      saveCheckpoint(db, sessionId, 1, preSnapshotId, auditResult);
    }

    // Phase 2: 编译 (domain 纯逻辑)
    if (phasesToRun.includes(2)) {
      log.info({ mode }, 'Running Phase 2: Compile');
      compileResult = await runCompile(profile.compile);
      saveCheckpoint(db, sessionId, 2, preSnapshotId, compileResult);

      // TODO-027: 记录 Surface 变更
      if (compileResult?.surface_changes && compileResult.surface_changes.length > 0) {
        const changedFiles = compileResult.surface_changes.filter(c => c.changed);
        if (changedFiles.length > 0) {
          log.info({ sessionId, surfaceChanges: changedFiles }, 'TODO-027: Surface files updated during compile');
          db.prepare(`INSERT INTO dream_logs (id, session_id, phase, narrative, llm_output_summary, created_at) VALUES (?, ?, 2, ?, ?, ?)`)
            .run(generateId(), sessionId, `Surface sync: ${changedFiles.map(c => c.file_name).join(', ')}`, JSON.stringify(compileResult.surface_changes), now());
        }
      }

      // 编译后漂移扫描
      try {
        const { scanDrift } = await import('../domain/core/drift-detector.js');
        log.info(scanDrift(), 'Post-compile drift scan complete');
      } catch (err) {
        log.warn({ err }, 'Drift scan failed (non-critical)');
      }

      // Phase 2.5: 知识审计
      try {
        const { runKnowledgeAudit: runKA } = await import('../domain/dream/knowledge-auditor.js');
        knowledgeAuditResult = await runKA();
        saveCheckpoint(db, sessionId, 2.5, preSnapshotId, knowledgeAuditResult);
        log.info(knowledgeAuditResult, '📋 Knowledge audit complete');
      } catch (err) {
        log.warn({ err }, 'Knowledge audit failed (non-critical)');
      }
    }

    // Phase 3: 做梦 (domain 纯逻辑)
    if (phasesToRun.includes(3)) {
      log.info({ mode }, 'Running Phase 3: Dream');
      dreamResult = await runDream(profile.dream);
      saveCheckpoint(db, sessionId, 3, preSnapshotId, dreamResult);

      // Phase 3.5: 灵感引擎 (实验性)
      const inspirationEnabled = getConfig().dreaming.inspiration?.enabled === true;
      if (inspirationEnabled) {
        try {
          const { runInspirationEngine } = await import('../domain/dream/inspiration-engine.js');
          inspirationResult = await runInspirationEngine({ dreamResult, mode, domain: options?.domain });
          saveCheckpoint(db, sessionId, 3.5, preSnapshotId, inspirationResult);
          log.info(inspirationResult, '💡 Inspiration engine complete');
        } catch (err) {
          log.warn({ err }, 'Inspiration engine failed (non-critical)');
        }
      }
    }

    // Phase 4: 清理 + Surface 同步 (A03: 编排决定同步哪些文件)
    if (phasesToRun.includes(4)) {
      log.info({ mode }, 'Running Phase 4: Cleanup');

      // A03: 动态扩展 Surface Files 列表 (编排逻辑)
      let effectiveSurfaceFiles = [...profile.surfaceFiles];
      try {
        const { getSyncerRegistry } = await import('../domain/surface/sync.js');
        const registry = getSyncerRegistry();
        for (const [fileName, syncer] of registry) {
          if (!effectiveSurfaceFiles.includes(fileName)) {
            try {
              if (syncer.hasChanges(null)) {
                effectiveSurfaceFiles.push(fileName);
                log.debug({ fileName }, 'Dynamically added surface file (hasChanges=true)');
              }
            } catch { /* hasChanges 检查失败不影响主流程 */ }
          }
        }
      } catch { /* syncer registry 不可用时使用原始列表 */ }

      cleanupResult = await runCleanup(preSnapshotId, dreamBranch, effectiveSurfaceFiles);
      saveCheckpoint(db, sessionId, 4, preSnapshotId, cleanupResult);
    }

    // 生成报告
    const totalDuration = Date.now() - start;
    const report = generateDreamReport(
      sessionId, preSnapshotId, totalDuration,
      auditResult ?? createEmptyAudit(),
      compileResult ?? createEmptyCompile(),
      dreamResult ?? createEmptyDream(),
      cleanupResult ?? createEmptyCleanup(preSnapshotId),
      inspirationResult ?? undefined,
    );

    session.report = report;
    session.status = 'completed';

    // 磁盘持久化
    try { saveDreamReportToDisk(sessionId, report); } catch (err) { log.warn({ err }, 'Failed to save dream report to disk (non-critical)'); }

    // A03: Surface Files 磁盘同步 (编排决定何时同步)
    try {
      syncAllSurfacesToDisk();
      log.debug('Surface files synced to disk after dream');
    } catch (err) {
      log.warn({ err }, 'Surface files disk sync failed after dream (non-critical)');
    }

    // 写入 dream_logs 总记录 (含 quality_score)
    const { calculateDreamQuality, extractQualityFactors } = await import('../domain/dream/quality-score.js');
    const qualityFactors = extractQualityFactors(report, {
      newConnections: report.consolidation?.l1_to_l2_extracted ?? 0,
      insights: report.pages?.created ?? 0,
      conflicts: 0,
      llmSelfScore: 0.5,
      processedMemories: (report.consolidation?.l1_to_l2_extracted ?? 0) + (report.consolidation?.l2_to_l3_induced ?? 0) + (report.consolidation?.l3_to_l4_proposed ?? 0),
    });
    const qualityResult = calculateDreamQuality(qualityFactors);

    db.prepare(`
      INSERT INTO dream_logs (id, session_id, phase, narrative, l1_to_l2, l2_to_l3, l3_to_l4,
        pages_created, pages_updated, compile_queue_processed, pre_snapshot_id, post_snapshot_id,
        duration_ms, created_at, seeds_json, pairs_json, llm_output_summary,
        new_connections, insights_count, conflicts_count, quality_score, quality_factors_json, surface_changes_json)
      VALUES (?, ?, 4, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId(), sessionId, report.dream.narrative_summary.slice(0, 1000),
      report.consolidation.l1_to_l2_extracted, report.consolidation.l2_to_l3_induced, report.consolidation.l3_to_l4_proposed,
      report.pages.created, report.pages.updated, compileResult?.compile_queue_processed ?? 0,
      preSnapshotId, report.version_control.post_snapshot_id, totalDuration, now(),
      JSON.stringify([]), JSON.stringify([]), (report.dream?.narrative_summary ?? '').slice(0, 2000),
      qualityFactors.newConnections, qualityFactors.insights, qualityFactors.conflicts,
      qualityResult.score, JSON.stringify({ ...qualityFactors, explanation: qualityResult.explanation }),
      JSON.stringify(cleanupResult?.surface_changes ?? []),
    );

    if (qualityResult.isLowQuality) {
      log.warn({ sessionId, qualityScore: qualityResult.score }, '⚠️ Dream marked low quality (score < 0.3)');
    } else {
      log.info({ sessionId, qualityScore: qualityResult.score }, 'Dream quality score calculated');
    }

    log.info({ sessionId, duration: totalDuration, status: 'completed' }, '🌅 Dream session completed');
  } catch (err) {
    session.status = 'partial';
    session.error = (err as Error).message;
    log.error({ sessionId, err }, '⚠️ Dream session failed partially');
  }

  return session;
}

export function getDreamReportMarkdown(session: DreamSession): string {
  if (!session.report) return '做梦报告不可用';
  return dreamReportToMarkdown(session.report);
}

// ── 辅助函数 ──

function saveCheckpoint(db: ReturnType<typeof getDb>, sessionId: string, phase: number, preSnapshotId: string, result: unknown): void {
  db.prepare(`INSERT INTO dream_logs (id, session_id, phase, narrative, pre_snapshot_id, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`)
    .run(generateId(), sessionId, phase, JSON.stringify(result).slice(0, 5000), preSnapshotId, now());
}

function createEmptyAudit(): AuditResult {
  return { total_new_memories: 0, by_source: {}, critical: [], important: [], routine: [], trivial: [], conflicts: [], duplicates: [], outdated: [], pages_linted: 0, lint_issues: [] };
}
function createEmptyCompile(): CompileResult {
  return { l1_to_l2: 0, l2_to_l3: 0, l3_to_l4: 0, pages_created: 0, pages_updated: 0, compile_queue_processed: 0 };
}
function createEmptyDream(): DreamResult {
  return { narrative: '', new_connections: 0, graph_discoveries: 0, insights_to_l3: 0, iterations_performed: 0, duration_ms: 0 };
}
function createEmptyCleanup(preSnapshotId: string): CleanupResult {
  return { gc_deleted: 0, gc_compressed: 0, surface_synced: 0, surface_updates: 0, surface_changes: [], post_snapshot_id: preSnapshotId, diff: null, merge: null };
}

function saveDreamReportToDisk(sessionId: string, report: DreamReport): void {
  const config = getConfig();
  const dreamsDir = join(config.storage.data_dir, 'dreams');
  if (!existsSync(dreamsDir)) mkdirSync(dreamsDir, { recursive: true });
  const dateStr = report.date.slice(0, 10);
  const shortId = sessionId.slice(0, 8);
  const baseName = `dream-${dateStr}-${shortId}`;
  writeFileSync(join(dreamsDir, `${baseName}.md`), dreamReportToMarkdown(report), 'utf-8');
  writeFileSync(join(dreamsDir, `${baseName}.json`), JSON.stringify(report, null, 2), 'utf-8');
  log.info({ dir: dreamsDir, baseName }, 'Dream report saved to disk');
}
