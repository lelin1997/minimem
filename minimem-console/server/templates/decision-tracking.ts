/**
 * 内置模板：项目决策追踪
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-decision-tracking';

export function initDecisionTrackingTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 项目决策追踪');

  createTemplate({
    id: TEMPLATE_ID,
    name: '项目决策追踪',
    description: '从近期记忆中提取项目相关的决策，自动整理决策时间线和影响分析，帮助回顾决策脉络。',
    tags: ['project', 'decision', 'builtin'],
    schedule_type: 'manual',
    nodes: [
      {
        id: 'src_decisions',
        type: 'memory-search',
        label: '搜索决策记忆',
        position: { x: 100, y: 200 },
        config: { query: '决定 决策 选择 方案 trade-off 权衡', top_k: 40 },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'llm_extract',
        type: 'llm-extract',
        label: '提取决策信息',
        position: { x: 400, y: 200 },
        config: {
          fields: JSON.stringify([
            { name: 'decisions', type: 'array', description: '每个决策包含 title, date, context, options, chosen, reasoning, impact' },
          ]),
        },
        inputs: [{ id: 'in', label: '文本', type: 'text' }],
        outputs: [{ id: 'out', label: 'JSON', type: 'json' }],
      },
      {
        id: 'tpl_render',
        type: 'template',
        label: '渲染报告',
        position: { x: 700, y: 200 },
        config: {
          template: `# 📋 项目决策追踪

{{#each input.decisions}}
## {{@index}}. {{this.title}}

- **时间**：{{this.date}}
- **背景**：{{this.context}}
- **可选方案**：{{join this.options " / "}}
- **最终选择**：{{this.chosen}}
- **决策理由**：{{this.reasoning}}
- **影响**：{{this.impact}}

---
{{/each}}

*生成时间：{{$datetime}}*`,
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '渲染文本', type: 'text' }],
      },
      {
        id: 'output_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1000, y: 200 },
        config: {
          title_template: '{{$date}} 项目决策追踪',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_decisions', source_port: 'out', target_node: 'llm_extract', target_port: 'in' },
      { id: 'e2', source_node: 'llm_extract', source_port: 'out', target_node: 'tpl_render', target_port: 'in' },
      { id: 'e3', source_node: 'tpl_render', source_port: 'out', target_node: 'output_report', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
