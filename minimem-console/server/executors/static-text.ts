/**
 * static-text 执行器
 * 输出一段静态文本（支持模板渲染）
 */

import type { NodeExecutor, ExecutorResult } from './index.js';
import { renderTemplate } from '../engine/template.js';

export const staticTextExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;

  const text = cfg.text
    ? renderTemplate(String(cfg.text), templateData)
    : '';

  return {
    outputs: { out: text },
  };
};
