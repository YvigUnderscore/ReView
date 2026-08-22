// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('./StorageService', () => ({ storage: { getPresignedGetUrl: vi.fn() } }));

import { ShareScope } from '@prisma/client';
import { publishedMediaWhere, shareMediaWhere, type ShareScopeRef } from './ClientShareService';

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

/**
 * La portée est la seule chose qui sépare « montrer un plan » de « ouvrir le film entier ».
 * Elle doit donc RESTREINDRE le filtre public, jamais le remplacer : un lien de playlist qui
 * oublierait `published` montrerait des brouillons, et un lien dont la cible a disparu ne
 * doit surtout pas retomber sur le projet.
 */
describe('shareMediaWhere — ce que la portée retire au filtre public', () => {
  const base: ShareScopeRef = {
    projectId: 7,
    scope: ShareScope.PROJECT,
    playlistId: null,
    versionId: null,
    mediaIds: [],
  };
  const publicFilter = publishedMediaWhere(7);

  it('laisse le filtre public intact pour un lien de projet', () => {
    expect(shareMediaWhere(base)).toEqual(publicFilter);
  });

  it('ajoute la playlist sans perdre les garanties de publication', () => {
    const where = shareMediaWhere({ ...base, scope: ShareScope.PLAYLIST, playlistId: 3 });
    expect(where.published).toBe(true);
    expect(where.deletedAt).toBeNull();
    expect(where.version).toMatchObject({
      published: true,
      deletedAt: null,
      playlistItems: { some: { playlistId: 3 } },
    });
    // Le OR d'appartenance au projet reste : une playlist ne peut pas servir de passe-droit.
    expect((where.version as { OR?: unknown[] }).OR).toHaveLength(3);
  });

  it('borne un lien de version à cette version', () => {
    expect(shareMediaWhere({ ...base, scope: ShareScope.VERSION, versionId: 42 })).toMatchObject({
      versionId: 42,
      published: true,
    });
  });

  it('borne un lien de sélection aux médias choisis', () => {
    const where = shareMediaWhere({ ...base, scope: ShareScope.MEDIA, mediaIds: [11, 12] });
    expect(where.id).toEqual({ in: [11, 12] });
    expect(where.published).toBe(true);
  });

  // Cascade et contrainte CHECK rendent ces états impossibles en base ; s'ils survenaient,
  // l'élargissement silencieux serait la pire réponse possible.
  it('ne montre rien plutôt que tout quand la cible manque', () => {
    for (const broken of [
      { ...base, scope: ShareScope.PLAYLIST },
      { ...base, scope: ShareScope.VERSION },
      { ...base, scope: ShareScope.MEDIA },
    ]) {
      expect(shareMediaWhere(broken)).toEqual({ id: { in: [] } });
    }
  });
});
