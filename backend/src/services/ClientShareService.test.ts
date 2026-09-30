// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('./StorageService', () => ({ storage: { getPresignedGetUrl: vi.fn() } }));

import { ShareScope } from '@prisma/client';
import {
  dropSplatEditBlobs,
  publishedMediaWhere,
  shareMediaWhere,
  sharePlaylistWhere,
  type ShareScopeRef,
} from './ClientShareService';

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

/**
 * Une playlist porte un NOM de production (« Retour client — final »), et l'accueil de la
 * page publique en affiche la liste. C'est donc une divulgation à part entière : la portée
 * doit la borner comme elle borne les médias.
 */
describe('sharePlaylistWhere — quelles playlists un lien a le droit de nommer', () => {
  const base: ShareScopeRef = {
    projectId: 7,
    scope: ShareScope.PROJECT,
    playlistId: null,
    versionId: null,
    mediaIds: [],
  };

  it('ne retient, pour un lien de projet, que les playlists qui ouvrent vraiment un média', () => {
    const where = sharePlaylistWhere(base);
    expect(where).toMatchObject({ projectId: 7 });
    // Le `some` est écrit avec le filtre de portée lui-même : une playlist ne peut pas
    // servir de passe-droit vers un brouillon ou la corbeille.
    expect(where?.items).toEqual({ some: { version: { media: { some: shareMediaWhere(base) } } } });
  });

  it('épingle un lien de playlist à la sienne, et au projet', () => {
    const where = sharePlaylistWhere({ ...base, scope: ShareScope.PLAYLIST, playlistId: 3 });
    expect(where).toMatchObject({ id: 3, projectId: 7 });
  });

  /**
   * Le point qui compte : lister « les playlists qui contiennent cette version » serait
   * techniquement dans la portée des MÉDIAS, et révélerait pourtant l'existence de dailies
   * que le destinataire n'a jamais reçus. Une portée qui ne montre qu'un plan ne nomme rien.
   */
  it('n’en nomme AUCUNE pour un lien de version ou de sélection', () => {
    expect(sharePlaylistWhere({ ...base, scope: ShareScope.VERSION, versionId: 42 })).toBeNull();
    expect(sharePlaylistWhere({ ...base, scope: ShareScope.MEDIA, mediaIds: [11] })).toBeNull();
  });

  it('ne retombe pas sur toutes les playlists quand la cible a disparu', () => {
    expect(sharePlaylistWhere({ ...base, scope: ShareScope.PLAYLIST })).toBeNull();
  });
});

/**
 * Masquage (`hiddenAt`, cf. `VisibilityRule`) : l'élément existe, aucun écran interne ne le
 * propose. Tant que la page publique n'affichait qu'une grille de noms de fichiers, le
 * laisser passer se voyait à peine ; depuis qu'elle range les médias par entité, elle
 * afficherait le nom et le code de ce qu'on a justement décidé de masquer.
 */
describe('publishedMediaWhere — le masquage suit jusque sur le lien public', () => {
  const where = publishedMediaWhere(7);
  const shotBranch = where.version.OR[0] as {
    task: { shot: { hiddenAt: null; OR: { sequenceId?: null; sequence?: { hiddenAt: null } }[] } };
  };

  it('écarte un plan, un asset ou une séquence masqués', () => {
    expect(shotBranch.task.shot.hiddenAt).toBeNull();
    expect(where.version.OR[1]).toMatchObject({ task: { asset: { hiddenAt: null } } });
    expect(where.version.OR[2]).toMatchObject({ asset: { hiddenAt: null } });
  });

  // Un plan sans séquence est un cas NORMAL (long-métrage) : exiger une séquence visible
  // sans cette alternative l'écarterait du partage.
  it('n’exige la visibilité de la séquence que lorsqu’il y en a une', () => {
    expect(shotBranch.task.shot.OR).toEqual([
      { sequenceId: null },
      { sequence: { deletedAt: null, hiddenAt: null } },
    ]);
  });
});

/**
 * Lot 14 — le masque et les ops d'une proposition d'édition de nuage sont stockés comme des
 * pièces jointes du commentaire : c'est ce qui leur donne la purge. Sur une page PUBLIQUE, les
 * présigner reviendrait à offrir au client un bitset qu'il n'ouvrira jamais, et à faire
 * descendre une URL vers un objet interne. Ils sont donc écartés avant présignature, par leur
 * clé — un vrai fichier joint par le studio, lui, continue de descendre.
 */
describe('dropSplatEditBlobs — ce qu’un lien public ne présigne pas', () => {
  const mask = { key: 'comments/attachments/1/mask.bin', name: 'splat-mask.bin' };
  const pdf = { key: 'comments/attachments/1/notes.pdf', name: 'notes.pdf' };
  const annotation = [
    { type: 'splat-edit', transform: null, volumes: [], mask: { key: mask.key, count: 3 }, subset: null },
  ];

  it('écarte le binaire que la proposition référence', () => {
    expect(dropSplatEditBlobs([mask, pdf], annotation)).toEqual([pdf]);
  });

  it('ne touche à rien sans proposition', () => {
    expect(dropSplatEditBlobs([mask, pdf], [{ type: 'poi', points: [] }])).toEqual([mask, pdf]);
  });

  it('garde un fichier homonyme qui n’est pas celui de la proposition', () => {
    const other = { key: 'comments/attachments/2/mask.bin', name: 'splat-mask.bin' };
    expect(dropSplatEditBlobs([other], annotation)).toEqual([other]);
  });
});
