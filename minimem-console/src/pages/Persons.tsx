import { useState } from 'react';
import { Users, User, ChevronRight, Plus, Trash2, Edit2, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import { usePersons, useUpdatePerson, type PersonItem } from '@/api/minimem';
import { api } from '@/api/client';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export default function Persons() {
  const { data, isLoading, error } = usePersons();
  const [selected, setSelected] = useState<PersonItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createAlias, setCreateAlias] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const updatePerson = useUpdatePerson();

  const persons = data?.persons || [];

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      await api.post('/proxy/api/v1/person', {
        name: createName.trim(),
        aliases: createAlias ? createAlias.split(',').map((s) => s.trim()) : [],
      });
      qc.invalidateQueries({ queryKey: ['persons'] });
      setShowCreate(false);
      setCreateName('');
      setCreateAlias('');
      toast.success('人设创建成功');
    } catch {
      toast.error('创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleEditStart = () => {
    if (!selected) return;
    // Convert all fields to string key-value pairs for editing
    const form: Record<string, string> = {};
    Object.entries(selected).forEach(([key, value]) => {
      if (key === 'name' || value == null) return;
      if (Array.isArray(value)) {
        form[key] = (value as string[]).join(', ');
      } else if (typeof value === 'object') {
        form[key] = JSON.stringify(value, null, 2);
      } else {
        form[key] = String(value);
      }
    });
    setEditForm(form);
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    // 引擎自动推断的人物可能没有 id，用 name 作为标识
    const personId = selected.id || selected.name;
    if (!personId) return;
    try {
      const data: Record<string, unknown> = {};
      Object.entries(editForm).forEach(([key, val]) => {
        const origVal = (selected as any)[key];
        if (Array.isArray(origVal)) {
          data[key] = val.split(',').map((s) => s.trim()).filter(Boolean);
        } else if (typeof origVal === 'object' && origVal !== null) {
          try { data[key] = JSON.parse(val); } catch { data[key] = val; }
        } else if (val !== '') {
          data[key] = val;
        }
      });
      await updatePerson.mutateAsync({ id: personId, data });
      toast.success(`已更新人设「${selected.name}」`);
      setIsEditing(false);
      setSelected(null);
    } catch {
      toast.error('更新失败');
    }
  };

  const handleDelete = async (name: string) => {
    setDeleteTarget(null);
    setDeleting(name);
    try {
      const person = persons.find((p) => p.name === name);
      // 引擎自动推断的人物可能没有 id，用 name 作为标识
      const personId = person?.id || person?.name;
      if (!personId) {
        toast.error('无法获取该人设的标识');
        return;
      }
      await api.delete(`/proxy/api/v1/person/${encodeURIComponent(personId)}`);
      qc.invalidateQueries({ queryKey: ['persons'] });
      if (selected?.name === name) setSelected(null);
      toast.success(`已删除人设「${name}」`);
    } catch {
      toast.error('删除失败');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">社交关系</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            系统识别出的关联对象和社交关系
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-apple transition-all hover:shadow-apple-md active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          新建人设
        </button>
      </div>

      {/* 新建弹窗 */}
      {showCreate && (
        <div className="rounded-2xl bg-card p-5 shadow-apple space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">新建人设</h3>
            <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <input
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="人名（必填）"
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <input
            type="text"
            value={createAlias}
            onChange={(e) => setCreateAlias(e.target.value)}
            placeholder="别名（逗号分隔，可选）"
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            onClick={handleCreate}
            disabled={!createName.trim() || creating}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {creating ? '创建中...' : '创建'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-destructive/5 p-6 text-center text-sm text-destructive">
          无法加载人设列表
        </div>
      ) : (
        <div className="flex gap-6">
          {/* 人设列表 */}
          <div className="flex-1 space-y-2">
            {persons.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Users className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">暂无人设数据</p>
              </div>
            ) : (
              persons.map((person) => (
                <div
                  key={person.name}
                  onClick={() => setSelected(person)}
                  className={cn(
                    'group flex items-center gap-3 rounded-xl bg-card p-4 shadow-apple cursor-pointer transition-all hover:shadow-apple-md',
                    selected?.name === person.name && 'ring-2 ring-primary/30'
                  )}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 flex-shrink-0">
                    <User className="h-5 w-5 text-primary" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{person.name}</p>
                    {person.aliases && person.aliases.length > 0 && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        别名: {person.aliases.join(', ')}
                      </p>
                    )}
                    {person.relationship && (
                      <p className="text-[11px] text-muted-foreground">
                        关系: {person.relationship}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(person.name);
                      }}
                      disabled={deleting === person.name}
                      className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 人设详情 */}
          {selected && (
            <div className="w-96 flex-shrink-0 rounded-2xl bg-card p-5 shadow-apple space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{selected.name}</h3>
                <div className="flex items-center gap-1">
                  {isEditing ? (
                    <>
                      <button
                        onClick={handleSaveEdit}
                        disabled={updatePerson.isPending}
                        className="rounded-lg p-1.5 text-emerald-500 hover:bg-emerald-50 disabled:opacity-50"
                        title="保存"
                      >
                        <Save className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                        title="取消"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleEditStart}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="编辑"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => { setSelected(null); setIsEditing(false); }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {isEditing ? (
                /* 编辑模式 */
                <div className="space-y-3">
                  {Object.entries(selected).map(([key, value]) => {
                    if (key === 'name' || key === 'id' || value == null) return null;
                    const label = key.replace(/_/g, ' ');
                    return (
                      <div key={key}>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          {label}
                        </label>
                        {Array.isArray(value) || typeof value === 'object' ? (
                          <textarea
                            value={editForm[key] || ''}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, [key]: e.target.value }))}
                            rows={typeof value === 'object' && !Array.isArray(value) ? 3 : 1}
                            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                          />
                        ) : (
                          <input
                            type="text"
                            value={editForm[key] || ''}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* 查看模式 */
                <div className="space-y-3">
                  {Object.entries(selected).map(([key, value]) => {
                    if (key === 'name' || value == null) return null;
                    return (
                      <div key={key}>
                        <span className="text-[11px] font-medium text-muted-foreground uppercase">
                          {key.replace(/_/g, ' ')}
                        </span>
                        <div className="mt-0.5 text-sm">
                          {Array.isArray(value) ? (
                            <div className="flex flex-wrap gap-1">
                              {value.map((v, i) => (
                                <span
                                  key={i}
                                  className="rounded-md bg-muted/50 px-2 py-0.5 text-xs"
                                >
                                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                </span>
                              ))}
                            </div>
                          ) : typeof value === 'object' ? (
                            <pre className="text-xs bg-muted/30 rounded-lg p-2 overflow-auto max-h-40">
                              {JSON.stringify(value, null, 2)}
                            </pre>
                          ) : (
                            <p>{String(value)}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除人设"
        description={`确认删除人设「${deleteTarget}」？`}
        confirmText="删除"
        variant="destructive"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
