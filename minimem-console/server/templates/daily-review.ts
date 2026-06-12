/**
 * 内置模板：每日智能回顾
 * 初始化时写入数据库
 */

import { createTemplate, listTemplates } from '../store/templates.js';
import { initWeeklyReviewTemplate } from './weekly-review.js';
import { initHealthCheckTemplate } from './health-check.js';
import { initInspirationIncubatorTemplate } from './inspiration-incubator.js';
import { initKnowledgeCardsTemplate } from './knowledge-cards.js';
import { initPersonRelationshipTemplate } from './person-relationship.js';
import { initDecisionTrackingTemplate } from './decision-tracking.js';
import { initMonthlyReportTemplate } from './monthly-report.js';
import { initMoodTrackerTemplate } from './mood-tracker.js';
import { initReadingDigestTemplate } from './reading-digest.js';
import { initIncidentPostmortemTemplate } from './incident-postmortem.js';
import { initHabitTrackerTemplate } from './habit-tracker.js';
import { initGoalProgressTemplate } from './goal-progress.js';
import { initMemoryCleanupTemplate } from './memory-cleanup.js';

// Phase 4: 感知世界模板
import { initTechRadarTemplate } from './tech-radar.js';
import { initGithubTrendingTemplate } from './github-trending.js';
import { initIndustryMonitorTemplate } from './industry-monitor.js';
import { initWebpageMonitorTemplate } from './webpage-monitor.js';

const DAILY_REVIEW_TEMPLATE_ID = 'tpl-daily-review';

export function initBuiltinTemplates(): void {
  // Phase 1: 每日智能回顾
  const existing = listTemplates();
  if (!existing.some((t) => t.id === DAILY_REVIEW_TEMPLATE_ID)) {
    console.log('[Templates] 初始化内置模板: 每日智能回顾');
    _createDailyReviewTemplate();
  }

  // Phase 2: 更多内置模板
  initWeeklyReviewTemplate();
  initHealthCheckTemplate();
  initInspirationIncubatorTemplate();
  initKnowledgeCardsTemplate();
  initPersonRelationshipTemplate();
  initDecisionTrackingTemplate();
  initMonthlyReportTemplate();

  // Phase 3: 场景化模板
  initMoodTrackerTemplate();
  initReadingDigestTemplate();
  initIncidentPostmortemTemplate();
  initHabitTrackerTemplate();
  initGoalProgressTemplate();
  initMemoryCleanupTemplate();

  // Phase 4: 感知世界模板
  initTechRadarTemplate();
  initGithubTrendingTemplate();
  initIndustryMonitorTemplate();
  initWebpageMonitorTemplate();
}

function _createDailyReviewTemplate(): void {
  createTemplate({
    id: DAILY_REVIEW_TEMPLATE_ID,
    name: '每日智能回顾',
    description: '每天晚上自动搜索当天的记忆，过滤重要内容，用 LLM 生成一份结构化的每日回顾报告，并保存到 Console。',
    tags: ['daily', 'review', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 23 * * *',
    nodes: [
      // 数据源：搜索今天的记忆
      {
        id: 'src_today',
        type: 'memory-search',
        label: '搜索今日记忆',
        position: { x: 100, y: 200 },
        config: {
          query: '今天发生的事情',
          top_k: 50,
          time_from: '{{$date}}T00:00:00',
          time_to: '{{$date}}T23:59:59',
        },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      // 过滤：只保留重要性 > 0.3 的记忆
      {
        id: 'filter_important',
        type: 'filter',
        label: '过滤重要记忆',
        position: { x: 400, y: 200 },
        config: {
          condition: 'importance > 0.3',
        },
        inputs: [{ id: 'in', label: '输入', type: 'any' }],
        outputs: [{ id: 'out', label: '过滤结果', type: 'any' }],
      },
      // 排序：按重要性降序
      {
        id: 'sort_by_importance',
        type: 'sort',
        label: '按重要性排序',
        position: { x: 700, y: 200 },
        config: {
          field: 'importance',
          order: 'desc',
        },
        inputs: [{ id: 'in', label: '输入', type: 'any' }],
        outputs: [{ id: 'out', label: '排序结果', type: 'any' }],
      },
      // LLM：生成每日回顾
      {
        id: 'llm_review',
        type: 'llm-chat',
        label: 'LLM 生成回顾',
        position: { x: 1000, y: 200 },
        config: {
          system_prompt: `你是一位个人生产力分析师，擅长从碎片化的日常记录中提炼有价值的洞察。

请基于以下今日记忆内容，生成一份结构化的每日回顾报告。使用 Markdown 格式。

报告结构：
## 📅 {{$date}} 每日回顾

### 🎯 今日概览
简短概括今天的主要内容和基调。

### 📌 关键事件
列出今天最重要的 3-5 件事。

### 💡 洞察与反思
从这些记忆中提炼出的深层洞察或值得思考的点。

### 🔗 关联发现
发现记忆之间是否有有趣的关联或模式。

### ✅ 明日建议
基于今天的内容，对明天有什么建议。`,
          user_prompt: `以下是今天的 {{nodes.sort_by_importance.output.length}} 条记忆（按重要性排序）：

{{#each nodes.sort_by_importance.output}}
---
**[重要性: {{this.importance}}]** {{this.content}}
来源: {{this.source}} | 时间: {{this.created_at}}
{{/each}}`,
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      // 输出：保存到 Console 报告
      {
        id: 'output_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1300, y: 100 },
        config: {
          title_template: '{{$date}} 每日智能回顾',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
      // 输出：同时写入文件
      {
        id: 'output_file',
        type: 'output-file',
        label: '写入文件',
        position: { x: 1300, y: 300 },
        config: {
          path_template: 'daily-review/{{$date}}.md',
          format: 'md',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      {
        id: 'e1',
        source_node: 'src_today',
        source_port: 'out',
        target_node: 'filter_important',
        target_port: 'in',
      },
      {
        id: 'e2',
        source_node: 'filter_important',
        source_port: 'out',
        target_node: 'sort_by_importance',
        target_port: 'in',
      },
      {
        id: 'e3',
        source_node: 'sort_by_importance',
        source_port: 'out',
        target_node: 'llm_review',
        target_port: 'in',
      },
      {
        id: 'e4',
        source_node: 'llm_review',
        source_port: 'out',
        target_node: 'output_report',
        target_port: 'in',
      },
      {
        id: 'e5',
        source_node: 'llm_review',
        source_port: 'out',
        target_node: 'output_file',
        target_port: 'in',
      },
    ],
    variables: {},
    default_llm: {},
  });
}
