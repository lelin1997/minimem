import { useState } from 'react';
import { ChevronDown, Search, GripVertical } from 'lucide-react';
import {
  Search as SearchIcon, List, User, FileText, Activity, Bot, Braces,
  Filter, ArrowUpDown, Merge, FileCode, FileOutput, Monitor,
  Brain, Webhook, GitBranch, Repeat, Moon, PenTool, Type, Box, Rss,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NodeType } from '@/api/pipeline';

const ICON_MAP: Record<string, React.ElementType> = {
  search: SearchIcon,
  list: List,
  user: User,
  'file-text': FileText,
  activity: Activity,
  bot: Bot,
  braces: Braces,
  filter: Filter,
  'arrow-up-down': ArrowUpDown,
  merge: Merge,
  'file-code': FileCode,
  'file-output': FileOutput,
  monitor: Monitor,
  brain: Brain,
  webhook: Webhook,
  'git-branch': GitBranch,
  repeat: Repeat,
  moon: Moon,
  'pen-tool': PenTool,
  text: Type,
  box: Box,
  rss: Rss,
};

const CATEGORIES: { key: string; label: string; color: string }[] = [
  { key: 'source', label: '数据源', color: '#3B82F6' },
  { key: 'transform', label: '转换', color: '#8B5CF6' },
  { key: 'ai', label: 'AI', color: '#F59E0B' },
  { key: 'output', label: '输出', color: '#10B981' },
  { key: 'control', label: '控制流', color: '#EF4444' },
  { key: 'action', label: '操作', color: '#6366F1' },
];

interface NodePaletteProps {
  nodeTypes: NodeType[];
}

export function NodePalette({ nodeTypes }: NodePaletteProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    source: true,
    transform: true,
    ai: true,
    output: true,
    control: false,
    action: false,
  });
  const [search, setSearch] = useState('');

  const filtered = search
    ? nodeTypes.filter(
        (nt) =>
          nt.label.toLowerCase().includes(search.toLowerCase()) ||
          nt.type.toLowerCase().includes(search.toLowerCase()) ||
          nt.description.toLowerCase().includes(search.toLowerCase()),
      )
    : nodeTypes;

  const byCategory = CATEGORIES.map((cat) => ({
    ...cat,
    types: filtered.filter((nt) => nt.category === cat.key),
  }));

  const handleDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('application/pipeline-node-type', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex h-full w-56 flex-col border-r border-border/60 bg-card/50">
      {/* 搜索 */}
      <div className="border-b border-border/40 p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索节点..."
            className="w-full rounded-lg border border-border/60 bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* 分类列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {byCategory.map((cat) => {
          if (cat.types.length === 0) return null;
          const isOpen = search ? true : expanded[cat.key];

          return (
            <div key={cat.key} className="mb-1">
              <button
                onClick={() =>
                  setExpanded((p) => ({ ...p, [cat.key]: !p[cat.key] }))
                }
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
              >
                <ChevronDown
                  className={cn(
                    'h-3 w-3 text-muted-foreground transition-transform',
                    !isOpen && '-rotate-90',
                  )}
                />
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="text-[11px] font-medium text-foreground">
                  {cat.label}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {cat.types.length}
                </span>
              </button>

              {isOpen && (
                <div className="ml-2 mt-0.5 space-y-0.5">
                  {cat.types.map((nt) => {
                    const Icon = ICON_MAP[nt.icon] || Box;
                    return (
                      <div
                        key={nt.type}
                        draggable
                        onDragStart={(e) => handleDragStart(e, nt.type)}
                        className="group flex cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60 active:cursor-grabbing"
                        title={nt.description}
                      >
                        <GripVertical className="h-3 w-3 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground" />
                        <Icon
                          className="h-3.5 w-3.5 flex-shrink-0"
                          style={{ color: nt.color }}
                          strokeWidth={1.8}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium text-foreground">
                            {nt.label}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
