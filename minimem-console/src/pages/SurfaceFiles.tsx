import { FileText, Eye, AlertTriangle } from 'lucide-react';
import { useSurfaceFiles } from '@/api/minimem';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

/** 标准 Surface Files — 与 MiniMem 引擎实际输出的 key 对齐 */
const SURFACE_FILES = [
  'me.md', 'soul.md', 'work.md', 'social.md', 'life.md',
  'agent.md', 'context.md', 'index.md',
];

const TOKEN_BUDGET = 10000;

/** 每个 Surface File 的默认 token 预算（总预算 / 文件数 ≈ 1111，取整 1200 留余量） */
const PER_FILE_BUDGET = 1200;

export default function SurfaceFiles() {
  const { data, isLoading } = useSurfaceFiles();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const surfaces = data?.surfaces || [];
  const totalTokens = surfaces.reduce((sum, s) => sum + (s.tokens || 0), 0);
  const selected = surfaces.find((s) => s.file === selectedFile);

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Surface Files</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Agent 眼中的「你」— 8 个结构化上下文文件
        </p>
      </div>

      {/* Token 预算进度条 */}
      <div className="rounded-2xl bg-card p-5 shadow-apple">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Token 使用
          </span>
          <span className="text-xs text-muted-foreground">
            {totalTokens.toLocaleString()} / {TOKEN_BUDGET.toLocaleString()}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              totalTokens / TOKEN_BUDGET > 0.9 ? 'bg-red-400' :
              totalTokens / TOKEN_BUDGET > 0.7 ? 'bg-amber-400' : 'bg-primary'
            )}
            style={{ width: `${Math.min((totalTokens / TOKEN_BUDGET) * 100, 100)}%` }}
          />
        </div>
      </div>

      <div className="flex gap-6">
        {/* 文件列表 */}
        <div className="w-72 flex-shrink-0 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            SURFACE_FILES.map((file) => {
              const surface = surfaces.find((s) => s.file === file);
              const tokens = surface?.tokens || 0;
              const budget = surface?.budget || PER_FILE_BUDGET;
              const overBudget = tokens > budget;
              const isActive = selectedFile === file;

              return (
                <button
                  key={file}
                  onClick={() => setSelectedFile(file)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all duration-200',
                    isActive
                      ? 'bg-primary/10 shadow-apple'
                      : overBudget
                        ? 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/30'
                        : 'hover:bg-muted/50'
                  )}
                >
                  {overBudget ? (
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" strokeWidth={1.8} />
                  ) : (
                    <FileText
                      className={cn(
                        'h-4 w-4 flex-shrink-0',
                        isActive ? 'text-primary' : 'text-muted-foreground'
                      )}
                      strokeWidth={1.8}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      'text-[13px] font-medium',
                      overBudget ? 'text-red-600 dark:text-red-400' :
                      isActive ? 'text-primary' : 'text-foreground'
                    )}>
                      {file}
                    </p>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className={overBudget ? 'text-red-500 font-medium' : ''}>
                        {tokens > 0 ? `${tokens}` : '—'} / {budget}
                      </span>
                      {surface?.version != null && (
                        <span className="text-muted-foreground/60">· v{surface.version}</span>
                      )}
                    </div>
                  </div>
                  {tokens > 0 && (
                    <div className="h-1 w-12 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          overBudget ? 'bg-red-400' : 'bg-primary/40'
                        )}
                        style={{ width: `${Math.min((tokens / budget) * 100, 100)}%` }}
                      />
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* 预览面板 */}
        <div className="flex-1">
          {selected ? (
            <div className="rounded-2xl bg-card p-6 shadow-apple">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                  <h2 className="text-sm font-semibold">{selected.file}</h2>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  {selected.version != null && <span>v{selected.version}</span>}
                  {selected.tokens != null && (
                    <span className={
                      (selected.tokens || 0) > (selected.budget || PER_FILE_BUDGET)
                        ? 'text-red-500 font-medium'
                        : ''
                    }>
                      {selected.tokens} / {selected.budget || PER_FILE_BUDGET} tokens
                    </span>
                  )}
                  {selected.updated_at && (
                    <span>{new Date(selected.updated_at).toLocaleDateString('zh-CN')}</span>
                  )}
                </div>
              </div>
              {(selected.tokens || 0) > (selected.budget || PER_FILE_BUDGET) && (
                <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" strokeWidth={1.8} />
                  <span className="text-xs text-red-600 dark:text-red-400">
                    超出预算 {(selected.tokens || 0) - (selected.budget || PER_FILE_BUDGET)} tokens，
                    建议精简内容
                  </span>
                </div>
              )}
              <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90 prose-a:text-primary hover:prose-a:text-primary/80 prose-code:text-foreground prose-code:bg-muted prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted/50 prose-pre:rounded-xl prose-blockquote:border-primary/30 prose-blockquote:text-muted-foreground prose-hr:border-border prose-th:text-foreground prose-td:text-foreground/80">
                <ReactMarkdown>{selected.content}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-2xl bg-muted/30 py-32">
              <p className="text-sm text-muted-foreground">选择一个文件查看预览</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
