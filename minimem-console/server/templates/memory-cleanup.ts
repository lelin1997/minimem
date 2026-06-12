/**
 * 内置模板：记忆整理优化
 * 定期扫描记忆库，识别重复、过时、低质量记忆，生成清理建议
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-memory-cleanup';

export function initMemoryCleanupTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 记忆整理优化');

  createTemplate({
    id: TEMPLATE_ID,
    name: '记忆整理优化',
    description: '每月定期扫描记忆库，识别重复、碎片化、低质量的记忆，分析记忆分布健康度，生成清理和优化建议。像整理房间一样整理你的记忆。',
    tags: ['health', 'knowledge', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 15 1 * *',
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
        id: 'src_temp',
        type: 'temperature',
        label: '温度分布',
        position: { x: 100, y: 280 },
        config: {},
        inputs: [],
        outputs: [{ id: 'out', label: '温度分布', type: 'json' }],
      },
      {
        id: 'src_low_importance',
        type: 'memory-search',
        label: '搜索低质量记忆',
        position: { x: 100, y: 460 },
        config: {
          query: '*',
          top_k: 100,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'merge_12',
        type: 'merge',
        label: '合并统计+温度',
        position: { x: 350, y: 190 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '统计', type: 'any' },
          { id: 'in_b', label: '温度', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'merge_all',
        type: 'merge',
        label: '合并全部',
        position: { x: 550, y: 320 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '统计+温度', type: 'any' },
          { id: 'in_b', label: '记忆', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_analyze',
        type: 'llm-chat',
        label: 'LLM 整理分析',
        position: { x: 800, y: 320 },
        config: {
          system_prompt: `你是一位记忆管理专家，擅长帮助人们优化和整理个人知识库。

请基于记忆统计、温度分布和记忆样本，生成记忆整理报告。使用 Markdown 格式。

报告结构：
## 🧹 记忆整理优化报告

### 📊 记忆库健康度
给出 A-F 的评分和简短说明：
- 总记忆量
- 各层分布是否均衡
- 温度分布是否健康
- 活跃记忆占比

### 🔍 发现的问题
1. **碎片化记忆**：过于零碎、缺乏上下文的记忆
2. **重复记忆**：内容高度相似的记忆
3. **过时记忆**：已过时或不再相关的记忆
4. **低质量记忆**：信息量极低的记忆

### 📋 清理建议
对每类问题给出具体的处理建议，列出候选记忆 ID。

### 🔗 合并建议
哪些碎片记忆可以合并为更有价值的综合记忆。

### ⚡ 优化建议
- 哪些主题的记忆不足，需要补充？
- 记忆标签和分类是否可以优化？
- 温度衰减策略是否需要调整？

### 📈 与上次对比
趋势分析和改善情况。`,
          user_prompt: '记忆库数据：\n{{json input}}',
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      {
        id: 'output_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1100, y: 320 },
        config: {
          title_template: '{{$date}} 记忆整理优化报告',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_stats', source_port: 'out', target_node: 'merge_12', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_temp', source_port: 'out', target_node: 'merge_12', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_12', source_port: 'out', target_node: 'merge_all', target_port: 'in_a' },
      { id: 'e4', source_node: 'src_low_importance', source_port: 'out', target_node: 'merge_all', target_port: 'in_b' },
      { id: 'e5', source_node: 'merge_all', source_port: 'out', target_node: 'llm_analyze', target_port: 'in' },
      { id: 'e6', source_node: 'llm_analyze', source_port: 'out', target_node: 'output_report', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
