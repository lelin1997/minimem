import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Brain,
  BookOpen,
  FileText,
  Workflow,
  Sparkles,
  User,
  Users,
  Moon,
  Lightbulb,
  PenLine,
  Store,
  BarChart3,
  Settings,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '@/lib/auth';
import { useConnectionStatus } from '@/api/minimem';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navigationGroups: NavGroup[] = [
  {
    label: '总览',
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
      { name: '数据分析', href: '/analytics', icon: BarChart3 },
      { name: '设置', href: '/settings', icon: Settings },
    ],
  },
  {
    label: '记忆',
    items: [
      { name: '记忆浏览器', href: '/memories', icon: Brain },
      { name: '记忆管理', href: '/memories/manage', icon: PenLine },
      { name: 'Surface Files', href: '/surfaces', icon: FileText },
    ],
  },
  {
    label: '人物 & 档案',
    items: [
      { name: '人设管理', href: '/owner', icon: User },
      { name: '社交关系', href: '/persons', icon: Users },
    ],
  },
  {
    label: '知识',
    items: [
      { name: '知识库', href: '/knowledge', icon: BookOpen },
    ],
  },
  {
    label: '洞察',
    items: [
      { name: 'Dream 历史', href: '/dreams', icon: Moon },
      { name: '灵感面板', href: '/inspirations', icon: Lightbulb },
    ],
  },
  {
    label: '自动化',
    items: [
      { name: 'Pipelines', href: '/pipelines', icon: Workflow },
      { name: '模板市场', href: '/templates', icon: Store },
    ],
  },
];

export function Sidebar() {
  const location = useLocation();
  const { data: conn, isLoading: connLoading } = useConnectionStatus();
  const { user, logout } = useAuth();

  return (
    <aside className="glass flex w-60 flex-col border-r border-border/60">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 shadow-apple">
          <Sparkles className="h-4 w-4 text-white" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            MiniMem
          </h1>
          <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            Console
          </p>
        </div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {navigationGroups.map((group, gi) => (
          <div key={group.label} className={cn(gi > 0 && 'mt-4')}>
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive =
                  item.href === '/'
                    ? location.pathname === '/'
                    : item.href === '/memories'
                    ? location.pathname === '/memories'
                    : location.pathname.startsWith(item.href);

                return (
                  <NavLink
                    key={item.href}
                    to={item.href}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <item.icon
                      className={cn(
                        'h-4 w-4 flex-shrink-0 transition-colors duration-200',
                        isActive
                          ? 'text-primary'
                          : 'text-muted-foreground/70 group-hover:text-foreground'
                      )}
                      strokeWidth={1.8}
                    />
                    {item.name}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* 底部状态 */}
      <div className="border-t border-border/60 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="group relative flex items-center gap-2">
            {connLoading ? (
              <>
                <div className="h-2 w-2 animate-pulse rounded-full bg-amber-400 shadow-sm shadow-amber-400/50" />
                <span className="text-[11px] text-muted-foreground">
                  检测中…
                </span>
              </>
            ) : conn?.connected ? (
              <>
                <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
                <span className="text-[11px] text-muted-foreground">
                  MiniMem 已连接
                </span>
                {/* hover tooltip — 显示版本和延迟 */}
                <div className="pointer-events-none absolute bottom-full left-0 mb-2 hidden rounded-lg border border-border/60 bg-popover px-3 py-2 text-[11px] shadow-lg group-hover:block">
                  <div className="flex flex-col gap-0.5 whitespace-nowrap text-muted-foreground">
                    {conn.version && <span>版本 {conn.version}</span>}
                    {conn.latencyMs != null && <span>延迟 {conn.latencyMs}ms</span>}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="h-2 w-2 rounded-full bg-red-400 shadow-sm shadow-red-400/50" />
                <span className="text-[11px] text-muted-foreground">
                  MiniMem 未连接
                </span>
              </>
            )}
          </div>
          <button onClick={logout} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-muted-foreground" title="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
              <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
