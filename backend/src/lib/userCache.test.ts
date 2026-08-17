// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock('./prisma', () => ({ prisma: db }));

import { getAuthUser, invalidateAuthUser, __testing } from './userCache';
import { Role } from '@prisma/client';

const user = { id: 1, email: 'a@b.c', role: Role.ARTIST };

beforeEach(() => {
  vi.clearAllMocks();
  __testing.cache.clear();
  db.user.findUnique.mockResolvedValue(user);
});

describe('getAuthUser', () => {
  it('ne lit la base qu’une fois pour des appels rapprochés', async () => {
    // C'est tout l'objet : une navigation déclenche vingt à quarante appels d'API.
    await getAuthUser(1);
    await getAuthUser(1);
    await getAuthUser(1);
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('rend la même identité depuis le cache', async () => {
    expect(await getAuthUser(1)).toEqual(user);
    db.user.findUnique.mockResolvedValue({ ...user, role: Role.ADMIN });
    expect(await getAuthUser(1)).toEqual(user);
  });

  it('relit la base une fois le délai écoulé', async () => {
    await getAuthUser(1);
    __testing.cache.set(1, { user, until: Date.now() - 1 });
    await getAuthUser(1);
    expect(db.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('met aussi en cache l’absence de compte', async () => {
    db.user.findUnique.mockResolvedValue(null);
    expect(await getAuthUser(42)).toBeNull();
    expect(await getAuthUser(42)).toBeNull();
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('sépare les comptes', async () => {
    db.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce({ ...user, id: 2 });
    expect((await getAuthUser(1))?.id).toBe(1);
    expect((await getAuthUser(2))?.id).toBe(2);
  });
});

describe('invalidateAuthUser', () => {
  it('force la relecture — un rôle rétrogradé s’applique tout de suite', async () => {
    await getAuthUser(1);
    invalidateAuthUser(1);
    db.user.findUnique.mockResolvedValue({ ...user, role: Role.CLIENT });
    expect((await getAuthUser(1))?.role).toBe(Role.CLIENT);
    expect(db.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('ne touche pas aux autres comptes', async () => {
    await getAuthUser(1);
    invalidateAuthUser(999);
    await getAuthUser(1);
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('bornes du cache', () => {
  it('se vide au lieu de croître sans fin', async () => {
    for (let i = 0; i < 5_001; i += 1) __testing.cacheSet(i, user);
    expect(__testing.cache.size).toBeLessThanOrEqual(5_000);
  });
});
