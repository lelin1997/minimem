/**
 * 主题管理 — Light / Dark / System 三模式
 * 使用 Tailwind CSS `darkMode: ['class']` 策略
 */

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'minimem-console-theme';

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {}
  return 'system';
}

export function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {}
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/**
 * 初始化主题（在 app 启动时调用一次）
 * 返回取消系统主题变化监听的 cleanup 函数
 */
export function initTheme(): () => void {
  const theme = getStoredTheme();
  applyTheme(theme);

  // 监听系统主题变化（仅 system 模式有意义，但始终监听以便动态切换）
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    const current = getStoredTheme();
    if (current === 'system') {
      applyTheme('system');
    }
  };
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}
