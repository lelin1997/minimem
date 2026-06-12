import { useState } from 'react';
import { Moon, FileText, Clock, Play, Loader2, Code2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDreamList, useDream } from '@/api/minimem';
import { useCreateTask } from '@/api/tasks';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export default function DreamHistory() {
  const { data, isLoading, error } = useDreamList();
  const [selectedId, setSelectedId] = useState('');
  const [viewFormat, setViewFormat] = useState<'json' | 'md' | undefined>(undefined);
  const { data: detail, isLoading: detailLoading } = useDream(selectedId, viewFormat);
  const [triggerMode, setTriggerMode] = useState<'daily' | 'weekly'>('daily');
  const [showTriggerConfirm, setShowTriggerConfirm] = useState(false);
  const createTask = useCreateTask();

  const dreams = data?.dreams || [];

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setViewFormat(undefined); // 重置为默认格式
  };

  const handleTrigger = () => {
    setShowTriggerConfirm(false);
    createTask.mutate(
      { type: 'dream-trigger', label: `触发 ${triggerMode} Dream`, params: { mode: triggerMode } },
      {
        onSuccess: () => {
          toast.success('Dream 已加入后台任务', {
            description: '完成后会自动通知你，可在右下角任务面板查看进度',
          });
        },
        onError: (err) => {
          toast.error('Dream 触发失败', { description: String(err) });
        },
      }
    );
  };

  // 当前选中 dream 拥有的格式（从列表数据或详情数据获取）
  const selectedDream = dreams.find((d) => d.id === selectedId);
  const availableFormats = detail?.formats || selectedDream?.formats || [];
  const currentFormat = detail?.type || viewFormat || 'md';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dream 管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            查看做梦历史、手动触发
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={triggerMode}
            onChange={(e) => setTriggerMode(e.target.value as any)}
            className="rounded-lg border border-border/60 bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <button
            onClick={() => setShowTriggerConfirm(true)}
            disabled={createTask.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-apple transition-all hover:shadow-apple-md active:scale-[0.98] disabled:opacity-50"
          >
            {createTask.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {createTask.isPending ? '提交中…' : '触发 Dream'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-destructive/5 p-6 text-center text-sm text-destructive">
          无法加载 Dream 历史
        </div>
      ) : (
        <div className="flex gap-6">
          {/* 列表 */}
          <div className="w-72 flex-shrink-0 space-y-2">
            {dreams.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Moon className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">暂无 Dream 记录</p>
                <p className="mt-1 text-xs">请确认 MiniMem data_dir 路径正确</p>
              </div>
            ) : (
              dreams.map((dream) => (
                <button
                  key={dream.id}
                  onClick={() => handleSelect(dream.id)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-xl bg-card p-3.5 shadow-apple text-left transition-all hover:shadow-apple-md',
                    selectedId === dream.id && 'ring-2 ring-primary/30'
                  )}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 flex-shrink-0">
                    <Moon className="h-4 w-4 text-indigo-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{dream.id}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">
                        {dream.date.length > 10
                          ? dream.date.slice(0, 16) /* YYYY-MM-DD HH:mm */
                          : dream.date}
                      </span>
                      {/* 显示拥有的格式标签 */}
                      {(dream.formats || []).map((fmt) => (
                        <span
                          key={fmt}
                          className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground/70 uppercase"
                        >
                          {fmt}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* 详情 */}
          <div className="flex-1 min-w-0">
            {selectedId ? (
              detailLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : detail ? (
                <div className="rounded-2xl bg-card p-6 shadow-apple">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">{detail.id}</h2>
                    {/* 格式切换 Tab（仅当有多种格式时显示） */}
                    {availableFormats.length > 1 && (
                      <div className="flex items-center rounded-lg bg-muted/50 p-0.5">
                        {availableFormats.includes('md') && (
                          <button
                            onClick={() => setViewFormat('md')}
                            className={cn(
                              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                              currentFormat === 'md'
                                ? 'bg-card text-foreground shadow-apple'
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <FileText className="h-3 w-3" />
                            Markdown
                          </button>
                        )}
                        {availableFormats.includes('json') && (
                          <button
                            onClick={() => setViewFormat('json')}
                            className={cn(
                              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                              currentFormat === 'json'
                                ? 'bg-card text-foreground shadow-apple'
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <Code2 className="h-3 w-3" />
                            JSON
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {detail.type === 'md' ? (
                    <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90 prose-a:text-primary hover:prose-a:text-primary/80 prose-code:text-foreground prose-code:bg-muted prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted/50 prose-pre:rounded-xl prose-blockquote:border-primary/30 prose-blockquote:text-muted-foreground prose-hr:border-border prose-th:text-foreground prose-td:text-foreground/80">
                      <ReactMarkdown>{detail.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <pre className="text-xs bg-muted/30 rounded-xl p-4 overflow-auto max-h-[70vh]">
                      {detail.content}
                    </pre>
                  )}
                </div>
              ) : (
                <div className="text-center text-sm text-muted-foreground py-20">
                  报告不存在
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Moon className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">选择一个 Dream 查看详情</p>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showTriggerConfirm}
        title="触发 Dream"
        description={`确认触发 ${triggerMode} Dream？引擎将开始整理和审计记忆。`}
        confirmText="触发"
        onConfirm={handleTrigger}
        onCancel={() => setShowTriggerConfirm(false)}
      />
    </div>
  );
}
