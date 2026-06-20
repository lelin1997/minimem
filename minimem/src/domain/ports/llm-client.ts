// ============================================================
// MiniMem — LLM Client Port (P3.1 依赖倒置)
// ============================================================
// domain 层通过此接口访问 LLM 能力，不直接依赖 infra/llm。
// infra/llm/client.ts 在 app 启动时通过 registerLLMClient 注册实现。

export type ModelTier = 'heavy' | 'medium' | 'light';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  model?: string;
  tier?: ModelTier;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' } | { type: 'text' };
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

/**
 * LLM 客户端端口
 * 抽象自 infra/llm/client.ts 的 LLMClient class
 */
export interface LLMClient {
  chat(options: ChatCompletionOptions, critical?: boolean): Promise<ChatCompletionResult>;
  chatJson<T>(options: Omit<ChatCompletionOptions, 'response_format'> & { fallback: T }): Promise<T>;
  embed(text: string, model?: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[], model?: string): Promise<EmbeddingResult[]>;
  readonly isAvailable: boolean;
  readonly isEmbeddingAvailable: boolean;
}

// ── Registry: infra 启动时注册实现 ──

let _factory: (() => LLMClient) | null = null;

/**
 * infra 层在 app 启动时调用，注册 LLM 客户端工厂
 */
export function registerLLMClient(factory: () => LLMClient): void {
  _factory = factory;
}

/**
 * domain 层获取 LLM 客户端实例
 */
export function getLLMClient(): LLMClient {
  if (!_factory) {
    throw new Error('LLMClient factory not registered. Call registerLLMClient() at app startup.');
  }
  return _factory();
}
