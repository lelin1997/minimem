/**
 * llm-judge 执行器
 * LLM 做判断/打分
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';
import { chatStructured } from '../llm/client.js';

export const llmJudgeExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;
  const model = cfg.model || ctx.defaultLlm.model || undefined;
  const temperature = ctx.defaultLlm.temperature;
  const maxTokens = ctx.defaultLlm.max_tokens;

  const extendedData = {
    ...templateData,
    input: inputs.in,
    items: Array.isArray(inputs.in) ? inputs.in : undefined,
    text: typeof inputs.in === 'string' ? inputs.in : undefined,
  };

  let systemPrompt = cfg.system_prompt
    ? renderTemplate(String(cfg.system_prompt), extendedData)
    : '你是一个评判助手。根据给定的标准对内容进行判断和打分。';

  if (cfg.criteria) {
    systemPrompt += `\n\n评判标准：\n${cfg.criteria}`;
  }

  systemPrompt += '\n\n请以 JSON 格式返回判断结果，至少包含 "score" (0-100) 和 "reasoning" 字段。';

  const userPrompt = cfg.user_prompt
    ? renderTemplate(String(cfg.user_prompt), extendedData)
    : (typeof inputs.in === 'string' ? inputs.in : JSON.stringify(inputs.in));

  if (!userPrompt) {
    throw new Error('llm-judge 节点缺少输入内容');
  }

  const resp = await chatStructured({
    systemPrompt,
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
