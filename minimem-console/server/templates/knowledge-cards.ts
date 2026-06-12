/**
 * 内置模板：知识卡片生成
 */

import { createTemplate, listTemplates } from '../store/templates.js';

const TEMPLATE_ID = 'tpl-knowledge-cards';

export function initKnowledgeCardsTemplate(): void {
  const existing = listTemplates();
  if (existing.some((t) => t.id === TEMPLATE_ID)) return;

  console.log('[Templates] 初始化内置模板: 知识卡片生成');

  createTemplate({
    id: TEMPLATE_ID,
    name: '知识卡片生成',
    description: '从高层级知识记忆中提取关键概念，自动生成结构化的知识卡片，便于回顾和巩固。',
    tags: ['knowledge', 'cards', 'builtin'],
    schedule_type: 'manual',
    nodes: [
      {
        id: 'src_knowledge',
        type: 'memory-list',
        label: '获取知识记忆',
        position: { x: 100, y: 200 },
        config: { page: 1, page_size: 20, layer: 'L3' },
        inputs: [],
        outputs: [{ id: 'out', label: '记忆列表', type: 'memories' }],
      },
      {
        id: 'llm_cards',
        type: 'llm-structured',
        label: 'LLM 生成卡片',
        position: { x: 400, y: 200 },
        config: {
          system_prompt: `你是知识整理专家。请将输入的知识记忆转化为结构化的知识卡片。每张卡片包含：
- title: 卡片标题（简洁的知识点）
- summary: 一句话总结
- key_points: 关键要点列表
- related_concepts: 相关概念
- practical_tip: 实践建议`,
          user_prompt: '请为以下知识记忆生成知识卡片：\n{{json input}}',
          output_schema: '{"type":"object","properties":{"cards":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"summary":{"type":"string"},"key_points":{"type":"array","items":{"type":"string"}},"related_concepts":{"type":"array","items":{"type":"string"}},"practical_tip":{"type":"string"}}}}}}',
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: 'JSON', type: 'json' }],
      },
      {
        id: 'tpl_render',
        type: 'template',
        label: '渲染卡片',
        position: { x: 700, y: 200 },
        config: {
          template: `# 📚 知识卡片集

{{#each input.cards}}
---

## 🃏 {{this.title}}

> {{this.summary}}

**关键要点：**
{{#each this.key_points}}
- {{this}}
{{/each}}

**相关概念：** {{join this.related_concepts ", "}}

💡 **实践建议：** {{this.practical_tip}}

{{/each}}

---
*生成时间：{{$datetime}}*`,
        },
        inputs: [{ id: 'in', label: '上下文', type: 'any' }],
        outputs: [{ id: 'out', label: '渲染文本', type: 'text' }],
      },
      {
        id: 'output_report',
        type: 'output-console',
        label: '保存报告',
        position: { x: 1000, y: 200 },
        config: {
          title_template: '{{$date}} 知识卡片',
        },
        inputs: [{ id: 'in', label: '内容', type: 'any' }],
        outputs: [],
      },
    ],
    edges: [
      { id: 'e1', source_node: 'src_knowledge', source_port: 'out', target_node: 'llm_cards', target_port: 'in' },
      { id: 'e2', source_node: 'llm_cards', source_port: 'out', target_node: 'tpl_render', target_port: 'in' },
      { id: 'e3', source_node: 'tpl_render', source_port: 'out', target_node: 'output_report', target_port: 'in' },
    ],
    variables: {},
    default_llm: {},
  });
}
