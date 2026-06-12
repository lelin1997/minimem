/**
 * 节点执行器注册表
 * 每种节点类型对应一个执行器函数
 */

import type { RunContext } from '../engine/context.js';
import type { PipelineNode } from '../engine/dag.js';
import type { LLMResponse } from '../llm/client.js';

// ── 执行器接口 ──

export interface ExecutorResult {
  /** 输出数据：portId → data */
  outputs: Record<string, unknown>;
  /** LLM 使用量（仅 LLM 节点） */
  llmUsage?: {
    prompt_tokens: number;
    completion_tokens: number;
    model: string;
  };
}

export type NodeExecutor = (
  node: PipelineNode,
  inputs: Record<string, unknown>,
  ctx: RunContext,
  templateData: Record<string, unknown>
) => Promise<ExecutorResult>;

// ── 注册表 ──

const executorRegistry = new Map<string, NodeExecutor>();

export function registerExecutor(type: string, executor: NodeExecutor): void {
  executorRegistry.set(type, executor);
}

export function getExecutor(type: string): NodeExecutor | undefined {
  return executorRegistry.get(type);
}

export function hasExecutor(type: string): boolean {
  return executorRegistry.has(type);
}

export function listExecutorTypes(): string[] {
  return Array.from(executorRegistry.keys());
}

// ── 注册所有执行器 ──

// Phase 1 核心执行器
import { memorySearchExecutor } from './memory-search.js';
import { filterExecutor } from './filter.js';
import { mergeExecutor } from './merge.js';
import { llmChatExecutor } from './llm-chat.js';
import { outputFileExecutor } from './output-file.js';
import { outputConsoleExecutor } from './output-console.js';
import { staticTextExecutor } from './static-text.js';
import { sortExecutor } from './sort.js';
import { templateExecutor } from './template.js';

// Phase 2 数据源
import { memoryListExecutor } from './memory-list.js';
import { memoryRecallExecutor } from './memory-recall.js';
import { surfaceLoadExecutor } from './surface-load.js';
import { healthCheckExecutor } from './health-check.js';
import { statsExecutor } from './stats.js';
import { temperatureExecutor } from './temperature.js';
import { ownerProfileExecutor } from './owner-profile.js';
import { personLoadExecutor } from './person-load.js';
import { inspirationLoadExecutor } from './inspiration-load.js';
import { httpRequestExecutor } from './http-request.js';
import { previousRunExecutor } from './previous-run.js';

// Phase 3 外部感知
import { rssFetchExecutor } from './rss-fetch.js';
import { webScrapeExecutor } from './web-scrape.js';
import { webSearchExecutor } from './web-search.js';
import { githubTrendingExecutor } from './github-trending.js';

// Phase 2 转换
import { limitExecutor } from './limit.js';
import { groupByExecutor } from './group-by.js';
import { jsonPathExecutor } from './json-path.js';
import { splitExecutor } from './split.js';
import { deduplicateExecutor } from './deduplicate.js';
import { javascriptExecutor } from './javascript.js';

// Phase 2 AI
import { llmStructuredExecutor } from './llm-structured.js';
import { llmSummarizeExecutor } from './llm-summarize.js';
import { llmExtractExecutor } from './llm-extract.js';
import { llmJudgeExecutor } from './llm-judge.js';

// Phase 2 输出
import { outputMinimemExecutor } from './output-minimem.js';
import { outputWebhookExecutor } from './output-webhook.js';
import { outputEmailExecutor } from './output-email.js';
import { outputVariableExecutor } from './output-variable.js';

// Phase 2 控制流
import { ifElseExecutor } from './if-else.js';
import { loopExecutor } from './loop.js';
import { switchExecutor } from './switch.js';
import { parallelExecutor } from './parallel.js';
import { waitAllExecutor } from './wait-all.js';
import { retryExecutor } from './retry.js';
import { delayExecutor } from './delay.js';
import { errorHandlerExecutor } from './error-handler.js';

// Phase 2 MiniMem 操作
import { dreamTriggerExecutor } from './dream-trigger.js';
import { memoryWriteExecutor } from './memory-write.js';
import { memoryForgetExecutor } from './memory-forget.js';
import { snapshotCreateExecutor } from './snapshot-create.js';

// Phase 1
registerExecutor('memory-search', memorySearchExecutor);
registerExecutor('filter', filterExecutor);
registerExecutor('merge', mergeExecutor);
registerExecutor('llm-chat', llmChatExecutor);
registerExecutor('output-file', outputFileExecutor);
registerExecutor('output-console', outputConsoleExecutor);
registerExecutor('static-text', staticTextExecutor);
registerExecutor('sort', sortExecutor);
registerExecutor('template', templateExecutor);

// Phase 2 — 数据源
registerExecutor('memory-list', memoryListExecutor);
registerExecutor('memory-recall', memoryRecallExecutor);
registerExecutor('surface-load', surfaceLoadExecutor);
registerExecutor('health-check', healthCheckExecutor);
registerExecutor('stats', statsExecutor);
registerExecutor('temperature', temperatureExecutor);
registerExecutor('owner-profile', ownerProfileExecutor);
registerExecutor('person-load', personLoadExecutor);
registerExecutor('inspiration-load', inspirationLoadExecutor);
registerExecutor('http-request', httpRequestExecutor);
registerExecutor('previous-run', previousRunExecutor);

// Phase 3 — 外部感知
registerExecutor('rss-fetch', rssFetchExecutor);

// Phase 2 — 转换
registerExecutor('limit', limitExecutor);
registerExecutor('group-by', groupByExecutor);
registerExecutor('json-path', jsonPathExecutor);
registerExecutor('split', splitExecutor);
registerExecutor('deduplicate', deduplicateExecutor);
registerExecutor('javascript', javascriptExecutor);

// Phase 2 — AI
registerExecutor('llm-structured', llmStructuredExecutor);
registerExecutor('llm-summarize', llmSummarizeExecutor);
registerExecutor('llm-extract', llmExtractExecutor);
registerExecutor('llm-judge', llmJudgeExecutor);

// Phase 2 — 输出
registerExecutor('output-minimem', outputMinimemExecutor);
registerExecutor('output-webhook', outputWebhookExecutor);
registerExecutor('output-email', outputEmailExecutor);
registerExecutor('output-variable', outputVariableExecutor);

// Phase 2 — 控制流
registerExecutor('if-else', ifElseExecutor);
registerExecutor('loop', loopExecutor);
registerExecutor('switch', switchExecutor);
registerExecutor('parallel', parallelExecutor);
registerExecutor('wait-all', waitAllExecutor);
registerExecutor('retry', retryExecutor);
registerExecutor('delay', delayExecutor);
registerExecutor('error-handler', errorHandlerExecutor);

// Phase 2 — MiniMem 操作
registerExecutor('dream-trigger', dreamTriggerExecutor);
registerExecutor('memory-write', memoryWriteExecutor);
registerExecutor('memory-forget', memoryForgetExecutor);
registerExecutor('snapshot-create', snapshotCreateExecutor);
