// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { mockApi, httpError, type ApiMock, type MockRequest } from '../../test/apiMock';
import { createTestQueryClient } from '../../test/renderWithProviders';
import { FIRST_PAGE, type Page } from './infiniteList';
import { useInfiniteList } from './useInfiniteList';

/**
 * Le mode « toutes les pages » (`all`) sert les sélecteurs : assigner un asset au 1 500e
 * plan suppose que le 1 500e plan soit dans la liste. Ce qui se joue ici n'est donc pas la
 * vitesse pour elle-même mais le nombre d'allers-retours en série — un curseur ne se
 * parallélise pas, chaque page réclamant celui de la précédente.
 */

interface Row {
  id: number;
}

const rows = (from: number, count: number): Row[] =>
  Array.from({ length: Math.max(0, count) }, (_, i) => ({ id: from + i }));

/** Serveur à curseur — celui de `/api/shots` : le curseur porte le nombre de lignes servies. */
function cursorServer(total: number, onCall?: (req: MockRequest) => unknown) {
  return (req: MockRequest): unknown => {
    const held = onCall?.(req);
    const size = Number(req.url.searchParams.get('pageSize') ?? 100);
    const from = Number(req.url.searchParams.get('cursor') ?? 0);
    const items = rows(from + 1, Math.min(size, total - from));
    const served = from + items.length;
    const page: Page<Row> = {
      items,
      total,
      page: Number(req.url.searchParams.get('page') ?? 1),
      pageSize: size,
      nextCursor: served < total ? String(served) : null,
    };
    return held instanceof Promise ? held.then(() => page) : page;
  };
}

/** Serveur page/pageSize — celui de `/api/projects` : le décalage se calcule en pages. */
function pagedServer(total: number) {
  return (req: MockRequest): Page<Row> => {
    const size = Number(req.url.searchParams.get('pageSize') ?? 100);
    const index = Number(req.url.searchParams.get('page') ?? 1);
    const from = (index - 1) * size;
    const items = rows(from + 1, Math.min(size, total - from));
    return { items, total, page: index, pageSize: size, hasMore: from + items.length < total };
  };
}

let api: ApiMock | null = null;
let qc: QueryClient | null = null;

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

afterEach(() => {
  api?.restore();
  api = null;
  qc?.clear();
  qc = null;
});

const sizes = (mock: ApiMock): (string | null)[] => mock.calls.map((c) => c.url.searchParams.get('pageSize'));

describe('useInfiniteList — mode « toutes les pages »', () => {
  it('peuple un sélecteur de 2 000 plans en quatre requêtes au lieu de vingt', async () => {
    api = mockApi({ 'GET /api/shots': cursorServer(2000) });
    qc = createTestQueryClient();
    const { result } = renderHook(
      () => useInfiniteList<Row>(['shots', 1], '/api/shots?projectId=1', { all: true }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.isComplete).toBe(true), { timeout: 5000 });
    // La liste reste complète et dans l'ordre : un sélecteur tronqué ou mélangé serait un
    // défaut bien pire que sa lenteur.
    expect(result.current.data).toHaveLength(2000);
    expect(result.current.data?.[0]?.id).toBe(1);
    expect(result.current.data?.[1999]?.id).toBe(2000);
    expect(result.current.total).toBe(2000);
    expect(api.calls).toHaveLength(4);
    expect(sizes(api)).toEqual(['500', '500', '500', '500']);
  });

  it('reprend à la taille que le serveur a servie, pas à celle demandée', async () => {
    // Deux écrans partagent une clé de cache (le rail latéral et la page des projets, la
    // modale et l'onglet) sans partager l'option `all` : la page 1 peut déjà être en
    // cache, servie par 100. En pagination par numéro de page, enchaîner sur une page 2
    // de 500 sauterait les lignes 101 à 500 — la liste mentirait en se croyant complète.
    api = mockApi({ 'GET /api/projects': pagedServer(300) });
    qc = createTestQueryClient();
    const first: Page<Row> = { items: rows(1, 100), total: 300, page: 1, pageSize: 100, hasMore: true };
    qc.setQueryData(['projects'], { pages: [first], pageParams: [FIRST_PAGE] });

    const { result } = renderHook(
      // `staleTime` non nul : sans lui le montage refetcherait la page 1 déjà en cache et
      // le scénario — poursuivre une liste commencée par un autre écran — s'évanouirait.
      () => useInfiniteList<Row>(['projects'], '/api/projects', { all: true, staleTime: 60_000 }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.isComplete).toBe(true), { timeout: 5000 });
    expect(result.current.data).toHaveLength(300);
    expect(result.current.data?.map((r) => r.id)).toEqual(rows(1, 300).map((r) => r.id));
    expect(sizes(api)).toEqual(['100', '100']);
  });

  it('ne cache le sélecteur qu’une fois la liste entière arrivée', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    api = mockApi({
      'GET /api/shots': cursorServer(1000, (req) =>
        req.url.searchParams.get('cursor') === '500' ? held : undefined,
      ),
    });
    qc = createTestQueryClient();
    const { result } = renderHook(
      () => useInfiniteList<Row>(['shots', 2], '/api/shots?projectId=2', { all: true }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(500));
    // La première page est là, la seconde pas encore : le sélecteur ne doit pas se
    // déclarer prêt sur une moitié de liste.
    expect(result.current.isComplete).toBe(false);
    release();
    await waitFor(() => expect(result.current.isComplete).toBe(true), { timeout: 5000 });
    expect(result.current.data).toHaveLength(1000);
  });

  it('se déclare terminé quand une page échoue — sinon le sélecteur attendrait sans fin', async () => {
    api = mockApi({ 'GET /api/shots': httpError(500, 'boom') });
    qc = createTestQueryClient();
    const { result } = renderHook(
      () => useInfiniteList<Row>(['shots', 3], '/api/shots?projectId=3', { all: true }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isComplete).toBe(true);
  });
});

describe('useInfiniteList — pagination à la demande', () => {
  it('ne demande ni taille ni page de plus quand l’appelant pagine lui-même', async () => {
    api = mockApi({ 'GET /api/shots': cursorServer(2000) });
    qc = createTestQueryClient();
    const { result } = renderHook(() => useInfiniteList<Row>(['shots', 4], '/api/shots?projectId=4', {}), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.data).toHaveLength(100));
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.url.searchParams.has('pageSize')).toBe(false);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.isComplete).toBe(false);
  });

  it('respecte une taille de page explicite, même en mode « toutes les pages »', async () => {
    api = mockApi({ 'GET /api/shots': cursorServer(300) });
    qc = createTestQueryClient();
    const { result } = renderHook(
      () => useInfiniteList<Row>(['shots', 5], '/api/shots?projectId=5', { all: true, pageSize: 150 }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.isComplete).toBe(true), { timeout: 5000 });
    expect(result.current.data).toHaveLength(300);
    expect(sizes(api)).toEqual(['150', '150']);
  });
});
