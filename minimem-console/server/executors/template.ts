/**
 * template 执行器
 * Handlebars 模板渲染节点
 */

import type { NodeExecutor, ExecutorResult } from './index.js';
import { renderTemplate } from '../engine/template.js';

export const templateExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;
  const template = String(cfg.template || '');

  if (!template) {
    throw new Error('template 节点缺少必填参数 template');
  }

  // 将输入注入模板数据
  const extendedData = {
    ...templateData,
    input: inputs.in,
    items: Array.isArray(inputs.in) ? inputs.in : undefined,
    text: typeof inputs.in === 'string' ? inputs.in : undefined,
  };

  const rendered = renderTemplate(template, extendedData);

  return {
    outputs: { out: rendered },
  };
};
