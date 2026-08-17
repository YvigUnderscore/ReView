// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('./StorageService', () => ({ storage: { getPresignedGetUrl: vi.fn() } }));

import { publishedMediaWhere } from './ClientShareService';

describe('publishedMediaWhere — ce que voit un visiteur du lien public', () => {
  const where = publishedMediaWhere(7);

  // Chaque branche du OR remonte à une entité différente (plan porté par une task, asset
  // porté par une task, asset direct) : seule cette entité porte projectId/deletedAt.
  const ownerOf = (branch: (typeof where.version.OR)[number]) =>
    branch.task ? (branch.task.shot ?? branch.task.asset) : branch.asset;

  it('n’expose que les médias prêts et publiés d’une version publiée', () => {
    expect(where.status).toBe('READY');
    expect(where.published).toBe(true);
    expect(where.version.published).toBe(true);
  });

  // La corbeille est un soft-delete : sans ces filtres, un plan supprimé reste listé et
  // téléchargeable sur le lien public alors qu'il a disparu de l'interface interne.
  it('exclut la corbeille à tous les niveaux de la hiérarchie', () => {
    expect(where.deletedAt).toBeNull();
    expect(where.version.deletedAt).toBeNull();
    for (const branch of where.version.OR) {
      expect(ownerOf(branch)).toMatchObject({ projectId: 7, deletedAt: null });
    }
  });

  it('reste borné au projet partagé', () => {
    for (const branch of where.version.OR) {
      expect(ownerOf(branch)?.projectId).toBe(7);
    }
  });
});
