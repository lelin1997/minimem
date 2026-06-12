import { X, Trash2, Info, ArrowRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PipelineNode, NodeType } from '@/api/pipeline';

// 零配置节点的功能说明
const ZERO_CONFIG_HINTS: Record<string, { hint: string; auto: boolean }> = {
  'owner-profile': { hint: '自动调用 MiniMem API 获取用户画像数据，无需额外配置。', auto: true },
  'health-check': { hint: '并行检查 MiniMem 的 health 和 stats 接口，返回健康状态。', auto: true },
  'stats': { hint: '调用 MiniMem API 获取各层记忆数量统计数据。', auto: true },
  'temperature': { hint: '调用 MiniMem API 获取记忆温度分布数据。', auto: true },
  'split': { hint: '将输入列表拆分为单项，逐项传递给下游节点处理。', auto: false },
  'loop': { hint: '对输入列表的每一项，依次执行下游子图（支持嵌套循环和索引变量）。', auto: false },
  'snapshot-create': { hint: '调用 MiniMem API 创建当前状态的快照备份。', auto: true },
};

// 占位实现/需注意的节点警告
const NODE_WARNINGS: Record<string, string> = {};

interface ConfigPanelProps {
  node: PipelineNode;
  nodeType: NodeType | undefined;
  onUpdate: (nodeId: string, updates: Partial<PipelineNode>) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}

export function ConfigPanel({ node, nodeType, onUpdate, onDelete, onClose }: ConfigPanelProps) {
  const schema = nodeType?.configSchema || {};
  const hasConfigFields = Object.keys(schema).length > 0;
  const zeroConfigHint = ZERO_CONFIG_HINTS[node.type];
  const warning = NODE_WARNINGS[node.type];

  const updateConfig = (key: string, value: unknown) => {
    onUpdate(node.id, {
      config: { ...node.config, [key]: value },
    });
  };

  const updateLabel = (label: string) => {
    onUpdate(node.id, { label });
  };

  return (
    <div className="flex h-full w-80 flex-col border-l border-border/60 bg-card/50">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: nodeType?.color || '#6B7280' }}
          />
          <span className="text-xs font-semibold text-foreground">
            节点属性
          </span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {node.type}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 表单 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-4">
          {/* 节点描述 */}
          {nodeType?.description && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {nodeType.description}
            </p>
          )}

          {/* 零配置节点提示 */}
          {!hasConfigFields && zeroConfigHint && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary/60" />
              <div className="min-w-0">
                <p className="text-[11px] leading-relaxed text-foreground/80">
                  {zeroConfigHint.hint}
                </p>
                {zeroConfigHint.auto && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    ✦ 拖入画布即可使用，无需配置
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 节点警告 */}
          {warning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300/40 bg-amber-50/50 px-3 py-2.5 dark:border-amber-500/20 dark:bg-amber-900/10">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
              <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                {warning}
              </p>
            </div>
          )}

          {/* 输入/输出端口信息 */}
          {nodeType && (nodeType.inputs.length > 0 || nodeType.outputs.length > 0) && (
            <div className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2.5">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                数据端口
              </p>
              <div className="space-y-1.5">
                {nodeType.inputs.map((port) => (
                  <div key={port.id} className="flex items-center gap-1.5 text-[11px]">
                    <ArrowRight className="h-2.5 w-2.5 text-blue-400" />
                    <span className="text-foreground/70">{port.label}</span>
                    <span className="ml-auto rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                      {port.type}
                    </span>
                  </div>
                ))}
                {nodeType.inputs.length > 0 && nodeType.outputs.length > 0 && (
                  <div className="my-1 border-t border-border/30" />
                )}
                {nodeType.outputs.map((port) => (
                  <div key={port.id} className="flex items-center gap-1.5 text-[11px]">
                    <ArrowRight className="h-2.5 w-2.5 rotate-180 text-emerald-400" />
                    <span className="text-foreground/70">{port.label}</span>
                    <span className="ml-auto rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                      {port.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 节点名称 */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              节点名称
            </label>
            <input
              type="text"
              value={node.label}
              onChange={(e) => updateLabel(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* 节点 ID */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              节点 ID
            </label>
            <p className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {node.id}
            </p>
          </div>

          {/* 动态配置字段 */}
          {Object.entries(schema).map(([key, fieldDef]: [string, any]) => (
            <ConfigField
              key={key}
              fieldKey={key}
              fieldDef={fieldDef}
              value={node.config[key]}
              onChange={(val) => updateConfig(key, val)}
            />
          ))}
        </div>
      </div>

      {/* 底部操作 */}
      <div className="border-t border-border/40 px-4 py-3">
        <button
          onClick={() => onDelete(node.id)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除节点
        </button>
      </div>
    </div>
  );
}

// ── 动态表单字段 ──

function ConfigField({
  fieldKey,
  fieldDef,
  value,
  onChange,
}: {
  fieldKey: string;
  fieldDef: any;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const { type, label, required, placeholder, options, optionLabels, template, description } = fieldDef;
  const defaultVal = fieldDef.default;

  const commonLabel = (
    <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      {label || fieldKey}
      {required && <span className="text-destructive">*</span>}
      {template && (
        <span className="rounded bg-amber-100 px-1 py-0.5 text-[8px] font-medium text-amber-600">
          模板
        </span>
      )}
    </label>
  );

  // 帮助文本组件
  const helpText = description ? (
    <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground/70">{description}</p>
  ) : null;

  if (type === 'textarea') {
    return (
      <div>
        {commonLabel}
        <textarea
          value={(value as string) ?? defaultVal ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={4}
          className={cn(
            'w-full resize-y rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-[11px] text-foreground',
            'placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30',
            template && 'bg-amber-50/30',
          )}
        />
        {template && !description && (
          <p className="mt-1 text-[9px] text-muted-foreground">
            支持 Handlebars 模板语法: {'{{nodes.xxx.output}}'}, {'{{vars.xxx}}'}, {'{{$date}}'}
          </p>
        )}
        {helpText}
      </div>
    );
  }

  if (type === 'select') {
    const labels: string[] = optionLabels || [];
    return (
      <div>
        {commonLabel}
        <select
          value={(value as string) ?? defaultVal ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
        >
          {(options || []).map((opt: string, i: number) => (
            <option key={opt} value={opt}>
              {labels[i] || opt || '（默认）'}
            </option>
          ))}
        </select>
        {helpText}
      </div>
    );
  }

  if (type === 'number') {
    return (
      <div>
        {commonLabel}
        <input
          type="number"
          value={(value as number) ?? defaultVal ?? ''}
          onChange={(e) =>
            onChange(e.target.value === '' ? undefined : Number(e.target.value))
          }
          placeholder={placeholder}
          className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        {helpText}
      </div>
    );
  }

  // string (default)
  return (
    <div>
      {commonLabel}
      <input
        type="text"
        value={(value as string) ?? defaultVal ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-xs text-foreground',
          'placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30',
          template && 'bg-amber-50/30',
        )}
      />
      {helpText}
    </div>
  );
}
