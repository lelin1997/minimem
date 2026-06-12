/**
 * 内置模板：每周深度复盘
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-weekly-review';

export function initWeeklyReviewTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 每周深度复盘');

  createTemplate({
    id: TEMPLATE_ID,
    name: '每周深度复盘',
    description: '每周日自动回顾本周记忆，从多维度生成深度复盘报告，包括时间分配、成就总结、问题反思和下周计划。',
    tags: ['weekly', 'review', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 21 * * 0',
    nodes: [
      {
        id: 'src_week',
        type: 'memory-search',
        label: '搜索本周记忆',
        position: { x: 100, y: 200 },
        config: {
          query: '本周的工作和生活',
          top_k: 100,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'src_stats',
        type: 'stats',
        label: '本周统计',
        position: { x: 100, y: 400 },
        config: {},
        inputs: [],
        outputs: [{ id: 'out', label: '统计', type: 'json' }],
      },
      {
        id: 'merge_data',
        type: 'merge',
        label: '合并数据',
        position: { x: 400, y: 300 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '记忆', type: 'any' },
          { id: 'in_b', label: '统计', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_review',
        type: 'llm-chat',
        label: 'LLM 生成周报',
        position: { x: 700, y: 300 },
        config: {
          system_prompt: `你是一位个人成长教练，擅长从一周的碎片信息中提炼出深度洞察。

请生成一份结构化的每周深度复盘报告，使用 Markdown 格式：

## 📊 本周深度复盘

### 🗓 周概览
一段话概括本周的整体情况和基调。

### 🏆 本周成就（Top 5）
本周最值得骄傲的成果。

### 📈 进步与成长
观察到的积极变化和进步领域。

### ⚠️ 问题与挑战
遇到的困难和需要关注的问题。

### 🔍 深度反思
从本周经历中提炼的深层洞察。

### 🎯 下周计划
基于本周的分析，下周应该关注什么。`,
          user_prompt: '以下是本周的记忆数据和统计：\n\n{{json input}}',
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      {
        id: 'output_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1000, y: 200 },
        config: {
          title_template: '{{$date}} 每周深度复盘',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
      {
        id: 'output_file',
        type: 'output-file',
        label: '写入文件',
        position: { x: 1000, y: 400 },
        config: {
          path_template: 'weekly-review/{{$date}}.md',
          format: 'md',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_week', source_port: 'out', target_node: 'merge_data', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_stats', source_port: 'out', target_node: 'merge_data', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_data', source_port: 'out', target_node: 'llm_review', target_port: 'in' },
      { id: 'e4', source_node: 'llm_review', source_port: 'out', target_node: 'output_report', target_port: 'in' },
      { id: 'e5', source_node: 'llm_review', source_port: 'out', target_node: 'output_file', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
