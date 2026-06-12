/**
 * 内置模板：行业资讯监控
 * 抓取多个行业 RSS/新闻源 → LLM 分类摘要 → 写入记忆 + 保存报告
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-industry-monitor';

export function initIndustryMonitorTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 行业资讯监控');

  createTemplate({
    id: TEMPLATE_ID,
    name: '行业资讯监控',
    description: '每天早晚各一次，抓取 36kr、TechCrunch 等行业资讯源，LLM 自动分类和摘要，生成资讯简报。',
    tags: ['perception', 'industry', 'news', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 8,18 * * *',
    nodes: [
      {
        id: 'src_36kr',
        type: 'rss-fetch',
        label: '36kr 快讯',
        position: { x: 100, y: 100 },
        config: {
          url: 'https://36kr.com/feed',
          limit: 10,
          since_hours: 12,
          include_content: 'false',
        },
        inputs: [],
        outputs: [{ id: 'out', label: '文章列表', type: 'json' }],
      },
      {
        id: 'src_techcrunch',
        type: 'rss-fetch',
        label: 'TechCrunch',
        position: { x: 100, y: 300 },
        config: {
          url: 'https://techcrunch.com/feed/',
          limit: 10,
          since_hours: 12,
          include_content: 'false',
        },
        inputs: [],
        outputs: [{ id: 'out', label: '文章列表', type: 'json' }],
      },
      {
        id: 'src_ars',
        type: 'rss-fetch',
        label: 'Ars Technica',
        position: { x: 100, y: 500 },
        config: {
          url: 'https://feeds.arstechnica.com/arstechnica/index',
          limit: 8,
          since_hours: 12,
          include_content: 'false',
        },
        inputs: [],
        outputs: [{ id: 'out', label: '文章列表', type: 'json' }],
      },
      {
        id: 'merge_1',
        type: 'merge',
        label: '合并 36kr + TC',
        position: { x: 400, y: 200 },
        config: { mode: 'concat' },
        inputs: [
          { id: 'in_a', label: '36kr', type: 'any' },
          { id: 'in_b', label: 'TC', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'merge_2',
        type: 'merge',
        label: '合并全部',
        position: { x: 600, y: 300 },
        config: { mode: 'concat' },
        inputs: [
          { id: 'in_a', label: '前两个', type: 'any' },
          { id: 'in_b', label: 'Ars', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'dedup',
        type: 'deduplicate',
        label: '去重',
        position: { x: 800, y: 300 },
        config: { field: 'title' },
        inputs: [{ id: 'in', label: '输入', type: 'any' }],
        outputs: [{ id: 'out', label: '去重结果', type: 'any' }],
      },
      {
        id: 'llm_digest',
        type: 'llm-chat',
        label: 'LLM 分类摘要',
        position: { x: 1050, y: 300 },
        config: {
          system_prompt: `你是一位行业资讯编辑，擅长从大量新闻中快速筛选和分类。

请将以下资讯按类别整理，生成一份简洁的行业简报：

## 📰 行业资讯简报 ({{$date}})

### 🤖 AI / 大模型
与 AI、LLM、机器学习相关的重要消息。

### 💻 科技产品 / 平台
重要产品发布、平台更新。

### 💰 融资 / 商业
创业融资、并购、商业策略。

### 🔬 前沿技术
底层技术突破、研究成果。

### 📋 一句话快讯
其他值得注意但不需展开的消息。

要求：
- 每条用一句中文概括核心信息
- 标注来源（36kr/TC/Ars）
- 忽略明显的软文和广告
- 如果某类别无相关内容则不显示该类别`,
          user_prompt: `以下是最新抓取的行业资讯：

{{#each input}}
- **{{this.title}}** (来源: {{this.author}}, 链接: {{this.link}})
  摘要: {{this.summary}}
{{/each}}

请分类整理为行业简报。`,
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      {
        id: 'write_memory',
        type: 'output-minimem',
        label: '写入记忆',
        position: { x: 1350, y: 200 },
        config: {
          source: 'perception:industry-monitor',
          content_type: 'briefing',
          importance: 0.5,
          tags: '外部感知,行业资讯,简报',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
      {
        id: 'save_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1350, y: 400 },
        config: {
          title_template: '{{$date}} 行业资讯简报',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_36kr', source_port: 'out', target_node: 'merge_1', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_techcrunch', source_port: 'out', target_node: 'merge_1', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_1', source_port: 'out', target_node: 'merge_2', target_port: 'in_a' },
      { id: 'e4', source_node: 'src_ars', source_port: 'out', target_node: 'merge_2', target_port: 'in_b' },
      { id: 'e5', source_node: 'merge_2', source_port: 'out', target_node: 'dedup', target_port: 'in' },
      { id: 'e6', source_node: 'dedup', source_port: 'out', target_node: 'llm_digest', target_port: 'in' },
      { id: 'e7', source_node: 'llm_digest', source_port: 'out', target_node: 'write_memory', target_port: 'in' },
      { id: 'e8', source_node: 'llm_digest', source_port: 'out', target_node: 'save_report', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
