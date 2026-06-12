/**
 * llm-summarize 执行器
 * 长文本自动摘要，支持 single 和 map-reduce 策略
 */

import type { NodeExecutor } from './index.js';
import { chatOnce } from '../llm/client.js';

export const llmSummarizeExecutor: NodeExecutor = async (node, inputs, ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;
  const strategy = cfg.strategy || 'single';
  const maxChunkSize = Number(cfg.max_chunk_size) || 4000;
  const model = cfg.model || ctx.defaultLlm.model || undefined;
  const temperature = ctx.defaultLlm.temperature;
  const maxTokens = ctx.defaultLlm.max_tokens;

  // 获取输入文本
  let text = '';
  if (typeof inputs.in === 'string') {
    text = inputs.in;
  } else if (Array.isArray(inputs.in)) {
    text = inputs.in.map((item: any) =>
      typeof item === 'string' ? item : (item?.content || JSON.stringify(item))
    ).join('\n\n---\n\n');
  } else {
    text = JSON.stringify(inputs.in);
  }

  let totalUsage = { prompt_tokens: 0, completion_tokens: 0 };
  let resultModel = model || '';
  let summary: string;

  if (strategy === 'map-reduce' && text.length > maxChunkSize) {
    // 分段摘要再合并
    const chunks = splitText(text, maxChunkSize);
    const chunkSummaries: string[] = [];

    for (const chunk of chunks) {
      const resp = await chatOnce({
        systemPrompt: '你是一个摘要助手。请简洁准确地概括以下内容的要点。',
        userPrompt: chunk,
        model,
        temperature,
        max_tokens: maxTokens,
      });
      chunkSummaries.push(resp.content);
      totalUsage.prompt_tokens += resp.usage.prompt_tokens;
      totalUsage.completion_tokens += resp.usage.completion_tokens;
      resultModel = resp.model;
    }

    // Reduce：合并所有段摘要
    const combinedText = chunkSummaries.join('\n\n');
    const reduceResp = await chatOnce({
      systemPrompt: '你是一个摘要助手。以下是多个段落的摘要，请合并为一篇流畅的整体摘要。',
      userPrompt: combinedText,
      model,
      temperature,
      max_tokens: maxTokens,
    });
    summary = reduceResp.content;
    totalUsage.prompt_tokens += reduceResp.usage.prompt_tokens;
    totalUsage.completion_tokens += reduceResp.usage.completion_tokens;
    resultModel = reduceResp.model;
  } else {
    // Single 策略：直接摘要
    const resp = await chatOnce({
      systemPrompt: '你是一个摘要助手。请简洁准确地概括以下内容的要点。',
      userPrompt: text,
      model,
      temperature,
      max_tokens: maxTokens,
    });
    summary = resp.content;
    totalUsage = resp.usage;
    resultModel = resp.model;
  }

  return {
    outputs: { out: summary },
    llmUsage: {
      prompt_tokens: totalUsage.prompt_tokens,
      completion_tokens: totalUsage.completion_tokens,
      model: resultModel,
    },
  };
};

function splitText(text: string, maxSize: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxSize));
    start += maxSize;
  }
  return chunks;
}
