/**
 * llm-chat 执行器
 * 单轮 LLM 调用，支持 system/user prompt 模板
 */

import type { NodeExecutor, ExecutorResult } from './index.js';
import { renderTemplate } from '../engine/template.js';
import { chatOnce } from '../llm/client.js';

export const llmChatExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;

  // 将输入注入模板数据
  const extendedData = {
    ...templateData,
    input: inputs.in,
    // 如果输入是数组，额外暴露 items
    items: Array.isArray(inputs.in) ? inputs.in : undefined,
    // 如果输入是字符串，额外暴露 text
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
    throw new Error('llm-chat 节点缺少必填参数 user_prompt');
  }

  // 使用节点配置的模型参数，未指定则使用 Pipeline 默认 / 全局默认
  const model = cfg.model || ctx.defaultLlm.model || undefined;
  const temperature = cfg.temperature != null ? Number(cfg.temperature) : ctx.defaultLlm.temperature;
  const maxTokens = cfg.max_tokens != null ? Number(cfg.max_tokens) : ctx.defaultLlm.max_tokens;

  const resp = await chatOnce({
    systemPrompt,
    userPrompt,
    model,
    temperature,
    max_tokens: maxTokens,
  });

  return {
    outputs: { out: resp.content },
    llmUsage: {
      prompt_tokens: resp.usage.prompt_tokens,
      completion_tokens: resp.usage.completion_tokens,
      model: resp.model,
    },
  };
};
