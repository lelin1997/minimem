import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import {
  Search, List, User, FileText, Activity, Bot, Braces,
  Filter, ArrowUpDown, Merge, FileCode, FileOutput, Monitor,
  Brain, Webhook, GitBranch, Repeat, Moon, PenTool, Type, Box, Rss,
} from 'lucide-react';
import type { PortDef } from '@/api/pipeline';

const ICON_MAP: Record<string, React.ElementType> = {
  search: Search,
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

const CATEGORY_LABEL: Record<string, string> = {
  source: '数据源',
  transform: '转换',
  ai: 'AI',
  output: '输出',
  control: '控制流',
  action: '操作',
};

interface CustomNodeData {
  label: string;
  nodeType: string;
  category: string;
  color: string;
  icon: string;
  inputs: PortDef[];
  outputs: PortDef[];
  config: Record<string, unknown>;
  [key: string]: unknown;
}

export const CustomNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as CustomNodeData;
  const label = nodeData?.label || '未命名';
  const category = nodeData?.category || 'source';
  const color = nodeData?.color || '#6B7280';
  const icon = nodeData?.icon || 'box';
  const inputs = nodeData?.inputs || [];
  const outputs = nodeData?.outputs || [];
  const Icon = ICON_MAP[icon] || Box;

  return (
    <div
      className={`
        group relative rounded-xl border bg-card shadow-apple transition-all duration-200
        ${selected ? 'shadow-apple-md ring-2 ring-primary/30' : 'hover:shadow-apple-md'}
      `}
      style={{
        borderColor: selected ? color : 'hsl(var(--border))',
        minWidth: 180,
      }}
    >
      {/* 输入端口 */}
      {inputs.map((port, i) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{
            top: `${((i + 1) / (inputs.length + 1)) * 100}%`,
            background: 'hsl(var(--card))',
            border: `2px solid ${color}`,
            width: 10,
            height: 10,
          }}
          title={port.label}
        />
      ))}

      {/* 节点头部 */}
      <div
        className="flex items-center gap-2 rounded-t-xl px-3 py-2"
        style={{ backgroundColor: `${color}12` }}
      >
        <div
          className="flex h-6 w-6 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color }} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-foreground">{label}</p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {CATEGORY_LABEL[category] || category}
          </p>
        </div>
      </div>

      {/* 端口标签 */}
      {(inputs.length > 0 || outputs.length > 0) && (
        <div className="flex justify-between px-3 py-1.5 text-[9px] text-muted-foreground">
          <div className="space-y-0.5">
            {inputs.map((p) => (
              <div key={p.id} className="flex items-center gap-1">
                <div className="h-1 w-1 rounded-full" style={{ backgroundColor: color }} />
                {p.label}
              </div>
            ))}
          </div>
          <div className="space-y-0.5 text-right">
            {outputs.map((p) => (
              <div key={p.id} className="flex items-center justify-end gap-1">
                {p.label}
                <div className="h-1 w-1 rounded-full" style={{ backgroundColor: color }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 输出端口 */}
      {outputs.map((port, i) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          style={{
            top: `${((i + 1) / (outputs.length + 1)) * 100}%`,
            background: color,
            border: `2px solid ${color}`,
            width: 10,
            height: 10,
          }}
          title={port.label}
        />
      ))}
    </div>
  );
});

CustomNode.displayName = 'CustomNode';
