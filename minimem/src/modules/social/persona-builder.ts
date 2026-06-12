// ============================================================
// MiniMem — 社交模块：人设画像自动构建
// ============================================================

import { getDb } from '../../store/database.js';
import { getLogger } from '../../common/logger.js';
import { now } from '../../common/utils.js';
import { getLLM } from '../../llm/client.js';
import { personaInferPrompt } from '../../llm/prompts.js';
import { findPersonByName, createPerson, updatePerson } from '../../owner/persons.js';

const log = getLogger('social:persona-builder');

/**
 * 从记忆中自动构建/更新人设画像
 */
export async function buildPersona(personName: string): Promise<void> {
  const llm = getLLM();
  const db = getDb();

  log.info({ person: personName }, 'Building persona profile');

  // 1. 收集关于该人的所有记忆
  const memories = db.prepare(`
    SELECT raw_content FROM experiences
    WHERE branch = 'main' AND (
      raw_content LIKE ? OR participants LIKE ?
    )
    ORDER BY importance DESC
    LIMIT 30
  `).all(`%${personName}%`, `%${personName}%`) as Array<{ raw_content: string }>;

  // 2. 收集 L2 事实
  const facts = db.prepare(`
    SELECT subject, predicate, object FROM world_facts
    WHERE branch = 'main' AND (subject LIKE ? OR object LIKE ?)
    ORDER BY confidence DESC
    LIMIT 20
  `).all(`%${personName}%`, `%${personName}%`) as Array<{ subject: string; predicate: string; object: string }>;

  if (memories.length === 0 && facts.length === 0) {
    log.info({ person: personName }, 'No memories found for persona building');
    return;
  }

  // 合并记忆文本
  const memoryTexts = [
    ...memories.map(m => m.raw_content),
    ...facts.map(f => `${f.subject} ${f.predicate} ${f.object}`),
  ];

  // 3. LLM 推断人设
  if (llm.isAvailable) {
    try {
      const result = await llm.chatJson<{
        personality: string;
        interests: string[];
        opinions: Record<string, string>;
        speech_patterns: string[];
        relationship_hints: string[];
      }>({
        messages: personaInferPrompt(personName, memoryTexts),
        tier: 'medium',
        temperature: 0.4,
        fallback: {
          personality: '',
          interests: [],
          opinions: {},
          speech_patterns: [],
          relationship_hints: [],
        },
      });

      // 4. 更新或创建 person_profile
      const existing = findPersonByName(personName);

      if (existing) {
        updatePerson(existing.id, {
          personality: result.personality || existing.personality || undefined,
          interests: [...new Set([...existing.interests, ...(result.interests ?? [])])],
          opinions: { ...existing.opinions, ...(result.opinions ?? {}) },
          speech_patterns: [...new Set([...existing.speech_patterns, ...(result.speech_patterns ?? [])])],
        });
        log.info({ person: personName, id: existing.id }, 'Persona updated');
      } else {
        createPerson({
          name: personName,
          personality: result.personality || undefined,
          interests: result.interests ?? [],
          opinions: result.opinions ?? {},
          speech_patterns: result.speech_patterns ?? [],
        });
        log.info({ person: personName }, 'Persona created');
      }
    } catch (err) {
      log.warn({ err, person: personName }, 'LLM persona inference failed');
    }
  }
}

/**
 * 批量构建所有出现过的人的画像
 */
export async function buildAllPersonas(): Promise<number> {
  const db = getDb();

  // 从条件索引中找到所有 person: 前缀的实体
  const rows = db.prepare(`
    SELECT DISTINCT REPLACE(condition_key, 'person:', '') as name
    FROM condition_index
    WHERE condition_key LIKE 'person:%'
  `).all() as Array<{ name: string }>;

  let built = 0;
  for (const row of rows) {
    await buildPersona(row.name);
    built++;
  }

  log.info({ count: built }, 'All personas built');
  return built;
}
