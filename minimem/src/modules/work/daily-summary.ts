// ============================================================
// MiniMem — 工作模块：日终总结（LLM 生成）
// ============================================================

import { getDb } from '../../store/database.js';
import { getLogger } from '../../common/logger.js';
import { generateId, now } from '../../common/utils.js';
import { getLLM } from '../../llm/client.js';
import { dailySummaryPrompt } from '../../llm/prompts.js';
import { getTodayTasks, getTaskStats } from './tasks.js';

const log = getLogger('work:daily-summary');

export interface DailySummary {
  date: string;
  summary: string;
  highlights: string[];
  mood: string;
  task_stats: { done: number; in_progress: number; todo: number; cancelled: number };
}

/**
 * 生成日终总结
 */
export async function generateDailySummary(date?: string): Promise<DailySummary> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const llm = getLLM();

  log.info({ date: targetDate }, 'Generating daily summary');

  // 获取今日任务
  const tasks = getTodayTasks();
  const stats = getTaskStats();

  // 获取今日记忆
  const db = getDb();
  const todayMemories = db.prepare(`
    SELECT raw_content FROM experiences
    WHERE branch = 'main' AND created_at >= ? AND created_at < ?
    ORDER BY importance DESC
    LIMIT 20
  `).all(
    `${targetDate}T00:00:00.000Z`,
    `${targetDate}T23:59:59.999Z`,
  ) as Array<{ raw_content: string }>;

  const memoryTexts = todayMemories.map(m => m.raw_content);

  // LLM 生成总结
  if (llm.isAvailable) {
    try {
      const result = await llm.chatJson<{
        summary: string;
        highlights: string[];
        mood: string;
      }>({
        messages: dailySummaryPrompt(
          tasks.map(t => ({ title: t.title, status: t.status, description: t.description ?? undefined })),
          memoryTexts,
        ),
        tier: 'medium',
        temperature: 0.5,
        fallback: {
          summary: buildFallbackSummary(tasks, memoryTexts, targetDate),
          highlights: [],
          mood: 'normal',
        },
      });

      const summary: DailySummary = {
        date: targetDate,
        summary: result.summary,
        highlights: result.highlights ?? [],
        mood: result.mood ?? 'normal',
        task_stats: stats,
      };

      // 保存到 dream_logs 作为记录
      saveDailySummaryLog(summary);

      log.info({ date: targetDate, highlights: summary.highlights.length }, 'Daily summary generated');
      return summary;
    } catch (err) {
      log.warn({ err }, 'LLM daily summary failed, using fallback');
    }
  }

  // 规则降级
  const fallback: DailySummary = {
    date: targetDate,
    summary: buildFallbackSummary(tasks, memoryTexts, targetDate),
    highlights: tasks.filter(t => t.status === 'done').map(t => t.title),
    mood: 'normal',
    task_stats: stats,
  };

  saveDailySummaryLog(fallback);
  return fallback;
}

/**
 * 获取历史日总结
 */
export function getDailySummaries(days: number = 7): DailySummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT narrative FROM dream_logs
    WHERE phase = 0
    ORDER BY created_at DESC
    LIMIT ?
  `).all(days) as Array<{ narrative: string }>;

  return rows.map(r => {
    try {
      return JSON.parse(r.narrative) as DailySummary;
    } catch {
      return { date: '', summary: r.narrative, highlights: [], mood: 'normal', task_stats: { done: 0, in_progress: 0, todo: 0, cancelled: 0 } };
    }
  });
}

function buildFallbackSummary(tasks: Array<{ title: string; status: string }>, memories: string[], date: string): string {
  const done = tasks.filter(t => t.status === 'done');
  const inProgress = tasks.filter(t => t.status === 'in_progress');

  let md = `# ${date} 日终总结\n\n`;
  md += `## 完成 (${done.length})\n`;
  for (const t of done) md += `- ✅ ${t.title}\n`;
  md += `\n## 进行中 (${inProgress.length})\n`;
  for (const t of inProgress) md += `- 🚧 ${t.title}\n`;
  md += `\n## 今日记忆 (${memories.length} 条)\n`;
  for (const m of memories.slice(0, 5)) md += `- ${m.slice(0, 100)}\n`;

  return md;
}

function saveDailySummaryLog(summary: DailySummary): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO dream_logs (id, session_id, phase, narrative, pre_snapshot_id, duration_ms, created_at)
      VALUES (?, ?, 0, ?, '', 0, ?)
    `).run(generateId(), `daily-${summary.date}`, JSON.stringify(summary), now());
  } catch {
    log.warn('Failed to save daily summary log');
  }
}
