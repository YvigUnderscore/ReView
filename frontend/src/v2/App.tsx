import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'sonner';
import { api } from '../lib/apiClient';
import { queryClient, qk } from './lib/query';
import { useAuth } from './stores/useAuth';
import { useTheme } from './stores/useTheme';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import TaskPage from './pages/TaskPage';
import ReviewPage from './pages/ReviewPage';
import KanbanPage from './pages/KanbanPage';
import AdminPage from './pages/AdminPage';
import AssetPage from './pages/AssetPage';
import ProfilePage from './pages/ProfilePage';
import DocumentationPage from './pages/DocumentationPage';

// Board (Excalidraw) chargé en lazy pour code-splitter sa lourde dépendance
const BoardPage = lazy(() => import('./pages/BoardPage'));

function Protected({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

function AppRoutes() {
  const init = useAuth((s) => s.init);
  const ready = useAuth((s) => s.ready);
  const theme = useTheme((s) => s.theme);
  const { data: setup } = useQuery({
    queryKey: qk.setupStatus,
    queryFn: () => api.get<{ needsSetup: boolean }>('/api/setup/status').catch(() => ({ needsSetup: false })),
    staleTime: Infinity,
  });
  const needsSetup = setup?.needsSetup ?? null;

  useEffect(() => { init(); }, [init]);

  if (!ready || needsSetup === null) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">Chargement…</div>;
  }

  return (
    <BrowserRouter>
      <Toaster position="bottom-right" richColors closeButton theme={theme} />
      <Routes>
        {needsSetup ? (
          <>
            <Route path="/setup" element={<SetupPage />} />
            <Route path="*" element={<Navigate to="/setup" replace />} />
          </>
        ) : (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<Protected><ProjectsPage /></Protected>} />
            <Route path="/projects/:id" element={<Protected><ProjectPage /></Protected>} />
            <Route path="/projects/:id/kanban" element={<Protected><KanbanPage /></Protected>} />
            <Route path="/tasks/:id" element={<Protected><TaskPage /></Protected>} />
            <Route path="/assets/:id" element={<Protected><AssetPage /></Protected>} />
            <Route path="/review/:mediaId" element={<Protected><ReviewPage /></Protected>} />
            <Route path="/projects/:id/board" element={<Protected><Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Chargement du board…</div>}><BoardPage scope="project" /></Suspense></Protected>} />
            <Route path="/assets/:id/board" element={<Protected><Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Chargement du board…</div>}><BoardPage scope="asset" /></Suspense></Protected>} />
            <Route path="/admin" element={<Protected><AdminPage /></Protected>} />
            <Route path="/admin/:section" element={<Protected><AdminPage /></Protected>} />
            <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
            <Route path="/docs" element={<Protected><DocumentationPage /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
