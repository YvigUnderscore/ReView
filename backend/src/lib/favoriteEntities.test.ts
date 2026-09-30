// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: {
    project: { findMany: vi.fn() },
    sequence: { findMany: vi.fn() },
    shot: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    projectMembership: { findMany: vi.fn() },
  },
}));

import { EntityType, Role } from '@prisma/client';
import { favoriteLabel, favoritePath, accessibleProjectIds, resolveFavorites } from './favoriteEntities';
import { prisma } from './prisma';

const mocks = {
  project: vi.mocked(prisma.project.findMany),
  sequence: vi.mocked(prisma.sequence.findMany),
  shot: vi.mocked(prisma.shot.findMany),
  asset: vi.mocked(prisma.asset.findMany),
  membership: vi.mocked(prisma.projectMembership.findMany),
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of Object.values(mocks)) m.mockResolvedValue([] as never);
});

describe('favoritePath', () => {
  it('mène chaque famille à sa page, la séquence à l’onglet qui la déplie', () => {
    expect(favoritePath(EntityType.PROJECT, 4, 4)).toBe('/projects/4');
    expect(favoritePath(EntityType.SEQUENCE, 9, 4)).toBe('/projects/4?tab=sequences&seq=9');
    expect(favoritePath(EntityType.SHOT, 12, 4)).toBe('/shots/12');
    expect(favoritePath(EntityType.ASSET, 3, 4)).toBe('/assets/3');
  });
});

describe('favoriteLabel', () => {
  it('préfixe du code là où le pipeline en donne un', () => {
    expect(favoriteLabel(EntityType.SHOT, { code: 'AAA_010', name: 'Chute' })).toBe('AAA_010 · Chute');
    expect(favoriteLabel(EntityType.PROJECT, { name: 'Le Film' })).toBe('Le Film');
    // Code vide (import partiel) : mieux vaut le nom nu qu'un séparateur orphelin.
    expect(favoriteLabel(EntityType.SEQUENCE, { code: '', name: 'Séquence 1' })).toBe('Séquence 1');
  });
});

describe('accessibleProjectIds', () => {
  it('ouvre tout à un ADMIN ou un SUPERVISOR sans interroger la base', async () => {
    await expect(accessibleProjectIds(1, Role.ADMIN, [4, 5])).resolves.toEqual(new Set([4, 5]));
    await expect(accessibleProjectIds(1, Role.SUPERVISOR, [4])).resolves.toEqual(new Set([4]));
    expect(mocks.membership).not.toHaveBeenCalled();
  });

  it('ne retient que les projets dont l’appartenance existe encore, en une requête', async () => {
    mocks.membership.mockResolvedValue([{ projectId: 4 }] as never);
    await expect(accessibleProjectIds(7, Role.ARTIST, [4, 5])).resolves.toEqual(new Set([4]));
    expect(mocks.membership).toHaveBeenCalledTimes(1);
  });

  it('n’interroge rien quand aucun projet n’est cité', async () => {
    await expect(accessibleProjectIds(7, Role.ARTIST, [])).resolves.toEqual(new Set());
    expect(mocks.membership).not.toHaveBeenCalled();
  });
});

describe('resolveFavorites', () => {
  const rows = [
    { id: 1, type: EntityType.SHOT, entityId: 12 },
    { id: 2, type: EntityType.PROJECT, entityId: 5 },
  ];

  const seed = () => {
    mocks.shot.mockResolvedValue([{ id: 12, code: 'AAA_010', name: 'Chute', projectId: 4 }] as never);
    mocks.project.mockResolvedValue([{ id: 5, name: 'Autre film' }] as never);
  };

  it('enrichit les favoris en quatre requêtes, quel qu’en soit le nombre', async () => {
    seed();
    const items = await resolveFavorites(1, Role.ADMIN, rows);
    expect(items).toEqual([
      { id: 1, type: 'SHOT', entityId: 12, label: 'AAA_010 · Chute', projectId: 4, to: '/shots/12' },
      { id: 2, type: 'PROJECT', entityId: 5, label: 'Autre film', projectId: 5, to: '/projects/5' },
    ]);
    for (const m of [mocks.project, mocks.sequence, mocks.shot, mocks.asset])
      expect(m).toHaveBeenCalledTimes(1);
  });

  /** Le défaut corrigé : un membre retiré voyait encore les noms de ses plans. */
  it('retire le favori dont le projet n’est plus accessible', async () => {
    seed();
    mocks.membership.mockResolvedValue([{ projectId: 5 }] as never);
    const items = await resolveFavorites(7, Role.ARTIST, rows);
    expect(items.map((f) => f.entityId)).toEqual([5]);
  });

  it('laisse tomber une entité passée à la corbeille', async () => {
    mocks.shot.mockResolvedValue([] as never);
    mocks.project.mockResolvedValue([{ id: 5, name: 'Autre film' }] as never);
    const items = await resolveFavorites(1, Role.ADMIN, rows);
    expect(items.map((f) => f.entityId)).toEqual([5]);
  });

  it('ne touche pas la base sans favori', async () => {
    await expect(resolveFavorites(1, Role.ARTIST, [])).resolves.toEqual([]);
    expect(mocks.shot).not.toHaveBeenCalled();
  });
});
