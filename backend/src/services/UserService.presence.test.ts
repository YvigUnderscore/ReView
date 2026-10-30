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

/** The `where` actually sent to Prisma. */
const whereOf = () => (db.user.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;

describe('listPresence: segregation (C1)', () => {
  it('serves the whole studio to an internal account', async () => {
    await listPresence({ id: 2, role: Role.ARTIST });
    expect(whereOf()).toEqual({ isService: false, disabledAt: null });
  });

  it('restricts a CLIENT to the people of their projects', async () => {
    // An external contributor need not know the whole team, nor be able to write
    // to anyone.
    await listPresence({ id: 9, role: Role.CLIENT });
    expect(whereOf()).toMatchObject({
      isService: false,
      memberships: { some: { project: { memberships: { some: { userId: 9 } } } } },
    });
  });

  it('always excludes service accounts', async () => {
    await listPresence({ id: 2, role: Role.ADMIN });
    expect(whereOf().isService).toBe(false);
  });

  it('never returns the e-mail address', async () => {
    const users = await listPresence({ id: 2, role: Role.SUPERVISOR });
    expect(users[0]).not.toHaveProperty('email');
  });

  it('marks the online state', async () => {
    const users = await listPresence({ id: 2, role: Role.ARTIST });
    expect(users[0]?.online).toBe(true);
  });

  it('stays safe without a known requester', async () => {
    await listPresence();
    expect(whereOf()).toEqual({ isService: false, disabledAt: null });
  });

  /**
   * A5-07: the name, first name and job title of a former employee remained published in
   * the studio directory — visible to external CLIENT accounts — and the person remained
   * offered for mentions and assignment. The global search, for its part, already excluded them:
   * the product's two directories did not follow the same rule.
   */
  it('excludes deactivated accounts, for all roles', async () => {
    for (const role of [Role.ADMIN, Role.SUPERVISOR, Role.ARTIST, Role.CLIENT]) {
      db.user.findMany.mockClear();
      await listPresence({ id: 2, role });
      expect(whereOf()).toMatchObject({ disabledAt: null });
    }
  });
});
