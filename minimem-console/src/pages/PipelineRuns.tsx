import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ChevronLeft, Clock, CheckCircle2, XCircle, AlertCircle, Play,
  Timer, ChevronDown, Eye, Zap, ArrowRight,
} from 'lucide-react';
import {
  usePipelineRuns,
  usePipeline,
  useRunDetail,
  type PipelineRun,
  type NodeRunRecord,
} from '@/api/pipeline';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

const STATUS_MAP: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  success: { icon: CheckCircle2, color: '#10B981', label: '成功' },
  failed: { icon: XCircle, color: '#EF4444', label: '失败' },
  running: { icon: Play, color: '#3B82F6', label: '运行中' },
  partial: { icon: AlertCircle, color: '#F59E0B', label: '部分成功' },
  pending: { icon: Clock, color: '#94A3B8', label: '等待' },
  skipped: { icon: ArrowRight, color: '#94A3B8', label: '跳过' },
};

export default function PipelineRuns() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: pipeline } = usePipeline(id!);
  const { data, isLoading } = usePipelineRuns(id!);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runs = data?.runs || [];

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/pipelines')}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">运行历史</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pipeline?.name || id} · 共 {runs.length} 次运行
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link
            to={`/pipelines/${id}/edit`}
            className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-card px-4 py-2 text-xs font-medium shadow-apple transition-all hover:shadow-apple-md"
          >
            编辑 Pipeline
          </Link>
        </div>
      </div>

      {/* 内容 */}
      <div className="flex gap-6">
        {/* 运行列表 */}
        <div className="flex-1 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : runs.length > 0 ? (
            runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                isSelected={selectedRunId === run.id}
                onClick={() => setSelectedRunId(run.id === selectedRunId ? null : run.id)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl bg-muted/30 py-24">
              <Timer className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">暂无运行记录</p>
              <p className="mt-1 text-xs text-muted-foreground">
                运行 Pipeline 后将在此显示历史记录
              </p>
            </div>
          )}
        </div>

        {/* 运行详情 */}
        {selectedRunId && (
          <div className="w-[420px] flex-shrink-0">
            <RunDetailPanel runId={selectedRunId} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── 运行卡片 ──

function RunCard({
  run,
  isSelected,
  onClick,
}: {
  run: PipelineRun;
  isSelected: boolean;
  onClick: () => void;
}) {
  const st = STATUS_MAP[run.status] || STATUS_MAP.pending;
  const StatusIcon = st.icon;

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-4 rounded-xl bg-card p-4 text-left shadow-apple transition-all duration-200',
        isSelected ? 'shadow-apple-md ring-1 ring-primary/20' : 'hover:shadow-apple-md',
      )}
    >
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${st.color}14` }}
      >
        <StatusIcon className="h-4 w-4" style={{ color: st.color }} strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-foreground">{st.label}</span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {run.trigger_type}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {new Date(run.started_at).toLocaleString('zh-CN')}
          {run.duration_ms != null && (
            <span className="ml-2">· {formatDuration(run.duration_ms)}</span>
          )}
        </p>
      </div>
      <ChevronDown
        className={cn(
          'h-4 w-4 text-muted-foreground transition-transform',
          isSelected && 'rotate-180',
        )}
      />
    </button>
  );
}

// ── 运行详情面板 ──

function RunDetailPanel({ runId }: { runId: string }) {
  const { data: detail, isLoading } = useRunDetail(runId);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);

  if (isLoading || !detail) {
    return (
      <div className="flex items-center justify-center rounded-2xl bg-card py-20 shadow-apple">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 概览 */}
      <div className="rounded-2xl bg-card p-5 shadow-apple">
        <h3 className="text-xs font-semibold text-foreground">运行详情</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            状态：
            <span style={{ color: STATUS_MAP[detail.status]?.color }}>
              {STATUS_MAP[detail.status]?.label}
            </span>
          </div>
          <div>触发：{detail.trigger_type}</div>
          <div>开始：{new Date(detail.started_at).toLocaleString('zh-CN')}</div>
          <div>
            耗时：{detail.duration_ms != null ? formatDuration(detail.duration_ms) : '-'}
          </div>
        </div>
        {detail.error && (
          <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {detail.error}
          </div>
        )}
      </div>

      {/* 节点执行时间线 */}
      <div className="rounded-2xl bg-card p-5 shadow-apple">
        <h3 className="mb-3 text-xs font-semibold text-foreground">节点执行</h3>
        <div className="space-y-1">
          {(detail.node_runs || []).map((nr) => (
            <NodeRunItem
              key={nr.node_id}
              nodeRun={nr}
              isExpanded={expandedNode === nr.node_id}
              onToggle={() =>
                setExpandedNode(expandedNode === nr.node_id ? null : nr.node_id)
              }
            />
          ))}
        </div>
      </div>

      {/* 输出 */}
      {detail.outputs && detail.outputs.length > 0 && (
        <div className="rounded-2xl bg-card p-5 shadow-apple">
          <h3 className="mb-3 text-xs font-semibold text-foreground">输出</h3>
          <div className="space-y-3">
            {detail.outputs.map((out) => (
              <div key={out.node_id} className="rounded-xl bg-muted/40 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[11px] font-medium text-foreground">
                    {out.node_label}
                  </span>
                  <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                    {out.type}
                  </span>
                </div>
                <div className="prose prose-sm max-h-40 max-w-none overflow-y-auto text-[11px] prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-code:text-foreground prose-code:bg-muted prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none">
                  <ReactMarkdown>{out.preview}</ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 节点运行项 ──

function NodeRunItem({
  nodeRun,
  isExpanded,
  onToggle,
}: {
  nodeRun: NodeRunRecord;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const st = STATUS_MAP[nodeRun.status] || STATUS_MAP.pending;
  const StatusIcon = st.icon;

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
      >
        <StatusIcon className="h-3 w-3 flex-shrink-0" style={{ color: st.color }} />
        <span className="flex-1 truncate text-[11px] text-foreground">
          {nodeRun.node_label}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {nodeRun.duration_ms != null ? formatDuration(nodeRun.duration_ms) : '-'}
        </span>
        {nodeRun.llm_usage && (
          <span className="rounded bg-amber-50 px-1 py-0.5 text-[9px] text-amber-600">
            {(nodeRun.llm_usage.prompt_tokens + nodeRun.llm_usage.completion_tokens).toLocaleString()} tok
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-3 w-3 text-muted-foreground transition-transform',
            isExpanded && 'rotate-180',
          )}
        />
      </button>

      {isExpanded && (
        <div className="ml-5 mt-1 space-y-2 rounded-lg bg-muted/30 p-3">
          {nodeRun.error && (
            <div className="rounded-md bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
              {nodeRun.error}
            </div>
          )}
          {nodeRun.input_snapshot != null && (
            <div>
              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                Input
              </p>
              <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-background p-2 font-mono text-[10px] text-foreground">
                {typeof nodeRun.input_snapshot === 'string'
                  ? nodeRun.input_snapshot
                  : JSON.stringify(nodeRun.input_snapshot, null, 2)}
              </pre>
            </div>
          )}
          {nodeRun.output_snapshot != null && (
            <div>
              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                Output
              </p>
              <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-background p-2 font-mono text-[10px] text-foreground">
                {typeof nodeRun.output_snapshot === 'string'
                  ? nodeRun.output_snapshot
                  : JSON.stringify(nodeRun.output_snapshot, null, 2)}
              </pre>
            </div>
          )}
          {nodeRun.llm_usage && (
            <div className="flex gap-4 text-[10px] text-muted-foreground">
              <span>模型: {nodeRun.llm_usage.model}</span>
              <span>输入: {nodeRun.llm_usage.prompt_tokens}</span>
              <span>输出: {nodeRun.llm_usage.completion_tokens}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
