/**
 * 内置模板：习惯养成追踪
 * 每周分析记忆中的习惯模式，追踪习惯养成进度
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-habit-tracker';

export function initHabitTrackerTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 习惯养成追踪');

  createTemplate({
    id: TEMPLATE_ID,
    name: '习惯养成追踪',
    description: '每周五分析记忆中的行为模式，识别正在养成和衰退的习惯，追踪运动、阅读、学习等习惯的执行情况，给出坚持建议。',
    tags: ['weekly', 'insight', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 20 * * 5',
    nodes: [
      {
        id: 'src_habits',
        type: 'memory-search',
        label: '搜索习惯记忆',
        position: { x: 100, y: 150 },
        config: {
          query: '运动 跑步 健身 早起 阅读 冥想 写日记 学习 散步 游泳 打球 睡眠 饮食 喝水',
          top_k: 60,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'src_routines',
        type: 'memory-search',
        label: '搜索日常模式',
        position: { x: 100, y: 350 },
        config: {
          query: '每天 每周 坚持 习惯 打卡 连续 中断 恢复 routine',
          top_k: 30,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'merge_data',
        type: 'merge',
        label: '合并数据',
        position: { x: 400, y: 250 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '习惯', type: 'any' },
          { id: 'in_b', label: '模式', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_analyze',
        type: 'llm-chat',
        label: 'LLM 习惯分析',
        position: { x: 700, y: 250 },
        config: {
          system_prompt: `你是一位习惯养成教练，擅长从日常行为数据中识别习惯模式。

请分析提供的记忆数据，生成习惯追踪报告。使用 Markdown 格式。

报告结构：
## 🎯 习惯养成追踪

### 📊 本周习惯概览
用表格展示各个被追踪习惯的本周执行情况：
| 习惯 | 本周执行 | 状态 |
|------|----------|------|
（用 ✅❌ 表示每天执行情况，状态用 🔥进行中 / ⚠️衰退 / 🌱新建 / 💪稳固 标注）

### 🔥 势头正好
哪些习惯保持得很好？分析成功因素。

### ⚠️ 需要关注
哪些习惯在衰退？分析可能的原因。

### 🌱 新发现的模式
从记忆中发现了哪些新的行为模式？是否值得培养为习惯？

### 💡 本周建议
- 下周应重点坚持的 2-3 个习惯
- 具体的执行计划建议（时间、触发器、奖励）
- 如何克服当前面临的障碍

### 📈 趋势
与之前相比，整体习惯执行力是上升还是下降？`,
          user_prompt: '以下是本周的习惯相关记忆：\n{{json input}}',
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
          title_template: '{{$date}} 习惯养成追踪',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_habits', source_port: 'out', target_node: 'merge_data', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_routines', source_port: 'out', target_node: 'merge_data', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_data', source_port: 'out', target_node: 'llm_analyze', target_port: 'in' },
      { id: 'e4', source_node: 'llm_analyze', source_port: 'out', target_node: 'output_report', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
