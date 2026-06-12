/**
 * 增强版 Prompt 编辑器
 * - 变量自动补全（{{nodes.*}} / {{vars.*}} / {{$*}}）
 * - 实时预览面板（渲染 Handlebars 模板）
 * - 语法高亮提示（高亮 {{ }} 片段）
 * - 行号 + 自适应高度
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Eye, EyeOff, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  /** 上游节点 IDs（用于变量补全提示） */
  upstreamNodeIds?: string[];
  /** 全局变量 keys */
  variableKeys?: string[];
  minRows?: number;
  maxRows?: number;
}

// 内置变量
const BUILTIN_VARS = ['$date', '$time', '$datetime', '$run_id', '$trigger', '$pipeline_name', '$date_offset'];

export function PromptEditor({
  value,
  onChange,
  label,
  placeholder = '输入 Prompt 模板...\n支持 {{nodes.node_id.output}} / {{vars.key}} / {{$date}} 等模板变量',
  upstreamNodeIds = [],
  variableKeys = [],
  minRows = 6,
  maxRows = 20,
}: PromptEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 构建所有可用变量
  const allVariables = useMemo(() => {
    const vars: string[] = [];
    for (const id of upstreamNodeIds) {
      vars.push(`nodes.${id}.output`);
      vars.push(`${id}`);
    }
    for (const key of variableKeys) {
      vars.push(`vars.${key}`);
    }
    vars.push(...BUILTIN_VARS);
    return vars;
  }, [upstreamNodeIds, variableKeys]);

  // 检查是否在 {{ }} 内部 + 提取前缀
  const checkCompletion = useCallback(
    (text: string, pos: number) => {
      // 从 pos 向前找 {{
      const before = text.slice(0, pos);
      const lastOpen = before.lastIndexOf('{{');
      const lastClose = before.lastIndexOf('}}');

      if (lastOpen > lastClose) {
        // 在 {{ ... 内部
        const prefix = before.slice(lastOpen + 2).trim();
        const filtered = allVariables.filter((v) =>
          v.toLowerCase().includes(prefix.toLowerCase()),
        );
        if (filtered.length > 0) {
          setSuggestions(filtered.slice(0, 8));
          setSelectedSuggestion(0);
          setShowSuggestions(true);
          return;
        }
      }
      setShowSuggestions(false);
    },
    [allVariables],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      const pos = e.target.selectionStart || 0;
      onChange(val);
      setCursorPos(pos);
      checkCompletion(val, pos);
    },
    [onChange, checkCompletion],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showSuggestions) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestion((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (suggestions.length > 0) {
          e.preventDefault();
          applySuggestion(suggestions[selectedSuggestion]);
        }
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
    },
    [showSuggestions, suggestions, selectedSuggestion],
  );

  const applySuggestion = useCallback(
    (suggestion: string) => {
      if (!textareaRef.current) return;
      const ta = textareaRef.current;
      const text = ta.value;
      const pos = ta.selectionStart || 0;

      // 找到 {{ 的位置
      const before = text.slice(0, pos);
      const lastOpen = before.lastIndexOf('{{');
      const after = text.slice(pos);

      // 检查后方是否已有 }}
      const hasClose = after.startsWith('}}');
      const newText =
        text.slice(0, lastOpen) +
        `{{${suggestion}}}` +
        (hasClose ? after.slice(2) : after);

      onChange(newText);
      setShowSuggestions(false);

      // 移动光标
      setTimeout(() => {
        const newPos = lastOpen + suggestion.length + 4; // {{ + suggestion + }}
        ta.selectionStart = newPos;
        ta.selectionEnd = newPos;
        ta.focus();
      }, 0);
    },
    [onChange],
  );

  // 高亮预览
  const highlightedHTML = useMemo(() => {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(
        /(\{\{[^}]*\}\})/g,
        '<span class="text-primary font-medium bg-primary/10 rounded px-0.5">$1</span>',
      );
  }, [value]);

  // 模拟渲染预览
  const previewText = useMemo(() => {
    let preview = value;
    // 替换 {{nodes.xxx}} → [节点输出: xxx]
    preview = preview.replace(/\{\{nodes\.([^}]+)\}\}/g, '[节点输出: $1]');
    preview = preview.replace(/\{\{vars\.([^}]+)\}\}/g, '[变量: $1]');
    preview = preview.replace(/\{\{\$date\}\}/g, new Date().toISOString().slice(0, 10));
    preview = preview.replace(/\{\{\$time\}\}/g, new Date().toTimeString().slice(0, 8));
    preview = preview.replace(/\{\{\$datetime\}\}/g, new Date().toISOString());
    preview = preview.replace(/\{\{([^}]+)\}\}/g, '[$1]');
    return preview;
  }, [value]);

  // 计算行数
  const rows = Math.max(minRows, Math.min(maxRows, value.split('\n').length + 1));

  return (
    <div className="space-y-2">
      {/* 标题 + 工具 */}
      <div className="flex items-center justify-between">
        {label && (
          <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-muted-foreground/50">
            {value.length} 字符 · {value.split('\n').length} 行
          </span>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={cn(
              'rounded-md p-1 transition-colors',
              showPreview
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground/50 hover:text-muted-foreground',
            )}
            title={showPreview ? '隐藏预览' : '实时预览'}
          >
            {showPreview ? (
              <EyeOff className="h-3 w-3" strokeWidth={1.8} />
            ) : (
              <Eye className="h-3 w-3" strokeWidth={1.8} />
            )}
          </button>
        </div>
      </div>

      {/* 编辑区域 */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          rows={rows}
          placeholder={placeholder}
          spellCheck={false}
          className={cn(
            'w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2',
            'font-mono text-xs leading-relaxed',
            'focus:outline-none focus:ring-1 focus:ring-primary/30',
            'placeholder:text-muted-foreground/40',
          )}
        />

        {/* 变量补全下拉 */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-4 z-50 mt-0 max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-card shadow-apple-lg"
            style={{ top: `${Math.min((cursorPos / (value.length || 1)) * 100, 80)}%` }}
          >
            {suggestions.map((s, i) => (
              <button
                key={s}
                onMouseDown={() => applySuggestion(s)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors',
                  i === selectedSuggestion
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-muted',
                )}
              >
                <Wand2 className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                <code className="font-mono">{`{{${s}}}`}</code>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 预览面板 */}
      {showPreview && (
        <div className="rounded-lg border border-border/40 bg-muted/30 p-3">
          <p className="mb-2 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/50">
            渲染预览
          </p>
          <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
            {previewText || '(空)'}
          </pre>
        </div>
      )}
    </div>
  );
}
