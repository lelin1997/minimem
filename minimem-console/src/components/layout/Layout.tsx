import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TaskMonitor } from '@/components/TaskMonitor';

export function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* 侧边栏 */}
      <Sidebar />

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Outlet />
        </div>
      </main>

      {/* 全局任务监控 */}
      <TaskMonitor />
    </div>
  );
}
