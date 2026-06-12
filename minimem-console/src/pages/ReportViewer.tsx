import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, FileText, Calendar } from 'lucide-react';
import { useRunOutputs } from '@/api/pipeline';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';

export default function ReportViewer() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useRunOutputs(runId!);

  const outputs = data?.outputs || [];

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">报告查看</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            运行 ID: {runId}
          </p>
        </div>
      </div>

      {/* 内容 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : outputs.length > 0 ? (
        <div className="space-y-6">
          {outputs.map((out) => (
            <div
              key={out.node_id}
              className="rounded-2xl bg-card p-6 shadow-apple"
            >
              <div className="mb-4 flex items-center gap-3">
                <FileText className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                <h2 className="text-sm font-semibold text-foreground">
                  {out.node_label}
                </h2>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {out.type}
                </span>
                {out.file_path && (
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    📂 {out.file_path}
                  </span>
                )}
              </div>
              <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90 prose-a:text-primary hover:prose-a:text-primary/80 prose-code:text-foreground prose-code:bg-muted prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted/50 prose-pre:rounded-xl prose-blockquote:border-primary/30 prose-blockquote:text-muted-foreground prose-hr:border-border">
                <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                  {out.full_content || out.preview}
                </ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-muted/30 py-24">
          <FileText className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground">暂无报告内容</p>
          <p className="mt-1 text-xs text-muted-foreground">
            此次运行没有产生输出
          </p>
        </div>
      )}
    </div>
  );
}
