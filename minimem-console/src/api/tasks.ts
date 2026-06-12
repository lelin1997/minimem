import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// ── 类型 ──

export type TaskType = 'dream-trigger' | 'inspiration-trigger' | 'pipeline-run';
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed';

export interface TaskDTO {
  id: string;
  type: TaskType;
  status: TaskStatus;
  label: string;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
}

// ── Hooks ──

/** 获取活跃任务（pending + running），用于全局监控轮询 */
export function useActiveTasks(enabled = true) {
  return useQuery({
    queryKey: ['tasks', 'active'],
    queryFn: async () => {
      const res = await api.get<{ tasks: TaskDTO[] }>('/api/tasks/active');
      return res.tasks;
    },
    refetchInterval: 2000, // 每 2 秒轮询
    enabled,
  });
}

/** 获取任务列表（历史记录） */
export function useTaskList(options?: { status?: TaskStatus; limit?: number }) {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.limit) params.set('limit', String(options.limit));

  return useQuery({
    queryKey: ['tasks', 'list', options],
    queryFn: async () => {
      const res = await api.get<{ tasks: TaskDTO[] }>(`/api/tasks?${params}`);
      return res.tasks;
    },
  });
}

/** 获取单个任务详情 */
export function useTask(id: string) {
  return useQuery({
    queryKey: ['tasks', id],
    queryFn: () => api.get<TaskDTO>(`/api/tasks/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      // 如果任务还在进行中就持续轮询
      if (data && (data.status === 'pending' || data.status === 'running')) {
        return 2000;
      }
      return false;
    },
  });
}

/** 创建后台任务 */
export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { type: TaskType; label: string; params?: Record<string, unknown> }) =>
      api.post<TaskDTO>('/api/tasks', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/** 最近完成的任务（用于通知显示） */
export function useRecentTasks(limit = 10) {
  return useQuery({
    queryKey: ['tasks', 'recent', limit],
    queryFn: async () => {
      const res = await api.get<{ tasks: TaskDTO[] }>(`/api/tasks?limit=${limit}`);
      return res.tasks;
    },
    refetchInterval: 5000, // 每 5 秒刷新
  });
}

/** 取消/终止任务 */
export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<TaskDTO>(`/api/tasks/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/** 删除任务 */
export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean }>(`/api/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/** 重试失败任务 */
export function useRetryTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<TaskDTO>(`/api/tasks/${id}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
