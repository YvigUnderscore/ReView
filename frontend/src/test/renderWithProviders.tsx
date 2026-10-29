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
 * Mount a screen the way the application mounts it.
 *
 * A rendering test is only worth something if it goes through the same layers as production:
 * the router (pages read `useParams`, navigate, write into the query string), the
 * query client (cache, invalidations, loading states), the session (the role
 * decides half of what is displayed), and the network (blocked at the `fetch` level, not at the
 * module level). Everything that stays mocked remains mocked **deliberately**, and is stated
 * in the signature.
 *
 * Each call starts from a fresh `QueryClient`: two tests of the same file cannot
 * pass each other a cache, and a test that passes alone also passes in the suite.
 *
 * ```tsx
 * const { api, user } = renderWithProviders(<ProjectsPage />, {
 *   api: { 'GET /api/projects': page([{ id: 1, name: 'Alpha' }]) },
 * });
 * await user.click(await screen.findByRole('button', { name: t('common.create') }));
 * ```
 */

/** Default session: an administrator, the role that opens the most screens. */
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
 * Answers set by default: the API endpoints that the shell queries on almost every
 * screen (visual identity, bell, favorites, preferences, watermark). Without them, each
 * test would have to redeclare them in order to do nothing with them. A route of the same name passed as an option
 * replaces them: this is the normal mechanism when a test is interested in them.
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
  /** Starting URL (`/projects/12?tab=shots`). */
  route?: string;
  /** Route pattern under which to mount the screen: it is what feeds `useParams`. */
  path?: string;
  /** Server responses, key `'METHOD /path'` (cf. `apiMock`). */
  api?: Record<string, MockResolver>;
  /**
   * Session: `undefined` = default administrator, `null` = signed out, a partial object
   * to change only what matters (`{ role: 'ARTIST' }`).
   */
  user?: Partial<AuthUser> | null;
  /** Additional destinations, to observe a navigation. */
  extraRoutes?: ReactNode;
}

export interface RenderWithProvidersResult extends RenderResult {
  api: ApiMock;
  queryClient: QueryClient;
  /** `userEvent` already configured (pointer, keyboard). */
  user: UserEvent;
  /** Current URL of the memory router: `expect(currentPath()).toBe('/')`. */
  currentPath: () => string;
}

/** Test query client: no retry, no cache between two tests. */
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
    // The persisted stores (list/grid view, language, theme) are module
    // singletons: without this cleanup, one test tints the next.
    localStorage.clear();
    sessionStorage.clear();
  });

  return { ...result, api, queryClient, user: userEvent.setup(), currentPath };
}

/** Paginated list envelope from the backend: `page([...], { total: 42 })`. */
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
