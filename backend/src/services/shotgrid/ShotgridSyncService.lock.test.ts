// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le verrou « une synchronisation à la fois » était posé APRÈS `await openConnection(...)`.
 *
 * Node ne préempte pas, mais il rend la main sur chaque `await` : une rafale d'événements
 * ShotGrid entrait tout entière dans `runSync`, attendait la connexion, puis trouvait le
 * verrou encore libre — et chacun le posait à son tour. Le journal du studio en portait la
 * trace : quinze synchronisations en onze secondes, toutes sur les mêmes 47 entités.
 *
 * Ce test rejoue exactement cette rafale : plusieurs appels lancés sans attendre entre eux,
 * sur une connexion volontairement lente à ouvrir.
 */

const { openConnection } = vi.hoisted(() => ({ openConnection: vi.fn() }));

vi.mock('./ShotgridConfigService', () => ({
  openConnection,
  markStatus: vi.fn(),
}));
vi.mock('./ShotgridSyncJournal', () => ({
  SyncJournal: {
    start: vi.fn().mockResolvedValue({
      runId: 1,
      count: vi.fn(),
      log: vi.fn(),
      finish: vi.fn(),
      stats: () => ({}),
    }),
  },
}));
vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { runSync } from './ShotgridSyncService';

/** Connexion inactive : la passe s'arrête juste après le verrou, sans toucher au réseau. */
const slowInactiveConnection = (delayMs: number) =>
  openConnection.mockImplementation(
    async () =>
      new Promise((resolve) => setTimeout(() => resolve({ connection: { id: 7, active: false } }), delayMs)),
  );

beforeEach(() => vi.clearAllMocks());

describe('runSync — verrou pris avant toute attente', () => {
  it('une rafale de cinq demandes n’ouvre la connexion qu’une fois', async () => {
    slowInactiveConnection(20);

    // Lancées sans `await` entre elles : c'est la rafale de webhooks.
    const results = await Promise.all([runSync(461), runSync(461), runSync(461), runSync(461), runSync(461)]);

    expect(openConnection).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'deferred')).toHaveLength(4);
  });

  it('deux projets différents ne se bloquent pas l’un l’autre', async () => {
    slowInactiveConnection(10);

    const [a, b] = await Promise.all([runSync(461), runSync(462)]);

    expect(openConnection).toHaveBeenCalledTimes(2);
    expect(a.status).not.toBe('deferred');
    expect(b.status).not.toBe('deferred');
  });

  it('libère le verrou quand la connexion est injoignable', async () => {
    openConnection.mockRejectedValueOnce(new Error('site injoignable'));
    await expect(runSync(461)).rejects.toThrow('site injoignable');

    // Sans libération, le projet restait verrouillé jusqu'au redémarrage du worker.
    slowInactiveConnection(0);
    await expect(runSync(461)).resolves.toMatchObject({ status: 'ok' });
  });
});
