// ============================================================
// MiniMem — 遗忘权（forget_about: 7 步级联删除）
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import { createAuditLog } from '../version/audit.js';

const log = getLogger('lifecycle:forget');

export interface ForgetResult {
  entity: string;
  dry_run: boolean;
  deleted: {
    experiences: number;
    world_facts: number;
    observations: number;
    mental_models: number;
    knowledge_pages: number;
    condition_index: number;
    fts_entries: number;
  };
  tombstones_created: number;
}

/**
 * 7 步级联遗忘流程
 * 
 * 1. 搜索所有包含该实体的记忆
 * 2. 创建墓碑记录（保留元数据不保留内容）
 * 3. 删除 L1 经历
 * 4. 删除 L2 事实
 * 5. 软标记/删除 L3 观察（REQ-014: 非 force 模式软标记）
 * 6. 软标记/删除 L4 心智模型（REQ-014: 非 force 模式软标记）
 * 7. 清理索引（条件索引 + FTS + 知识页面 + 图边）
 */
export function forgetAbout(entity: string, dryRun: boolean = false, force: boolean = false): ForgetResult {
  const db = getDb();
  const pattern = `%${entity}%`;
  const timestamp = now();

  const result: ForgetResult = {
    entity,
    dry_run: dryRun,
    deleted: { experiences: 0, world_facts: 0, observations: 0, mental_models: 0, knowledge_pages: 0, condition_index: 0, fts_entries: 0 },
    tombstones_created: 0,
  };

  // Step 1: 搜索所有相关记忆
  const l1Ids = db.prepare(
    "SELECT id FROM experiences WHERE branch = 'main' AND (raw_content LIKE ? OR tags LIKE ? OR participants LIKE ?)"
  ).all(pattern, pattern, pattern) as Array<{ id: string }>;

  const l2Ids = db.prepare(
    "SELECT id FROM world_facts WHERE branch = 'main' AND (subject LIKE ? OR predicate LIKE ? OR object LIKE ?)"
  ).all(pattern, pattern, pattern) as Array<{ id: string }>;

  const l3Ids = db.prepare(
    "SELECT id FROM observations WHERE branch = 'main' AND description LIKE ?"
  ).all(pattern) as Array<{ id: string }>;

  const l4Ids = db.prepare(
    "SELECT id FROM mental_models WHERE branch = 'main' AND (title LIKE ? OR content LIKE ?)"
  ).all(pattern, pattern) as Array<{ id: string }>;

  const pageIds = db.prepare(
    "SELECT id FROM knowledge_pages WHERE branch = 'main' AND (title LIKE ? OR content LIKE ? OR slug LIKE ?)"
  ).all(pattern, pattern, pattern) as Array<{ id: string }>;

  result.deleted.experiences = l1Ids.length;
  result.deleted.world_facts = l2Ids.length;
  result.deleted.observations = l3Ids.length;
  result.deleted.mental_models = l4Ids.length;
  result.deleted.knowledge_pages = pageIds.length;

  if (dryRun) {
    log.info({ entity, ...result.deleted }, 'Forget dry-run completed');
    return result;
  }

  // Step 2-7: 执行删除（事务保护）
  db.transaction(() => {
    // Step 2: 创建墓碑
    const allIds = [
      ...l1Ids.map(r => ({ id: r.id, type: 'L1' })),
      ...l2Ids.map(r => ({ id: r.id, type: 'L2' })),
      ...l3Ids.map(r => ({ id: r.id, type: 'L3' })),
      ...l4Ids.map(r => ({ id: r.id, type: 'L4' })),
      ...pageIds.map(r => ({ id: r.id, type: 'page' })),
    ];

    const tombstoneStmt = db.prepare(`
      INSERT INTO memory_tombstones (id, original_id, original_type, topics, summary, reason, created_at)
      VALUES (?, ?, ?, ?, ?, 'manual', ?)
    `);

    for (const item of allIds) {
      tombstoneStmt.run(generateId(), item.id, item.type, JSON.stringify([entity]), `Forgotten: ${entity}`, timestamp);
      result.tombstones_created++;
    }

    // Step 3: 删除 L1
    for (const { id } of l1Ids) {
      db.prepare('DELETE FROM experiences WHERE id = ?').run(id);
    }

    // Step 4: 删除 L2
    for (const { id } of l2Ids) {
      db.prepare('DELETE FROM world_facts WHERE id = ?').run(id);
    }

    // Step 5: L3 — REQ-014: 非 force 模式下软标记，不物理删除
    for (const { id } of l3Ids) {
      if (force) {
        db.prepare('DELETE FROM observations WHERE id = ?').run(id);
      } else {
        db.prepare("UPDATE observations SET confidence = 0.1, tags = json_insert(tags, '$[#]', 'superseded_by_forget'), updated_at = ? WHERE id = ?").run(timestamp, id);
      }
    }

    // Step 6: L4 — REQ-014: 非 force 模式下 deactivate，不物理删除
    for (const { id } of l4Ids) {
      if (force) {
        db.prepare('DELETE FROM mental_models WHERE id = ?').run(id);
      } else {
        db.prepare('UPDATE mental_models SET is_active = 0, updated_at = ? WHERE id = ?').run(timestamp, id);
      }
    }

    // 删除知识页面
    for (const { id } of pageIds) {
      db.prepare('DELETE FROM knowledge_pages WHERE id = ?').run(id);
    }

    // Step 7: 清理索引
    const allMemIds = allIds.map(i => i.id);
    if (allMemIds.length > 0) {
      const placeholders = allMemIds.map(() => '?').join(',');

      // 条件索引
      const ciResult = db.prepare(`DELETE FROM condition_index WHERE memory_id IN (${placeholders})`).run(...allMemIds);
      result.deleted.condition_index = ciResult.changes;

      // FTS 索引
      const ftsResult = db.prepare(`DELETE FROM memory_fts WHERE memory_id IN (${placeholders})`).run(...allMemIds);
      result.deleted.fts_entries = ftsResult.changes;

      // 温度记录
      db.prepare(`DELETE FROM memory_temperature WHERE memory_id IN (${placeholders})`).run(...allMemIds);

      // 图边
      db.prepare(`DELETE FROM memory_links WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`).run(...allMemIds, ...allMemIds);

      // 知识页面证据链
      db.prepare(`DELETE FROM knowledge_page_evidence WHERE evidence_id IN (${placeholders})`).run(...allMemIds);
    }
  })();

  // 审计日志
  createAuditLog({
    action: 'forget',
    target_type: 'entity',
    target_id: entity,
    after_value: JSON.stringify(result.deleted),
    triggered_by: 'user',
  });

  const total = result.deleted.experiences + result.deleted.world_facts + result.deleted.observations + result.deleted.mental_models + result.deleted.knowledge_pages;
  log.info({ entity, totalDeleted: total, tombstones: result.tombstones_created }, 'Entity forgotten');

  return result;
}
