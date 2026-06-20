// ============================================================
// MiniMem — 社交模块：聊天摘要提取
// ============================================================

import { getLogger } from '../../common/logger.js';
import { generateId, now } from '../../common/utils.js';
import { getLLMClient as getLLM } from '../ports/llm-client.js';
import { chatSummaryPrompt } from '../prompts/templates.js';
import { enqueueCompile } from '../ports/data-store.js';

const log = getLogger('social:chat-summary');

export interface ChatSummaryResult {
  id: string;
  summary: string;
  topics: string[];
  entities: string[];
  action_items: string[];
  sentiment: string;
  created_at: string;
}

/**
 * 从聊天消息中提取摘要
 */
export async function extractChatSummary(
  messages: Array<{ role: string; content: string }>,
  context?: string,
): Promise<ChatSummaryResult> {
  const llm = getLLM();
  const id = generateId();
  const timestamp = now();

  log.info({ messageCount: messages.length }, 'Extracting chat summary');

  if (llm.isAvailable && messages.length >= 2) {
    try {
      const result = await llm.chatJson<{
        summary: string;
        topics: string[];
        entities: string[];
        action_items: string[];
        sentiment: string;
      }>({
        messages: chatSummaryPrompt(messages, context),
        tier: 'light',
        temperature: 0.3,
        fallback: buildFallback(messages),
      });

      // KC00: query_insight 不再入队 compile_queue (灵感不是事实, 会污染知识编译)
      // 聊天摘要只存 inspirations 表, 不进 compile_queue
      log.info({ topics: result.topics, entities: result.entities }, 'Chat summary extracted');
      return { id, ...result, created_at: timestamp };
    } catch (err) {
      log.warn({ err }, 'LLM chat summary failed');
    }
  }

  // 规则降级
  const fallback = buildFallback(messages);
  return { id, ...fallback, created_at: timestamp };
}

function buildFallback(messages: Array<{ role: string; content: string }>): {
  summary: string; topics: string[]; entities: string[]; action_items: string[]; sentiment: string;
} {
  const combined = messages.map(m => m.content).join(' ').slice(0, 500);
  return {
    summary: `对话包含 ${messages.length} 条消息: ${combined.slice(0, 200)}...`,
    topics: [],
    entities: [],
    action_items: [],
    sentiment: 'neutral',
  };
}
