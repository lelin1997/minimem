import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import MemoryBrowser from './pages/MemoryBrowser';
import SurfaceFiles from './pages/SurfaceFiles';
import PipelineList from './pages/PipelineList';
import PipelineEditor from './pages/PipelineEditor';
import PipelineRuns from './pages/PipelineRuns';
import ReportViewer from './pages/ReportViewer';
import OwnerProfile from './pages/OwnerProfile';
import Persons from './pages/Persons';
import DreamHistory from './pages/DreamHistory';
import Inspirations from './pages/Inspirations';
import Knowledge from './pages/Knowledge';
import MemoryManage from './pages/MemoryManage';
import TemplateMarket from './pages/TemplateMarket';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import { LoginPage } from './pages/LoginPage';
import { useAuth } from './lib/auth';

// 认证保护组件
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* 公开路由 */}
      <Route path="/login" element={<LoginPage />} />
      
      {/* 需要认证的路由 */}
      <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/memories" element={<MemoryBrowser />} />
        <Route path="/memories/manage" element={<MemoryManage />} />
        <Route path="/surfaces" element={<SurfaceFiles />} />
        <Route path="/pipelines" element={<PipelineList />} />
        <Route path="/pipelines/:id/edit" element={<PipelineEditor />} />
        <Route path="/pipelines/:id/runs" element={<PipelineRuns />} />
        <Route path="/reports/:runId" element={<ReportViewer />} />
        <Route path="/owner" element={<OwnerProfile />} />
        <Route path="/persons" element={<Persons />} />
        <Route path="/dreams" element={<DreamHistory />} />
        <Route path="/inspirations" element={<Inspirations />} />
        <Route path="/knowledge" element={<Knowledge />} />
        <Route path="/templates" element={<TemplateMarket />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
