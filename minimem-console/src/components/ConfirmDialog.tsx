import { useEffect, useRef } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      // 自动聚焦确认按钮
      setTimeout(() => confirmRef.current?.focus(), 50);
      // ESC 关闭
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onCancel();
      };
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [open, onCancel]);

  if (!open) return null;

  const isDestructive = variant === 'destructive';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-150"
        onClick={onCancel}
      />

      {/* 弹窗主体 */}
      <div className="relative w-full max-w-[360px] mx-4 rounded-2xl bg-card p-6 shadow-apple-lg animate-in fade-in zoom-in-95 duration-200">
        {/* 图标 */}
        <div
          className={`mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full ${
            isDestructive ? 'bg-destructive/10' : 'bg-primary/10'
          }`}
        >
          {isDestructive ? (
            <AlertTriangle className="h-5 w-5 text-destructive" strokeWidth={1.5} />
          ) : (
            <Info className="h-5 w-5 text-primary" strokeWidth={1.5} />
          )}
        </div>

        {/* 标题 */}
        {title && (
          <h3 className="mb-1.5 text-center text-[15px] font-semibold text-foreground">
            {title}
          </h3>
        )}

        {/* 描述 */}
        <p className="mb-6 text-center text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>

        {/* 按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-border/60 bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 active:scale-[0.98]"
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-all active:scale-[0.98] ${
              isDestructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-apple'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-apple'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
