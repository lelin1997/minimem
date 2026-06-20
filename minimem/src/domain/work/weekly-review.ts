// ============================================================
// MiniMem — 工作模块：周回顾报告
// ============================================================

import { getLogger } from '../../common/logger.js';
import { getLLM } from '../../llm/client.js';
import { weeklyReviewPrompt } from '../../llm/prompts.js';
import { getTaskStats } from './tasks.js';
import { getDailySummaries } from './daily-summary.js';

const log = getLogger('work:weekly-review');

export interface WeeklyReview {
  week_start: string;
  week_end: string;
  review: string;
  achievements: string[];
  improvements: string[];
  next_week_focus: string[];
  task_stats: { done: number; in_progress: number; todo: number };
}

/**
 * 生成周回顾报告
 */
export async function generateWeeklyReview(): Promise<WeeklyReview> {
  const llm = getLLM();
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);

  const weekStart = start.toISOString().slice(0, 10);
  const weekEnd = end.toISOString().slice(0, 10);

  log.info({ weekStart, weekEnd }, 'Generating weekly review');

  // 获取本周日总结
  const dailySummaries = getDailySummaries(7);
  const stats = getTaskStats();

  if (llm.isAvailable) {
    try {
      const result = await llm.chatJson<{
        review: string;
        achievements: string[];
        improvements: string[];
        next_week_focus: string[];
      }>({
        messages: weeklyReviewPrompt(
          dailySummaries.map(s => s.summary),
          { done: stats.done, in_progress: stats.in_progress, todo: stats.todo },
        ),
        tier: 'medium',
        temperature: 0.5,
        fallback: {
          review: buildFallbackReview(dailySummaries, stats, weekStart, weekEnd),
          achievements: [],
          improvements: [],
          next_week_focus: [],
        },
      });

      const review: WeeklyReview = {
        week_start: weekStart,
        week_end: weekEnd,
        review: result.review,
        achievements: result.achievements ?? [],
        improvements: result.improvements ?? [],
        next_week_focus: result.next_week_focus ?? [],
        task_stats: { done: stats.done, in_progress: stats.in_progress, todo: stats.todo },
      };

      log.info({ weekStart, weekEnd, achievements: review.achievements.length }, 'Weekly review generated');
      return review;
    } catch (err) {
      log.warn({ err }, 'LLM weekly review failed, using fallback');
    }
  }

  // 规则降级
  return {
    week_start: weekStart,
    week_end: weekEnd,
    review: buildFallbackReview(dailySummaries, stats, weekStart, weekEnd),
    achievements: [],
    improvements: [],
    next_week_focus: [],
    task_stats: { done: stats.done, in_progress: stats.in_progress, todo: stats.todo },
  };
}

function buildFallbackReview(
  summaries: Array<{ date: string; summary: string; highlights: string[] }>,
  stats: { done: number; in_progress: number; todo: number },
  weekStart: string,
  weekEnd: string,
): string {
  let md = `# 周回顾 ${weekStart} ~ ${weekEnd}\n\n`;
  md += `## 任务统计\n- 完成: ${stats.done}\n- 进行中: ${stats.in_progress}\n- 待做: ${stats.todo}\n\n`;
  md += `## 日总结回顾\n`;
  for (const s of summaries) {
    md += `### ${s.date}\n`;
    for (const h of s.highlights) md += `- ${h}\n`;
    md += '\n';
  }
  return md;
}
