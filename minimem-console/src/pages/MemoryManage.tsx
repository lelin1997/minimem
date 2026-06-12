import { useState } from 'react';
import { Plus, Edit2, Trash2, X, AlertTriangle, Loader2, Search, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useQueryClient } from '@tanstack/react-query';
import { useMemoryList, useMemorySearch, type MemoryItem } from '@/api/minimem';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type Tab = 'write' | 'edit' | 'forget';

export default function MemoryManage() {
  const [tab, setTab] = useState<Tab>('write');
  const qc = useQueryClient();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">记忆管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          手动写入、编辑、删除、遗忘记忆
        </p>
      </div>

      {/* Tab */}
      <div className="flex gap-1 rounded-xl bg-muted/50 p-1 w-fit">
        {([
          { key: 'write' as const, label: '写入记忆', icon: Plus },
          { key: 'edit' as const, label: '编辑/删除', icon: Edit2 },
          { key: 'forget' as const, label: '遗忘主题', icon: AlertTriangle },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium transition-all',
              tab === t.key
                ? 'bg-card text-foreground shadow-apple'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'write' && <WriteMemory onSuccess={() => qc.invalidateQueries({ queryKey: ['memories'] })} />}
      {tab === 'edit' && <EditDeleteMemory onSuccess={() => qc.invalidateQueries({ queryKey: ['memories'] })} />}
      {tab === 'forget' && <ForgetTopic />}
    </div>
  );
}

// ── 写入记忆 ──

function WriteMemory({ onSuccess }: { onSuccess: () => void }) {
  const [content, setContent] = useState('');
  const [source, setSource] = useState('manual');
  const [importance, setImportance] = useState('0.5');
  const [tags, setTags] = useState('');
  const [domain, setDomain] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSaving(true);
    setResult(null);
    try {
      const body: Record<string, any> = {
        content: content.trim(),
        source: source || 'manual',
        importance: parseFloat(importance) || 0.5,
      };
      if (tags) body.tags = tags.split(',').map((t) => t.trim());
      if (domain) body.domain = domain;

      await api.post('/proxy/api/v1/memory', body);
      setResult('✅ 记忆写入成功');
      setContent('');
      onSuccess();
    } catch (err: any) {
      setResult(`❌ 写入失败: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl bg-card p-6 shadow-apple space-y-4 max-w-2xl">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="输入记忆内容..."
        rows={4}
        className="w-full rounded-xl border border-border/60 bg-background px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">来源</label>
          <input
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">重要性 (0-1)</label>
          <input
            type="number"
            value={importance}
            onChange={(e) => setImportance(e.target.value)}
            min="0"
            max="1"
            step="0.1"
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">标签（逗号分隔）</label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="tag1, tag2"
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">领域</label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="tech, health..."
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || saving}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-apple transition-all hover:shadow-apple-md disabled:opacity-50"
        >
          {saving ? '写入中...' : '写入记忆'}
        </button>
        {result && (
          <span className="text-sm">{result}</span>
        )}
      </div>
    </div>
  );
}

// ── 编辑/删除记忆 ──

function EditDeleteMemory({ onSuccess }: { onSuccess: () => void }) {
  const [memoryId, setMemoryId] = useState('');
  const [layer, setLayer] = useState('L1');
  const [editContent, setEditContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [loadedMemory, setLoadedMemory] = useState<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 列表模式状态
  const [listPage, setListPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  const { data: listData, isLoading: listLoading } = useMemoryList({
    page: listPage,
    page_size: 10,
    layer: layer || undefined,
  });
  const { data: searchData, isLoading: searchLoading } = useMemorySearch(activeSearch, 10);

  const memories = activeSearch ? searchData?.memories : listData?.memories;
  const isListLoading = activeSearch ? searchLoading : listLoading;

  const handleSearch = () => {
    setActiveSearch(searchQuery);
  };

  const handleSelectMemory = (memory: MemoryItem) => {
    setMemoryId(memory.id);
    setEditContent(memory.content);
    setLoadedMemory(memory);
    setResult(null);
  };

  const loadMemory = async () => {
    if (!memoryId.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await api.get<any>(`/proxy/api/v1/memory/${memoryId.trim()}`);
      setLoadedMemory(data);
      // 引擎返回 raw_content 而非 content
      setEditContent(data.content || data.raw_content || '');
    } catch {
      setResult('❌ 未找到该记忆');
      setLoadedMemory(null);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!memoryId.trim() || !editContent.trim()) return;
    setLoading(true);
    try {
      await api.put(`/proxy/api/v1/memory/${memoryId.trim()}`, {
        content: editContent.trim(),
      });
      setResult('✅ 更新成功');
      toast.success('记忆更新成功');
      onSuccess();
    } catch (err: any) {
      setResult(`❌ 更新失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!memoryId.trim()) return;
    setShowDeleteConfirm(false);
    setLoading(true);
    try {
      await api.delete(`/proxy/api/v1/memory/${memoryId.trim()}?layer=${layer}`);
      setResult('✅ 删除成功');
      toast.success('记忆已删除');
      setLoadedMemory(null);
      setEditContent('');
      setMemoryId('');
      onSuccess();
    } catch (err: any) {
      setResult(`❌ 删除失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const clearSelection = () => {
    setMemoryId('');
    setEditContent('');
    setLoadedMemory(null);
    setResult(null);
  };

  return (
    <div className="flex gap-4 max-w-5xl">
      {/* 左侧：记忆列表选择 */}
      <div className="w-[360px] flex-shrink-0 space-y-3">
        {/* 搜索 */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索记忆…"
              className="w-full rounded-lg border border-border/60 bg-background py-2 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={handleSearch}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
          >
            搜索
          </button>
          {activeSearch && (
            <button
              onClick={() => { setActiveSearch(''); setSearchQuery(''); }}
              className="rounded-lg border border-border/60 px-2 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 层级筛选 */}
        <div className="flex gap-1 rounded-lg bg-muted/50 p-0.5">
          {['L1', 'L2', 'L3', 'L4'].map((l) => (
            <button
              key={l}
              onClick={() => { setLayer(l); setListPage(1); setActiveSearch(''); setSearchQuery(''); }}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all',
                layer === l
                  ? 'bg-card text-foreground shadow-apple'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {l}
            </button>
          ))}
        </div>

        {/* 记忆列表 */}
        <div className="max-h-[400px] overflow-y-auto rounded-xl border border-border/60 bg-card scrollbar-thin">
          {isListLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : memories && memories.length > 0 ? (
            <div className="divide-y divide-border/40">
              {memories.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleSelectMemory(m)}
                  className={cn(
                    'w-full px-3 py-2.5 text-left transition-colors hover:bg-accent/50',
                    memoryId === m.id && 'bg-primary/5 border-l-2 border-l-primary'
                  )}
                >
                  <p className="text-xs leading-relaxed line-clamp-2 text-foreground">
                    {m.content}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {m.layer && <span className="font-medium text-primary/80">{m.layer}</span>}
                    {m.source && <span>{m.source}</span>}
                    <span className="ml-auto">{new Date(m.created_at).toLocaleDateString('zh-CN')}</span>
                    <ChevronRight className="h-3 w-3 flex-shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <p className="text-xs">暂无记忆</p>
            </div>
          )}
        </div>

        {/* 分页 */}
        {!activeSearch && listData && (
          <div className="flex items-center justify-center gap-2">
            <button
              disabled={listPage <= 1}
              onClick={() => setListPage(listPage - 1)}
              className="rounded-md bg-card px-3 py-1 text-[11px] font-medium shadow-apple disabled:opacity-40"
            >
              上一页
            </button>
            <span className="text-[11px] text-muted-foreground">第 {listPage} 页</span>
            <button
              onClick={() => setListPage(listPage + 1)}
              disabled={!memories || memories.length < 10}
              className="rounded-md bg-card px-3 py-1 text-[11px] font-medium shadow-apple disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        )}
      </div>

      {/* 右侧：编辑面板 */}
      <div className="flex-1 rounded-2xl bg-card p-6 shadow-apple space-y-4">
        {/* ID 输入（也可以手动输入） */}
        <div className="flex gap-2">
          <input
            type="text"
            value={memoryId}
            onChange={(e) => setMemoryId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadMemory()}
            placeholder="从左侧选择记忆，或手动输入 ID"
            className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <button
            onClick={loadMemory}
            disabled={loading || !memoryId.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            加载
          </button>
          {loadedMemory && (
            <button
              onClick={clearSelection}
              className="rounded-lg border border-border/60 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {loadedMemory ? (
          <>
            {/* 记忆元信息 */}
            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {loadedMemory.layer && (
                <span className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">
                  {loadedMemory.layer}
                </span>
              )}
              {loadedMemory.source && <span>来源: {loadedMemory.source}</span>}
              {loadedMemory.importance != null && <span>重要性: {loadedMemory.importance}</span>}
              {loadedMemory.temperature && <span>温度: {loadedMemory.temperature}</span>}
              <span className="font-mono text-[10px]">ID: {memoryId}</span>
            </div>

            {/* 编辑框 */}
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={6}
              className="w-full rounded-xl border border-border/60 bg-background px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
            />

            {/* 操作按钮 */}
            <div className="flex gap-2">
              <button
                onClick={handleUpdate}
                disabled={loading || !editContent.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-apple hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? '更新中…' : '更新内容'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={loading}
                className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-apple hover:bg-destructive/90 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4 inline mr-1" />
                删除
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Edit2 className="h-8 w-8 mb-3 text-muted-foreground/30" />
            <p className="text-sm">从左侧列表选择要编辑的记忆</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              也可以在上方输入框直接输入记忆 ID 后点击加载
            </p>
          </div>
        )}

        {result && <p className="text-sm">{result}</p>}

        <ConfirmDialog
          open={showDeleteConfirm}
          title="删除记忆"
          description="确认删除这条记忆？此操作不可撤销。"
          confirmText="删除"
          variant="destructive"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      </div>
    </div>
  );
}

// ── 遗忘主题 ──

function ForgetTopic() {
  const [topic, setTopic] = useState('');
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [showForgetConfirm, setShowForgetConfirm] = useState(false);

  const handleDryRun = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await api.post<any>('/proxy/api/v1/memory/forget', {
        topic: topic.trim(),
        dry_run: true,
      });
      // 引擎返回 { deleted: { experiences: N, ... }, tombstones_created: N }
      // 计算总影响数
      const deleted = data.deleted || {};
      const totalAffected = Object.values(deleted).reduce((sum: number, n: any) => sum + (Number(n) || 0), 0);
      setDryRunResult({ ...data, affected: totalAffected });
    } catch (err: any) {
      setResult(`❌ 预览失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!topic.trim()) return;
    setShowForgetConfirm(false);
    setLoading(true);
    try {
      const data = await api.post<any>('/proxy/api/v1/memory/forget', {
        topic: topic.trim(),
        dry_run: false,
      });
      // 引擎返回 { deleted: { experiences: N, ... }, tombstones_created: N }
      const deleted = data.deleted || {};
      const totalAffected = Object.values(deleted).reduce((sum: number, n: any) => sum + (Number(n) || 0), 0);
      setResult(`✅ 遗忘完成：影响 ${totalAffected} 条记忆`);
      setDryRunResult(null);
    } catch (err: any) {
      setResult(`❌ 遗忘失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl bg-card p-6 shadow-apple space-y-4 max-w-2xl">
      <div className="flex items-center gap-2 text-amber-600 text-sm">
        <AlertTriangle className="h-4 w-4" />
        遗忘操作不可撤销，建议先预览影响范围
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="输入要遗忘的主题..."
          className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <button
          onClick={handleDryRun}
          disabled={!topic.trim() || loading}
          className="rounded-lg bg-card border border-border/60 px-4 py-2 text-sm font-medium shadow-apple hover:shadow-apple-md"
        >
          {loading ? '分析中...' : '预览影响'}
        </button>
        <button
          onClick={() => setShowForgetConfirm(true)}
          disabled={!topic.trim() || loading}
          className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground"
        >
          执行遗忘
        </button>
      </div>

      {dryRunResult && (
        <div className="rounded-xl bg-amber-50 p-4 text-sm space-y-2">
          <p className="font-medium text-amber-800">
            预览：将影响 {dryRunResult.affected || dryRunResult.count || '?'} 条记忆
          </p>
          {dryRunResult.memories && (
            <ul className="space-y-1 text-amber-700">
              {(dryRunResult.memories as any[]).slice(0, 10).map((m: any, i: number) => (
                <li key={i} className="truncate">
                  • {m.content || m.id}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && <p className="text-sm">{result}</p>}

      <ConfirmDialog
        open={showForgetConfirm}
        title="遗忘主题"
        description={`确认遗忘主题「${topic}」？此操作不可撤销。`}
        confirmText="遗忘"
        variant="destructive"
        onConfirm={handleExecute}
        onCancel={() => setShowForgetConfirm(false)}
      />
    </div>
  );
}
