// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: {
    userSession: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    apiToken: { updateMany: vi.fn() },
  },
}));
vi.mock('./redis', () => ({ publishRedis: vi.fn() }));

import {
  revokeSession,
  revokeAllSessions,
  revokeAllCredentials,
  markSessionsRevoked,
  decodeSessionRevocation,
  encodeSessionRevocation,
  isSessionActive,
  SESSION_REVOCATION_CHANNEL,
} from './sessions';
import { prisma } from './prisma';
import { publishRedis } from './redis';

/** Les `sid` publiés lors du dernier appel, décodés avec le décodeur de production. */
const published = (): string[][] =>
  vi
    .mocked(publishRedis)
    .mock.calls.filter((c) => c[0] === SESSION_REVOCATION_CHANNEL)
    .map((c) => decodeSessionRevocation(c[1]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.userSession.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }] as never);
  vi.mocked(prisma.userSession.updateMany).mockResolvedValue({ count: 2 });
  vi.mocked(prisma.apiToken.updateMany).mockResolvedValue({ count: 1 });
});

/**
 * A3-02, volet immédiat. Le cache de validité est **par process** et le balayage des sockets
 * tourne à la minute : révoquer une session laissait l'onglet du partant recevoir les
 * commentaires internes du projet pendant une minute, et les autres répliques répondre
 * « session vivante » pendant trente secondes. La révocation doit donc s'annoncer.
 */
describe('révocation — publication sur le canal partagé', () => {
  it('annonce le sid révoqué par `revokeSession`', async () => {
    vi.mocked(prisma.userSession.updateMany).mockResolvedValue({ count: 1 });
    await expect(revokeSession('sid-morte')).resolves.toBe(true);
    expect(published()).toEqual([['sid-morte']]);
  });

  // Une session déjà révoquée (ou appartenant à quelqu'un d'autre) ne met rien à jour :
  // annoncer quand même réveillerait toutes les répliques pour rien.
  it('n’annonce rien quand la révocation n’a rien changé', async () => {
    vi.mocked(prisma.userSession.updateMany).mockResolvedValue({ count: 0 });
    await expect(revokeSession('sid-inconnue')).resolves.toBe(false);
    expect(published()).toEqual([]);
  });

  it('annonce toutes les sessions d’une révocation en masse', async () => {
    await revokeAllSessions(42);
    expect(published()).toEqual([['a', 'b']]);
  });

  /**
   * Le point qui ferait le plus mal s'il était raté : « révoquer toutes mes sessions » ne
   * doit pas déconnecter l'auteur de l'action. La session épargnée est exclue du `where`,
   * donc absente de la liste lue — et donc absente de l'annonce.
   */
  it('n’annonce jamais la session épargnée', async () => {
    vi.mocked(prisma.userSession.findMany).mockResolvedValue([{ id: 'a' }] as never);
    await revokeAllSessions(42, 'sid-courante');
    const where = vi.mocked(prisma.userSession.findMany).mock.calls[0]![0]!.where as Record<string, unknown>;
    expect(where).toMatchObject({ id: { not: 'sid-courante' } });
    expect(published()).toEqual([['a']]);
    expect(published()[0]).not.toContain('sid-courante');
  });

  // Offboarding / changement de mot de passe passent par là : l'annonce doit suivre.
  it('annonce aussi lors d’une reprise en main de compte', async () => {
    await revokeAllCredentials(42);
    expect(published()).toEqual([['a', 'b']]);
  });
});

describe('contrat du canal de révocation', () => {
  it('fait l’aller-retour', () => {
    expect(decodeSessionRevocation(encodeSessionRevocation(['x', 'y']))).toEqual(['x', 'y']);
  });

  /**
   * Le canal est partagé et rien ne garantit ce qu'on y lit : un abonné pub/sub qui jette
   * tue le gestionnaire, pas seulement le message.
   */
  it('avale ce qui n’est pas lisible plutôt que de jeter', () => {
    expect(decodeSessionRevocation('{pas du json')).toEqual([]);
    expect(decodeSessionRevocation('{"sids":"pas un tableau"}')).toEqual([]);
    expect(decodeSessionRevocation('null')).toEqual([]);
    expect(decodeSessionRevocation('{"sids":[1,"",null,"ok"]}')).toEqual(['ok']);
  });
});

/**
 * Fermer le socket sans tomber le cache serait cosmétique : `isSessionActive` répondrait
 * encore « vivante » jusqu'à trente secondes, et l'API rouvrirait la porte que le canal
 * temps réel vient de fermer.
 */
describe('markSessionsRevoked — le cache de la réplique tombe tout de suite', () => {
  it('rend la session invalide sans aller en base', async () => {
    markSessionsRevoked(['sid-distante']);
    await expect(isSessionActive('sid-distante')).resolves.toBe(false);
    expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
  });
});
