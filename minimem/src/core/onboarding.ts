// ============================================================
// MiniMem — 新用户引导（Onboarding Flow）
// ============================================================

import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now } from '../common/utils.js';
import { setProfileEntry } from '../owner/profile.js';
import { ingestMemory } from './perception.js';

const log = getLogger('core:onboarding');

export interface OnboardingInput {
  name?: string;
  occupation?: string;
  interests?: string[];
  goals?: string[];
  preferred_language?: string;
  personality?: string;
  important_people?: Array<{ name: string; relationship: string }>;
}

export interface OnboardingResult {
  status: 'completed' | 'partial';
  profile_entries: number;
  memories_created: number;
  message: string;
}

/**
 * 执行新用户引导
 */
export async function runOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
  log.info('Starting onboarding flow');
  let profileEntries = 0;
  let memoriesCreated = 0;

  // 1. 设置 Owner Profile
  if (input.name) {
    setProfileEntry('identity.name', input.name, { category: 'identity', confidence: 1.0, source: 'onboarding' });
    profileEntries++;
  }

  if (input.occupation) {
    setProfileEntry('identity.occupation', input.occupation, { category: 'identity', confidence: 0.9, source: 'onboarding' });
    profileEntries++;
  }

  if (input.preferred_language) {
    setProfileEntry('preferences.language', input.preferred_language, { category: 'preferences', confidence: 1.0, source: 'onboarding' });
    profileEntries++;
  }

  if (input.personality) {
    setProfileEntry('identity.personality', input.personality, { category: 'identity', confidence: 0.7, source: 'onboarding' });
    profileEntries++;
  }

  if (input.interests && input.interests.length > 0) {
    setProfileEntry('preferences.interests', input.interests, { category: 'preferences', confidence: 0.8, source: 'onboarding' });
    profileEntries++;

    // 为每个兴趣创建记忆
    for (const interest of input.interests) {
      await safeIngest(`用户表示对 ${interest} 感兴趣`, 'onboarding');
      memoriesCreated++;
    }
  }

  if (input.goals && input.goals.length > 0) {
    setProfileEntry('identity.goals', input.goals, { category: 'identity', confidence: 0.8, source: 'onboarding' });
    profileEntries++;

    for (const goal of input.goals) {
      await safeIngest(`用户的目标: ${goal}`, 'onboarding');
      memoriesCreated++;
    }
  }

  // 2. 创建重要人物记忆
  if (input.important_people && input.important_people.length > 0) {
    for (const person of input.important_people) {
      await safeIngest(
        `${person.name} 是用户的${person.relationship}`,
        'onboarding',
      );
      memoriesCreated++;
    }
  }

  // 3. 标记引导完成
  setProfileEntry('system.onboarding_completed', true, { category: 'system', confidence: 1.0, source: 'system' });
  setProfileEntry('system.onboarding_date', now(), { category: 'system', confidence: 1.0, source: 'system' });
  profileEntries += 2;

  const result: OnboardingResult = {
    status: 'completed',
    profile_entries: profileEntries,
    memories_created: memoriesCreated,
    message: `欢迎${input.name ? ' ' + input.name : ''}！已为你初始化记忆系统。`,
  };

  log.info({ profileEntries, memoriesCreated }, 'Onboarding completed');
  return result;
}

/**
 * 检查是否已完成引导
 */
export function isOnboardingCompleted(): boolean {
  const db = getDb();
  const row = db.prepare(
    "SELECT value FROM owner_profile WHERE key = 'system.onboarding_completed'"
  ).get() as { value: string } | undefined;

  if (!row) return false;
  return JSON.parse(row.value) === true;
}

/**
 * 获取引导提示问题
 */
export function getOnboardingQuestions(): Array<{ key: string; question: string; required: boolean }> {
  return [
    { key: 'name', question: '你叫什么名字？', required: true },
    { key: 'occupation', question: '你的职业是什么？', required: false },
    { key: 'interests', question: '你有哪些兴趣爱好？（逗号分隔）', required: false },
    { key: 'goals', question: '你目前的主要目标是什么？', required: false },
    { key: 'preferred_language', question: '你偏好的沟通语言？', required: false },
    { key: 'important_people', question: '有哪些重要的人？（格式: 名字-关系）', required: false },
  ];
}

async function safeIngest(content: string, source: string): Promise<void> {
  try {
    await ingestMemory({
      content,
      source,
      content_type: 'note',
      tags: ['onboarding'],
    });
  } catch {
    log.warn({ content: content.slice(0, 50) }, 'Onboarding ingest failed');
  }
}
