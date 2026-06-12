/**
 * 内置模板：灵感孵化器
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-inspiration-incubator';

export function initInspirationIncubatorTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 灵感孵化器');

  createTemplate({
    id: TEMPLATE_ID,
    name: '灵感孵化器',
    description: '定期检视处于孵化状态的灵感，结合最近记忆寻找关联，帮助灵感从 spark 成长为 mature。',
    tags: ['inspiration', 'creative', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 10 * * 1,4',
    nodes: [
      {
        id: 'src_inspirations',
        type: 'inspiration-load',
        label: '加载孵化中灵感',
        position: { x: 100, y: 200 },
        config: { status: 'incubating' },
        inputs: [],
        outputs: [{ id: 'out', label: '灵感列表', type: 'json' }],
      },
      {
        id: 'src_recent',
        type: 'memory-search',
        label: '搜索最近记忆',
        position: { x: 100, y: 400 },
        config: { query: '最近学到的和想到的', top_k: 30 },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'merge_data',
        type: 'merge',
        label: '合并数据',
        position: { x: 400, y: 300 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '灵感', type: 'any' },
          { id: 'in_b', label: '记忆', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_incubate',
        type: 'llm-chat',
        label: 'LLM 孵化分析',
        position: { x: 700, y: 300 },
        config: {
          system_prompt: `你是一位创意顾问，擅长帮助人们发展和完善想法。

你的任务是：
1. 检视每个孵化中的灵感
2. 结合最近的记忆，寻找与灵感相关的新信息或关联
3. 为每个灵感提供发展建议

请以 Markdown 格式生成报告：

## 💡 灵感孵化报告

对每个灵感：
### [灵感标题]
- **当前状态**：简述灵感的核心内容
- **新发现关联**：与最近记忆中的哪些内容有联系
- **发展方向**：建议如何进一步发展这个灵感
- **成熟度评估**：是否可以从"孵化"升级为"成熟"

### 📋 总结
整体建议和优先级排序。`,
          user_prompt: '灵感列表和最近记忆：\n{{json input}}',
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      {
        id: 'output_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1000, y: 300 },
        config: {
          title_template: '{{$date}} 灵感孵化报告',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_inspirations', source_port: 'out', target_node: 'merge_data', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_recent', source_port: 'out', target_node: 'merge_data', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_data', source_port: 'out', target_node: 'llm_incubate', target_port: 'in' },
      { id: 'e4', source_node: 'llm_incubate', source_port: 'out', target_node: 'output_report', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
