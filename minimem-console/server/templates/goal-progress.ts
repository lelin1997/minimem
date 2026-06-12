/**
 * 内置模板：目标进度追踪
 * 每两周检查个人目标的推进情况，生成进度报告
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-goal-progress';

export function initGoalProgressTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 目标进度追踪');

  createTemplate({
    id: TEMPLATE_ID,
    name: '目标进度追踪',
    description: '每两周自动检查记忆中与个人目标相关的内容，评估各项目标的推进情况，识别阻碍因素并给出调整建议。',
    tags: ['review', 'report', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 19 1,15 * *',
    nodes: [
      {
        id: 'src_goals',
        type: 'memory-search',
        label: '搜索目标记忆',
        position: { x: 100, y: 100 },
        config: {
          query: '目标 计划 OKR KPI 里程碑 deadline 截止 完成 进度 进展',
          top_k: 50,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'src_achievements',
        type: 'memory-search',
        label: '搜索成果记忆',
        position: { x: 100, y: 280 },
        config: {
          query: '完成了 做好了 搞定 上线 发布 通过 达成 成功 成果 产出',
          top_k: 40,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'src_profile',
        type: 'owner-profile',
        label: '用户画像',
        position: { x: 100, y: 460 },
        config: {},
        inputs: [],
        outputs: [{ id: 'out', label: '画像', type: 'json' }],
      },
      {
        id: 'merge_12',
        type: 'merge',
        label: '合并目标+成果',
        position: { x: 350, y: 190 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '目标', type: 'any' },
          { id: 'in_b', label: '成果', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'merge_all',
        type: 'merge',
        label: '合并全部',
        position: { x: 550, y: 300 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '目标+成果', type: 'any' },
          { id: 'in_b', label: '画像', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_progress',
        type: 'llm-chat',
        label: 'LLM 目标分析',
        position: { x: 800, y: 300 },
        config: {
          system_prompt: `你是一位目标管理教练，擅长帮助人们追踪和达成个人目标。

请基于记忆中的目标和成果数据，结合用户画像，生成目标进度报告。使用 Markdown 格式。

报告结构：
## 🎯 目标进度追踪报告

### 📋 目标清单与进度
用表格展示识别到的各项目标及其进度：
| 目标 | 进度 | 状态 | 下一步 |
|------|------|------|--------|
（进度用百分比或里程碑表示，状态用 🟢正常/🟡滞后/🔴严重滞后/✅已完成）

### 🏆 近期成果
列出已完成或取得重要进展的成果。

### ⚠️ 风险与阻碍
- 哪些目标进展缓慢？
- 识别到的主要阻碍因素是什么？

### 🔄 建议调整
- 哪些目标需要重新评估优先级？
- 是否有目标需要拆分或合并？
- 资源/时间分配是否需要调整？

### 📅 下阶段重点
未来两周应重点推进的 2-3 个目标。`,
          user_prompt: '目标和成果数据：\n{{json input}}',
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
          title_template: '{{$date}} 目标进度追踪',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
      {
        id: 'output_file',
        type: 'output-file',
        label: '写入文件',
        position: { x: 1100, y: 400 },
        config: {
          path_template: 'goal-progress/{{$date}}.md',
          format: 'md',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_goals', source_port: 'out', target_node: 'merge_12', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_achievements', source_port: 'out', target_node: 'merge_12', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_12', source_port: 'out', target_node: 'merge_all', target_port: 'in_a' },
      { id: 'e4', source_node: 'src_profile', source_port: 'out', target_node: 'merge_all', target_port: 'in_b' },
      { id: 'e5', source_node: 'merge_all', source_port: 'out', target_node: 'llm_progress', target_port: 'in' },
      { id: 'e6', source_node: 'llm_progress', source_port: 'out', target_node: 'output_report', target_port: 'in' },
      { id: 'e7', source_node: 'llm_progress', source_port: 'out', target_node: 'output_file', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
