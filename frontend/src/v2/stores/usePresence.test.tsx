// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * L'annuaire de présence mesuré en REQUÊTES et en TRAMES, pas en intentions (A5-08).
 *
 * L'annuaire complet du studio — une ligne par compte, avec une URL d'avatar présignée
 * calculée côté serveur — était chargé dans un `useEffect` propre à chaque consommateur,
 * hors TanStack Query : deux composants montés ensemble faisaient deux requêtes, et
 * chaque ouverture du sélecteur de personnes en refaisait une de plus. Sur 120 comptes la
 * réponse pèse ~70 ko. On compte ici les appels à `api.get` : c'est exactement le nombre
 * de requêtes HTTP qu'un navigateur aurait émises.
 *
 * Second volet : chaque frappe et chaque clic émettaient une trame socket `activity`.
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
const emitActivity = vi.fn();

vi.mock('../../lib/socket', () => ({ getSocket: () => socket, emitActivity: () => emitActivity() }));

/** Compteur de requêtes : la mesure du constat. */
let calls: string[] = [];

/** Huit comptes, comme la réponse réellement mesurée (4 724 octets). */
const directory = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  email: `p${i + 1}@studio.test`,
  displayName: `Person ${i + 1}`,
  initials: 'PX',
  avatarUrl: null,
  status: 'AVAILABLE' as const,
  lastSeenAt: null,
  online: i === 0,
}));

vi.mock('../../lib/apiClient', () => ({
  api: {
    get: (url: string) => {
      calls.push(url);
      return Promise.resolve({ users: directory });
    },
  },
}));

import { usePresence } from './usePresence';
import { usePresenceBridge, ACTIVITY_THROTTLE_MS } from '../lib/socketBridge';

const presenceCalls = (): string[] => calls.filter((u) => u.startsWith('/api/users/presence'));

/** Tient l'annuaire ouvert — c'est ce que font SocialPanel et PeoplePicker, à l'identique. */
function Directory() {
  const { users } = usePresence();
  // Rendu dans le DOM plutôt que remonté par effet de bord : le test lit ce que la
  // personne devant l'écran verrait, et non un état interne.
  return (
    <span data-testid="online">
      {users
        .filter((u) => u.online)
        .map((u) => u.id)
        .join(',')}
    </span>
  );
}

/** Le pont temps réel, monté une fois pour toute l'application (Shell). */
function Bridge() {
  usePresenceBridge();
  return null;
}

function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const newClient = (): QueryClient => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Laisse partir la requête et arriver sa réponse. */
/**
 * Laisse passer un tour de boucle — suffisant pour une écriture SYNCHRONE dans le cache de
 * Query (la poussée socket), jamais pour l'arrivée d'une requête.
 *
 * Attendre une donnée qui vient du réseau se fait par `waitFor`, qui réessaie : depuis que
 * l'annuaire passe par TanStack Query, sa résolution s'étale sur plusieurs tours et un unique
 * `setTimeout(0)` ne suffisait plus dès que la machine était chargée — le test passait seul et
 * tombait dans la suite complète.
 */
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

beforeEach(() => {
  handlers.clear();
  calls = [];
  emitActivity.mockClear();
  socket.emit.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePresence — annuaire du studio', () => {
  it("ne charge l'annuaire qu'une fois pour plusieurs consommateurs et plusieurs montages", async () => {
    const client = newClient();
    // Le panneau social est monté en permanence par la barre latérale.
    const panel = render(
      <Providers client={client}>
        <Bridge />
        <Directory />
      </Providers>,
    );
    await waitFor(() => expect(presenceCalls()).toHaveLength(1));

    // Le sélecteur de personnes, lui, est ouvert puis refermé — ici cinq fois.
    for (let i = 0; i < 5; i++) {
      const picker = render(
        <Providers client={client}>
          <Directory />
        </Providers>,
      );
      await settle();
      picker.unmount();
    }
    panel.unmount();

    expect(presenceCalls()).toHaveLength(1);
  });

  it('garde le temps réel : une poussée socket bascule « en ligne » sans recharger', async () => {
    const client = newClient();
    render(
      <Providers client={client}>
        <Bridge />
        <Directory />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByTestId('online')).toHaveTextContent('1'));

    fire('presence:update', { onlineUserIds: [2, 3] });
    await settle();

    expect(screen.getByTestId('online')).toHaveTextContent('2,3');
    // La poussée écrit dans le cache : elle ne redemande pas l'annuaire au serveur.
    expect(presenceCalls()).toHaveLength(1);
  });

  it("n'émet qu'une trame d'activité pour une phrase entière tapée", async () => {
    vi.useFakeTimers();
    const client = newClient();
    render(
      <Providers client={client}>
        <Bridge />
        <Directory />
      </Providers>,
    );
    const tick = async (ms: number): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    await tick(0);

    // Le montage signale la présence une fois, sans attendre le seuil.
    expect(emitActivity).toHaveBeenCalledTimes(1);

    // Quarante caractères frappés dans une note de review, en moins d'une seconde.
    for (let i = 0; i < 40; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(emitActivity).toHaveBeenCalledTimes(1);

    // Passé le seuil, l'activité est de nouveau signalée : on étrangle, on ne coupe pas.
    await tick(ACTIVITY_THROTTLE_MS);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(emitActivity).toHaveBeenCalledTimes(2);
  });
});
