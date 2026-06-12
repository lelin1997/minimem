import { useState, useCallback } from 'react';
import {
  User,
  Edit2,
  Save,
  X,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  Heart,
  Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useOwnerProfile,
  useUpdateOwnerProfile,
  useDeleteOwnerProfileField,
} from '@/api/minimem';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';

// 分类定义：每个分类对应 API 的 category 参数和展示配置
const CATEGORIES = [
  {
    key: 'identity',
    label: '身份信息',
    description: '名字、角色、背景',
    icon: Fingerprint,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    fieldHints: {
      name: '名字',
      role: '角色/职业',
      background: '背景',
      display_name: '显示名称',
      nickname: '昵称',
    },
  },
  {
    key: 'personality',
    label: '性格特质',
    description: '性格、沟通风格、决策模式',
    icon: Heart,
    color: 'text-rose-500',
    bg: 'bg-rose-500/10',
    fieldHints: {
      traits: '性格特质（逗号分隔）',
      communication_style: '沟通风格',
      decision_pattern: '决策模式',
      energy_level: '能量水平',
    },
  },
  {
    key: 'preferences',
    label: '偏好设置',
    description: '交互偏好、响应风格',
    icon: Settings2,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    fieldHints: {
      interaction_depth: '交互深度（deep/casual）',
      response_tone: '响应风格（formal/friendly）',
      language: '语言偏好',
      detail_level: '细节程度',
    },
  },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]['key'];

// 渲染值：对象取最可读字段，数组 join，其他 String
function renderValue(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(renderValue).join(', ');
  // 对象：尝试取 display_name / name / title 等语义字段
  if (typeof v === 'object') {
    return v.display_name || v.name || v.title || v.role || JSON.stringify(v);
  }
  return String(v);
}

// 检查值是否为"简单可编辑"类型（string / number / boolean / 简单对象）
function isSimpleEditable(v: any): boolean {
  if (v == null) return true;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.every((i) => typeof i !== 'object' || i === null);
  return false;
}

// 将值转为可编辑字符串
function valueToEditable(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((i) => (typeof i === 'object' ? JSON.stringify(i) : String(i))).join(', ');
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

// 将编辑字符串解析回值（保持原始类型）
function editableToValue(str: string, origValue: any): any {
  if (str === '') return null;
  if (Array.isArray(origValue)) {
    return str.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (typeof origValue === 'object' && origValue !== null && !Array.isArray(origValue)) {
    try { return JSON.parse(str); } catch { return str; }
  }
  if (typeof origValue === 'number') {
    const n = Number(str);
    return isNaN(n) ? str : n;
  }
  if (typeof origValue === 'boolean') return str === 'true';
  return str;
}

export default function OwnerProfile() {
  const { data, isLoading, error } = useOwnerProfile();
  const updateProfile = useUpdateOwnerProfile();
  const deleteField = useDeleteOwnerProfileField();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({ identity: true, personality: true, preferences: true });
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [addingToCategory, setAddingToCategory] = useState<CategoryKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // 获取某分类的数据
  const getCategoryData = useCallback(
    (catKey: CategoryKey): Record<string, any> | null => {
      if (!data) return null;
      return (data as any)[catKey] || null;
    },
    [data]
  );

  // 开始编辑
  const handleEditStart = () => {
    if (!data) return;
    const form: Record<string, string> = {};
    CATEGORIES.forEach((cat) => {
      const catData = getCategoryData(cat.key);
      if (!catData) return;
      Object.entries(catData).forEach(([k, v]) => {
        form[`${cat.key}.${k}`] = valueToEditable(v);
      });
    });
    setEditing(form);
    setIsEditing(true);
  };

  // 保存编辑
  const handleSave = async () => {
    try {
      // 构建提交数据：按分类分组
      const payload: Record<string, any> = {};
      CATEGORIES.forEach((cat) => {
        const catData = getCategoryData(cat.key);
        if (!catData) return;
        const catObj: Record<string, any> = {};
        Object.keys(catData).forEach((k) => {
          const formKey = `${cat.key}.${k}`;
          if (formKey in editing) {
            catObj[k] = editableToValue(editing[formKey], catData[k]);
          }
        });
        if (Object.keys(catObj).length > 0) {
          payload[cat.key] = catObj;
        }
      });
      await updateProfile.mutateAsync(payload);
      toast.success('人设已更新');
      setIsEditing(false);
      setEditing({});
    } catch {
      toast.error('更新失败');
    }
  };

  // 删除字段
  const handleDelete = async (fieldPath: string) => {
    setDeleteTarget(null);
    try {
      await deleteField.mutateAsync(fieldPath);
      toast.success(`已删除 ${fieldPath}`);
    } catch {
      toast.error('删除失败');
    }
  };

  // 添加新字段
  const handleAddField = async (catKey: CategoryKey) => {
    const key = newFieldKey.trim().replace(/\s+/g, '_');
    const value = newFieldValue.trim();
    if (!key) return;

    try {
      // 解析值：尝试 JSON，回退到字符串
      let parsedValue: any = value;
      try { parsedValue = JSON.parse(value); } catch { /* keep as string */ }

      await updateProfile.mutateAsync({
        [catKey]: { [key]: parsedValue },
      });
      toast.success('字段已添加');
      setNewFieldKey('');
      setNewFieldValue('');
      setAddingToCategory(null);
    } catch {
      toast.error('添加失败');
    }
  };

  // 头部信息
  const identity = getCategoryData('identity');
  const displayName = (() => {
    const raw = identity?.name;
    if (!raw) return 'Owner';
    if (typeof raw === 'object') return (raw as any).display_name || (raw as any).nickname || (raw as any).name || 'Owner';
    return String(raw);
  })();
  const displayRole = (() => {
    const raw = identity?.role || identity?.occupation;
    if (!raw) return '';
    if (typeof raw === 'object') return (raw as any).title || (raw as any).role || '';
    return String(raw);
  })();

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">人设管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理你的身份信息、性格特质和交互偏好
          </p>
        </div>
        {!isLoading && !error && data && (
          isEditing ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={updateProfile.isPending}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-apple transition-all hover:shadow-apple-md active:scale-[0.98] disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                保存
              </button>
              <button
                onClick={() => { setIsEditing(false); setEditing({}); }}
                className="flex items-center gap-1.5 rounded-xl border border-border/60 px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={handleEditStart}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-apple transition-all hover:shadow-apple-md active:scale-[0.98]"
            >
              <Edit2 className="h-4 w-4" />
              编辑人设
            </button>
          )
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-destructive/5 p-6 text-center text-sm text-destructive">
          无法加载人设数据，请确认 MiniMem 引擎已启动
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* 头像卡片 */}
          <div className="flex items-center gap-4 rounded-2xl bg-card p-6 shadow-apple">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <User className="h-8 w-8 text-primary" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold truncate">{displayName}</h2>
              {displayRole && (
                <p className="text-sm text-muted-foreground truncate">{displayRole}</p>
              )}
            </div>
            {/* 快速标签：显示 personality.traits */}
            {(() => {
              const traits = getCategoryData('personality')?.traits;
              if (!traits || !Array.isArray(traits) || traits.length === 0) return null;
              return (
                <div className="flex flex-wrap gap-1.5">
                  {traits.slice(0, 4).map((t: any, i: number) => (
                    <span
                      key={i}
                      className="rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-600 dark:text-rose-400"
                    >
                      {typeof t === 'object' ? JSON.stringify(t) : String(t)}
                    </span>
                  ))}
                  {traits.length > 4 && (
                    <span className="rounded-lg bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                      +{traits.length - 4}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>

          {/* 分类卡片 */}
          {CATEGORIES.map((cat) => {
            const catData = getCategoryData(cat.key);
            const isExpanded = expanded[cat.key] ?? true;
            const CatIcon = cat.icon;
            const fields = catData ? Object.entries(catData) : [];

            return (
              <div
                key={cat.key}
                className="rounded-2xl bg-card shadow-apple overflow-hidden"
              >
                {/* 分类标题 */}
                <button
                  onClick={() => toggle(cat.key)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-accent/50 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg', cat.bg)}>
                    <CatIcon className={cn('h-3.5 w-3.5', cat.color)} strokeWidth={1.8} />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-medium">{cat.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{cat.description}</span>
                  </div>
                  {fields.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {fields.length} 项
                    </span>
                  )}
                </button>

                {/* 字段列表 */}
                {isExpanded && (
                  <div className="border-t border-border/40 px-5 py-3 space-y-2">
                    {fields.length === 0 ? (
                      <div className="py-4 text-center">
                        <p className="text-xs text-muted-foreground/60">暂无数据</p>
                        <button
                          onClick={() => setAddingToCategory(cat.key)}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Plus className="h-3 w-3" />
                          添加字段
                        </button>
                      </div>
                    ) : (
                      <>
                        {fields.map(([k, v]) => {
                          const formKey = `${cat.key}.${k}`;
                          const hint = (cat.fieldHints as Record<string, string>)[k];

                          return (
                            <div
                              key={k}
                              className="group flex items-start gap-3 py-1.5"
                            >
                              <span className="flex-shrink-0 text-xs font-medium text-muted-foreground w-28 capitalize">
                                {hint || k.replace(/_/g, ' ')}
                              </span>
                              <div className="flex-1 min-w-0">
                                {isEditing && isSimpleEditable(v) ? (
                                  <input
                                    type="text"
                                    value={editing[formKey] ?? valueToEditable(v)}
                                    onChange={(e) =>
                                      setEditing((prev) => ({
                                        ...prev,
                                        [formKey]: e.target.value,
                                      }))
                                    }
                                    className="w-full rounded-lg border border-border/60 bg-background px-2.5 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
                                  />
                                ) : isEditing && !isSimpleEditable(v) ? (
                                  <textarea
                                    value={editing[formKey] ?? valueToEditable(v)}
                                    onChange={(e) =>
                                      setEditing((prev) => ({
                                        ...prev,
                                        [formKey]: e.target.value,
                                      }))
                                    }
                                    rows={3}
                                    className="w-full rounded-lg border border-border/60 bg-background px-2.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                                  />
                                ) : (
                                  <span className="text-sm text-foreground break-words">
                                    {Array.isArray(v) ? (
                                      <div className="flex flex-wrap gap-1">
                                        {v.map((item: any, i: number) => (
                                          <span
                                            key={i}
                                            className={cn(
                                              'rounded-md px-2 py-0.5 text-xs',
                                              cat.key === 'personality'
                                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                                : cat.key === 'preferences'
                                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                                : 'bg-muted/50'
                                            )}
                                          >
                                            {renderValue(item)}
                                          </span>
                                        ))}
                                      </div>
                                    ) : typeof v === 'object' && v !== null ? (
                                      <pre className="text-xs bg-muted/30 rounded-lg p-2 overflow-auto max-h-40 font-mono">
                                        {JSON.stringify(v, null, 2)}
                                      </pre>
                                    ) : (
                                      renderValue(v)
                                    )}
                                  </span>
                                )}
                              </div>
                              {/* 删除按钮 */}
                              {!isEditing && (
                                <button
                                  onClick={() => setDeleteTarget(`${cat.key}.${k}`)}
                                  className="flex-shrink-0 rounded-md p-1 text-muted-foreground/0 group-hover:text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                                  title={`删除 ${k}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {/* 添加字段入口 */}
                        {!isEditing && (
                          <button
                            onClick={() => setAddingToCategory(cat.key)}
                            className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                          >
                            <Plus className="h-3 w-3" />
                            添加字段
                          </button>
                        )}
                      </>
                    )}

                    {/* 新增字段表单 */}
                    {addingToCategory === cat.key && (
                      <div className="mt-3 rounded-xl border border-dashed border-border/60 bg-muted/20 p-3 space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newFieldKey}
                            onChange={(e) => setNewFieldKey(e.target.value)}
                            placeholder="字段名（如 communication_style）"
                            className="flex-1 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                          />
                          <input
                            type="text"
                            value={newFieldValue}
                            onChange={(e) => setNewFieldValue(e.target.value)}
                            placeholder="值（JSON 或纯文本）"
                            className="flex-1 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleAddField(cat.key)}
                            disabled={!newFieldKey.trim()}
                            className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                          >
                            添加
                          </button>
                          <button
                            onClick={() => {
                              setAddingToCategory(null);
                              setNewFieldKey('');
                              setNewFieldValue('');
                            }}
                            className="rounded-lg px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <User className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm">暂无人设数据</p>
          <p className="text-xs mt-1">使用 MiniMem 引擎积累记忆后，系统会自动推断人设</p>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除字段"
        description={`确认删除「${deleteTarget}」？此操作不可撤销。`}
        confirmText="删除"
        variant="destructive"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
