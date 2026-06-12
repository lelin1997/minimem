/**
 * 内置模板：GitHub Trending 追踪
 * 每天自动抓取 GitHub Trending → LLM 分析热门项目 → 写入记忆
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-github-trending';

export function initGithubTrendingTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: GitHub Trending 追踪');

  createTemplate({
    id: TEMPLATE_ID,
    name: 'GitHub Trending 追踪',
    description: '每天早上自动抓取 GitHub 热门仓库，LLM 分析值得关注的项目和技术方向，将洞察写入记忆。',
    tags: ['perception', 'github', 'opensource', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 9 * * *',
    nodes: [
      {
        id: 'src_all',
        type: 'github-trending',
        label: '全语言 Trending',
        position: { x: 100, y: 150 },
        config: {
          language: '',
          since: 'daily',
          limit: 10,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '热门仓库', type: 'json' }],
      },
      {
        id: 'src_ts',
        type: 'github-trending',
        label: 'TypeScript Trending',
        position: { x: 100, y: 350 },
        config: {
          language: 'typescript',
          since: 'daily',
          limit: 5,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '热门仓库', type: 'json' }],
      },
      {
        id: 'merge_repos',
        type: 'merge',
        label: '合并结果',
        position: { x: 400, y: 250 },
        config: { mode: 'object' },
        inputs: [
          { id: 'in_a', label: '全语言', type: 'any' },
          { id: 'in_b', label: 'TS', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_analyze',
        type: 'llm-chat',
        label: 'LLM 分析项目',
        position: { x: 700, y: 250 },
        config: {
          system_prompt: `你是一位开源技术分析师，擅长从 GitHub Trending 中识别有价值的项目和趋势。

请分析以下 GitHub 热门仓库数据，输出一份中文报告：

## 🔥 GitHub Trending 日报 ({{$date}})

### 🌟 今日值得关注（Top 5）
从所有仓库中挑选最值得关注的 5 个，说明为什么值得关注。

### 📂 分类汇总
按领域分类：
- **AI/LLM 相关**
- **开发工具/基础设施**
- **Web/前端**
- **其他有趣项目**

### 📈 趋势洞察
本日 Trending 反映出什么技术趋势？

注意：
- 关注创新性和实用价值
- 对 AI Agent、LLM 工具、开发者体验相关项目给予额外关注
- 用简洁的语言，每个项目不超过两句话`,
          user_prompt: `全语言热门仓库：
{{#each input.a}}
- **{{this.fullName}}** ⭐{{this.stars}} (+{{this.starsToday}} today) [{{this.language}}]
  {{this.description}}
{{/each}}

TypeScript 热门仓库：
{{#each input.b}}
- **{{this.fullName}}** ⭐{{this.stars}} (+{{this.starsToday}} today)
  {{this.description}}
{{/each}}`,
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      {
        id: 'write_memory',
        type: 'output-minimem',
        label: '写入记忆',
        position: { x: 1000, y: 150 },
        config: {
          source: 'perception:github-trending',
          content_type: 'insight',
          importance: 0.5,
          tags: '外部感知,GitHub,开源,Trending',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
      {
        id: 'save_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1000, y: 350 },
        config: {
          title_template: '{{$date}} GitHub Trending 日报',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_all', source_port: 'out', target_node: 'merge_repos', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_ts', source_port: 'out', target_node: 'merge_repos', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_repos', source_port: 'out', target_node: 'llm_analyze', target_port: 'in' },
      { id: 'e4', source_node: 'llm_analyze', source_port: 'out', target_node: 'write_memory', target_port: 'in' },
      { id: 'e5', source_node: 'llm_analyze', source_port: 'out', target_node: 'save_report', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
