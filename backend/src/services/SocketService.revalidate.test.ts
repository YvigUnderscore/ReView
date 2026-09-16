// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getAuthUser, isSessionActive } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  isSessionActive: vi.fn(),
}));

vi.mock('../lib/userCache', () => ({ getAuthUser }));
// `SocketService` importe aussi le contrat du canal de révocation immédiate (A3-02) : un
// export absent d'un double fait échouer vitest à l'accès, même si ce fichier ne l'exerce pas.
vi.mock('../lib/sessions', () => ({
  isSessionActive,
  SESSION_REVOCATION_CHANNEL: 'review:session-revoked',
  decodeSessionRevocation: vi.fn(() => []),
  markSessionsRevoked: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { Role } from '@prisma/client';
import { revalidateSocket, sweepSockets, type AuthedSocket } from './SocketService';

const active = { id: 7, email: 'sup@studio.com', role: Role.SUPERVISOR, disabledAt: null };

/** Socket minimal : seuls l'identité posée au handshake et la déconnexion nous intéressent. */
const socketOf = (over: Partial<AuthedSocket> = {}): AuthedSocket =>
  ({
    user: { id: 7, email: 'sup@studio.com', role: Role.SUPERVISOR },
    authSid: 'sid-1',
    disconnect: vi.fn(),
    ...over,
  }) as unknown as AuthedSocket;

beforeEach(() => {
  vi.clearAllMocks();
  isSessionActive.mockResolvedValue(true);
  getAuthUser.mockResolvedValue(active);
});

/**
 * A3-02 — `authenticateSocket` ne s'exécute qu'au handshake : ensuite `socket.user` est figé
 * et la connexion vit tant que le transport tient, c'est-à-dire des jours. Révoquer une
 * session ou rétrograder un rôle coupait l'API en trente secondes sans rien changer au canal
 * temps réel : l'onglet resté ouvert continuait de recevoir les commentaires internes du
 * projet, et son ancien rôle lui rouvrait `join_project`.
 */
describe('revalidateSocket — la porte se rejoue', () => {
  it('ferme une connexion dont la session a été révoquée', async () => {
    isSessionActive.mockResolvedValue(false);
    expect(await revalidateSocket(socketOf())).toBe(false);
  });

  it('ferme une connexion dont le compte a été désactivé', async () => {
    getAuthUser.mockResolvedValue({ ...active, disabledAt: new Date() });
    expect(await revalidateSocket(socketOf())).toBe(false);
  });

  it('ferme une connexion dont le compte a disparu', async () => {
    getAuthUser.mockResolvedValue(null);
    expect(await revalidateSocket(socketOf())).toBe(false);
  });

  /**
   * Le point dur : `join_project` lit `socket.user.role`, et `resolveProjectAccess` accorde
   * un accès global à ADMIN comme à SUPERVISOR. Vérifier sans réécrire aurait laissé
   * l'ancien superviseur rejoindre n'importe quel projet depuis son onglet ouvert.
   */
  it('remplace le rôle figé par le rôle courant', async () => {
    getAuthUser.mockResolvedValue({ ...active, role: Role.CLIENT });
    const socket = socketOf();
    expect(await revalidateSocket(socket)).toBe(true);
    expect(socket.user?.role).toBe(Role.CLIENT);
  });

  // Un jeton d'avant la phase 36 n'a pas de session à vérifier : rien ne peut le révoquer.
  it('ferme une connexion sans session identifiée', async () => {
    expect(await revalidateSocket(socketOf({ authSid: undefined }))).toBe(false);
  });

  // Un invité de partage n'a ni session ni rôle : son accès tient au ShareLink, revérifié
  // côté API à chaque lecture. Rien à rejouer, et surtout rien à couper.
  it('laisse tranquille un invité arrivé par un lien de partage', async () => {
    const guest = socketOf({ user: undefined, shareProjectId: 3 });
    expect(await revalidateSocket(guest)).toBe(true);
    expect(isSessionActive).not.toHaveBeenCalled();
  });
});

describe('sweepSockets — balayage de la réplique', () => {
  const serverOf = (...sockets: AuthedSocket[]) =>
    ({ sockets: { sockets: new Map(sockets.map((s, i) => [String(i), s])) } }) as never;

  it('déconnecte celles qui ne valent plus, garde les autres', async () => {
    const revoked = socketOf({ authSid: 'morte' });
    const kept = socketOf({ authSid: 'sid-1' });
    isSessionActive.mockImplementation((sid: string) => Promise.resolve(sid !== 'morte'));

    await sweepSockets(serverOf(revoked, kept));

    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(kept.disconnect).not.toHaveBeenCalled();
  });

  // Une panne de base ou de Redis ne doit pas déconnecter tout le studio : le contrôle qui
  // échoue garde la connexion (l'API, elle, échoue fermé de son côté).
  it('conserve la connexion quand le contrôle lui-même échoue', async () => {
    isSessionActive.mockRejectedValue(new Error('redis down'));
    const socket = socketOf();

    await sweepSockets(serverOf(socket));

    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});
