// ============================================================
// MiniMem — TypeScript SDK (@minimem/sdk)
// ============================================================
// 轻量级客户端 SDK，封装 REST API 调用

/**
 * SDK 专用错误类 — 携带 HTTP 状态码和服务端错误码
 */
export class MiniMemAPIError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: Record<string, unknown> | null;

  constructor(statusCode: number, code: string, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'MiniMemAPIError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface MiniMemSDKConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
}

export interface AddMemoryInput {
  content: string;
  content_type?: string;
  source?: string;
  tags?: string[];
  context?: string;
}

export interface SearchInput {
  query: string;
  layers?: string[];
  top_k?: number;
  time_from?: string;
  time_to?: string;
}

/**
 * MiniMem SDK 客户端
 */
export class MiniMemClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(config: MiniMemSDKConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  // ── 记忆写入 ──

  async addMemory(input: AddMemoryInput): Promise<{ id: string; importance: number }> {
    return this.post('/api/v1/memory', input);
  }

  async addMemories(inputs: AddMemoryInput[]): Promise<{ results: Array<{ id: string }> }> {
    return this.post('/api/v1/memory/batch', { memories: inputs });
  }

  // ── 记忆检索 ──

  async search(input: SearchInput): Promise<{ results: unknown[]; query_plan: unknown }> {
    const params = new URLSearchParams();
    params.set('q', input.query);
    if (input.top_k) params.set('top_k', String(input.top_k));
    if (input.layers) params.set('layers', input.layers.join(','));
    if (input.time_from) params.set('time_from', input.time_from);
    if (input.time_to) params.set('time_to', input.time_to);
    return this.get(`/api/v1/memory/search?${params}`);
  }

  async recall(entity: string): Promise<unknown> {
    return this.get(`/api/v1/memory/recall/${encodeURIComponent(entity)}`);
  }

  // ── 记忆管理 ──

  async getMemory(id: string): Promise<unknown> {
    return this.get(`/api/v1/memory/${id}`);
  }

  async updateMemory(id: string, content: string): Promise<unknown> {
    return this.put(`/api/v1/memory/${id}`, { content });
  }

  async deleteMemory(id: string): Promise<void> {
    return this.del(`/api/v1/memory/${id}`);
  }

  async listMemories(page: number = 1, pageSize: number = 20): Promise<unknown> {
    return this.get(`/api/v1/memory/list?page=${page}&page_size=${pageSize}`);
  }

  // ── Surface Files ──

  async getSurfaces(agentType?: string): Promise<unknown> {
    const params = agentType ? `?agent_type=${agentType}` : '';
    return this.get(`/api/v1/surface${params}`);
  }

  async getSurfaceFile(fileName: string): Promise<unknown> {
    return this.get(`/api/v1/surface/${fileName}`);
  }

  // ── Owner ──

  async getOwnerProfile(): Promise<unknown> {
    return this.get('/api/v1/owner/profile');
  }

  // ── Dream ──

  async triggerDream(options?: { mode?: string; phases?: number[] }): Promise<unknown> {
    return this.post('/api/v1/dream/trigger', options ?? {});
  }

  // ── 版本控制 ──

  async createSnapshot(label?: string): Promise<unknown> {
    return this.post('/api/v1/snapshot', { label });
  }

  async diffSnapshots(a: string, b: string): Promise<unknown> {
    return this.get(`/api/v1/snapshot/diff?snapshot_a=${a}&snapshot_b=${b}`);
  }

  // ── 系统 ──

  async health(): Promise<{ status: string; version: string }> {
    return this.get('/api/v1/health');
  }

  // ── 导入导出 ──

  async exportMemories(format: 'json' | 'markdown' = 'json'): Promise<unknown> {
    return this.post('/api/v1/memory/export', { format });
  }

  async importMemories(data: unknown, format: string = 'json'): Promise<unknown> {
    return this.post('/api/v1/memory/import', { data, format });
  }

  // ── HTTP 工具 ──

  private async get<T>(path: string): Promise<T> {
    return this.request('GET', path);
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request('POST', path, body);
  }

  private async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request('PUT', path, body);
  }

  private async del<T>(path: string): Promise<T> {
    return this.request('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let code = 'UNKNOWN_ERROR';
        let message = errorText;
        let details: Record<string, unknown> | null = null;
        try {
          const parsed = JSON.parse(errorText);
          code = parsed.code ?? code;
          message = parsed.error ?? message;
          details = parsed.details ?? null;
        } catch {
          // 非 JSON 响应，使用原始文本
        }
        throw new MiniMemAPIError(response.status, code, message, details);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * 快速创建客户端
 */
export function createClient(config: MiniMemSDKConfig): MiniMemClient {
  return new MiniMemClient(config);
}
