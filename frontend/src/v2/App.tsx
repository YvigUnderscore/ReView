// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import { api } from '../lib/apiClient';
import { queryClient, qk } from './lib/query';
import { useAuth } from './stores/useAuth';
import { useTheme } from './stores/useTheme';
import { useBranding } from './lib/branding';
import Shell from './components/Shell';
import LoginPage from './pages/LoginPage';
import InvitePage from './pages/InvitePage';
import SetupPage from './pages/SetupPage';
import HomePage from './pages/HomePage';
import ProjectsPage from './pages/ProjectsPage';
import ReviewsPage from './pages/ReviewsPage';
import ProjectPage from './pages/ProjectPage';
import TaskPage from './pages/TaskPage';
import AssetPage from './pages/AssetPage';
import ShotPage from './pages/ShotPage';
import SequencePage from './pages/SequencePage';
import EpisodePage from './pages/EpisodePage';
import AssetLatestRedirect from './pages/asset/AssetLatestRedirect';
import ProfilePage from './pages/ProfilePage';
import UserProfilePage from './pages/UserProfilePage';
import { useT } from './i18n';

/**
 * Chargement différé par route (D3).
 *
 * L'espace de review et les vingt-sept onglets d'administration partaient dans le fichier
 * d'entrée : ils étaient téléchargés avant la page de connexion, par quelqu'un qui n'avait
 * encore rien demandé. Chacun s'ouvre maintenant à l'usage.
 */
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const TimelinePlayerPage = lazy(() => import('./pages/TimelinePlayerPage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));
const KanbanPage = lazy(() => import('./pages/KanbanPage'));
const PlaylistPage = lazy(() => import('./pages/PlaylistPage'));
// Board (Excalidraw) chargé en lazy pour code-splitter sa lourde dépendance
const BoardPage = lazy(() => import('./pages/BoardPage'));
// Page client publique (35.D) : lazy — les visiteurs anonymes ne chargent pas l'app interne.
const ClientSharePage = lazy(() => import('./pages/ClientSharePage'));

/**
 * Route layout des pages authentifiées (A1) : garde d'accès + coquille montée une seule
 * fois. Les pages vivent dans le `<Outlet/>` de `Shell` et n'ont plus à le rendre elles-mêmes.
 */
function ProtectedShell() {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  // Une seule frontière pour toutes les pages différées (D3) : la coquille reste montée
  // pendant le chargement, seule la zone de contenu attend. Sans elle, ouvrir une review
  // ferait disparaître la barre latérale le temps du téléchargement.
  return <Shell />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* reducedMotion="user" : framer respecte prefers-reduced-motion globalement (10.B6). */}
      <MotionConfig reducedMotion="user">
        <AppRoutes />
      </MotionConfig>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

function AppRoutes() {
  const t = useT();
  const init = useAuth((s) => s.init);
  const ready = useAuth((s) => s.ready);
  const theme = useTheme((s) => s.theme);
  // Thème studio (42.B — №101) : applique l'accent défini par l'admin, globalement.
  useBranding();
  const { data: setup } = useQuery({
    queryKey: qk.setupStatus,
    queryFn: () => api.get<{ needsSetup: boolean }>('/api/setup/status').catch(() => ({ needsSetup: false })),
    staleTime: Infinity,
  });
  const needsSetup = setup?.needsSetup ?? null;

  useEffect(() => {
    void init();
  }, [init]);

  if (!ready || needsSetup === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        {t('common.loading')}
      </div>
    );
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
            {/* Activation d'un compte invité : publique, le jeton du lien fait foi. */}
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route
              path="/client/:token"
              element={
                <Suspense
                  fallback={<div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>}
                >
                  <ClientSharePage />
                </Suspense>
              }
            />
            {/* Toutes les pages authentifiées partagent la même coquille (A1). */}
            <Route element={<ProtectedShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/reviews" element={<ReviewsPage />} />
              <Route path="/projects/:id" element={<ProjectPage />} />
              <Route path="/projects/:id/kanban" element={<KanbanPage />} />
              <Route path="/tasks/:id" element={<TaskPage />} />
              {/* La séquence a enfin sa page (C3) : c'était un accordéon dans un onglet. */}
              <Route path="/sequences/:id" element={<SequencePage />} />
              {/* Épisode : niveau facultatif de la série. La route existe toujours, la
                  page se garde elle-même — un projet où le niveau est éteint n'y mène
                  depuis nulle part, et le serveur y répond 409. */}
              <Route path="/episodes/:id" element={<EpisodePage />} />
              {/* La playlist aussi (C5), avec le catalogue du projet d'où la remplir. */}
              <Route path="/playlists/:id" element={<PlaylistPage />} />
              <Route path="/shots/:id" element={<ShotPage />} />
              <Route path="/assets/:id" element={<AssetPage />} />
              {/* Lien permanent vers l'état le plus avancé (Phase 45, étendu aux plans en C3). */}
              <Route path="/assets/:id/latest" element={<AssetLatestRedirect />} />
              <Route path="/shots/:id/latest" element={<AssetLatestRedirect entity="shot" />} />
              <Route path="/review/:mediaId" element={<ReviewPage />} />
              {/* Page du montage (Phase 46) : la review du plan courant + la bande du film. */}
              <Route path="/timelines/:id/play" element={<TimelinePlayerPage />} />
              <Route
                path="/projects/:id/board"
                element={
                  <Suspense
                    fallback={<div className="p-6 text-sm text-muted-foreground">{t('board.loading')}</div>}
                  >
                    <BoardPage scope="project" />
                  </Suspense>
                }
              />
              <Route
                path="/assets/:id/board"
                element={
                  <Suspense
                    fallback={<div className="p-6 text-sm text-muted-foreground">{t('board.loading')}</div>}
                  >
                    <BoardPage scope="asset" />
                  </Suspense>
                }
              />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/:section" element={<AdminPage />} />
              <Route path="/admin/:section/:id" element={<AdminPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              {/* Fiche publique d'un membre du studio (annuaire de présence, auteurs). */}
              <Route path="/users/:id" element={<UserProfilePage />} />
              <Route path="/docs" element={<DocsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
