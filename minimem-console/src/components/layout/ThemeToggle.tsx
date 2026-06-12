/**
 * 主题切换组件 — 三态切换（Light / System / Dark）
 */

import { useState, useEffect } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Theme, getStoredTheme, storeTheme, applyTheme } from '@/lib/theme';

const MODES: { value: Theme; icon: React.ElementType; label: string }[] = [
  { value: 'light', icon: Sun, label: '浅色' },
  { value: 'system', icon: Monitor, label: '跟随系统' },
  { value: 'dark', icon: Moon, label: '深色' },
];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    storeTheme(theme);
    applyTheme(theme);
  }, [theme]);

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
      {MODES.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          title={label}
          className={cn(
            'rounded-md p-1.5 transition-all duration-200',
            theme === value
              ? 'bg-card text-foreground shadow-apple'
              : 'text-muted-foreground/60 hover:text-muted-foreground',
          )}
        >
          <Icon className="h-3 w-3" strokeWidth={1.8} />
        </button>
      ))}
    </div>
  );
}
