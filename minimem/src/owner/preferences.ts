// ============================================================
// MiniMem — Owner Profile: 偏好推断
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { now } from '../common/utils.js';
import { setProfileEntry, getProfileByPrefix } from './profile.js';
import type { OwnerProfileEntry } from '../common/types.js';

const log = getLogger('owner:preferences');

/**
 * 偏好条目（更高级的包装）
 */
export interface Preference {
  topic: string;
  preference: string;
  confidence: number;
  evidence_count: number;
  last_updated: string;
}

/**
 * 记录一个偏好观察（从记忆中推断）
 * 
 * 如果已有同 topic 的偏好：
 *   - 相同偏好 → 增加置信度 + 证据数
 *   - 不同偏好 → 如果新置信度更高则替换，否则降低旧置信度
 */
export function recordPreference(
  topic: string,
  preference: string,
  confidence: number = 0.5,
  source: string = 'system',
): Preference {
  const key = `preferences.${topic}`;
  const existing = getProfileByPrefix(key);

  if (existing.length > 0) {
    const entry = existing[0];
    const oldPref = entry.value as { preference: string; evidence_count: number };

    if (oldPref.preference === preference) {
      // 相同偏好，增强置信度
      const newConfidence = Math.min(1, entry.confidence + confidence * 0.2);
      const newCount = (oldPref.evidence_count || 0) + 1;

      setProfileEntry(key, {
        preference,
        evidence_count: newCount,
      }, { category: 'preferences', confidence: newConfidence, source });

      return { topic, preference, confidence: newConfidence, evidence_count: newCount, last_updated: now() };
    } else if (confidence > entry.confidence) {
      // 不同偏好且新偏好置信度更高，替换
      setProfileEntry(key, {
        preference,
        evidence_count: 1,
      }, { category: 'preferences', confidence, source });

      return { topic, preference, confidence, evidence_count: 1, last_updated: now() };
    } else {
      // 不同偏好但旧偏好置信度更高，略微降低旧偏好
      const degraded = Math.max(0, entry.confidence - 0.1);
      setProfileEntry(key, {
        preference: oldPref.preference,
        evidence_count: oldPref.evidence_count,
      }, { category: 'preferences', confidence: degraded, source });

      return {
        topic,
        preference: oldPref.preference,
        confidence: degraded,
        evidence_count: oldPref.evidence_count,
        last_updated: now(),
      };
    }
  }

  // 新偏好
  setProfileEntry(key, {
    preference,
    evidence_count: 1,
  }, { category: 'preferences', confidence, source });

  return { topic, preference, confidence, evidence_count: 1, last_updated: now() };
}

/**
 * 获取指定 topic 的偏好
 */
export function getPreference(topic: string): Preference | null {
  const key = `preferences.${topic}`;
  const entries = getProfileByPrefix(key);
  if (entries.length === 0) return null;

  const entry = entries[0];
  const val = entry.value as { preference: string; evidence_count: number };
  return {
    topic,
    preference: val.preference,
    confidence: entry.confidence,
    evidence_count: val.evidence_count || 0,
    last_updated: entry.updated_at,
  };
}

/**
 * 获取所有偏好
 */
export function getAllPreferences(): Preference[] {
  const entries = getProfileByPrefix('preferences.');

  return entries.map(entry => {
    const topic = entry.key.replace('preferences.', '');
    const val = entry.value as { preference: string; evidence_count: number };
    return {
      topic,
      preference: val.preference,
      confidence: entry.confidence,
      evidence_count: val.evidence_count || 0,
      last_updated: entry.updated_at,
    };
  });
}

/**
 * 获取高置信度偏好（用于 Agent 指导）
 */
export function getStrongPreferences(minConfidence: number = 0.7): Preference[] {
  return getAllPreferences().filter(p => p.confidence >= minConfidence);
}

/**
 * 删除偏好
 */
export function deletePreference(topic: string): boolean {
  const db = getDb();
  const key = `preferences.${topic}`;
  const result = db.prepare('DELETE FROM owner_profile WHERE key = ?').run(key);
  return result.changes > 0;
}
