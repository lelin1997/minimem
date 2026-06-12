import { useState, Fragment } from 'react';
import {
  Lightbulb, Sparkles, Zap, Clock, Star, ChevronDown, ChevronRight,
  Archive, Trash2, Play, Filter, RefreshCw, X, Check, AlertCircle, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useInspirations, useRateInspiration, useActOnInspiration,
  useDismissInspiration, useTriggerInspirationEngine,
  type Inspiration, type InspirationStatus,
} from '@/api/minimem';
import { useCreateTask } from '@/api/tasks';
import { cn } from '@/lib/utils';

/* ── 状态配置 ── */

const STATUS_CONFIG: Record<InspirationStatus, {
  label: string; icon: React.ReactNode; color: string; bgColor: string;
}> = {
  spark: {
    label: '灵感火花',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
  },
  incubating: {
    label: '孵化中',
    icon: <Clock className="h-3.5 w-3.5" />,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  mature: {
    label: '已成熟',
    icon: <Star className="h-3.5 w-3.5" />,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
  },
  acted: {
    label: '已行动',
    icon: <Check className="h-3.5 w-3.5" />,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
  },
  archived: {
    label: '已归档',
    icon: <Archive className="h-3.5 w-3.5" />,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
  },
};

const STATUS_TABS: { value: InspirationStatus | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'spark', label: '火花' },
  { value: 'incubating', label: '孵化中' },
  { value: 'mature', label: '已成熟' },
  { value: 'acted', label: '已行动' },
  { value: 'archived', label: '归档' },
];

/* ── 主页面 ── */

export default function Inspirations() {
  const [statusFilter, setStatusFilter] = useState<InspirationStatus | ''>('');
  const [domainFilter, setDomainFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showActDialog, setShowActDialog] = useState(false);
  const [showRateDialog, setShowRateDialog] = useState(false);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useInspirations({
    status: statusFilter,
    domain: domainFilter || undefined,
    limit: 50,
  });

  const triggerEngine = useTriggerInspirationEngine();
  const createTask = useCreateTask();

  const inspirations = data?.inspirations || [];
  const selected = inspirations.find((i) => i.id === selectedId) || null;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success('已刷新');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTrigger = () => {
    createTask.mutate(
      { type: 'inspiration-trigger', label: '触发灵感引擎' },
      {
        onSuccess: () => {
          toast.success('灵感引擎已加入后台任务', {
            description: '完成后会自动通知你',
          });
        },
        onError: (err) => {
          toast.error('提交任务失败', { description: err.message });
        },
      }
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-1 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">灵感面板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            灵感由 Dream 引擎在记忆整理时自动生成
            {data && <span className="ml-2 text-xs">共 {data.total} 条</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-apple transition hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
            刷新
          </button>
          <button
            onClick={handleTrigger}
            disabled={createTask.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-apple transition hover:bg-primary/90 disabled:opacity-50"
          >
            {createTask.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {createTask.isPending ? '提交中…' : '触发灵感引擎'}
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-3 pb-4">
        {/* 状态 Tab */}
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setStatusFilter(tab.value); setSelectedId(null); }}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-all duration-200',
                statusFilter === tab.value
                  ? 'bg-card text-foreground shadow-apple'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 领域过滤 */}
        <div className="relative">
          <Filter className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            placeholder="按领域过滤…"
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="h-7 w-40 rounded-lg border border-border/60 bg-card pl-8 pr-3 text-xs placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
          {domainFilter && (
            <button
              onClick={() => setDomainFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* 主体：列表 + 详情面板 — 左右独立滚动 */}
      <div className="flex gap-4" style={{ height: 'calc(100vh - 200px)' }}>
        {/* 灵感列表 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin pr-1">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          ) : inspirations.length === 0 ? (
            <EmptyState status={statusFilter} />
          ) : (
            <div className="space-y-2 pr-1">
              {inspirations.map((item) => (
                <InspirationCard
                  key={item.id}
                  item={item}
                  isSelected={selectedId === item.id}
                  onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 详情面板 */}
        {selected && (
          <InspirationDetail
            item={selected}
            onClose={() => setSelectedId(null)}
            onAct={() => setShowActDialog(true)}
            onRate={() => setShowRateDialog(true)}
          />
        )}
      </div>

      {/* 行动弹窗 */}
      {showActDialog && selected && (
        <ActDialog
          item={selected}
          onClose={() => setShowActDialog(false)}
          onDone={() => { setShowActDialog(false); refetch(); }}
        />
      )}

      {/* 评分弹窗 */}
      {showRateDialog && selected && (
        <RateDialog
          item={selected}
          onClose={() => setShowRateDialog(false)}
          onDone={() => { setShowRateDialog(false); refetch(); }}
        />
      )}
    </div>
  );
}

/* ── 灵感卡片 ── */

function InspirationCard({ item, isSelected, onClick }: {
  item: Inspiration; isSelected: boolean; onClick: () => void;
}) {
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.spark;

  return (
    <button
      onClick={onClick}
      className={cn(
        'group w-full rounded-xl border bg-card p-4 text-left shadow-apple transition-all duration-200 hover:shadow-apple-md',
        isSelected ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border/60'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            {/* 状态 badge */}
            <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium', cfg.bgColor, cfg.color)}>
              {cfg.icon}
              {cfg.label}
            </span>
            {item.domain && (
              <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {item.domain}
              </span>
            )}
          </div>

          <h3 className="text-sm font-medium leading-snug line-clamp-1">
            {item.title || '未命名灵感'}
          </h3>

          {item.hypothesis && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {item.hypothesis}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {item.confidence != null && (
            <ConfidenceIndicator value={item.confidence} />
          )}
          <div className="flex items-center gap-0.5">
            {isSelected ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
            )}
          </div>
        </div>
      </div>

      {/* 底部指标 */}
      <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
        {item.novelty != null && (
          <span>新颖度 {(item.novelty * 100).toFixed(0)}%</span>
        )}
        {item.actionability != null && (
          <span>可行性 {(item.actionability * 100).toFixed(0)}%</span>
        )}
        {item.incubation_count != null && item.incubation_count > 0 && (
          <span>孵化 {item.incubation_count} 轮</span>
        )}
      </div>
    </button>
  );
}

/* ── 详情面板 ── */

function InspirationDetail({ item, onClose, onAct, onRate }: {
  item: Inspiration;
  onClose: () => void;
  onAct: () => void;
  onRate: () => void;
}) {
  const dismiss = useDismissInspiration();
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.spark;

  return (
    <div className="w-[400px] flex-shrink-0 overflow-y-auto rounded-xl border border-border/60 bg-card shadow-apple-md scrollbar-thin">
      {/* Header */}
      <div className="sticky top-0 z-10 glass border-b border-border/60 px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium', cfg.bgColor, cfg.color)}>
            {cfg.icon}
            {cfg.label}
          </span>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 className="text-base font-semibold leading-snug">{item.title || '未命名灵感'}</h2>
        {item.domain && (
          <span className="mt-1 inline-block rounded-md bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            {item.domain}
          </span>
        )}
      </div>

      <div className="space-y-5 px-5 py-4">
        {/* 内容 */}
        {item.content && (
          <section>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              内容
            </h4>
            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
              {item.content}
            </p>
          </section>
        )}

        {/* 假设 */}
        {item.hypothesis && (
          <section>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              假设
            </h4>
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-2.5">
              <p className="text-sm text-foreground/80 leading-relaxed">{item.hypothesis}</p>
            </div>
          </section>
        )}

        {/* 指标 */}
        <section>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            指标
          </h4>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="信心度" value={item.confidence} />
            <MetricCard label="新颖度" value={item.novelty} />
            <MetricCard label="可行性" value={item.actionability} />
          </div>
        </section>

        {/* 行动结果 */}
        {item.acted_outcome && (
          <section>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              行动结果
            </h4>
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/10 px-3 py-2.5">
              <p className="text-sm text-foreground/80 leading-relaxed">{item.acted_outcome}</p>
            </div>
          </section>
        )}

        {/* 孵化日志 */}
        {item.incubation_log && item.incubation_log.length > 0 && (
          <section>
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              孵化日志（{item.incubation_log.length} 轮）
            </h4>
            <div className="space-y-2">
              {item.incubation_log.map((log, idx) => (
                <div key={idx} className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium text-muted-foreground">
                      第 {log.round} 轮
                    </span>
                    {log.confidence_delta != null && (
                      <span className={cn(
                        'text-[10px] font-medium',
                        log.confidence_delta > 0 ? 'text-emerald-500' : log.confidence_delta < 0 ? 'text-red-500' : 'text-muted-foreground'
                      )}>
                        {log.confidence_delta > 0 ? '+' : ''}{(log.confidence_delta * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  {log.new_angle && (
                    <p className="text-xs text-foreground/70 leading-relaxed">{log.new_angle}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 元信息 */}
        <section>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            元信息
          </h4>
          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>ID</span>
              <code className="font-mono text-[10px]">{item.id}</code>
            </div>
            {item.origin && (
              <div className="flex justify-between">
                <span>来源</span>
                <span>{item.origin}</span>
              </div>
            )}
            {item.created_at && (
              <div className="flex justify-between">
                <span>创建时间</span>
                <span>{new Date(item.created_at).toLocaleString('zh-CN')}</span>
              </div>
            )}
            {item.expires_at && (
              <div className="flex justify-between">
                <span>过期时间</span>
                <span>{new Date(item.expires_at).toLocaleString('zh-CN')}</span>
              </div>
            )}
          </div>
        </section>

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-2">
          {item.status !== 'acted' && item.status !== 'archived' && (
            <button
              onClick={onAct}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-apple transition hover:bg-primary/90"
            >
              <Zap className="h-3.5 w-3.5" />
              标记已行动
            </button>
          )}
          <button
            onClick={onRate}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs font-medium text-foreground shadow-apple transition hover:bg-accent"
          >
            <Star className="h-3.5 w-3.5" />
            评分
          </button>
          {item.status !== 'archived' && (
            <button
              onClick={() => dismiss.mutate({ id: item.id, mode: 'archive' })}
              disabled={dismiss.isPending}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-apple transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 行动弹窗 ── */

function ActDialog({ item, onClose, onDone }: {
  item: Inspiration; onClose: () => void; onDone: () => void;
}) {
  const [outcome, setOutcome] = useState('');
  const act = useActOnInspiration();

  const handleSubmit = () => {
    if (!outcome.trim()) return;
    act.mutate({ id: item.id, outcome }, {
      onSuccess: () => onDone(),
    });
  };

  return (
    <DialogOverlay onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-apple-lg">
        <h3 className="text-base font-semibold mb-1">标记已行动</h3>
        <p className="text-xs text-muted-foreground mb-4">
          记录你对「{item.title}」采取的行动和结果
        </p>
        <textarea
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          placeholder="描述你采取了什么行动，产生了什么结果…"
          className="w-full resize-none rounded-xl border border-border/60 bg-background px-4 py-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
          rows={4}
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border/60 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!outcome.trim() || act.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-apple hover:bg-primary/90 disabled:opacity-50"
          >
            {act.isPending ? '提交中…' : '确认'}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}

/* ── 评分弹窗 ── */

function RateDialog({ item, onClose, onDone }: {
  item: Inspiration; onClose: () => void; onDone: () => void;
}) {
  const [rating, setRating] = useState(3);
  const [comment, setComment] = useState('');
  const rate = useRateInspiration();

  const handleSubmit = () => {
    rate.mutate({ id: item.id, rating, comment: comment || undefined }, {
      onSuccess: () => onDone(),
    });
  };

  return (
    <DialogOverlay onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-apple-lg">
        <h3 className="text-base font-semibold mb-1">评分灵感</h3>
        <p className="text-xs text-muted-foreground mb-4">
          为「{item.title}」打分（1-5 分）
        </p>

        {/* 星级评分 */}
        <div className="flex items-center justify-center gap-2 mb-4">
          {[1, 2, 3, 4, 5].map((v) => (
            <button
              key={v}
              onClick={() => setRating(v)}
              className="p-1 transition hover:scale-110"
            >
              <Star
                className={cn(
                  'h-7 w-7 transition',
                  v <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'
                )}
              />
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="评论（可选）…"
          className="w-full resize-none rounded-xl border border-border/60 bg-background px-4 py-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
          rows={3}
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border/60 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={rate.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-apple hover:bg-primary/90 disabled:opacity-50"
          >
            {rate.isPending ? '提交中…' : '提交评分'}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}

/* ── 通用子组件 ── */

function ConfidenceIndicator({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? 'text-emerald-500' : pct >= 40 ? 'text-amber-500' : 'text-red-400';
  return (
    <span className={cn('text-xs font-semibold tabular-nums', color)}>
      {pct}%
    </span>
  );
}

function MetricCard({ label, value }: { label: string; value?: number }) {
  if (value == null) return (
    <div className="rounded-lg bg-muted/30 p-2.5 text-center">
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-muted-foreground/40">-</p>
    </div>
  );
  const pct = Math.round(value * 100);
  return (
    <div className="rounded-lg bg-muted/30 p-2.5 text-center">
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-semibold">{pct}%</p>
    </div>
  );
}

function DialogOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="mt-3 text-sm text-muted-foreground">加载灵感…</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 mb-4">
        <AlertCircle className="h-7 w-7 text-destructive/60" />
      </div>
      <h3 className="text-sm font-medium">加载失败</h3>
      <p className="mt-1 text-xs text-muted-foreground max-w-sm text-center">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-apple hover:bg-primary/90"
      >
        重试
      </button>
    </div>
  );
}

function EmptyState({ status }: { status: InspirationStatus | '' }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="relative mb-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10">
          <Lightbulb className="h-8 w-8 text-amber-500/60" />
        </div>
        <div className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-card shadow-apple">
          <Sparkles className="h-3 w-3 text-amber-400" />
        </div>
      </div>
      <h3 className="text-sm font-medium">
        {status ? `没有${STATUS_CONFIG[status]?.label || ''}灵感` : '暂无灵感'}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground max-w-sm text-center">
        灵感会在 Dream 引擎执行记忆整理时自动生成，也可以点击「触发灵感引擎」手动触发。
      </p>
    </div>
  );
}
