/**
 * LLM 客户端封装
 * 统一的 OpenAI-compatible API 调用接口
 * 支持 DashScope、OpenAI、Ollama 等兼容接口
 */

import { getConfig } from '../config.js';

// ── 类型定义 ──

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequestOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  messages: ChatMessage[];
  response_format?: { type: 'json_object' };
}

export interface LLMResponse {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
  finish_reason: string;
}

// ── LLM 客户端 ──

export async function callLLM(options: LLMRequestOptions): Promise<LLMResponse> {
  const config = getConfig();

  const model = options.model || config.llm.model;
  const temperature = options.temperature ?? config.llm.temperature;
  const maxTokens = options.max_tokens ?? config.llm.max_tokens;

  if (!config.llm.api_key) {
    throw new LLMError('LLM API Key 未配置。请在 config.toml 或环境变量中设置 MINIMEM_LLM_API_KEY');
  }

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (options.response_format) {
    body.response_format = options.response_format;
  }

  const url = `${config.llm.base_url.replace(/\/$/, '')}/chat/completions`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.api_key}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new LLMError(
        `LLM API 返回错误 (${resp.status}): ${errBody}`,
        resp.status
      );
    }

    const json = await resp.json() as any;

    const choice = json.choices?.[0];
    if (!choice) {
      throw new LLMError('LLM API 返回格式异常: 无 choices');
    }

    return {
      content: choice.message?.content || '',
      usage: {
        prompt_tokens: json.usage?.prompt_tokens || 0,
        completion_tokens: json.usage?.completion_tokens || 0,
        total_tokens: json.usage?.total_tokens || 0,
      },
      model: json.model || model,
      finish_reason: choice.finish_reason || 'stop',
    };
  } catch (err: any) {
    if (err instanceof LLMError) throw err;
    throw new LLMError(`LLM 调用失败: ${err.message}`);
  }
}

/**
 * 简化调用：单轮对话
 */
export async function chatOnce(params: {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}): Promise<LLMResponse> {
  const messages: ChatMessage[] = [];

  if (params.systemPrompt) {
    messages.push({ role: 'system', content: params.systemPrompt });
  }
  messages.push({ role: 'user', content: params.userPrompt });

  return callLLM({
    messages,
    model: params.model,
    temperature: params.temperature,
    max_tokens: params.max_tokens,
  });
}

/**
 * 结构化输出：要求 LLM 返回 JSON
 */
export async function chatStructured(params: {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}): Promise<{ data: unknown; usage: LLMResponse['usage']; model: string }> {
  const messages: ChatMessage[] = [];

  const systemPrompt = (params.systemPrompt || '') +
    '\n\n你必须以有效的 JSON 格式回复，不要包含任何额外文字。';

  messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: params.userPrompt });

  const resp = await callLLM({
    messages,
    model: params.model,
    temperature: params.temperature,
    max_tokens: params.max_tokens,
    response_format: { type: 'json_object' },
  });

  try {
    const data = JSON.parse(resp.content);
    return { data, usage: resp.usage, model: resp.model };
  } catch {
    // 尝试提取 JSON 块
    const jsonMatch = resp.content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1].trim());
      return { data, usage: resp.usage, model: resp.model };
    }
    throw new LLMError(`LLM 返回的内容无法解析为 JSON: ${resp.content.slice(0, 200)}`);
  }
}

// ── 异常 ──

export class LLMError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'LLMError';
    this.statusCode = statusCode;
  }
}
