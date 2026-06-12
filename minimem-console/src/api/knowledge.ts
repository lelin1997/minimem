import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// ── 类型定义 ──

export type KnowledgeStatus = 'active' | 'archived' | 'draft';

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  summary?: string;
  domain?: string;
  tags?: string[];
  status: KnowledgeStatus;
  confidence?: number;
  source_memory_ids?: string[];
  created_at: string;
  updated_at?: string;
}

export interface KnowledgeListResult {
  items: KnowledgeItem[];
  total: number;
  page: number;
  page_size: number;
}

// ── Query Hooks ──

export function useKnowledgeList(params: {
  page?: number;
  page_size?: number;
  search?: string;
  tag?: string;
  domain?: string;
  status?: KnowledgeStatus | '';
} = {}) {
  return useQuery({
    queryKey: ['knowledge', 'list', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.page) searchParams.set('page', String(params.page));
      if (params.page_size) searchParams.set('page_size', String(params.page_size));
      if (params.search) searchParams.set('search', params.search);
      if (params.tag) searchParams.set('tag', params.tag);
      if (params.domain) searchParams.set('domain', params.domain);
      if (params.status) searchParams.set('status', params.status);
      return api.get<KnowledgeListResult>(`/api/knowledge?${searchParams}`);
    },
  });
}

export function useKnowledge(id: string) {
  return useQuery({
    queryKey: ['knowledge', id],
    queryFn: () => api.get<KnowledgeItem>(`/api/knowledge/${encodeURIComponent(id)}`),
    enabled: id.length > 0,
  });
}

export function useKnowledgeTags() {
  return useQuery({
    queryKey: ['knowledge', 'tags'],
    queryFn: () => api.get<{ tags: string[] }>('/api/knowledge/tags/list'),
    staleTime: 60_000,
  });
}

// ── Mutation Hooks ──

export function useDeleteKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mode = 'archive' }: { id: string; mode?: 'archive' | 'delete' }) =>
      api.delete<{ deleted: boolean }>(`/api/knowledge/${encodeURIComponent(id)}?mode=${mode}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
}
