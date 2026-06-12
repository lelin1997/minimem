/**
 * 内置模板：网页变更监控
 * 定时请求指定 URL → 与上次运行对比 → 有变化则 LLM 分析 → 通知
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-webpage-monitor';

export function initWebpageMonitorTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 网页变更监控');

  createTemplate({
    id: TEMPLATE_ID,
    name: '网页变更监控',
    description: '每小时抓取指定网页内容，与上次运行对比，发现变化时用 LLM 分析变更要点并通知。适合监控竞品、文档更新、产品 Changelog 等。',
    tags: ['perception', 'monitor', 'diff', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 * * * *',
    nodes: [
      {
        id: 'fetch_page',
        type: 'web-scrape',
        label: '抓取网页',
        position: { x: 100, y: 200 },
        config: {
          url: 'https://example.com/changelog',
          extract_mode: 'readability',
          max_length: 3000,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '网页内容', type: 'json' }],
      },
      {
        id: 'prev_content',
        type: 'previous-run',
        label: '上次内容',
        position: { x: 100, y: 400 },
        config: {
          node_id: 'fetch_page',
        },
        inputs: [],
        outputs: [{ id: 'out', label: '上次输出', type: 'any' }],
      },
      {
        id: 'merge_data',
        type: 'merge',
        label: '合并新旧',
        position: { x: 400, y: 300 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '当前', type: 'any' },
          { id: 'in_b', label: '上次', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'diff_check',
        type: 'javascript',
        label: '对比差异',
        position: { x: 650, y: 300 },
        config: {
          code: `const current = input.a?.content || '';
const previous = input.b?.content || '';
if (!previous) return { changed: true, reason: '首次运行', current };
if (current === previous) return { changed: false };
return { changed: true, reason: 'content_changed', current, previous, currentLength: current.length, previousLength: previous.length };`,
        },
        inputs: [{ id: 'in', label: '输入', type: 'any' }],
        outputs: [{ id: 'out', label: '输出', type: 'any' }],
      },
      {
        id: 'has_change',
        type: 'if-else',
        label: '是否有变化',
        position: { x: 900, y: 300 },
        config: {
          condition: 'input.changed === true && input.reason !== "首次运行"',
        },
        inputs: [{ id: 'in', label: '输入', type: 'any' }],
        outputs: [
          { id: 'true', label: 'True', type: 'any' },
          { id: 'false', label: 'False', type: 'any' },
        ],
      },
      {
        id: 'llm_analyze',
        type: 'llm-chat',
        label: 'LLM 分析变更',
        position: { x: 1150, y: 200 },
        config: {
          system_prompt: `你是一位变更分析助手。用户监控了一个网页的内容变化。
请对比新旧内容，用中文简洁描述：
1. 主要变更了什么
2. 变更的意义（如果能判断的话）

格式：
## 🔔 网页变更提醒

**监控页面**: [页面标题/URL]
**变更时间**: {{$date}} {{$time}}

### 变更内容
- 具体变更点

### 分析
简要分析这个变更的意义。`,
          user_prompt: `当前内容 ({{input.currentLength}} 字):
{{input.current}}

上次内容 ({{input.previousLength}} 字):
{{input.previous}}`,
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      {
        id: 'write_memory',
        type: 'output-minimem',
        label: '写入记忆',
        position: { x: 1400, y: 150 },
        config: {
          source: 'perception:webpage-monitor',
          content_type: 'change-alert',
          importance: 0.7,
          tags: '外部感知,网页监控,变更',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
      {
        id: 'save_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1400, y: 300 },
        config: {
          title_template: '{{$date}} 网页变更提醒',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'fetch_page', source_port: 'out', target_node: 'merge_data', target_port: 'in_a' },
      { id: 'e2', source_node: 'prev_content', source_port: 'out', target_node: 'merge_data', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_data', source_port: 'out', target_node: 'diff_check', target_port: 'in' },
      { id: 'e4', source_node: 'diff_check', source_port: 'out', target_node: 'has_change', target_port: 'in' },
      { id: 'e5', source_node: 'has_change', source_port: 'true', target_node: 'llm_analyze', target_port: 'in' },
      { id: 'e6', source_node: 'llm_analyze', source_port: 'out', target_node: 'write_memory', target_port: 'in' },
      { id: 'e7', source_node: 'llm_analyze', source_port: 'out', target_node: 'save_report', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
