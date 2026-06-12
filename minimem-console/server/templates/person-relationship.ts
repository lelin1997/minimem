/**
 * 内置模板：人物关系图谱
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-person-relationship';

export function initPersonRelationshipTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 人物关系图谱');

  createTemplate({
    id: TEMPLATE_ID,
    name: '人物关系图谱',
    description: '加载所有人设和相关记忆，由 LLM 分析人物间的关系强度和互动模式，生成关系图谱报告。',
    tags: ['person', 'relationship', 'builtin'],
    schedule_type: 'manual',
    nodes: [
      {
        id: 'src_persons',
        type: 'person-load',
        label: '加载所有人设',
        position: { x: 100, y: 200 },
        config: {},
        inputs: [],
        outputs: [{ id: 'out', label: '人设列表', type: 'json' }],
      },
      {
        id: 'src_social',
        type: 'memory-search',
        label: '搜索社交记忆',
        position: { x: 100, y: 400 },
        config: { query: '和朋友同事家人的互动', top_k: 50 },
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
          { id: 'in_a', label: '人设', type: 'any' },
          { id: 'in_b', label: '记忆', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_analyze',
        type: 'llm-chat',
        label: 'LLM 分析关系',
        position: { x: 700, y: 300 },
        config: {
          system_prompt: `你是一位人际关系分析师。请分析人物间的关系网络。

生成 Markdown 格式报告：

## 👥 人物关系图谱

### 核心人物圈
按亲密度分层列出人物。

### 关系强度分析
对每对有互动的人物关系进行分析：
- 互动频率
- 情感基调（积极/中性/消极）
- 关系类型

### 关系动态
最近的关系变化和趋势。

### 💡 社交建议
哪些关系需要维护，哪些可以加深。`,
          user_prompt: '人设数据和社交记忆：\n{{json input}}',
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
          title_template: '{{$date}} 人物关系图谱',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_persons', source_port: 'out', target_node: 'merge_data', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_social', source_port: 'out', target_node: 'merge_data', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_data', source_port: 'out', target_node: 'llm_analyze', target_port: 'in' },
      { id: 'e4', source_node: 'llm_analyze', source_port: 'out', target_node: 'output_report', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
