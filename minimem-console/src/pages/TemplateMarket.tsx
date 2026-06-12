/**
 * Pipeline 模板市场 — 浏览、预览、创建内置模板
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store, Search, Calendar, Clock, Zap, Heart, Brain, Shield,
  Lightbulb, Users, BarChart3, FileText, ChevronRight, Sparkles,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTemplates, useCreateFromTemplate, type PipelineTemplate } from '@/api/pipeline';
import { cn } from '@/lib/utils';

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  review: Calendar,
  health: Shield,
  insight: Lightbulb,
  social: Users,
  knowledge: Brain,
  report: BarChart3,
  default: FileText,
};

const CATEGORY_COLORS: Record<string, string> = {
  review: '#3B82F6',
  health: '#10B981',
  insight: '#F59E0B',
  social: '#8B5CF6',
  knowledge: '#EC4899',
  report: '#6366F1',
  default: '#6B7280',
};

function getCategory(template: PipelineTemplate): string {
  const tags = template.tags || [];
  if (tags.includes('review') || template.name.includes('回顾') || template.name.includes('复盘')) return 'review';
  if (tags.includes('health') || template.name.includes('巡检') || template.name.includes('健康')) return 'health';
  if (tags.includes('insight') || template.name.includes('灵感') || template.name.includes('洞察')) return 'insight';
  if (tags.includes('social') || template.name.includes('人物') || template.name.includes('关系')) return 'social';
  if (tags.includes('knowledge') || template.name.includes('知识') || template.name.includes('卡片')) return 'knowledge';
  if (tags.includes('report') || template.name.includes('报告')) return 'report';
  return 'default';
}

export default function TemplateMarket() {
  const navigate = useNavigate();
  const { data: templatesData, isLoading } = useTemplates();
  const createFromTemplate = useCreateFromTemplate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<PipelineTemplate | null>(null);
  const [createName, setCreateName] = useState('');

  const templates = templatesData?.templates || [];

  // 筛选
  const filtered = templates.filter((t) => {
    const matchSearch =
      !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCategory = !selectedCategory || getCategory(t) === selectedCategory;
    return matchSearch && matchCategory;
  });

  // 分类统计
  const categoryCounts = templates.reduce<Record<string, number>>((acc, t) => {
    const cat = getCategory(t);
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  const categories = [
    { key: null, label: '全部', count: templates.length },
    { key: 'review', label: '回顾', count: categoryCounts['review'] || 0 },
    { key: 'insight', label: '洞察', count: categoryCounts['insight'] || 0 },
    { key: 'habit', label: '习惯', count: categoryCounts['habit'] || 0 },
    { key: 'knowledge', label: '知识', count: categoryCounts['knowledge'] || 0 },
    { key: 'social', label: '人物', count: categoryCounts['social'] || 0 },
    { key: 'health', label: '健康', count: categoryCounts['health'] || 0 },
    { key: 'ops', label: 'SRE', count: categoryCounts['ops'] || 0 },
    { key: 'report', label: '报告', count: categoryCounts['report'] || 0 },
  ];

  const handleCreate = async (template: PipelineTemplate) => {
    const name = createName || `${template.name} (副本)`;
    try {
      const result = await createFromTemplate.mutateAsync({
        templateId: template.id,
        name,
      });
      navigate(`/pipelines/${result.id}/edit`);
    } catch (err: any) {
      toast.error('创建失败', { description: err?.message || '未知错误' });
    }
  };

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" strokeWidth={1.8} />
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              模板市场
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            浏览内置模板，一键创建 Pipeline
          </p>
        </div>
        <button
          onClick={() => navigate('/pipelines')}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          返回 Pipelines
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      {/* 搜索 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" strokeWidth={1.8} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索模板..."
          className="w-full rounded-xl border border-border/60 bg-card pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      {/* 分类标签 */}
      <div className="flex flex-wrap gap-2">
        {categories.map(({ key, label, count }) => (
          <button
            key={label}
            onClick={() => setSelectedCategory(key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              selectedCategory === key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {count > 0 && (
              <span className="ml-1.5 text-[10px] opacity-60">{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* 模板网格 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          没有找到匹配的模板
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((template) => {
            const cat = getCategory(template);
            const CatIcon = CATEGORY_ICONS[cat] || CATEGORY_ICONS.default;
            const catColor = CATEGORY_COLORS[cat] || CATEGORY_COLORS.default;
            const nodeCount = (template.nodes || []).length;

            return (
              <div
                key={template.id}
                className="group cursor-pointer rounded-2xl border border-border/40 bg-card p-5 shadow-apple transition-all duration-200 hover:shadow-apple-md"
                onClick={() => setPreviewTemplate(template)}
              >
                {/* 图标 + 分类 */}
                <div className="mb-3 flex items-center justify-between">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${catColor}14` }}
                  >
                    <CatIcon className="h-4.5 w-4.5" style={{ color: catColor }} strokeWidth={1.8} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-muted-foreground/40" strokeWidth={1.5} />
                    <span className="text-[10px] text-muted-foreground/60">
                      {nodeCount} 节点
                    </span>
                  </div>
                </div>

                {/* 名称 + 描述 */}
                <h3 className="text-sm font-semibold text-foreground">
                  {template.name}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {template.description}
                </p>

                {/* 标签 */}
                {template.tags?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {template.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* 使用按钮（hover 显示） */}
                <div className="mt-4 flex justify-end opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCreate(template); }}
                    disabled={createFromTemplate.isPending}
                    className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    {createFromTemplate.isPending && template.id === previewTemplate?.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    使用此模板
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 预览弹窗 */}
      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-lg rounded-2xl bg-card p-6 shadow-apple-lg">
            <h2 className="text-lg font-semibold text-foreground">
              {previewTemplate.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {previewTemplate.description}
            </p>

            {/* DAG 信息 */}
            <div className="mt-4 rounded-xl bg-muted/30 p-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    {(previewTemplate.nodes || []).length}
                  </p>
                  <p className="text-[10px] text-muted-foreground">节点</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    {(previewTemplate.edges || []).length}
                  </p>
                  <p className="text-[10px] text-muted-foreground">连线</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    {Object.keys(previewTemplate.variables || {}).length}
                  </p>
                  <p className="text-[10px] text-muted-foreground">变量</p>
                </div>
              </div>
            </div>

            {/* 节点列表 */}
            <div className="mt-4 max-h-40 space-y-1.5 overflow-y-auto">
              {(previewTemplate.nodes || []).map((node) => (
                <div key={node.id} className="flex items-center gap-2 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                  <span className="text-foreground">{node.label}</span>
                  <span className="text-muted-foreground/50">({node.type})</span>
                </div>
              ))}
            </div>

            {/* 创建表单 */}
            <div className="mt-5">
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={`Pipeline 名称（默认：${previewTemplate.name} 副本）`}
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {/* 操作按钮 */}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setPreviewTemplate(null); setCreateName(''); }}
                className="rounded-xl px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                取消
              </button>
              <button
                onClick={() => handleCreate(previewTemplate)}
                disabled={createFromTemplate.isPending}
                className={cn(
                  'flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2 text-xs font-medium text-primary-foreground shadow-apple transition-all hover:shadow-apple-md',
                  createFromTemplate.isPending && 'opacity-60',
                )}
              >
                <Zap className="h-3.5 w-3.5" strokeWidth={2} />
                {createFromTemplate.isPending ? '创建中...' : '创建 Pipeline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
