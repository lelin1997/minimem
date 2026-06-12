/**
 * output-console 执行器
 * 将内容保存到 Console 报告数据库
 */

import { randomUUID } from 'crypto';
import type { NodeExecutor, ExecutorResult } from './index.js';
import { renderTemplate } from '../engine/template.js';
import { getDb } from '../db.js';

export const outputConsoleExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;
  const db = getDb();

  // 渲染标题模板
  const title = renderTemplate(String(cfg.title_template || ''), templateData);
  const content = inputs.in;

  // 转为字符串
  const fullContent = typeof content === 'string'
    ? content
    : JSON.stringify(content, null, 2);

  // 预览（前 500 字）
  const preview = fullContent.slice(0, 500);

  // 写入 pipeline_outputs 表
  const outputId = randomUUID();
  db.prepare(`
    INSERT INTO pipeline_outputs (id, run_id, node_id, node_label, output_type, preview, full_content, created_at)
    VALUES (?, ?, ?, ?, 'console', ?, ?, datetime('now'))
  `).run(outputId, ctx.runId, node.id, node.label || title, preview, fullContent);

  return {
    outputs: {
      out: {
        id: outputId,
        title,
        preview,
        length: fullContent.length,
      },
    },
  };
};
