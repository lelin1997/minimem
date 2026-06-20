import { useState } from 'react';
import { Moon, Clock, Activity, Sparkles, GitBranch, FileText, AlertTriangle, ChevronRight } from 'lucide-react';
import { useDreamSessions, useDreamReplay, type DreamReplayPhase } from '@/api/minimem';
import { cn } from '@/lib/utils';

const PHASE_LABELS: Record<number, string> = {
  1: 'Consolidation 提炼',
  2: 'Compile 编译',
  2.5: 'Surface 同步',
  3: 'Dream 联想',
  3.5: 'Inspiration 灵感',
  4: '总结',
};

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return 'bg-emerald-500/15 text-emerald-600';
    case 'B': return 'bg-blue-500/15 text-blue-600';
    case 'C': return 'bg-amber-500/15 text-amber-600';
    case 'D': return 'bg-orange-500/15 text-orange-600';
    case 'F': return 'bg-red-500/15 text-red-600';
    default: return 'bg-muted text-muted-foreground';
  }
}

function PhaseCard({ phase }: { phase: DreamReplayPhase }) {
  const [expanded, setExpanded] = useState(phase.phase === 3 || phase.phase === 2.5);
  const label = PHASE_LABELS[phase.phase] ?? `Phase ${phase.phase}`;
  const hasProcess = phase.process.seeds.length > 0 ||
    phase.process.pairs.length > 0 ||
    phase.process.llm_output ||
    phase.process.surface_changes.length > 0;

  return (
    <div className="relative pl-8">
      {/* 时间轴节点 */}
      <div className="absolute left-0 top-1.5 flex h-4 w-4 items-center justify-center">
        <div className="h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-primary/10" />
      </div>
      <div className="absolute left-[7px] top-6 bottom-0 w-px bg-border/60 last:hidden" />

      <div className="mb-6 rounded-xl bg-card p-4 shadow-apple">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-[11px] text-muted-foreground">Phase {phase.phase}</span>
            {phase.quality && (
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', gradeColor(phase.quality.grade))}>
                {phase.quality.grade} · {(phase.quality.score * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {(phase.duration_ms / 1000).toFixed(1)}s
            </span>
            {hasProcess && <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-90')} />}
          </div>
        </button>

        {expanded && hasProcess && (
          <div className="mt-3 space-y-3 border-t border-border/40 pt-3">
            {/* 种子 */}
            {phase.process.seeds.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Sparkles className="h-3 w-3" /> 种子记忆 ({phase.process.seeds.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {phase.process.seeds.map((s, i) => (
                    <span key={i} className="rounded-md bg-indigo-500/10 px-2 py-1 text-[11px] text-indigo-600">
                      {s.content?.slice(0, 40) ?? s.id ?? `seed-${i}`}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 配对 */}
            {phase.process.pairs.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <GitBranch className="h-3 w-3" /> 记忆配对 ({phase.process.pairs.length})
                </p>
                <div className="space-y-1">
                  {phase.process.pairs.map((p, i) => (
                    <div key={i} className="rounded-md bg-muted/40 px-2 py-1 text-[11px]">
                      <span className="font-medium">{p.a}</span>
                      <span className="mx-1 text-muted-foreground">↔</span>
                      <span className="font-medium">{p.b}</span>
                      {p.reason && <span className="ml-2 text-muted-foreground">({p.reason})</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* LLM 联想输出 */}
            {phase.process.llm_output && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Activity className="h-3 w-3" /> LLM 联想输出
                </p>
                <p className="rounded-md bg-muted/30 p-2 text-xs text-foreground/80 whitespace-pre-wrap">
                  {phase.process.llm_output}
                </p>
              </div>
            )}

            {/* Surface 变更 */}
            {phase.process.surface_changes.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <FileText className="h-3 w-3" /> Surface 文件变更 ({phase.process.surface_changes.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {phase.process.surface_changes.map((c, i) => (
                    <span key={i} className={cn(
                      'rounded-md px-2 py-1 text-[11px]',
                      c.changed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'
                    )}>
                      {c.file_name} {c.changed ? '✓' : '—'}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 产出统计 */}
            {(phase.process.new_connections > 0 || phase.process.insights_count > 0) && (
              <div className="flex gap-4 text-[11px]">
                {phase.process.new_connections > 0 && (
                  <span className="text-muted-foreground">新连接: <span className="font-medium text-foreground">{phase.process.new_connections}</span></span>
                )}
                {phase.process.insights_count > 0 && (
                  <span className="text-muted-foreground">产出: <span className="font-medium text-foreground">{phase.process.insights_count}</span></span>
                )}
                {phase.process.conflicts_count > 0 && (
                  <span className="text-muted-foreground">冲突: <span className="font-medium text-red-500">{phase.process.conflicts_count}</span></span>
                )}
              </div>
            )}

            {/* 质量因子 */}
            {phase.quality && Object.keys(phase.quality.factors).length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">质量因子</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(phase.quality.factors).map(([k, v]) => (
                    <span key={k} className="text-[11px] text-muted-foreground">
                      {k}: <span className={cn('font-medium', v >= 0 ? 'text-emerald-600' : 'text-red-500')}>{v.toFixed(2)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {expanded && !hasProcess && phase.narrative && (
          <p className="mt-3 border-t border-border/40 pt-3 text-xs text-foreground/70 whitespace-pre-wrap">
            {phase.narrative}
          </p>
        )}
      </div>
    </div>
  );
}

export default function DreamReplay() {
  const { data, isLoading, error } = useDreamSessions();
  const [selectedId, setSelectedId] = useState('');
  const { data: replay, isLoading: replayLoading } = useDreamReplay(selectedId);

  const sessions = data?.sessions ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">梦境回放</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          按 session 查看 dream 完整过程：种子 → 配对 → LLM 联想 → 产出
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-destructive/5 p-6 text-center text-sm text-destructive">
          无法加载 Dream session 列表
        </div>
      ) : (
        <div className="flex gap-6">
          {/* session 列表 */}
          <div className="w-80 flex-shrink-0 space-y-2 max-h-[75vh] overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Moon className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">暂无 Dream session</p>
              </div>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.session_id}
                  onClick={() => setSelectedId(s.session_id)}
                  className={cn(
                    'w-full rounded-xl bg-card p-3.5 shadow-apple text-left transition-all hover:shadow-apple-md',
                    selectedId === s.session_id && 'ring-2 ring-primary/30'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">{s.session_id.slice(0, 12)}…</p>
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', gradeColor(s.quality_grade))}>
                      {s.quality_grade}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {s.started_at?.slice(0, 16)}
                  </div>
                  <div className="mt-1.5 flex gap-3 text-[11px] text-muted-foreground">
                    <span>L1→L2: {s.consolidation.l1_to_l2}</span>
                    <span>页: {s.pages.created}</span>
                    <span>连接: {s.process_stats.new_connections}</span>
                  </div>
                  {s.is_low_quality && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-red-500">
                      <AlertTriangle className="h-3 w-3" /> 低质量
                    </p>
                  )}
                </button>
              ))
            )}
          </div>

          {/* 回放时间轴 */}
          <div className="flex-1 min-w-0">
            {selectedId ? (
              replayLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : replay ? (
                <div className="rounded-2xl bg-card p-6 shadow-apple">
                  <div className="mb-5 flex items-center justify-between border-b border-border/40 pb-4">
                    <div>
                      <h2 className="text-base font-semibold">{replay.session_id}</h2>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {replay.phases.length} 个阶段 · 总耗时 {replay.phases.reduce((a, p) => a + p.duration_ms, 0)}ms
                      </p>
                    </div>
                  </div>
                  <div>
                    {replay.phases.map((p, i) => (
                      <PhaseCard key={i} phase={p} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-sm text-muted-foreground py-20">
                  回放数据不存在
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Moon className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">选择一个 Dream session 查看回放</p>
                <p className="mt-1 text-xs">展示种子选择 → 记忆配对 → LLM 联想 → 知识产出的完整过程</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
