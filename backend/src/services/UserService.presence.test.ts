// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({ db: { user: { findMany: vi.fn() } } }));
vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./PresenceService', () => ({ getOnlineUserIds: () => [1] }));
vi.mock('../lib/userView', () => ({
  toPublicUser: (u: { id: number; email: string }) =>
    Promise.resolve({ id: u.id, email: u.email, displayName: 'x', initials: 'x', avatarUrl: null }),
}));

import { listPresence } from './UserService';
import { Role } from '@prisma/client';

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findMany.mockResolvedValue([{ id: 1, email: 'a@b.c' }]);
});

/** Le `where` réellement envoyé à Prisma. */
const whereOf = () => (db.user.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;

describe('listPresence — cloisonnement (C1)', () => {
  it('sert le studio entier à un compte interne', async () => {
    await listPresence({ id: 2, role: Role.ARTIST });
    expect(whereOf()).toEqual({ isService: false });
  });

  it('restreint un CLIENT aux personnes de ses projets', async () => {
    // Un intervenant extérieur n'a pas à connaître l'équipe entière ni à pouvoir écrire
    // à n'importe qui.
    await listPresence({ id: 9, role: Role.CLIENT });
    expect(whereOf()).toMatchObject({
      isService: false,
      memberships: { some: { project: { memberships: { some: { userId: 9 } } } } },
    });
  });

  it('exclut toujours les comptes de service', async () => {
    await listPresence({ id: 2, role: Role.ADMIN });
    expect(whereOf().isService).toBe(false);
  });

  it('ne renvoie jamais l’adresse e-mail', async () => {
    const users = await listPresence({ id: 2, role: Role.SUPERVISOR });
    expect(users[0]).not.toHaveProperty('email');
  });

  it('marque l’état en ligne', async () => {
    const users = await listPresence({ id: 2, role: Role.ARTIST });
    expect(users[0]?.online).toBe(true);
  });

  it('reste sûr sans demandeur connu', async () => {
    await listPresence();
    expect(whereOf()).toEqual({ isService: false });
  });
});
