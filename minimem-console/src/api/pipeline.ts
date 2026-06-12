import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// ── 类型 ──

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tags: string[];
  schedule_type: 'cron' | 'manual' | 'event';
  schedule_cron?: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  variables: Record<string, string>;
  default_llm: { model?: string; temperature?: number; max_tokens?: number };
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  inputs: PortDef[];
  outputs: PortDef[];
}

export interface PortDef {
  id: string;
  label: string;
  type: 'any' | 'text' | 'json' | 'memories' | 'boolean' | 'number';
}

export interface PipelineEdge {
  id: string;
  source_node: string;
  source_port: string;
  target_node: string;
  target_port: string;
  transform?: string;
}

export interface PipelineRun {
  id: string;
  pipeline_id: string;
  trigger_type: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error?: string;
}

export interface NodeRunRecord {
  node_id: string;
  node_label: string;
  node_type: string;
  status: 'pending' | 'running' | 'success' | 'skipped' | 'failed';
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  input_snapshot: unknown;
  output_snapshot: unknown;
  error?: string;
  llm_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    model: string;
  };
}

export interface PipelineRunDetail extends PipelineRun {
  node_runs: NodeRunRecord[];
  outputs: Array<{
    node_id: string;
    node_label: string;
    type: string;
    preview: string;
    full_content: string;
    file_path?: string;
  }>;
}

export interface NodeType {
  type: string;
  category: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  inputs: PortDef[];
  outputs: PortDef[];
  configSchema: Record<string, any>;
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  variables: Record<string, string>;
  default_llm: { model?: string; temperature?: number; max_tokens?: number };
}

// ── Query Hooks ──

export function usePipelines() {
  return useQuery({
    queryKey: ['pipelines'],
    queryFn: () => api.get<{ pipelines: Pipeline[] }>('/api/pipelines'),
  });
}

export function usePipeline(id: string) {
  return useQuery({
    queryKey: ['pipelines', id],
    queryFn: () => api.get<Pipeline>(`/api/pipelines/${id}`),
    enabled: !!id,
  });
}

export function usePipelineRuns(pipelineId: string) {
  return useQuery({
    queryKey: ['pipelines', pipelineId, 'runs'],
    queryFn: () => api.get<{ runs: PipelineRun[] }>(`/api/pipelines/${pipelineId}/runs`),
    enabled: !!pipelineId,
  });
}

export function useRunDetail(runId: string) {
  return useQuery({
    queryKey: ['runs', runId],
    queryFn: () => api.get<PipelineRunDetail>(`/api/runs/${runId}`),
    enabled: !!runId,
  });
}

export function useRecentRuns(limit = 20) {
  return useQuery({
    queryKey: ['runs', 'recent', limit],
    queryFn: () => api.get<{ runs: PipelineRun[] }>(`/api/runs/recent?limit=${limit}`),
  });
}

export function useRunOutputs(runId: string) {
  return useQuery({
    queryKey: ['runs', runId, 'outputs'],
    queryFn: () => api.get<{ outputs: PipelineRunDetail['outputs'] }>(`/api/runs/${runId}/outputs`),
    enabled: !!runId,
  });
}

export interface DailyRunStats {
  daily: Array<{
    day: string;
    total: number;
    success: number;
    failed: number;
    partial: number;
    avg_duration_ms: number | null;
  }>;
  byPipeline: Array<{
    pipeline_name: string;
    run_count: number;
    success_count: number;
  }>;
}

export function useDailyRunStats(days = 30) {
  return useQuery({
    queryKey: ['runs', 'daily-stats', days],
    queryFn: () => api.get<DailyRunStats>(`/api/runs/daily-stats?days=${days}`),
  });
}

export function useNodeTypes() {
  return useQuery({
    queryKey: ['node-types'],
    queryFn: () => api.get<{ nodeTypes: NodeType[] }>('/api/node-types'),
    staleTime: Infinity, // 节点类型不会变
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ templates: PipelineTemplate[] }>('/api/templates'),
  });
}

// ── Mutation Hooks ──

export function useCreatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Pipeline>) =>
      api.post<Pipeline>('/api/pipelines', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

export function useUpdatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<Pipeline>) =>
      api.put<Pipeline>(`/api/pipelines/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['pipelines'] });
      qc.invalidateQueries({ queryKey: ['pipelines', vars.id] });
    },
  });
}

export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/pipelines/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

export function useTogglePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Pipeline>(`/api/pipelines/${id}/toggle`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['pipelines'] });
      qc.invalidateQueries({ queryKey: ['pipelines', id] });
    },
  });
}

export function useRunPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ run_id: string }>(`/api/pipelines/${id}/run`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['pipelines'] });
      qc.invalidateQueries({ queryKey: ['pipelines', id, 'runs'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}

export function useCreateFromTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, name }: { templateId: string; name: string }) =>
      api.post<Pipeline>(`/api/templates/${templateId}/create`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

// ── Dry-run ──

export function useDryRunPipeline() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ dry_run: boolean; events: Array<{ event: string; data: any }> }>(
        `/api/pipelines/${id}/dry-run`,
      ),
  });
}

// ── SSE 流式运行 ──

export interface SSEEvent {
  event: string;
  data: any;
}

/**
 * 使用 EventSource 监听 Pipeline 流式运行
 * 返回一个启动函数和事件列表
 */
export function useStreamRun() {
  const qc = useQueryClient();

  const startStream = (
    pipelineId: string,
    onEvent: (event: SSEEvent) => void,
    options?: { dryRun?: boolean },
  ): (() => void) => {
    const controller = new AbortController();

    fetch(`/api/pipelines/${pipelineId}/run-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: options?.dryRun || false }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('流式运行请求失败');
        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                onEvent({ event: currentEvent || 'message', data });
              } catch {}
            }
          }
        }

        // 刷新数据
        qc.invalidateQueries({ queryKey: ['pipelines'] });
        qc.invalidateQueries({ queryKey: ['runs'] });
      })
      .catch(() => {
        // 连接关闭或被取消
      });

    return () => controller.abort();
  };

  return { startStream };
}

// ── 自定义节点 ──

export interface CustomNodeType {
  id: string;
  type: string;
  category: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  inputs: PortDef[];
  outputs: PortDef[];
  config_schema: Record<string, any>;
  executor_code: string;
  created_at: string;
  updated_at: string;
}

export function useCustomNodeTypes() {
  return useQuery({
    queryKey: ['custom-node-types'],
    queryFn: () => api.get<{ customNodeTypes: CustomNodeType[] }>('/api/custom-nodes'),
  });
}

export function useCreateCustomNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CustomNodeType> & { executorCode: string }) =>
      api.post<{ id: string; type: string }>('/api/custom-nodes', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-node-types'] });
      qc.invalidateQueries({ queryKey: ['node-types'] });
    },
  });
}

export function useDeleteCustomNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (type: string) => api.delete(`/api/custom-nodes/${type}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-node-types'] });
      qc.invalidateQueries({ queryKey: ['node-types'] });
    },
  });
}
