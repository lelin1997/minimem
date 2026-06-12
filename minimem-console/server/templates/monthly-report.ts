/**
 * 内置模板：月度成长报告
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-monthly-report';

export function initMonthlyReportTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 月度成长报告');

  createTemplate({
    id: TEMPLATE_ID,
    name: '月度成长报告',
    description: '每月底自动生成综合成长报告，包含知识增长、人际关系、灵感进展、习惯追踪等多维度分析。',
    tags: ['monthly', 'growth', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 20 28 * *',
    nodes: [
      {
        id: 'src_stats',
        type: 'stats',
        label: '记忆统计',
        position: { x: 100, y: 100 },
        config: {},
        inputs: [],
        outputs: [{ id: 'out', label: '统计', type: 'json' }],
      },
      {
        id: 'src_memories',
        type: 'memory-search',
        label: '搜索本月记忆',
        position: { x: 100, y: 250 },
        config: { query: '本月的重要事情', top_k: 100 },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'src_profile',
        type: 'owner-profile',
        label: '用户画像',
        position: { x: 100, y: 400 },
        config: {},
        inputs: [],
        outputs: [{ id: 'out', label: '画像', type: 'json' }],
      },
      {
        id: 'merge_12',
        type: 'merge',
        label: '合并统计+记忆',
        position: { x: 350, y: 175 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '统计', type: 'any' },
          { id: 'in_b', label: '记忆', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'merge_all',
        type: 'merge',
        label: '合并全部',
        position: { x: 550, y: 280 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '统计+记忆', type: 'any' },
          { id: 'in_b', label: '画像', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_report',
        type: 'llm-chat',
        label: 'LLM 生成月报',
        position: { x: 800, y: 280 },
        config: {
          system_prompt: `你是一位个人成长分析师，请生成一份全面的月度成长报告：

## 📈 月度成长报告

### 本月数据概览
记忆总量变化、各层分布。

### 🧠 知识增长
本月学到了哪些新知识。

### 🎯 目标进展
与个人目标相关的进展。

### 👥 人际互动
重要的社交互动和关系变化。

### 💡 灵感与创意
本月产生的灵感及发展状况。

### 📊 习惯与模式
观察到的行为模式和习惯。

### 🌟 本月亮点
最值得记住的 3 件事。

### 🎯 下月展望
基于本月分析的下月建议。`,
          user_prompt: '月度数据：\n{{json input}}',
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      {
        id: 'output_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1100, y: 200 },
        config: {
          title_template: '{{$date}} 月度成长报告',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
      {
        id: 'output_file',
        type: 'output-file',
        label: '写入文件',
        position: { x: 1100, y: 360 },
        config: {
          path_template: 'monthly-report/{{$date}}.md',
          format: 'md',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_stats', source_port: 'out', target_node: 'merge_12', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_memories', source_port: 'out', target_node: 'merge_12', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_12', source_port: 'out', target_node: 'merge_all', target_port: 'in_a' },
      { id: 'e4', source_node: 'src_profile', source_port: 'out', target_node: 'merge_all', target_port: 'in_b' },
      { id: 'e5', source_node: 'merge_all', source_port: 'out', target_node: 'llm_report', target_port: 'in' },
      { id: 'e6', source_node: 'llm_report', source_port: 'out', target_node: 'output_report', target_port: 'in' },
      { id: 'e7', source_node: 'llm_report', source_port: 'out', target_node: 'output_file', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
