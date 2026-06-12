/**
 * 内置模板：情绪追踪日记
 * 每天分析记忆中的情绪变化曲线，识别情绪触发因素
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-mood-tracker';

export function initMoodTrackerTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 情绪追踪日记');

  createTemplate({
    id: TEMPLATE_ID,
    name: '情绪追踪日记',
    description: '每晚自动分析当天记忆中的情绪变化，识别情绪触发因素和模式，生成情绪健康报告。帮助你更好地了解自己的情绪节律。',
    tags: ['daily', 'insight', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '30 22 * * *',
    nodes: [
      {
        id: 'src_today',
        type: 'memory-search',
        label: '搜索今日记忆',
        position: { x: 100, y: 200 },
        config: {
          query: '今天的感受 情绪 心情 开心 焦虑 压力',
          top_k: 50,
          time_from: '{{$date}}T00:00:00',
          time_to: '{{$date}}T23:59:59',
        },
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
        id: 'merge_data',
        type: 'merge',
        label: '合并数据',
        position: { x: 400, y: 300 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '记忆', type: 'any' },
          { id: 'in_b', label: '画像', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_analyze',
        type: 'llm-chat',
        label: 'LLM 情绪分析',
        position: { x: 700, y: 300 },
        config: {
          system_prompt: `你是一位情绪心理分析师，擅长从日常记录中解读情绪线索。

请分析今天的记忆内容，生成一份情绪追踪报告。使用 Markdown 格式。

报告结构：
## 🎭 {{$date}} 情绪日记

### 📊 今日情绪概览
用一个词概括今天的整体情绪基调（如：平静、焦虑、愉悦、疲惫等），并给出 1-10 的情绪评分。

### 🌊 情绪曲线
按时间顺序描述今天情绪的起伏变化，标注关键转折点。

### 🔍 情绪触发因素
识别今天影响情绪的关键事件或因素：
- 正面触发（让你开心/满足的事）
- 负面触发（让你焦虑/沮丧的事）

### 🧠 情绪模式
与用户画像结合，分析是否存在重复出现的情绪模式。

### 💡 自我关怀建议
基于今天的情绪状态，给出具体的自我调节建议。`,
          user_prompt: `以下是今天的记忆和用户画像：\n{{json input}}`,
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
          title_template: '{{$date}} 情绪追踪日记',
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
          path_template: 'mood-tracker/{{$date}}.md',
          format: 'md',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_today', source_port: 'out', target_node: 'merge_data', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_profile', source_port: 'out', target_node: 'merge_data', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_data', source_port: 'out', target_node: 'llm_analyze', target_port: 'in' },
      { id: 'e4', source_node: 'llm_analyze', source_port: 'out', target_node: 'output_report', target_port: 'in' },
      { id: 'e5', source_node: 'llm_analyze', source_port: 'out', target_node: 'output_file', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
