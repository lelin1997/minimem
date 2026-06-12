import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  BookOpen, Search, Filter, RefreshCw, X,
  Trash2, Archive, Tag, Clock, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useKnowledgeList, useKnowledgeTags,
  useDeleteKnowledge,
  type KnowledgeItem, type KnowledgeStatus,
} from '@/api/knowledge';
import { cn } from '@/lib/utils';

/* ── 状态配置 ── */

const STATUS_CONFIG: Record<KnowledgeStatus, {
  label: string; color: string; bgColor: string;
}> = {
  active: { label: '活跃', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
  draft: { label: '草稿', color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  archived: { label: '已归档', color: 'text-muted-foreground', bgColor: 'bg-muted/50' },
};

const STATUS_TABS: { value: KnowledgeStatus | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'active', label: '活跃' },
  { value: 'draft', label: '草稿' },
  { value: 'archived', label: '归档' },
];

/* ── 主页面 ── */

export default function Knowledge() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<KnowledgeStatus | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useKnowledgeList({
    page,
    page_size: 20,
    search: activeSearch || undefined,
    tag: tagFilter || undefined,
    domain: domainFilter || undefined,
    status: statusFilter || undefined,
  });

  const { data: tagsData } = useKnowledgeTags();
  const deleteMutation = useDeleteKnowledge();

  const items = data?.items || [];
  const selected = items.find((i) => i.id === selectedId) || null;

  const handleSearch = useCallback(() => {
    setActiveSearch(searchQuery);
    setPage(1);
  }, [searchQuery]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success('已刷新');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDelete = (item: KnowledgeItem, mode: 'archive' | 'delete') => {
    const label = mode === 'archive' ? '归档' : '删除';
    deleteMutation.mutate({ id: item.id, mode }, {
      onSuccess: () => {
        toast.success(`已${label}「${item.title}」`);
        if (selectedId === item.id) setSelectedId(null);
      },
      onError: (err: any) => {
        toast.error(`${label}失败`, { description: err?.message || '未知错误' });
      },
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-1 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">知识库</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            由 Karpathy Dream 引擎编译产出的知识卡片
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
        </div>
      </div>

      {/* 搜索栏 */}
      <div className="flex items-center gap-3 pb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            placeholder="搜索知识…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="h-8 w-full rounded-lg border border-border/60 bg-card pl-9 pr-3 text-xs placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setActiveSearch(''); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* 状态 Tab */}
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setStatusFilter(tab.value); setPage(1); setSelectedId(null); }}
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

        {/* 标签过滤 */}
        {tagsData?.tags && tagsData.tags.length > 0 && (
          <div className="relative">
            <Tag className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <select
              value={tagFilter}
              onChange={(e) => { setTagFilter(e.target.value); setPage(1); }}
              className="h-7 appearance-none rounded-lg border border-border/60 bg-card pl-8 pr-6 text-xs text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
            >
              <option value="">所有标签</option>
              {tagsData.tags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        )}

        {/* 领域过滤 */}
        <div className="relative">
          <Filter className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            placeholder="按领域过滤…"
            value={domainFilter}
            onChange={(e) => { setDomainFilter(e.target.value); setPage(1); }}
            className="h-7 w-32 rounded-lg border border-border/60 bg-card pl-8 pr-3 text-xs placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
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
        {/* 知识列表 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin pr-1">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-2 pr-1">
              {items.map((item) => (
                <KnowledgeCard
                  key={item.id}
                  item={item}
                  isSelected={selectedId === item.id}
                  onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
                />
              ))}

              {/* 分页 */}
              {data && data.total > 20 && (
                <div className="flex items-center justify-center gap-3 pt-4">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="rounded-lg bg-card px-4 py-2 text-xs font-medium shadow-apple transition-all disabled:opacity-40 hover:shadow-apple-md"
                  >
                    上一页
                  </button>
                  <span className="text-xs text-muted-foreground">
                    第 {page} 页 / 共 {Math.ceil(data.total / 20)} 页
                  </span>
                  <button
                    disabled={page >= Math.ceil(data.total / 20)}
                    onClick={() => setPage(page + 1)}
                    className="rounded-lg bg-card px-4 py-2 text-xs font-medium shadow-apple transition-all disabled:opacity-40 hover:shadow-apple-md"
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 详情面板 */}
        {selected && (
          <KnowledgeDetail
            item={selected}
            onClose={() => setSelectedId(null)}
            onArchive={() => handleDelete(selected, 'archive')}
            onDelete={() => handleDelete(selected, 'delete')}
          />
        )}
      </div>
    </div>
  );
}

/* ── 知识卡片 ── */

function KnowledgeCard({ item, isSelected, onClick }: {
  item: KnowledgeItem; isSelected: boolean; onClick: () => void;
}) {
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.active;

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
            <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium', cfg.bgColor, cfg.color)}>
              {cfg.label}
            </span>
            {item.domain && (
              <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {item.domain}
              </span>
            )}
            {item.confidence != null && (
              <span className={cn(
                'text-[10px] font-medium tabular-nums',
                item.confidence >= 0.7 ? 'text-emerald-500' : item.confidence >= 0.4 ? 'text-amber-500' : 'text-red-400'
              )}>
                {Math.round(item.confidence * 100)}%
              </span>
            )}
          </div>

          <h3 className="text-sm font-medium leading-snug line-clamp-1">
            {item.title || '未命名知识'}
          </h3>

          {item.summary && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {item.summary}
            </p>
          )}
        </div>
      </div>

      {/* 底部标签 + 时间 */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {item.tags?.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {tag}
            </span>
          ))}
          {item.tags && item.tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground">+{item.tags.length - 3}</span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {new Date(item.updated_at || item.created_at).toLocaleDateString('zh-CN')}
        </span>
      </div>
    </button>
  );
}

/* ── 详情面板 ── */

function KnowledgeDetail({ item, onClose, onArchive, onDelete }: {
  item: KnowledgeItem;
  onClose: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.active;

  return (
    <div className="w-[420px] flex-shrink-0 overflow-y-auto rounded-xl border border-border/60 bg-card shadow-apple-md scrollbar-thin">
      {/* Header */}
      <div className="sticky top-0 z-10 glass border-b border-border/60 px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium', cfg.bgColor, cfg.color)}>
            {cfg.label}
          </span>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 className="text-base font-semibold leading-snug">{item.title || '未命名知识'}</h2>
        {item.domain && (
          <span className="mt-1 inline-block rounded-md bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            {item.domain}
          </span>
        )}
      </div>

      <div className="space-y-5 px-5 py-4">
        {/* 摘要 */}
        {item.summary && (
          <section>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              摘要
            </h4>
            <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2.5">
              <p className="text-sm text-foreground/80 leading-relaxed">{item.summary}</p>
            </div>
          </section>
        )}

        {/* 内容（Markdown 渲染） */}
        <section>
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            内容
          </h4>
          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground/80 prose-strong:text-foreground prose-code:rounded prose-code:bg-muted/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[11px] prose-pre:bg-muted/40 prose-pre:border prose-pre:border-border/60 prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
            <ReactMarkdown>{item.content}</ReactMarkdown>
          </div>
        </section>

        {/* 置信度 */}
        {item.confidence != null && (
          <section>
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              置信度
            </h4>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    item.confidence >= 0.7 ? 'bg-emerald-500' : item.confidence >= 0.4 ? 'bg-amber-500' : 'bg-red-400'
                  )}
                  style={{ width: `${item.confidence * 100}%` }}
                />
              </div>
              <span className="text-xs font-semibold tabular-nums">
                {Math.round(item.confidence * 100)}%
              </span>
            </div>
          </section>
        )}

        {/* 标签 */}
        {item.tags && item.tags.length > 0 && (
          <section>
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              标签
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-lg bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
                  <Tag className="h-2.5 w-2.5" />
                  {tag}
                </span>
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
            {item.created_at && (
              <div className="flex justify-between">
                <span>创建时间</span>
                <span>{new Date(item.created_at).toLocaleString('zh-CN')}</span>
              </div>
            )}
            {item.updated_at && (
              <div className="flex justify-between">
                <span>更新时间</span>
                <span>{new Date(item.updated_at).toLocaleString('zh-CN')}</span>
              </div>
            )}
            {item.source_memory_ids && item.source_memory_ids.length > 0 && (
              <div className="flex justify-between">
                <span>来源记忆</span>
                <span>{item.source_memory_ids.length} 条</span>
              </div>
            )}
          </div>
        </section>

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-2">
          {item.status !== 'archived' && (
            <button
              onClick={onArchive}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-apple transition hover:bg-accent hover:text-foreground"
            >
              <Archive className="h-3.5 w-3.5" />
              归档
            </button>
          )}
          <button
            onClick={onDelete}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-apple transition hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            永久删除
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 通用子组件 ── */

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="mt-3 text-sm text-muted-foreground">加载知识…</p>
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="relative mb-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <BookOpen className="h-8 w-8 text-primary/60" />
        </div>
      </div>
      <h3 className="text-sm font-medium">暂无知识</h3>
      <p className="mt-1 text-xs text-muted-foreground max-w-sm text-center">
        知识由 Dream 引擎的 Karpathy 编译层自动生成，无需手动创建。
      </p>
    </div>
  );
}
