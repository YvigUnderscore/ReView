// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

/**
 * Le pont socket mesuré en REQUÊTES, pas en intentions.
 *
 * Un lot de statuts sur trente plans émettait trente `shot:update` ; chacun déclenchait
 * cinq invalidations, dont le kanban entier — la lecture la plus lourde de l'application.
 * Huit artistes ayant le kanban ouvert, un seul geste de production faisait partir des
 * centaines de requêtes, presque toutes annulées en vol. On compte ici les appels de
 * `queryFn` : c'est exactement le nombre de requêtes HTTP qu'un navigateur aurait émises.
 */

/** Faux socket : les gestionnaires sont déclenchés à la main, sans réseau. */
const handlers = new Map<string, Set<(payload: unknown) => void>>();
const socket = {
  on(event: string, fn: (payload: unknown) => void) {
    const set = handlers.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(fn);
    handlers.set(event, set);
  },
  off(event: string, fn: (payload: unknown) => void) {
    handlers.get(event)?.delete(fn);
  },
  emit: vi.fn(),
};
const fire = (event: string, payload: unknown): void => {
  for (const fn of [...(handlers.get(event) ?? [])]) fn(payload);
};

vi.mock('../../lib/socket', () => ({ getSocket: () => socket }));

import { useSocketInvalidation, COALESCE_WINDOW_MS, dropRedundantKeys } from './socketBridge';
import { qk } from './query';

const PROJECT = 1;
const SHOT = 7;

let calls: Record<string, number>;
const counted = (name: string) => () => {
  calls[name] = (calls[name] ?? 0) + 1;
  return Promise.resolve({ name });
};

/** Un écran qui tient le kanban, la liste des plans et la fiche d'un plan ouverts. */
function Screen() {
  useSocketInvalidation(PROJECT);
  useQuery({ queryKey: qk.projectBoard(PROJECT), queryFn: counted('board') });
  useQuery({ queryKey: qk.shots(PROJECT), queryFn: counted('shots') });
  useQuery({ queryKey: qk.projectActivity(PROJECT), queryFn: counted('activity') });
  useQuery({ queryKey: qk.shot(SHOT), queryFn: counted('shot') });
  useQuery({ queryKey: qk.shotTree(SHOT), queryFn: counted('shotTree') });
  return null;
}

/** Laisse courir les minuteries (fenêtre de regroupement) et les promesses en attente. */
const settle = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const mount = async (): Promise<void> => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } },
  });
  render(
    <QueryClientProvider client={client}>
      <Screen />
    </QueryClientProvider>,
  );
  // Premier chargement : cinq requêtes, que l'on remet à zéro avant de mesurer.
  await settle();
  calls = {};
};

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  calls = {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSocketInvalidation — regroupement des invalidations', () => {
  it('un lot de trente plans ne recharge le kanban qu’une fois', async () => {
    await mount();

    // Ce que faisait le serveur avant le correctif : un événement par plan.
    for (let id = 1; id <= 30; id++) fire('shot:update', { projectId: PROJECT, id });
    await settle(COALESCE_WINDOW_MS * 2);

    // Mesuré avant le correctif sur ce même écran : 93 requêtes
    // (30 kanban + 30 listes de plans + 30 activités + 1 fiche + 2 arbres).
    expect(calls).toEqual({ board: 1, shots: 1, activity: 1, shot: 1, shotTree: 1 });
  });

  it('un événement de lot (`ids`) rafraîchit chaque plan du lot sans multiplier les listes', async () => {
    await mount();

    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    // Ce que fait le serveur après le correctif : UN événement décrivant le lot.
    fire('shot:update', { projectId: PROJECT, id: ids[0], ids: [...ids, SHOT] });
    await settle(COALESCE_WINDOW_MS * 2);

    // Le plan ouvert fait partie du lot : sa fiche se met à jour, une seule fois.
    expect(calls).toEqual({ board: 1, shots: 1, activity: 1, shot: 1, shotTree: 1 });
  });

  it('un changement isolé reste visible tout de suite', async () => {
    await mount();

    fire('shot:update', { projectId: PROJECT, id: SHOT });
    // Sans avancer d'une seule fenêtre : le premier événement d'une rafale part au plus tôt.
    await settle();

    expect(calls.board ?? 0).toBe(1);
    expect(calls.shot ?? 0).toBe(1);
  });

  it('un second changement, plus tard, recharge de nouveau — la fenêtre n’endort pas l’écran', async () => {
    await mount();

    fire('shot:update', { projectId: PROJECT, id: SHOT });
    await settle(COALESCE_WINDOW_MS * 3);
    fire('shot:update', { projectId: PROJECT, id: SHOT });
    await settle(COALESCE_WINDOW_MS * 3);

    expect(calls.board ?? 0).toBe(2);
  });

  it('une clé et son préfixe ne déclenchent pas deux requêtes sur la même fiche', async () => {
    await mount();

    // `shot:update` invalidait `['shot', id]` PUIS `['shot', id, 'tree']` : la seconde
    // invalidation annulait la requête d'arbre déjà partie et en relançait une.
    fire('shot:update', { projectId: PROJECT, id: SHOT });
    await settle(COALESCE_WINDOW_MS * 2);

    expect(calls.shotTree ?? 0).toBe(1);
  });

  it('les plans hors du lot ne sont pas rechargés', async () => {
    await mount();

    fire('shot:update', { projectId: PROJECT, id: SHOT + 100 });
    await settle(COALESCE_WINDOW_MS * 2);

    expect(calls.shot ?? 0).toBe(0);
    expect(calls.board ?? 0).toBe(1);
  });
});

describe('dropRedundantKeys', () => {
  it('garde le préfixe et jette la clé qu’il couvre déjà', () => {
    const kept = dropRedundantKeys([
      ['shot', 7],
      ['shot', 7, 'tree'],
      ['tasks', 'board', 1],
    ]);
    expect(kept).toEqual([
      ['shot', 7],
      ['tasks', 'board', 1],
    ]);
  });

  it('ne touche pas à des clés sœurs', () => {
    const keys = [
      ['shot', 7],
      ['shot', 8],
    ];
    expect(dropRedundantKeys(keys)).toEqual(keys);
  });

  it('laisse passer une clé vide seule et absorbe tout le reste avec elle', () => {
    expect(dropRedundantKeys([[], ['shot', 7]])).toEqual([[]]);
  });
});
