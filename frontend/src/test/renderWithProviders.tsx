// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ReactElement, type ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import { onTestFinished } from 'vitest';
import { useAuth, type AuthUser } from '../v2/stores/useAuth';
import { useTheme } from '../v2/stores/useTheme';
import { mockApi, type ApiMock, type MockResolver } from './apiMock';
import { LocationSpy } from './LocationSpy';

/**
 * Monter un écran comme l'application le monte.
 *
 * Un test de rendu n'a d'intérêt que s'il traverse les mêmes couches que la production :
 * le routeur (les pages lisent `useParams`, naviguent, écrivent dans la query-string), le
 * client de requêtes (cache, invalidations, états de chargement), la session (le rôle
 * décide de la moitié de ce qui s'affiche) et le réseau (bouché au niveau `fetch`, pas au
 * niveau des modules). Tout ce qui reste bouchonné le reste **volontairement** et se dit
 * dans la signature.
 *
 * Chaque appel repart d'un `QueryClient` neuf : deux tests d'un même fichier ne peuvent
 * pas se transmettre un cache, et un test qui passe seul passe aussi en suite.
 *
 * ```tsx
 * const { api, user } = renderWithProviders(<ProjectsPage />, {
 *   api: { 'GET /api/projects': page([{ id: 1, name: 'Alpha' }]) },
 * });
 * await user.click(await screen.findByRole('button', { name: t('common.create') }));
 * ```
 */

/** Session par défaut : un administrateur, le rôle qui ouvre le plus d'écrans. */
const DEFAULT_USER: AuthUser = {
  id: 1,
  email: 'admin@review.local',
  name: 'Ada Lovelace',
  displayName: 'Ada Lovelace',
  initials: 'AL',
  avatarUrl: null,
  status: 'AVAILABLE',
  role: 'ADMIN',
};

/**
 * Réponses posées d'office : les points d'API que la coquille interroge sur presque tout
 * écran (identité visuelle, cloche, favoris, préférences, filigrane). Sans elles, chaque
 * test devrait les redéclarer pour ne rien en faire. Une route homonyme passée en option
 * les remplace — c'est le mécanisme normal quand un test s'y intéresse.
 */
const DEFAULT_API: Record<string, MockResolver> = {
  'GET /api/setup/status': { needsSetup: false },
  'GET /api/studio/branding': {
    name: 'Test Studio',
    accent: null,
    logoUrl: null,
    sourceUrl: 'https://example.invalid/source',
  },
  'GET /api/auth/oidc/status': { enabled: false, label: '', logoUrl: null, passwordLogin: true },
  'GET /api/notifications': { notifications: [], unread: 0 },
  'GET /api/favorites': { favorites: [] },
  'GET /api/users/me/preferences': { preferences: {} },
  'GET /api/studio/watermark': { watermark: { internal: false, shares: false, opacity: 0.08 } },
  'GET /api/review-statuses': { statuses: [] },
};

export interface RenderWithProvidersOptions {
  /** URL de départ (`/projects/12?tab=shots`). */
  route?: string;
  /** Motif de route sous lequel monter l'écran — c'est lui qui alimente `useParams`. */
  path?: string;
  /** Réponses du serveur, clé `'MÉTHODE /chemin'` (cf. `apiMock`). */
  api?: Record<string, MockResolver>;
  /**
   * Session : `undefined` = administrateur par défaut, `null` = déconnecté, un objet
   * partiel pour ne changer que ce qui compte (`{ role: 'ARTIST' }`).
   */
  user?: Partial<AuthUser> | null;
  /** Destinations supplémentaires, pour observer une navigation. */
  extraRoutes?: ReactNode;
}

export interface RenderWithProvidersResult extends RenderResult {
  api: ApiMock;
  queryClient: QueryClient;
  /** `userEvent` déjà configuré (pointeur, clavier). */
  user: UserEvent;
  /** URL courante du routeur mémoire — `expect(currentPath()).toBe('/')`. */
  currentPath: () => string;
}

/** Client de requêtes de test : pas de relance, pas de cache entre deux tests. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const { route = '/', path = '*', api: routes = {}, user: session, extraRoutes } = options;

  const api = mockApi({ ...DEFAULT_API, ...routes });
  const queryClient = createTestQueryClient();
  const resolvedUser = session === null ? null : ({ ...DEFAULT_USER, ...(session ?? {}) } satisfies AuthUser);
  useAuth.setState({ user: resolvedUser, ready: true });

  let path_ = route;
  const currentPath = () => path_;

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="always">
        <MemoryRouter initialEntries={[route]}>
          <LocationSpy
            onChange={(p) => {
              path_ = p;
            }}
          />
          <Routes>
            <Route path={path} element={ui} />
            {extraRoutes}
          </Routes>
          <Toaster theme={useTheme.getState().theme} />
        </MemoryRouter>
      </MotionConfig>
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    api.restore();
    queryClient.clear();
    useAuth.setState({ user: null, ready: false });
    // Les stores persistés (vue liste/grille, langue, thème) sont des singletons de
    // module : sans ce nettoyage, un test en teinte le suivant.
    localStorage.clear();
    sessionStorage.clear();
  });

  return { ...result, api, queryClient, user: userEvent.setup(), currentPath };
}

/** Enveloppe de liste paginée du backend — `page([...], { total: 42 })`. */
export function page<T>(
  items: T[],
  extra: { total?: number; hasMore?: boolean; nextCursor?: string | null } = {},
): { items: T[]; total: number; page: number; pageSize: number; hasMore: boolean } & {
  nextCursor?: string | null;
} {
  return {
    items,
    total: extra.total ?? items.length,
    page: 1,
    pageSize: 100,
    hasMore: extra.hasMore ?? false,
    ...(extra.nextCursor !== undefined ? { nextCursor: extra.nextCursor } : {}),
  };
}
