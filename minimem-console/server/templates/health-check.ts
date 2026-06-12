/**
 * 内置模板：健康巡检
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-health-check';

export function initHealthCheckTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 健康巡检');

  createTemplate({
    id: TEMPLATE_ID,
    name: '健康巡检',
    description: '定时检查 MiniMem 服务健康状态和温度分布，识别异常并生成巡检报告。如有异常可通过 Webhook 告警。',
    tags: ['health', 'monitoring', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 */4 * * *',
    nodes: [
      {
        id: 'src_health',
        type: 'health-check',
        label: '健康检查',
        position: { x: 100, y: 150 },
        config: {},
        inputs: [],
        outputs: [{ id: 'out', label: '健康数据', type: 'json' }],
      },
      {
        id: 'src_temp',
        type: 'temperature',
        label: '温度分布',
        position: { x: 100, y: 350 },
        config: {},
        inputs: [],
        outputs: [{ id: 'out', label: '温度分布', type: 'json' }],
      },
      {
        id: 'merge_data',
        type: 'merge',
        label: '合并数据',
        position: { x: 400, y: 250 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '健康', type: 'any' },
          { id: 'in_b', label: '温度', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_analyze',
        type: 'llm-chat',
        label: 'LLM 分析报告',
        position: { x: 700, y: 250 },
        config: {
          system_prompt: `你是 MiniMem 运维巡检助手。请根据提供的健康状态和温度分布数据，生成一份简洁的巡检报告。

报告格式：
## 🔍 MiniMem 巡检报告 — {{$datetime}}

### 服务状态
健康 / 告警 / 异常

### 温度分布
分析温度是否健康（冻结过多说明衰减过快，热数据过少说明活跃度低）。

### ⚠️ 异常发现（如有）
列出需要关注的问题。

### ✅ 建议
给出运维建议。`,
          user_prompt: '巡检数据：\n{{json input}}',
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      {
        id: 'output_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1000, y: 250 },
        config: {
          title_template: '{{$datetime}} 健康巡检报告',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_health', source_port: 'out', target_node: 'merge_data', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_temp', source_port: 'out', target_node: 'merge_data', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_data', source_port: 'out', target_node: 'llm_analyze', target_port: 'in' },
      { id: 'e4', source_node: 'llm_analyze', source_port: 'out', target_node: 'output_report', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
