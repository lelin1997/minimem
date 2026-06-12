/**
 * 内置模板：阅读与学习摘要
 * 每周汇总阅读和学习相关的记忆，生成知识消化报告
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-reading-digest';

export function initReadingDigestTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 阅读与学习摘要');

  createTemplate({
    id: TEMPLATE_ID,
    name: '阅读与学习摘要',
    description: '每周三、日自动汇总阅读和学习相关的记忆，提炼核心观点，生成结构化知识摘要，帮助消化吸收所学内容。',
    tags: ['knowledge', 'review', 'builtin'],
    schedule_type: 'cron',
    schedule_cron: '0 20 * * 0,3',
    nodes: [
      {
        id: 'src_reading',
        type: 'memory-search',
        label: '搜索阅读记忆',
        position: { x: 100, y: 150 },
        config: {
          query: '读到 学到 文章 书 视频 教程 课程 分享 笔记 论文 博客',
          top_k: 40,
        },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'src_tech',
        type: 'memory-search',
        label: '搜索技术记忆',
        position: { x: 100, y: 350 },
        config: {
          query: '技术 架构 框架 工具 最佳实践 原理 设计模式 算法',
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
          { id: 'in_a', label: '阅读', type: 'any' },
          { id: 'in_b', label: '技术', type: 'any' },
        ],
        outputs: [{ id: 'out', label: '合并结果', type: 'any' }],
      },
      {
        id: 'llm_digest',
        type: 'llm-chat',
        label: 'LLM 生成摘要',
        position: { x: 700, y: 250 },
        config: {
          system_prompt: `你是一位知识管理专家，擅长帮助人们整理和消化所学知识。

请基于提供的阅读和学习记忆，生成一份知识摘要报告。使用 Markdown 格式。

报告结构：
## 📖 阅读与学习摘要

### 🔑 核心收获（Top 5）
从所有阅读中提炼出最有价值的 5 个核心观点或知识点。

### 📚 内容分类汇总
按主题对所学内容进行分类：
- **技术类**：框架、工具、架构
- **方法论**：流程、最佳实践
- **通识类**：思维方式、认知升级
- **行业类**：趋势、案例

### 🔗 知识关联
发现不同来源知识之间的关联和交叉点。

### 🎯 行动清单
基于所学，有哪些可以立即实践的行动项？

### 📌 待深入主题
哪些主题值得进一步深入研究？`,
          user_prompt: '以下是近期的阅读和学习记忆：\n{{json input}}',
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '输出文本', type: 'text' }],
      },
      {
        id: 'output_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1000, y: 150 },
        config: {
          title_template: '{{$date}} 阅读与学习摘要',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
      {
        id: 'output_file',
        type: 'output-file',
        label: '写入文件',
        position: { x: 1000, y: 350 },
        config: {
          path_template: 'reading-digest/{{$date}}.md',
          format: 'md',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_reading', source_port: 'out', target_node: 'merge_data', target_port: 'in_a' },
      { id: 'e2', source_node: 'src_tech', source_port: 'out', target_node: 'merge_data', target_port: 'in_b' },
      { id: 'e3', source_node: 'merge_data', source_port: 'out', target_node: 'llm_digest', target_port: 'in' },
      { id: 'e4', source_node: 'llm_digest', source_port: 'out', target_node: 'output_report', target_port: 'in' },
      { id: 'e5', source_node: 'llm_digest', source_port: 'out', target_node: 'output_file', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
