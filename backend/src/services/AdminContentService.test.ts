// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

// Fonctions pures testées : on neutralise les dépendances env/DB des imports.
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('./StorageService', () => ({ storage: {} }));

import { versionWhere, commentWhere, versionLocation, projectPathsOf } from './AdminContentService';

describe('AdminContentService — versionWhere', () => {
  it('exclut toujours les versions supprimées', () => {
    expect(versionWhere({})).toEqual({ deletedAt: null });
  });

  it('combine statut, publication, type de média et recherche', () => {
    const where = versionWhere({ status: 'REVIEW', published: true, kind: 'VIDEO', q: 'V0' });
    expect(where.status).toBe('REVIEW');
    expect(where.published).toBe(true);
    expect(where.media).toEqual({ some: { kind: 'VIDEO', deletedAt: null } });
    expect(where.name).toEqual({ contains: 'V0', mode: 'insensitive' });
  });

  it('filtre par projet via les trois chemins possibles', () => {
    const where = versionWhere({ projectId: 7 });
    expect(where.OR).toEqual(projectPathsOf(7));
    expect(projectPathsOf(7)).toHaveLength(3);
  });

  it('published: false filtre bien (différent de « non renseigné »)', () => {
    expect(versionWhere({ published: false }).published).toBe(false);
    expect(versionWhere({}).published).toBeUndefined();
  });
});

describe('AdminContentService — versionLocation', () => {
  it('shot avec séquence → « SQ · SH › tâche »', () => {
    expect(
      versionLocation({
        task: { name: 'anim', shot: { code: 'SH020', sequence: { code: 'SQ010' } } },
      }),
    ).toBe('SQ010 · SH020 › anim');
  });

  it('shot sans séquence → « SH › tâche »', () => {
    expect(versionLocation({ task: { name: 'comp', shot: { code: 'SH030', sequence: null } } })).toBe(
      'SH030 › comp',
    );
  });

  it('tâche d’asset → « asset › tâche » ; version d’asset direct → nom de l’asset', () => {
    expect(versionLocation({ task: { name: 'lookdev', asset: { name: 'perso' } } })).toBe('perso › lookdev');
    expect(versionLocation({ asset: { name: 'décor' } })).toBe('décor');
    expect(versionLocation({})).toBe('');
  });
});

describe('AdminContentService — commentWhere', () => {
  it('vide par défaut (tous les commentaires)', () => {
    expect(commentWhere({})).toEqual({});
  });

  it('combine auteur, résolution et recherche plein texte', () => {
    const where = commentWhere({ authorId: 3, resolved: false, q: 'retake' });
    expect(where.userId).toBe(3);
    expect(where.isResolved).toBe(false);
    expect(where.content).toEqual({ contains: 'retake', mode: 'insensitive' });
  });

  it('remonte au projet via média → version', () => {
    expect(commentWhere({ projectId: 9 }).media).toEqual({
      version: { OR: projectPathsOf(9) },
    });
  });
});
