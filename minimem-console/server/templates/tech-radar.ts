/**
 * 内置模板：技术前沿扫描
 * 定时抓取多个技术 RSS 源 → 去重 → LLM 分析洞察 → 写入记忆
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-tech-radar';

export function initTechRadarTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 技术前沿扫描');

  createTemplate({
    id: TEMPLATE_ID,
    name: '技术前沿扫描',
    description: '每 4 小时自动抓取 Hacker News、阮一峰博客等技术源，去重后用 LLM 提取技术洞察，有价值的内容自动写入记忆。',
    tags: ['perception', 'tech', 'rss', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 */4 * * *',
    nodes: [
      {
        id: 'src_hn',
        type: 'rss-fetch',
        label: 'Hacker News',
        position: { x: 100, y: 150 },
        config: {
          url: 'https://hnrss.org/best?count=15',
          limit: 10,
          since_hours: 8,
          include_content: 'false',
        },
        inputs: [],
        outputs: [{ id: 'out', label: '文章列表', type: 'json' }],
      },
      {
        id: 'src_ruanyf',
        type: 'rss-fetch',
        label: '阮一峰博客',
        position: { x: 100, y: 350 },
        config: {
          url: 'https://www.ruanyifeng.com/blog/atom.xml',
          limit: 5,
          since_hours: 48,
          include_content: 'false',
        },
        inputs: [],
        outputs: [{ id: 'out', label: '文章列表', type: 'json' }],
      },
      {
        id: 'merge_feeds',
        type: 'merge',
        label: '合并订阅源',
        position: { x: 400, y: 250 },
        config: { mode: 'concat' },
        inputs: [
          { id: 'in_a', label: 'HN', type: 'any' },
          { id: 'in_b', label: '阮一峰', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'dedup',
        type: 'deduplicate',
        label: '去重',
        position: { x: 600, y: 250 },
        config: { field: 'link' },
        inputs: [{ id: 'in', label: '输入', type: 'any' }],
        outputs: [{ id: 'out', label: '去重结果', type: 'any' }],
      },
      {
        id: 'llm_analyze',
        type: 'llm-chat',
        label: 'LLM 提取洞察',
        position: { x: 850, y: 250 },
        config: {
          system_prompt: `你是一位技术趋势分析师，关注 AI/LLM/Agent、开发者工具、系统设计/SRE、开源项目。

从以下文章列表中提取有价值的技术洞察。要求：
1. 只关注真正有价值和创新性的内容
2. 用中文输出
3. 每篇有价值的文章提取一条洞察
4. 输出格式：

## 🔭 技术前沿扫描 ({{$date}})

### 洞察列表
- **[文章标题]** — 一句话洞察（为什么值得关注）

### 趋势判断
总结本次扫描看到的 1-2 个技术趋势方向。

如果没有值得关注的内容，输出 "本次扫描无显著洞察"。`,
          user_prompt: `以下是最新抓取的技术文章：

{{#each input}}
- **{{this.title}}** ({{this.link}})
  摘要: {{this.summary}}
{{/each}}

请提取技术洞察。`,
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      {
        id: 'judge_value',
        type: 'if-else',
        label: '是否有价值',
        position: { x: 1100, y: 250 },
        config: {
          condition: '!input.includes("无显著洞察")',
        },
        inputs: [{ id: 'in', label: '输入', type: 'any' }],
        outputs: [
          { id: 'true', label: 'True', type: 'any' },
          { id: 'false', label: 'False', type: 'any' },
        ],
      },
      {
        id: 'write_memory',
        type: 'output-minimem',
        label: '写入记忆',
        position: { x: 1400, y: 150 },
        config: {
          source: 'perception:tech-radar',
          content_type: 'insight',
          importance: 0.6,
          tags: '外部感知,技术前沿,自动扫描',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
      {
        id: 'log_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1400, y: 350 },
        config: {
          title_template: '{{$date}} 技术前沿扫描',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_hn', source_port: 'out', target_node: 'merge_feeds', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_ruanyf', source_port: 'out', target_node: 'merge_feeds', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_feeds', source_port: 'out', target_node: 'dedup', target_port: 'in' },
      { id: 'e4', source_node: 'dedup', source_port: 'out', target_node: 'llm_analyze', target_port: 'in' },
      { id: 'e5', source_node: 'llm_analyze', source_port: 'out', target_node: 'judge_value', target_port: 'in' },
      { id: 'e6', source_node: 'judge_value', source_port: 'true', target_node: 'write_memory', target_port: 'in' },
      { id: 'e7', source_node: 'judge_value', source_port: 'true', target_node: 'log_report', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
