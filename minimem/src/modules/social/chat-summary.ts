// ============================================================
// MiniMem — 社交模块：聊天摘要提取
// ============================================================

import { getLogger } from '../../common/logger.js';
import { generateId, now } from '../../common/utils.js';
import { getLLM } from '../../llm/client.js';
import { chatSummaryPrompt } from '../../llm/prompts.js';
import { enqueueCompile } from '../../store/knowledge-pages/compile-queue.js';

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

      // 将实体和话题写入编译队列
      if (result.entities.length > 0 || result.topics.length > 0) {
        const content = `聊天摘要提取：${result.summary.slice(0, 200)}\n实体: ${result.entities.join(', ')}\n话题: ${result.topics.join(', ')}`;
        enqueueCompile('query_insight', content, undefined, 4);
      }

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
