import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// ── 类型定义 ──

export interface MemoryItem {
  id: string;
  content: string;
  source?: string;
  content_type?: string;
  importance?: number;
  tags?: string[];
  participants?: string[];
  domain?: string;
  temperature?: string;
  layer?: string;
  created_at: string;
  updated_at?: string;
  // L2 特有
  subject?: string;
  predicate?: string;
  object?: string;
  // L3 特有
  confidence?: number;
  // L4 特有
  priority?: number;
  scope?: string;
  active?: boolean;
}

export interface AdminStats {
  total: number;
  by_layer: Record<string, number>;
  knowledge_pages?: number;
  inspirations?: number;
}

export interface TemperatureDistribution {
  hot: number;
  warm: number;
  cool: number;
  cold: number;
  frozen: number;
}

export interface HealthAlert {
  level: string;
  message: string;
  metric?: string;
  value?: number;
  threshold?: number;
}

export interface HealthStatus {
  status: 'healthy' | 'warning' | 'critical';
  temperature_distribution?: TemperatureDistribution;
  alerts?: HealthAlert[];
  uptime?: number;
}

export interface VersionInfo {
  version: string;
  last_dream_at?: string;
  surface_etag?: string;
}

export interface SurfaceFile {
  file: string;
  content: string;
  tokens?: number;
  budget?: number;
  version?: number;
  updated_at?: string;
}

export interface SearchResult {
  memories: MemoryItem[];
  total?: number;
}

export interface MemoryListResult {
  memories: MemoryItem[];
  total: number;
  page: number;
  page_size: number;
}

// ── 连接状态检测 ──

export interface ConnectionStatus {
  connected: boolean;
  version?: string;
  latencyMs?: number;
}

export function useConnectionStatus() {
  return useQuery({
    queryKey: ['minimem', 'connection'],
    queryFn: async (): Promise<ConnectionStatus> => {
      const start = Date.now();
      try {
        const res = await fetch('/proxy/api/v1/health');
        const latencyMs = Date.now() - start;
        if (!res.ok) return { connected: false };
        const data = await res.json();
        return {
          connected: data.status === 'healthy' || data.status === 'warning',
          version: data.version,
          latencyMs,
        };
      } catch {
        return { connected: false };
      }
    },
    refetchInterval: 30_000, // 每 30 秒检测一次
    retry: false,
    staleTime: 15_000,
  });
}

// ── Hooks ──

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const raw = await api.get<Record<string, number>>('/proxy/api/v1/admin/stats');
      // MiniMem 引擎返回扁平结构：{ experiences, world_facts, observations, mental_models, knowledge_pages }
      // 前端需要嵌套结构：{ total, by_layer: { L1, L2, L3, L4 }, knowledge_pages }
      const by_layer: Record<string, number> = {
        L1: raw.experiences || 0,
        L2: raw.world_facts || 0,
        L3: raw.observations || 0,
        L4: raw.mental_models || 0,
      };
      return {
        total: by_layer.L1 + by_layer.L2 + by_layer.L3 + by_layer.L4,
        by_layer,
        knowledge_pages: raw.knowledge_pages || 0,
        inspirations: raw.inspirations || 0,
      } as AdminStats;
    },
  });
}

export function useTemperature() {
  return useQuery({
    queryKey: ['admin', 'temperature'],
    queryFn: () => api.get<TemperatureDistribution>('/proxy/api/v1/admin/temperature'),
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthStatus>('/proxy/api/v1/health'),
    refetchInterval: 60_000, // 每分钟刷新
  });
}

export function useVersion() {
  return useQuery({
    queryKey: ['version'],
    queryFn: () => api.get<VersionInfo>('/proxy/api/v1/version'),
  });
}

export function useMemoryList(params: {
  page?: number;
  page_size?: number;
  source?: string;
  layer?: string;
}) {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(params.page || 1));
  searchParams.set('page_size', String(params.page_size || 20));
  if (params.layer) searchParams.set('layer', params.layer);
  if (params.source) searchParams.set('source', params.source);

  return useQuery({
    queryKey: ['memories', 'list', params],
    queryFn: async () => {
      const raw = await api.get<MemoryListResult>(`/proxy/api/v1/memories?${searchParams}`);
      return raw;
    },
  });
}

export function useMemorySearch(query: string, topK = 20) {
  return useQuery({
    queryKey: ['memories', 'search', query, topK],
    queryFn: async () => {
      const raw = await api.get<{ results: Array<{ id: string; content: string; layer?: string; score?: number; source_strategy?: string; metadata?: Record<string, any> }>; total: number }>(
        `/proxy/api/v1/memory/search?query=${encodeURIComponent(query)}&top_k=${topK}`
      );
      // 引擎返回 results，适配为前端的 SearchResult.memories
      const memories: MemoryItem[] = (raw.results || []).map((r) => ({
        id: r.id,
        content: r.content,
        layer: r.layer,
        source: r.source_strategy || r.metadata?.source,
        created_at: r.metadata?.created_at || new Date().toISOString(),
      }));
      return { memories, total: raw.total || memories.length } as SearchResult;
    },
    enabled: query.length > 0,
  });
}

export function useSurfaceFiles(agentType?: string) {
  const params = agentType ? `?agent_type=${agentType}` : '';
  return useQuery({
    queryKey: ['surface', agentType],
    queryFn: async () => {
      const raw = await api.get<Record<string, string>>(`/proxy/api/v1/surface${params}`);
      // 引擎返回扁平字典 { "me.md": "内容", ... }
      // 前端期望 { surfaces: SurfaceFile[] }
      const surfaces: SurfaceFile[] = Object.entries(raw).map(([file, content]) => ({
        file,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        tokens: typeof content === 'string' ? Math.ceil(content.length / 4) : 0,
      }));
      return { surfaces };
    },
  });
}

export function useOwnerProfile(category?: string) {
  return useQuery({
    queryKey: ['owner', 'profile', category],
    queryFn: async () => {
      const url = category
        ? `/proxy/api/v1/owner/profile?category=${encodeURIComponent(category)}`
        : '/proxy/api/v1/owner/profile';
      const raw = await api.get<Record<string, any>>(url);
      return raw.profile || raw;
    },
  });
}

export function useUpdateOwnerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, any>) => {
      return api.post('/proxy/api/v1/owner/profile', data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner', 'profile'] });
    },
  });
}

export function useDeleteOwnerProfileField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fieldPath: string) => {
      return api.delete(`/proxy/api/v1/owner/profile/${fieldPath}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner', 'profile'] });
    },
  });
}

export function usePersons() {
  return useQuery({
    queryKey: ['persons'],
    queryFn: () => api.get<{ persons: PersonItem[] }>('/proxy/api/v1/persons'),
  });
}

export function usePerson(name: string) {
  return useQuery({
    queryKey: ['person', name],
    queryFn: () => api.get<PersonItem>(`/proxy/api/v1/owner/person/${encodeURIComponent(name)}`),
    enabled: name.length > 0,
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; data: Partial<PersonItem> }) =>
      api.put<PersonItem>(`/proxy/api/v1/person/${encodeURIComponent(params.id)}`, params.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] });
    },
  });
}

export function useDreamList() {
  return useQuery({
    queryKey: ['dreams'],
    queryFn: () => api.get<{ dreams: DreamFile[] }>('/api/dreams'),
  });
}

export function useDream(id: string, format?: 'json' | 'md') {
  const formatQuery = format ? `?format=${format}` : '';
  return useQuery({
    queryKey: ['dream', id, format],
    queryFn: () => api.get<DreamDetail>(`/api/dreams/${id}${formatQuery}`),
    enabled: id.length > 0,
  });
}

// ── 灵感（Inspirations）──

export type InspirationStatus = 'spark' | 'incubating' | 'mature' | 'acted' | 'archived';

export interface Inspiration {
  id: string;
  title: string;
  content: string;
  hypothesis?: string;
  origin?: string;
  status: InspirationStatus;
  novelty?: number;
  actionability?: number;
  confidence?: number;
  incubation_count?: number;
  incubation_log?: Array<{
    round: number;
    new_angle?: string;
    deepened?: boolean;
    confidence_delta?: number;
    timestamp?: string;
  }>;
  acted_outcome?: string;
  domain?: string;
  source_memory_ids?: string[];
  expires_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface InspirationListResult {
  inspirations: Inspiration[];
  total: number;
  limit: number;
  offset: number;
}

export function useInspirations(params: {
  status?: InspirationStatus | '';
  domain?: string;
  limit?: number;
  offset?: number;
} = {}) {
  return useQuery({
    queryKey: ['inspirations', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.status) searchParams.set('status', params.status);
      if (params.domain) searchParams.set('domain', params.domain);
      if (params.limit) searchParams.set('limit', String(params.limit));
      if (params.offset != null) searchParams.set('offset', String(params.offset));
      return api.get<InspirationListResult>(`/api/inspirations?${searchParams}`);
    },
  });
}

export function useInspiration(id: string) {
  return useQuery({
    queryKey: ['inspiration', id],
    queryFn: () => api.get<Inspiration>(`/api/inspirations/${encodeURIComponent(id)}`),
    enabled: id.length > 0,
  });
}

export function useRateInspiration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; rating: number; comment?: string }) =>
      api.post<{ rated: boolean; id: string; rating: number; new_confidence: number }>(
        `/api/inspirations/${encodeURIComponent(params.id)}/rate`,
        { rating: params.rating, comment: params.comment }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspirations'] });
    },
  });
}

export function useActOnInspiration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; outcome: string }) =>
      api.post<{ acted: boolean; id: string; title: string }>(
        `/api/inspirations/${encodeURIComponent(params.id)}/act`,
        { outcome: params.outcome }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspirations'] });
    },
  });
}

export function useDismissInspiration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; mode?: 'archive' | 'delete'; reason?: string }) => {
      const searchParams = new URLSearchParams();
      if (params.mode) searchParams.set('mode', params.mode);
      if (params.reason) searchParams.set('reason', params.reason);
      return api.delete<{ dismissed: number }>(
        `/api/inspirations/${encodeURIComponent(params.id)}?${searchParams}`
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspirations'] });
    },
  });
}

export function useTriggerInspirationEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Record<string, unknown>>('/api/inspirations/trigger'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspirations'] });
    },
  });
}

// ── 更多类型 ──

export interface PersonItem {
  id?: string;
  name: string;
  aliases?: string[];
  last_seen?: string;
  personality?: string;
  interests?: string[];
  opinions?: Record<string, string>;
  speech_patterns?: string;
  relationship?: string;
  [key: string]: unknown;
}

export interface DreamFile {
  id: string;
  filename: string;
  date: string;
  type: 'json' | 'md';
  size: number;
  /** 该 dream 拥有的所有格式 */
  formats?: ('json' | 'md')[];
}

export interface DreamDetail {
  id: string;
  filename: string;
  type: 'json' | 'md';
  content: string;
  data?: Record<string, any>;
  /** 该 dream 拥有的所有格式 */
  formats?: ('json' | 'md')[];
}
