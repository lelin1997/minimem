// ============================================================
// MiniMem — 引用完整性检查（修复悬空引用）
// ============================================================

import { getDb } from './database.js';
import { getLogger } from '../common/logger.js';

const log = getLogger('store:integrity');

export interface IntegrityReport {
  checked: boolean;
  orphaned_links: number;
  orphaned_evidence: number;
  orphaned_conditions: number;
  orphaned_temperatures: number;
  repaired: number;
}

/**
 * 检查并修复引用完整性
 */
export function checkAndRepairIntegrity(repair: boolean = true): IntegrityReport {
  const db = getDb();
  log.info({ repair }, 'Starting integrity check');

  const report: IntegrityReport = {
    checked: true,
    orphaned_links: 0,
    orphaned_evidence: 0,
    orphaned_conditions: 0,
    orphaned_temperatures: 0,
    repaired: 0,
  };

  // 1. 检查 memory_links 中引用的 source/target 是否存在
  const orphanedLinks = db.prepare(`
    SELECT id FROM memory_links
    WHERE (source_type = 'L1' AND source_id NOT IN (SELECT id FROM experiences))
       OR (source_type = 'L2' AND source_id NOT IN (SELECT id FROM world_facts))
       OR (source_type = 'L3' AND source_id NOT IN (SELECT id FROM observations))
       OR (source_type = 'L4' AND source_id NOT IN (SELECT id FROM mental_models))
       OR (target_type = 'L1' AND target_id NOT IN (SELECT id FROM experiences))
       OR (target_type = 'L2' AND target_id NOT IN (SELECT id FROM world_facts))
       OR (target_type = 'L3' AND target_id NOT IN (SELECT id FROM observations))
       OR (target_type = 'L4' AND target_id NOT IN (SELECT id FROM mental_models))
  `).all() as Array<{ id: string }>;

  report.orphaned_links = orphanedLinks.length;

  if (repair && orphanedLinks.length > 0) {
    const ids = orphanedLinks.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM memory_links WHERE id IN (${placeholders})`).run(...ids);
    report.repaired += orphanedLinks.length;
    log.info({ count: orphanedLinks.length }, 'Orphaned links removed');
  }

  // 2. 检查 knowledge_page_evidence 中的悬空引用
  const orphanedEvidence = db.prepare(`
    SELECT id FROM knowledge_page_evidence
    WHERE page_id NOT IN (SELECT id FROM knowledge_pages)
  `).all() as Array<{ id: string }>;

  report.orphaned_evidence = orphanedEvidence.length;

  if (repair && orphanedEvidence.length > 0) {
    const ids = orphanedEvidence.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM knowledge_page_evidence WHERE id IN (${placeholders})`).run(...ids);
    report.repaired += orphanedEvidence.length;
    log.info({ count: orphanedEvidence.length }, 'Orphaned evidence removed');
  }

  // 3. 检查 condition_index 中的悬空条目
  const orphanedConditions = db.prepare(`
    SELECT condition_key, memory_type, memory_id FROM condition_index
    WHERE (memory_type = 'L1' AND memory_id NOT IN (SELECT id FROM experiences))
       OR (memory_type = 'L2' AND memory_id NOT IN (SELECT id FROM world_facts))
       OR (memory_type = 'L3' AND memory_id NOT IN (SELECT id FROM observations))
       OR (memory_type = 'L4' AND memory_id NOT IN (SELECT id FROM mental_models))
  `).all() as Array<{ condition_key: string; memory_type: string; memory_id: string }>;

  report.orphaned_conditions = orphanedConditions.length;

  if (repair && orphanedConditions.length > 0) {
    const stmt = db.prepare(
      'DELETE FROM condition_index WHERE condition_key = ? AND memory_type = ? AND memory_id = ?'
    );
    db.transaction(() => {
      for (const c of orphanedConditions) {
        stmt.run(c.condition_key, c.memory_type, c.memory_id);
      }
    })();
    report.repaired += orphanedConditions.length;
    log.info({ count: orphanedConditions.length }, 'Orphaned conditions removed');
  }

  // 4. 检查 memory_temperature 中的悬空条目
  const orphanedTemps = db.prepare(`
    SELECT memory_id, memory_type FROM memory_temperature
    WHERE (memory_type = 'L1' AND memory_id NOT IN (SELECT id FROM experiences))
       OR (memory_type = 'L2' AND memory_id NOT IN (SELECT id FROM world_facts))
       OR (memory_type = 'L3' AND memory_id NOT IN (SELECT id FROM observations))
       OR (memory_type = 'L4' AND memory_id NOT IN (SELECT id FROM mental_models))
  `).all() as Array<{ memory_id: string; memory_type: string }>;

  report.orphaned_temperatures = orphanedTemps.length;

  if (repair && orphanedTemps.length > 0) {
    const stmt = db.prepare(
      'DELETE FROM memory_temperature WHERE memory_id = ? AND memory_type = ?'
    );
    db.transaction(() => {
      for (const t of orphanedTemps) {
        stmt.run(t.memory_id, t.memory_type);
      }
    })();
    report.repaired += orphanedTemps.length;
    log.info({ count: orphanedTemps.length }, 'Orphaned temperatures removed');
  }

  log.info(report, 'Integrity check completed');
  return report;
}
