/**
 * llm-structured 执行器
 * LLM 结构化 JSON 输出，要求 LLM 返回 JSON 格式
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';
import { chatStructured } from '../llm/client.js';

export const llmStructuredExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;

  // 将输入注入模板数据
  const extendedData = {
    ...templateData,
    input: inputs.in,
    items: Array.isArray(inputs.in) ? inputs.in : undefined,
    text: typeof inputs.in === 'string' ? inputs.in : undefined,
  };

  // 渲染 prompts
  const systemPrompt = cfg.system_prompt
    ? renderTemplate(String(cfg.system_prompt), extendedData)
    : undefined;

  const userPrompt = cfg.user_prompt
    ? renderTemplate(String(cfg.user_prompt), extendedData)
    : '';

  if (!userPrompt) {
    throw new Error('llm-structured 节点缺少必填参数 user_prompt');
  }

  // 如果有 output_schema，将其加入 system prompt
  let fullSystemPrompt = systemPrompt || '';
  if (cfg.output_schema) {
    const schemaStr = typeof cfg.output_schema === 'string'
      ? cfg.output_schema
      : JSON.stringify(cfg.output_schema, null, 2);
    fullSystemPrompt += `\n\n你的输出必须严格遵循以下 JSON Schema：\n${schemaStr}`;
  }

  const model = cfg.model || ctx.defaultLlm.model || undefined;
  const temperature = cfg.temperature != null ? Number(cfg.temperature) : ctx.defaultLlm.temperature;
  const maxTokens = cfg.max_tokens != null ? Number(cfg.max_tokens) : ctx.defaultLlm.max_tokens;

  const resp = await chatStructured({
    systemPrompt: fullSystemPrompt || undefined,
    userPrompt,
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
