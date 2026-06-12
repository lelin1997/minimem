import { useState, useEffect, useRef } from 'react';
import {
  Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  Activity, Clock, X, Eye, Square, RotateCcw, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useActiveTasks, useRecentTasks,
  useCancelTask, useDeleteTask, useRetryTask,
  type TaskDTO,
} from '@/api/tasks';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

/**
 * 格式化任务结果为可读字符串
 */
function formatTaskResult(task: TaskDTO): string | undefined {
  if (!task.result) return undefined;
  const r = task.result as Record<string, unknown>;

  if (task.type === 'inspiration-trigger' || task.type === 'dream-trigger') {
    // 尝试提取引擎返回的摘要信息
    const parts: string[] = [];
    if (r.inspirations_generated != null) parts.push(`生成 ${r.inspirations_generated} 条灵感`);
    if (r.memories_processed != null) parts.push(`处理 ${r.memories_processed} 条记忆`);
    if (r.phase_results && typeof r.phase_results === 'object') {
      parts.push(`执行了 ${Object.keys(r.phase_results).length} 个阶段`);
    }
    if (r.message) parts.push(String(r.message));
    if (parts.length > 0) return parts.join('，');
    // fallback: 显示 JSON 的关键信息
    const keys = Object.keys(r).filter(k => k !== 'status');
    if (keys.length > 0) return keys.map(k => `${k}: ${JSON.stringify(r[k])}`).join(', ');
  }

  if (task.type === 'pipeline-run') {
    if (r.status) return `状态: ${r.status}`;
  }

  return undefined;
}

/**
 * 全局任务监控面板
 * 悬浮在右下角，显示活跃任务 + 最近完成任务
 */
export function TaskMonitor() {
  const [expanded, setExpanded] = useState(false);
  const { data: activeTasks = [] } = useActiveTasks();
  const { data: recentTasks = [] } = useRecentTasks(8);
  const prevActiveRef = useRef<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const cancelTask = useCancelTask();
  const deleteTask = useDeleteTask();
  const retryTask = useRetryTask();

  // 检测任务完成并弹出 toast + 自动刷新相关数据
  useEffect(() => {
    const currentActiveIds = new Set(activeTasks.map((t) => t.id));
    const prevIds = prevActiveRef.current;

    // 检查上一轮活跃但这一轮不在活跃列表中的任务 → 说明刚完成
    for (const id of prevIds) {
      if (!currentActiveIds.has(id)) {
        // 在最近任务中找到这个完成的任务
        const finished = recentTasks.find((t) => t.id === id);
        if (finished) {
          if (finished.status === 'success') {
            const durationDesc = finished.duration_ms
              ? `耗时 ${formatDuration(finished.duration_ms)}`
              : '';
            toast.success(`${finished.label} 已完成`, {
              description: [durationDesc, '点击右下角任务面板查看详情'].filter(Boolean).join(' · '),
            });

            // 自动刷新相关数据
            if (finished.type === 'inspiration-trigger') {
              queryClient.invalidateQueries({ queryKey: ['inspirations'] });
            }
            if (finished.type === 'dream-trigger') {
              queryClient.invalidateQueries({ queryKey: ['inspirations'] });
              queryClient.invalidateQueries({ queryKey: ['memories'] });
              queryClient.invalidateQueries({ queryKey: ['admin'] });
            }
          } else if (finished.status === 'failed') {
            toast.error(`${finished.label} 失败`, {
              description: '点击右下角任务面板查看错误详情，可一键重试',
            });
          }
        }
      }
    }

    prevActiveRef.current = currentActiveIds;
  }, [activeTasks, recentTasks, queryClient]);

  // 如果没有任何任务，不显示面板
  const hasActive = activeTasks.length > 0;
  const finishedTasks = recentTasks.filter(
    (t) => t.status === 'success' || t.status === 'failed'
  ).slice(0, 5);

  if (!hasActive && finishedTasks.length === 0) return null;

  const handleCancel = (task: TaskDTO) => {
    cancelTask.mutate(task.id, {
      onSuccess: () => toast.success(`已取消「${task.label}」`),
      onError: () => toast.error('取消失败'),
    });
  };

  const handleDelete = (task: TaskDTO) => {
    deleteTask.mutate(task.id, {
      onSuccess: () => toast.success('已删除任务记录'),
      onError: () => toast.error('删除失败'),
    });
  };

  const handleRetry = (task: TaskDTO) => {
    retryTask.mutate(task.id, {
      onSuccess: () => toast.success(`已重新启动「${task.label}」`),
      onError: () => toast.error('重试失败'),
    });
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80">
      {/* 折叠标题栏 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex w-full items-center justify-between rounded-xl border border-border/60 bg-card/95 px-4 py-2.5 shadow-apple-md backdrop-blur-md transition-all',
          expanded && 'rounded-b-none border-b-0'
        )}
      >
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">后台任务</span>
          {hasActive && (
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {activeTasks.length}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* 展开的任务列表 */}
      {expanded && (
        <div className="max-h-80 overflow-y-auto rounded-b-xl border border-t-0 border-border/60 bg-card/95 shadow-apple-md backdrop-blur-md scrollbar-thin">
          {/* 活跃任务 */}
          {hasActive && (
            <div className="border-b border-border/40 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                进行中
              </p>
              <div className="space-y-2">
                {activeTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onCancel={() => handleCancel(task)}
                    showCancel={cancelTask.isPending}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 最近完成 */}
          {finishedTasks.length > 0 && (
            <div className="p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                最近完成
              </p>
              <div className="space-y-1.5">
                {finishedTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onRetry={task.status === 'failed' ? () => handleRetry(task) : undefined}
                    onDelete={() => handleDelete(task)}
                    showDelete={deleteTask.isPending}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TaskItemProps {
  task: TaskDTO;
  onCancel?: () => void;
  onRetry?: () => void;
  onDelete?: () => void;
  showCancel?: boolean;
  showDelete?: boolean;
}

function TaskItem({ task, onCancel, onRetry, onDelete, showCancel, showDelete }: TaskItemProps) {
  const [showResult, setShowResult] = useState(false);
  const resultText = task.status === 'success' ? formatTaskResult(task) : undefined;
  
  // 修正状态显示：优先判断 finished_at（已完成），其次 started_at（运行中），否则等待中
  const isFinished = !!task.finished_at || task.status === 'success' || task.status === 'failed';
  const isActuallyRunning = !isFinished && (!!task.started_at || task.status === 'running');
  const isPending = !isFinished && !isActuallyRunning;
  const isActive = isActuallyRunning || isPending;
  const displayStatus = isFinished ? task.status : isActuallyRunning ? 'running' : 'pending';

  return (
    <div className="rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/40 group">
      <div className="flex items-center gap-2.5">
        <TaskStatusIcon status={displayStatus} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{task.label}</p>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {displayStatus === 'running' && task.progress > 0 && (
              <span>{task.progress}%</span>
            )}
            {task.status === 'success' && task.duration_ms && (
              <span>{formatDuration(task.duration_ms)}</span>
            )}
            {task.status === 'failed' && task.error && (
              <span className="truncate text-destructive/70">{task.error}</span>
            )}
            {isActive && (
              <span className="text-muted-foreground/50">
                {displayStatus === 'pending' ? '等待中' : '运行中'}
              </span>
            )}
          </div>
          {/* 进度条 */}
          {displayStatus === 'running' && (
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          )}
        </div>

        {/* 操作按钮组 */}
        <div className="flex items-center gap-0.5">
          {/* 运行中任务：显示终止按钮 */}
          {isActuallyRunning && onCancel && (
            <button
              onClick={onCancel}
              disabled={showCancel}
              className="flex-shrink-0 rounded p-1 text-amber-500/70 transition hover:text-amber-500 hover:bg-amber-500/10 disabled:opacity-50"
              title="终止任务"
            >
              <Square className="h-3 w-3" fill="currentColor" />
            </button>
          )}

          {/* 失败任务：显示重试按钮 */}
          {task.status === 'failed' && onRetry && (
            <button
              onClick={onRetry}
              className="flex-shrink-0 rounded p-1 text-muted-foreground/60 transition hover:text-primary hover:bg-primary/10"
              title="重新运行"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}

          {/* 已完成任务：显示删除按钮 */}
          {!isActive && onDelete && (
            <button
              onClick={onDelete}
              disabled={showDelete}
              className="flex-shrink-0 rounded p-1 text-muted-foreground/40 transition hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
              title="删除记录"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}

          {/* 查看结果按钮 */}
          {resultText && (
            <button
              onClick={() => setShowResult(!showResult)}
              className="flex-shrink-0 rounded p-1 text-muted-foreground/60 transition hover:text-foreground"
              title="查看详情"
            >
              <Eye className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {/* 结果详情 */}
      {showResult && resultText && (
        <div className="mt-1.5 ml-6 rounded-md bg-muted/50 px-2 py-1.5 text-[10px] text-muted-foreground leading-relaxed">
          {resultText}
        </div>
      )}
    </div>
  );
}

function TaskStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return <Clock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-primary" />;
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 flex-shrink-0 text-destructive" />;
    default:
      return null;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}
