/**
 * llm-extract 执行器
 * 从文本中提取结构化信息
 */

import type { NodeExecutor } from './index.js';
import { chatStructured } from '../llm/client.js';

export const llmExtractExecutor: NodeExecutor = async (node, inputs, ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;
  const model = cfg.model || ctx.defaultLlm.model || undefined;
  const temperature = ctx.defaultLlm.temperature;
  const maxTokens = ctx.defaultLlm.max_tokens;

  // 获取字段定义
  let fields: { name: string; type: string; description?: string }[] = [];
  if (cfg.fields) {
    try {
      fields = typeof cfg.fields === 'string' ? JSON.parse(cfg.fields) : cfg.fields;
    } catch {
      throw new Error('llm-extract 节点的 fields 配置格式不正确（应为 JSON 数组）');
    }
  }

  if (!fields.length) {
    throw new Error('llm-extract 节点需要至少定义一个提取字段');
  }

  // 获取输入文本
  let text = '';
  if (typeof inputs.in === 'string') {
    text = inputs.in;
  } else if (Array.isArray(inputs.in)) {
    text = inputs.in.map((item: any) =>
      typeof item === 'string' ? item : (item?.content || JSON.stringify(item))
    ).join('\n\n');
  } else {
    text = JSON.stringify(inputs.in);
  }

  const fieldsDescription = fields
    .map(f => `- ${f.name} (${f.type})${f.description ? `: ${f.description}` : ''}`)
    .join('\n');

  const systemPrompt = `你是一个信息提取助手。从用户提供的文本中提取以下字段：\n${fieldsDescription}\n\n以 JSON 对象格式返回，键名为字段名。如果文本中找不到某字段的值，该字段设为 null。`;

  const resp = await chatStructured({
    systemPrompt,
    userPrompt: text,
    model,
    temperature,
    max_tokens: maxTokens,
  });

  return {
    outputs: { out: resp.data },
    llmUsage: {
      prompt_tokens: resp.usage.prompt_tokens,
      completion_tokens: resp.usage.completion_tokens,
      model: resp.model,
    },
  };
};
