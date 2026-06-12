import {
  LayoutDashboard,
  Brain,
  Thermometer,
  Activity,
  Clock,
  Moon,
  Workflow,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Play,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAdminStats, useTemperature, useHealth, useVersion, useMemoryList, type HealthAlert } from '@/api/minimem';
import { useRecentRuns, usePipelines, type PipelineRun } from '@/api/pipeline';
import { useCreateTask } from '@/api/tasks';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';

// ── 统计卡片 ──

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  subtitle,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl bg-card p-5 shadow-apple transition-shadow duration-200 hover:shadow-apple-md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">
            {value}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div
          className={cn('flex h-9 w-9 items-center justify-center rounded-xl')}
          style={{ backgroundColor: `${color}14` }}
        >
          <Icon className="h-4.5 w-4.5" style={{ color }} strokeWidth={1.8} />
        </div>
      </div>
    </div>
  );
}

// ── 温度条 ──

function TemperatureBar({
  distribution,
}: {
  distribution: Record<string, number>;
}) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const segments = [
    { key: 'hot', label: '热', color: '#EF4444' },
    { key: 'warm', label: '温', color: '#F59E0B' },
    { key: 'cool', label: '凉', color: '#3B82F6' },
    { key: 'cold', label: '冷', color: '#6366F1' },
    { key: 'frozen', label: '冻', color: '#94A3B8' },
  ];

  return (
    <div className="rounded-2xl bg-card p-5 shadow-apple">
      <div className="mb-3 flex items-center gap-2">
        <Thermometer className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          温度分布
        </h3>
      </div>

      {/* 进度条 */}
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {segments.map(({ key, color }) => {
          const count = distribution[key] || 0;
          const pct = (count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={key}
              className="transition-all duration-500"
              style={{ width: `${pct}%`, backgroundColor: color }}
            />
          );
        })}
      </div>

      {/* 图例 */}
      <div className="mt-3 flex gap-4">
        {segments.map(({ key, label, color }) => {
          const count = distribution[key] || 0;
          return (
            <div key={key} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-[11px] text-muted-foreground">
                {label} {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 健康状态 ──

function HealthCard({ health }: { health: { status: string; alerts?: HealthAlert[] } }) {
  const statusMap: Record<string, { color: string; bg: string; label: string }> = {
    healthy: { color: '#10B981', bg: '#10B98114', label: '健康' },
    warning: { color: '#F59E0B', bg: '#F59E0B14', label: '警告' },
    critical: { color: '#EF4444', bg: '#EF444414', label: '异常' },
  };

  const s = statusMap[health.status] || statusMap.healthy;

  return (
    <div className="rounded-2xl bg-card p-5 shadow-apple">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          系统健康
        </h3>
      </div>

      <div className="flex items-center gap-2.5">
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: s.color, boxShadow: `0 0 8px ${s.color}40` }}
        />
        <span className="text-lg font-semibold" style={{ color: s.color }}>
          {s.label}
        </span>
      </div>

      {health.alerts && health.alerts.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {health.alerts.map((alert, i) => {
            const isWarning = alert.level === 'warning' || alert.level === 'critical';
            return (
              <div
                key={i}
                className={cn(
                  'flex items-start gap-2 rounded-lg px-3 py-2',
                  isWarning ? 'bg-amber-50 dark:bg-amber-950/20' : 'bg-blue-50 dark:bg-blue-950/20'
                )}
              >
                <AlertTriangle
                  className={cn(
                    'mt-0.5 h-3.5 w-3.5 flex-shrink-0',
                    isWarning ? 'text-amber-500' : 'text-blue-500'
                  )}
                />
                <span className={cn(
                  'text-xs',
                  isWarning ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'
                )}>
                  {alert.message}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 最近活动 ──

function RecentActivity({ memories }: { memories: Array<{ id: string; content: string; source?: string; created_at: string }> }) {
  return (
    <div className="rounded-2xl bg-card p-5 shadow-apple">
      <div className="mb-4 flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          最近活动
        </h3>
      </div>

      <div className="space-y-3">
        {memories.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无数据</p>
        ) : (
          memories.slice(0, 8).map((m) => (
            <div key={m.id} className="flex items-start gap-3">
              <div className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/40" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] leading-tight text-foreground">
                  {m.content}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {m.source && <span>{m.source} · </span>}
                  {new Date(m.created_at).toLocaleString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Pipeline 运行状态摘要 ──

const RUN_STATUS: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  success: { icon: CheckCircle2, color: '#10B981', label: '成功' },
  failed: { icon: XCircle, color: '#EF4444', label: '失败' },
  running: { icon: Play, color: '#3B82F6', label: '运行中' },
  partial: { icon: AlertCircle, color: '#F59E0B', label: '部分成功' },
};

function PipelineRunsSummary({ runs }: { runs: PipelineRun[] }) {
  return (
    <div className="rounded-2xl bg-card p-5 shadow-apple">
      <div className="mb-4 flex items-center gap-2">
        <Workflow className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Pipeline 运行
        </h3>
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无运行记录</p>
      ) : (
        <div className="space-y-2.5">
          {runs.slice(0, 5).map((run) => {
            const st = RUN_STATUS[run.status] || RUN_STATUS.success;
            const StatusIcon = st.icon;
            return (
              <div key={run.id} className="flex items-center gap-3">
                <StatusIcon
                  className="h-3.5 w-3.5 flex-shrink-0"
                  style={{ color: st.color }}
                  strokeWidth={1.8}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-foreground">
                    {run.pipeline_id}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {run.trigger_type} ·{' '}
                    {new Date(run.started_at).toLocaleString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {run.duration_ms != null && (
                      <span> · {run.duration_ms < 1000 ? `${run.duration_ms}ms` : `${(run.duration_ms / 1000).toFixed(1)}s`}</span>
                    )}
                  </p>
                </div>
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ color: st.color, backgroundColor: `${st.color}14` }}
                >
                  {st.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Dashboard 主页 ──

export default function Dashboard() {
  const { data: stats } = useAdminStats();
  const { data: temperature } = useTemperature();
  const { data: health } = useHealth();
  const { data: version } = useVersion();
  const { data: recentMemories } = useMemoryList({ page: 1, page_size: 10 });
  const { data: recentRunsData } = useRecentRuns(5);
  const createTask = useCreateTask();
  const [showDreamConfirm, setShowDreamConfirm] = useState(false);

  const layerCounts = stats?.by_layer || {};
  const recentRuns = recentRunsData?.runs || [];

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          MiniMem 认知状态总览
        </p>
      </div>

      {/* 四层记忆计数器 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="L1 经历"
          value={layerCounts['L1'] || 0}
          icon={Brain}
          color="#3B82F6"
          subtitle="Experience"
        />
        <StatCard
          label="L2 事实"
          value={layerCounts['L2'] || 0}
          icon={Brain}
          color="#8B5CF6"
          subtitle="WorldFact"
        />
        <StatCard
          label="L3 观察"
          value={layerCounts['L3'] || 0}
          icon={Brain}
          color="#F59E0B"
          subtitle="Observation"
        />
        <StatCard
          label="L4 心智模型"
          value={layerCounts['L4'] || 0}
          icon={Brain}
          color="#EF4444"
          subtitle="MentalModel"
        />
        <StatCard
          label="知识页面"
          value={stats?.knowledge_pages || 0}
          icon={Brain}
          color="#10B981"
          subtitle="KnowledgePage"
        />
      </div>

      {/* 温度 + 健康 + Dream */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* 温度分布 */}
        {temperature && <TemperatureBar distribution={temperature} />}

        {/* 健康状态 */}
        {health && <HealthCard health={health} />}

        {/* Dream 信息 */}
        <div className="rounded-2xl bg-card p-5 shadow-apple">
          <div className="mb-3 flex items-center gap-2">
            <Moon className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Dream
            </h3>
          </div>
          <div>
            {version?.last_dream_at ? (
              <>
                <p className="text-sm text-foreground">
                  上次做梦：{' '}
                  {new Date(version.last_dream_at).toLocaleString('zh-CN')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  距今{' '}
                  {Math.round(
                    (Date.now() - new Date(version.last_dream_at).getTime()) / 3600000
                  )}{' '}
                  小时
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">暂无做梦记录</p>
            )}
          </div>
          <button
            onClick={() => setShowDreamConfirm(true)}
            disabled={createTask.isPending}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-4 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
          >
            {createTask.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {createTask.isPending ? '提交中…' : '触发 Dream'}
          </button>
        </div>
      </div>

      {/* Pipeline 运行摘要 + 最近活动 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PipelineRunsSummary runs={recentRuns} />
        <RecentActivity memories={recentMemories?.memories || []} />
      </div>

      {/* Dream 触发确认弹窗 */}
      <ConfirmDialog
        open={showDreamConfirm}
        title="触发 Dream"
        description="确认触发 Daily Dream？引擎将开始整理和审计记忆。"
        confirmText="触发"
        onConfirm={() => {
          setShowDreamConfirm(false);
          createTask.mutate(
            { type: 'dream-trigger', label: '触发 Daily Dream', params: { mode: 'daily' } },
            {
              onSuccess: () => {
                toast.success('Dream 已加入后台任务', {
                  description: '完成后会自动通知你',
                });
              },
              onError: (err) => {
                toast.error('Dream 触发失败', { description: String(err) });
              },
            }
          );
        }}
        onCancel={() => setShowDreamConfirm(false)}
      />
    </div>
  );
}
