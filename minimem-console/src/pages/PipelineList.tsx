import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Plus, LayoutTemplate, Play, Settings, Clock,
  CheckCircle2, XCircle, AlertCircle, Trash2, Power, PowerOff,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  usePipelines,
  useRunPipeline,
  useDeletePipeline,
  useTogglePipeline,
  useTemplates,
  useCreateFromTemplate,
  type Pipeline,
} from '@/api/pipeline';
import { useCreateTask } from '@/api/tasks';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  success: { icon: CheckCircle2, color: '#10B981', label: '成功' },
  failed: { icon: XCircle, color: '#EF4444', label: '失败' },
  running: { icon: Play, color: '#3B82F6', label: '运行中' },
  partial: { icon: AlertCircle, color: '#F59E0B', label: '部分成功' },
};

export default function PipelineList() {
  const { data, isLoading } = usePipelines();
  const navigate = useNavigate();
  const runMutation = useRunPipeline();
  const deleteMutation = useDeletePipeline();
  const toggleMutation = useTogglePipeline();
  const createTask = useCreateTask();
  const [showTemplates, setShowTemplates] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);

  const pipelines = data?.pipelines || [];

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pipelines</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            自动化任务流水线 · {pipelines.length} 条
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTemplates(true)}
            className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-card px-4 py-2 text-xs font-medium shadow-apple transition-all hover:shadow-apple-md"
          >
            <LayoutTemplate className="h-3.5 w-3.5" strokeWidth={1.8} />
            从模板创建
          </button>
          <button
            onClick={() => navigate('/pipelines/new/edit')}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-apple transition-all hover:shadow-apple-md active:scale-[0.98]"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            新建 Pipeline
          </button>
        </div>
      </div>

      {/* 列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : pipelines.length > 0 ? (
        <div className="space-y-3">
          {pipelines.map((pipeline) => (
            <PipelineCard
              key={pipeline.id}
              pipeline={pipeline}
              onEdit={() => navigate(`/pipelines/${pipeline.id}/edit`)}
              onRuns={() => navigate(`/pipelines/${pipeline.id}/runs`)}
              onRun={() => {
                createTask.mutate(
                  {
                    type: 'pipeline-run',
                    label: `运行「${pipeline.name}」`,
                    params: { pipeline_id: pipeline.id },
                  },
                  {
                    onSuccess: () => {
                      toast.success(`「${pipeline.name}」已加入后台任务`, {
                        description: '完成后会自动通知你',
                      });
                    },
                    onError: (err) => {
                      toast.error('提交任务失败', { description: err.message });
                    },
                  }
                );
              }}
              onToggle={() => toggleMutation.mutate(pipeline.id)}
              onDelete={() => setDeleteTarget(pipeline)}
              isRunning={runMutation.isPending}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-muted/30 py-24">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Plus className="h-6 w-6 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">还没有 Pipeline</p>
          <p className="mt-1 text-xs text-muted-foreground">
            创建第一个自动化任务流水线
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setShowTemplates(true)}
              className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-card px-4 py-2 text-xs font-medium shadow-apple transition-all hover:shadow-apple-md"
            >
              <LayoutTemplate className="h-3.5 w-3.5" strokeWidth={1.8} />
              从模板创建
            </button>
            <button
              onClick={() => navigate('/pipelines/new/edit')}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-apple transition-all hover:shadow-apple-md active:scale-[0.98]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              新建 Pipeline
            </button>
          </div>
        </div>
      )}

      {/* 模板弹窗 */}
      {showTemplates && (
        <TemplateDialog
          onClose={() => setShowTemplates(false)}
          onCreated={(id) => {
            setShowTemplates(false);
            navigate(`/pipelines/${id}/edit`);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除 Pipeline"
        description={`确定删除 Pipeline「${deleteTarget?.name}」？`}
        confirmText="删除"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ── Pipeline 卡片 ──

function PipelineCard({
  pipeline,
  onEdit,
  onRuns,
  onRun,
  onToggle,
  onDelete,
  isRunning,
}: {
  pipeline: Pipeline;
  onEdit: () => void;
  onRuns: () => void;
  onRun: () => void;
  onToggle: () => void;
  onDelete: () => void;
  isRunning: boolean;
}) {
  const statusConf = STATUS_CONFIG[pipeline.last_run_status || ''];
  const StatusIcon = statusConf?.icon;

  return (
    <div className="flex items-center gap-5 rounded-2xl bg-card p-5 shadow-apple transition-all duration-200 hover:shadow-apple-md">
      {/* 状态灯 */}
      <div
        className={cn(
          'h-2.5 w-2.5 flex-shrink-0 rounded-full',
          pipeline.enabled
            ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
            : 'bg-muted-foreground/30',
        )}
      />

      {/* 信息 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{pipeline.name}</h3>
          {pipeline.tags?.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {pipeline.description || `${(pipeline.nodes || []).length} 个节点`}
          {pipeline.schedule_type === 'cron' && pipeline.schedule_cron && (
            <span className="ml-2">· ⏱ {pipeline.schedule_cron}</span>
          )}
          {pipeline.schedule_type === 'manual' && (
            <span className="ml-2">· 手动触发</span>
          )}
        </p>
      </div>

      {/* 上次运行 */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {pipeline.last_run_at && (
          <div className="flex items-center gap-1.5">
            {StatusIcon && (
              <StatusIcon
                className="h-3.5 w-3.5"
                style={{ color: statusConf.color }}
                strokeWidth={1.8}
              />
            )}
            <span>
              {new Date(pipeline.last_run_at).toLocaleString('zh-CN', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        )}
      </div>

      {/* 操作 */}
      <div className="flex gap-1.5">
        <button
          onClick={onToggle}
          className={cn(
            'rounded-lg p-2 transition-colors',
            pipeline.enabled
              ? 'text-emerald-500 hover:bg-emerald-50'
              : 'text-muted-foreground hover:bg-muted',
          )}
          title={pipeline.enabled ? '禁用' : '启用'}
        >
          {pipeline.enabled ? (
            <Power className="h-4 w-4" strokeWidth={1.8} />
          ) : (
            <PowerOff className="h-4 w-4" strokeWidth={1.8} />
          )}
        </button>
        <button
          onClick={onRuns}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="运行历史"
        >
          <Clock className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button
          onClick={onEdit}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="编辑"
        >
          <Settings className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button
          onClick={onRun}
          disabled={isRunning}
          className="rounded-lg p-2 text-primary transition-colors hover:bg-primary/10"
          title="运行"
        >
          <Play className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button
          onClick={onDelete}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          title="删除"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

// ── 模板选择弹窗 ──

function TemplateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { data } = useTemplates();
  const createMutation = useCreateFromTemplate();
  const templates = data?.templates || [];

  const handleCreate = async (templateId: string, templateName: string) => {
    const result = await createMutation.mutateAsync({
      templateId,
      name: templateName,
    });
    onCreated(result.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="w-[520px] rounded-2xl bg-card p-6 shadow-apple-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">从模板创建</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {templates.length > 0 ? (
          <div className="space-y-3">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex items-center gap-4 rounded-xl border border-border/60 p-4 transition-colors hover:bg-muted/30"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{tpl.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {tpl.description}
                  </p>
                  <div className="mt-1.5 flex gap-1.5">
                    {tpl.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                    <span className="text-[10px] text-muted-foreground">
                      · {(tpl.nodes || []).length} 个节点
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleCreate(tpl.id, tpl.name)}
                  disabled={createMutation.isPending}
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-all hover:shadow-apple-md active:scale-[0.98]"
                >
                  创建
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-muted-foreground">
            暂无可用模板
          </div>
        )}
      </div>
    </div>
  );
}
