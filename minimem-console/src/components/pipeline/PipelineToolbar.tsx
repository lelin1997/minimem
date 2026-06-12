import { useState, useRef } from 'react';
import {
  Save, Play, ChevronLeft, Clock, Settings2, Variable, Power, PowerOff,
  FlaskConical, Download, Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface PipelineToolbarProps {
  name: string;
  enabled: boolean;
  scheduleType: string;
  scheduleCron: string;
  variables: Record<string, string>;
  isSaving: boolean;
  isRunning: boolean;
  hasChanges: boolean;
  pipelineId?: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onRun: () => void;
  onDryRun?: () => void;
  onToggle: () => void;
  onBack: () => void;
  onScheduleChange: (type: string, cron: string) => void;
  onVariablesChange: (vars: Record<string, string>) => void;
  onImport?: (data: any) => void;
}

export function PipelineToolbar({
  name,
  enabled,
  scheduleType,
  scheduleCron,
  variables,
  isSaving,
  isRunning,
  hasChanges,
  pipelineId,
  onNameChange,
  onSave,
  onRun,
  onDryRun,
  onToggle,
  onBack,
  onScheduleChange,
  onVariablesChange,
  onImport,
}: PipelineToolbarProps) {
  const [showCron, setShowCron] = useState(false);
  const [showVars, setShowVars] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 导出
  const handleExport = async () => {
    if (!pipelineId || pipelineId === 'new') return;
    try {
      const resp = await fetch(`/api/pipelines/${pipelineId}/export`);
      const data = await resp.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pipeline-${name.replace(/\s+/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  // 导入
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        onImport?.(data);
      } catch {}
    };
    reader.readAsText(file);
    e.target.value = ''; // reset
  };

  return (
    <div className="flex items-center gap-3 border-b border-border/60 bg-card/80 px-4 py-2.5">
      {/* 返回 */}
      <button
        onClick={onBack}
        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="返回列表"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* Pipeline 名称 */}
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-sm font-semibold text-foreground focus:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
      />

      {hasChanges && (
        <span className="h-2 w-2 rounded-full bg-amber-400" title="有未保存的更改" />
      )}

      {/* 启停状态 */}
      <button
        onClick={onToggle}
        className={cn(
          'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors',
          enabled
            ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400'
            : 'bg-muted text-muted-foreground hover:bg-muted/80',
        )}
        title={enabled ? '已启用' : '已禁用'}
      >
        {enabled ? (
          <Power className="h-3 w-3" strokeWidth={2} />
        ) : (
          <PowerOff className="h-3 w-3" strokeWidth={2} />
        )}
        {enabled ? '已启用' : '已禁用'}
      </button>

      {/* 调度设置 */}
      <div className="relative">
        <button
          onClick={() => { setShowCron(!showCron); setShowVars(false); }}
          className={cn(
            'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            'border border-border/60 bg-card hover:bg-muted',
            showCron && 'bg-muted ring-1 ring-primary/20',
          )}
        >
          <Clock className="h-3 w-3" strokeWidth={1.8} />
          {scheduleType === 'cron' ? scheduleCron || 'Cron' : '手动'}
        </button>
        {showCron && (
          <CronEditor
            type={scheduleType}
            cron={scheduleCron}
            onChange={onScheduleChange}
            onClose={() => setShowCron(false)}
          />
        )}
      </div>

      {/* 变量 */}
      <div className="relative">
        <button
          onClick={() => { setShowVars(!showVars); setShowCron(false); }}
          className={cn(
            'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            'border border-border/60 bg-card hover:bg-muted',
            showVars && 'bg-muted ring-1 ring-primary/20',
          )}
        >
          <Variable className="h-3 w-3" strokeWidth={1.8} />
          变量 ({Object.keys(variables).length})
        </button>
        {showVars && (
          <VariableEditor
            variables={variables}
            onChange={onVariablesChange}
            onClose={() => setShowVars(false)}
          />
        )}
      </div>

      {/* 导入/导出 */}
      <div className="flex items-center gap-1">
        <button
          onClick={handleExport}
          disabled={!pipelineId || pipelineId === 'new'}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          title="导出 JSON"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="导入 JSON"
        >
          <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImportFile}
          className="hidden"
        />
      </div>

      <div className="h-5 w-px bg-border/60" />

      {/* 保存 */}
      <button
        onClick={onSave}
        disabled={isSaving}
        className={cn(
          'flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium transition-all',
          'border border-border/60 bg-card shadow-apple hover:shadow-apple-md',
          isSaving && 'opacity-60',
        )}
      >
        <Save className="h-3.5 w-3.5" strokeWidth={1.8} />
        {isSaving ? '保存中...' : '保存'}
      </button>

      {/* Dry-run */}
      {onDryRun && (
        <button
          onClick={onDryRun}
          disabled={isRunning}
          className={cn(
            'flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all',
            'border border-amber-300/40 bg-amber-50 text-amber-700 hover:bg-amber-100',
            'dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400',
            isRunning && 'opacity-60',
          )}
          title="试运行：验证流程但不执行输出"
        >
          <FlaskConical className="h-3.5 w-3.5" strokeWidth={1.8} />
          试运行
        </button>
      )}

      {/* 运行 */}
      <button
        onClick={onRun}
        disabled={isRunning}
        className={cn(
          'flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-apple transition-all hover:shadow-apple-md active:scale-[0.98]',
          isRunning && 'opacity-60',
        )}
      >
        <Play className="h-3.5 w-3.5" strokeWidth={2} />
        {isRunning ? '运行中...' : '运行'}
      </button>
    </div>
  );
}

// ── Cron 编辑器 ──

function CronEditor({
  type,
  cron,
  onChange,
  onClose,
}: {
  type: string;
  cron: string;
  onChange: (type: string, cron: string) => void;
  onClose: () => void;
}) {
  const PRESETS = [
    { label: '每天 8:00', value: '0 8 * * *' },
    { label: '每天 0:00', value: '0 0 * * *' },
    { label: '每小时', value: '0 * * * *' },
    { label: '每周一 9:00', value: '0 9 * * 1' },
    { label: '工作日 9:00', value: '0 9 * * 1-5' },
  ];

  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-border/60 bg-card p-4 shadow-apple-lg">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold">调度设置</span>
        <button onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">
          关闭
        </button>
      </div>

      <div className="mb-3 flex gap-2">
        <button
          onClick={() => onChange('manual', '')}
          className={cn(
            'rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors',
            type === 'manual' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          手动
        </button>
        <button
          onClick={() => onChange('cron', cron || '0 8 * * *')}
          className={cn(
            'rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors',
            type === 'cron' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          定时
        </button>
      </div>

      {type === 'cron' && (
        <>
          <input
            type="text"
            value={cron}
            onChange={(e) => onChange('cron', e.target.value)}
            placeholder="Cron 表达式"
            className="mb-2 w-full rounded-lg border border-border/60 bg-background px-3 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => onChange('cron', p.value)}
                className={cn(
                  'rounded-md px-2 py-1 text-[10px] transition-colors',
                  cron === p.value
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[9px] text-muted-foreground">
            格式：分 时 日 月 星期 · {describeCron(cron)}
          </p>
        </>
      )}
    </div>
  );
}

function describeCron(cron: string): string {
  if (!cron) return '';
  const map: Record<string, string> = {
    '0 8 * * *': '每天 08:00',
    '0 0 * * *': '每天 00:00',
    '0 * * * *': '每小时整点',
    '0 9 * * 1': '每周一 09:00',
    '0 9 * * 1-5': '工作日 09:00',
  };
  return map[cron] || '';
}

// ── 变量编辑器 ──

function VariableEditor({
  variables,
  onChange,
  onClose,
}: {
  variables: Record<string, string>;
  onChange: (vars: Record<string, string>) => void;
  onClose: () => void;
}) {
  const entries = Object.entries(variables);

  const updateKey = (oldKey: string, newKey: string) => {
    const next = { ...variables };
    const val = next[oldKey];
    delete next[oldKey];
    next[newKey] = val;
    onChange(next);
  };

  const updateValue = (key: string, value: string) => {
    onChange({ ...variables, [key]: value });
  };

  const addVar = () => {
    onChange({ ...variables, [`var_${Date.now()}`]: '' });
  };

  const removeVar = (key: string) => {
    const next = { ...variables };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-xl border border-border/60 bg-card p-4 shadow-apple-lg">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold">全局变量</span>
        <button onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">
          关闭
        </button>
      </div>

      <div className="max-h-60 space-y-2 overflow-y-auto">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-center gap-1.5">
            <input
              type="text"
              value={key}
              onChange={(e) => updateKey(key, e.target.value)}
              className="w-24 rounded-md border border-border/60 bg-background px-2 py-1 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30"
              placeholder="key"
            />
            <span className="text-[10px] text-muted-foreground">=</span>
            <input
              type="text"
              value={val}
              onChange={(e) => updateValue(key, e.target.value)}
              className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30"
              placeholder="value"
            />
            <button
              onClick={() => removeVar(key)}
              className="rounded p-0.5 text-muted-foreground hover:text-destructive"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addVar}
        className="mt-2 w-full rounded-lg bg-muted py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        + 添加变量
      </button>
      <p className="mt-2 text-[9px] text-muted-foreground">
        通过 {'{{vars.key_name}}'} 在模板中引用
      </p>
    </div>
  );
}
