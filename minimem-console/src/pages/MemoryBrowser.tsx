import { useState } from 'react';
import { Search, Filter, ChevronDown, ExternalLink, User, X } from 'lucide-react';
import { useMemoryList, useMemorySearch, type MemoryItem } from '@/api/minimem';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';

const LAYERS = [
  { key: '', label: '全部' },
  { key: 'L1', label: 'L1 经历' },
  { key: 'L2', label: 'L2 事实' },
  { key: 'L3', label: 'L3 观察' },
  { key: 'L4', label: 'L4 心智模型' },
];

const TEMPERATURES = ['hot', 'warm', 'cool', 'cold', 'frozen'];

const TEMPERATURE_COLORS: Record<string, string> = {
  hot: '#EF4444',
  warm: '#F59E0B',
  cool: '#3B82F6',
  cold: '#6366F1',
  frozen: '#94A3B8',
};

function MemoryCard({ memory, onClick }: { memory: MemoryItem; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl bg-card p-4 text-left shadow-apple transition-all duration-200 hover:shadow-apple-md"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 text-[13px] leading-relaxed text-foreground">
          {memory.content}
        </p>
        {memory.temperature && (
          <div
            className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full"
            style={{ backgroundColor: TEMPERATURE_COLORS[memory.temperature] || '#94A3B8' }}
            title={memory.temperature}
          />
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {memory.layer && (
          <span className="rounded-md bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {memory.layer}
          </span>
        )}
        {memory.source && (
          <span className="text-[10px] text-muted-foreground">{memory.source}</span>
        )}
        {memory.importance != null && (
          <span className="text-[10px] text-muted-foreground">
            重要性 {memory.importance}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {new Date(memory.created_at).toLocaleDateString('zh-CN')}
        </span>
      </div>

      {memory.tags && memory.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {memory.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
          {memory.tags.length > 4 && (
            <span className="text-[10px] text-muted-foreground">
              +{memory.tags.length - 4}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function MemoryDetailPanel({ memory, onClose }: { memory: MemoryItem; onClose: () => void }) {
  return (
    <div className="rounded-2xl bg-card p-6 shadow-apple-md">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          {memory.layer && (
            <span className="rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              {memory.layer}
            </span>
          )}
          {memory.temperature && (
            <span
              className="rounded-lg px-2 py-1 text-xs font-medium"
              style={{
                color: TEMPERATURE_COLORS[memory.temperature],
                backgroundColor: `${TEMPERATURE_COLORS[memory.temperature]}14`,
              }}
            >
              {memory.temperature}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          ✕
        </button>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {memory.content}
      </p>

      {/* L2 三元组 */}
      {memory.subject && (
        <div className="mt-4 rounded-xl bg-muted/50 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            三元组
          </p>
          <p className="mt-1 text-sm">
            <span className="font-medium text-primary">{memory.subject}</span>
            {' → '}
            <span className="text-foreground">{memory.predicate}</span>
            {' → '}
            <span className="font-medium text-primary">{memory.object}</span>
          </p>
        </div>
      )}

      {/* 元信息 */}
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>ID: <span className="font-mono">{memory.id}</span></div>
        {memory.source && <div>来源: {memory.source}</div>}
        {memory.content_type && <div>类型: {memory.content_type}</div>}
        {memory.importance != null && <div>重要性: {memory.importance}</div>}
        {memory.domain && <div>领域: {memory.domain}</div>}
        <div>创建: {new Date(memory.created_at).toLocaleString('zh-CN')}</div>
      </div>
    </div>
  );
}

export default function MemoryBrowser() {
  const [layer, setLayer] = useState('');
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [filterSource, setFilterSource] = useState('');
  const [filterDomain, setFilterDomain] = useState('');
  const [filterTemperature, setFilterTemperature] = useState('');
  const [recallEntity, setRecallEntity] = useState('');
  const [recallResult, setRecallResult] = useState<MemoryItem[] | null>(null);
  const [recallLoading, setRecallLoading] = useState(false);

  const { data: listData, isLoading: listLoading } = useMemoryList({
    page,
    page_size: 20,
    layer: layer || undefined,
    source: filterSource || undefined,
  });

  const { data: searchData, isLoading: searchLoading } = useMemorySearch(activeSearch);

  // 应用客户端筛选
  let memories = activeSearch
    ? searchData?.memories
    : recallResult != null
      ? recallResult
      : listData?.memories;

  if (memories && filterDomain) {
    memories = memories.filter((m) => m.domain === filterDomain);
  }
  if (memories && filterTemperature) {
    memories = memories.filter((m) => m.temperature === filterTemperature);
  }

  const isLoading = activeSearch ? searchLoading : recallLoading ? true : listLoading;

  const handleSearch = () => {
    setRecallResult(null);
    setActiveSearch(searchQuery);
  };

  const handleRecall = async () => {
    if (!recallEntity.trim()) return;
    setRecallLoading(true);
    setActiveSearch('');
    try {
      const data = await api.get<{ memories: MemoryItem[] }>(
        `/proxy/api/v1/memory/recall/${encodeURIComponent(recallEntity.trim())}`,
      );
      setRecallResult(data.memories || []);
    } catch {
      setRecallResult([]);
    } finally {
      setRecallLoading(false);
    }
  };

  const clearAll = () => {
    setActiveSearch('');
    setSearchQuery('');
    setRecallResult(null);
    setRecallEntity('');
  };

  const hasActiveFilters = filterSource || filterDomain || filterTemperature;

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">记忆浏览器</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          浏览、搜索、查看记忆详情
        </p>
      </div>

      {/* 搜索栏 + 实体召回 */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="语义搜索记忆..."
            className="w-full rounded-xl border border-border/60 bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 shadow-apple transition-shadow focus:shadow-apple-md focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <button
          onClick={handleSearch}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-apple transition-all hover:shadow-apple-md active:scale-[0.98]"
        >
          搜索
        </button>

        {/* 实体召回 */}
        <div className="relative">
          <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={recallEntity}
            onChange={(e) => setRecallEntity(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRecall()}
            placeholder="实体召回..."
            className="w-40 rounded-xl border border-border/60 bg-card py-2.5 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 shadow-apple transition-shadow focus:shadow-apple-md focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* 筛选按钮 */}
        <button
          onClick={() => setShowFilter(!showFilter)}
          className={cn(
            'flex items-center gap-1.5 rounded-xl border border-border/60 bg-card px-4 py-2.5 text-sm shadow-apple transition-all',
            showFilter || hasActiveFilters
              ? 'border-primary/30 text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Filter className="h-4 w-4" />
          筛选
          {hasActiveFilters && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
              {[filterSource, filterDomain, filterTemperature].filter(Boolean).length}
            </span>
          )}
        </button>

        {(activeSearch || recallResult != null) && (
          <button
            onClick={clearAll}
            className="rounded-xl border border-border/60 bg-card px-4 py-2.5 text-sm text-muted-foreground shadow-apple transition-colors hover:text-foreground"
          >
            清除
          </button>
        )}
      </div>

      {/* 筛选面板 */}
      {showFilter && (
        <div className="flex items-center gap-4 rounded-xl bg-card p-4 shadow-apple">
          <div>
            <label className="mb-1 block text-[10px] font-medium text-muted-foreground">来源</label>
            <input
              type="text"
              value={filterSource}
              onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
              placeholder="如 agent, user..."
              className="w-36 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-muted-foreground">领域</label>
            <input
              type="text"
              value={filterDomain}
              onChange={(e) => setFilterDomain(e.target.value)}
              placeholder="如 tech, health..."
              className="w-36 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-muted-foreground">温度</label>
            <select
              value={filterTemperature}
              onChange={(e) => setFilterTemperature(e.target.value)}
              className="w-28 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
            >
              <option value="">全部</option>
              {TEMPERATURES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setFilterSource('');
                setFilterDomain('');
                setFilterTemperature('');
              }}
              className="mt-4 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
              清除筛选
            </button>
          )}
        </div>
      )}

      {/* 层级 Tab */}
      <div className="flex gap-1 rounded-xl bg-muted/50 p-1">
        {LAYERS.map((l) => (
          <button
            key={l.key}
            onClick={() => {
              setLayer(l.key);
              setPage(1);
              clearAll();
            }}
            className={cn(
              'rounded-lg px-4 py-1.5 text-xs font-medium transition-all duration-200',
              layer === l.key
                ? 'bg-card text-foreground shadow-apple'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* 内容区 — 左右独立滚动 */}
      <div className="flex gap-6" style={{ height: 'calc(100vh - 280px)' }}>
        {/* 列表 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin space-y-3 pr-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : memories && memories.length > 0 ? (
            <>
              {recallResult != null && (
                <div className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-primary">
                  实体「{recallEntity}」召回 {recallResult.length} 条关联记忆
                </div>
              )}
              {memories.map((m) => (
                <MemoryCard
                  key={m.id}
                  memory={m}
                  onClick={() => setSelectedMemory(m)}
                />
              ))}

              {/* 分页 */}
              {!activeSearch && recallResult == null && listData && (
                <div className="flex items-center justify-center gap-3 pt-4">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="rounded-lg bg-card px-4 py-2 text-xs font-medium shadow-apple transition-all disabled:opacity-40 hover:shadow-apple-md"
                  >
                    上一页
                  </button>
                  <span className="text-xs text-muted-foreground">
                    第 {page} 页
                  </span>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={!memories || memories.length < 20}
                    className="rounded-lg bg-card px-4 py-2 text-xs font-medium shadow-apple transition-all disabled:opacity-40 hover:shadow-apple-md"
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <p className="text-sm">暂无记忆数据</p>
              <p className="mt-1 text-xs">请确认 MiniMem 引擎已启动并包含数据</p>
            </div>
          )}
        </div>

        {/* 详情面板 */}
        {selectedMemory && (
          <div className="w-96 flex-shrink-0">
            <MemoryDetailPanel
              memory={selectedMemory}
              onClose={() => setSelectedMemory(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
