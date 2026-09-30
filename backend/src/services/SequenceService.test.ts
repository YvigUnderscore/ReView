// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    sequence: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    // Pastille « attend une review » des plans : un agrégat SQL groupé pour la fiche.
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn((ops: unknown[]) => Promise.resolve(ops)),
  },
}));

vi.mock('../lib/thumbnails', () => ({
  effectiveThumbnailUrl: vi.fn((key: string | null, fallback: string | null) =>
    Promise.resolve(key ? `url:${key}` : fallback ? `url:${fallback}` : null),
  ),
  firstMediaThumbKeysForShots: vi.fn().mockResolvedValue(new Map([[2, 'derived/9/thumbnail.webp']])),
  // La séquence et ses assets ont désormais la même image de repli que ses plans : le
  // premier média publié. Sans média, la carte retombe sur le nom, côté interface.
  firstMediaThumbKeysForAssets: vi.fn().mockResolvedValue(new Map()),
  firstMediaThumbKeysForSequences: vi.fn().mockResolvedValue(new Map()),
  firstMediaThumbKeyForSequence: vi.fn().mockResolvedValue(null),
}));

vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`url:${key}`)) },
}));

import { createBulk, getDetail, signSequenceThumbnails } from './SequenceService';
import { prisma } from '../lib/prisma';
import {
  firstMediaThumbKeyForSequence,
  firstMediaThumbKeysForAssets,
  firstMediaThumbKeysForSequences,
  firstMediaThumbKeysForShots,
} from '../lib/thumbnails';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
});

describe('createBulk', () => {
  it('refuse un doublon interne au lot, avant toute écriture', async () => {
    await expect(
      createBulk(1, [
        { code: 'SQ01', name: 'A' },
        { code: 'SQ01', name: 'B' },
      ]),
    ).rejects.toThrow(/SQ01/);
    expect(prisma.sequence.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse le lot entier si un code existe déjà — rien de partiel', async () => {
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([{ code: 'SQ02' }] as never);
    await expect(
      createBulk(1, [
        { code: 'SQ01', name: 'A' },
        { code: 'SQ02', name: 'B' },
      ]),
    ).rejects.toThrow(/SQ02/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('numérote les séquences dans l’ordre reçu quand aucun ordre n’est donné', async () => {
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([] as never);
    await createBulk(3, [
      { code: 'SQ01', name: 'A' },
      { code: 'SQ02', name: 'B', order: 9 },
    ]);
    const created = vi.mocked(prisma.sequence.create).mock.calls.map((c) => c[0].data);
    // `episodeId: null` : le niveau Épisode est facultatif, et une séquence créée sans
    // épisode reste hors épisode — l'état normal d'un long-métrage.
    expect(created).toEqual([
      { projectId: 3, name: 'A', code: 'SQ01', order: 0, episodeId: null },
      { projectId: 3, name: 'B', code: 'SQ02', order: 9, episodeId: null },
    ]);
  });
});

describe('getDetail', () => {
  const sequence = {
    id: 5,
    projectId: 1,
    code: 'SQ01',
    thumbnailKey: 'entity-thumbs/sequence/5.jpg',
    // `assignees` : Prisma rend toujours la relation demandée dans `include`.
    shots: [
      {
        id: 1,
        code: 'SH010',
        thumbnailKey: 'entity-thumbs/shot/1.jpg',
        assets: [],
        assignees: [],
        _count: { tasks: 2 },
      },
      { id: 2, code: 'SH020', thumbnailKey: null, assets: [], assignees: [], _count: { tasks: 0 } },
      { id: 3, code: 'SH030', thumbnailKey: null, assets: [], assignees: [], _count: { tasks: 1 } },
    ],
    assets: [{ id: 8, name: 'Ship', type: 'PROP', typeLabel: null, thumbnailKey: null }],
    departments: [{ id: 4, key: 'comp', name: 'Compositing', color: null }],
    episode: null,
    // Niveau Épisode éteint : l'état par défaut de tout projet.
    project: { episodesEnabled: false },
  };

  it('signale une séquence absente plutôt que de rendre un objet vide', async () => {
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue(null);
    await expect(getDetail(404)).rejects.toThrow();
  });

  it('résout les vignettes : explicite, sinon média publié, sinon rien', async () => {
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue(sequence as never);
    const detail = await getDetail(5);
    expect(detail.thumbnailUrl).toBe('url:entity-thumbs/sequence/5.jpg');
    expect(detail.shots.map((s) => s.thumbnailUrl)).toEqual([
      'url:entity-thumbs/shot/1.jpg', // vignette choisie à la main
      'url:derived/9/thumbnail.webp', // repli sur le premier média publié
      null, // ni l'un ni l'autre
    ]);
  });

  it('donne aussi une image de repli à la séquence et à ses assets', async () => {
    // Ni l'une ni les autres n'en avaient : leur carte restait vide même une fois les
    // plans livrés, alors que l'image existait un cran plus bas.
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue({
      ...sequence,
      thumbnailKey: null,
    } as never);
    vi.mocked(firstMediaThumbKeyForSequence).mockResolvedValue('derived/12/thumbnail.webp');
    vi.mocked(firstMediaThumbKeysForAssets).mockResolvedValue(new Map([[8, 'derived/13/thumbnail.webp']]));

    const detail = await getDetail(5);
    expect(detail.thumbnailUrl).toBe('url:derived/12/thumbnail.webp');
    expect(detail.assets.map((a) => a.thumbnailUrl)).toEqual(['url:derived/13/thumbnail.webp']);
    expect(firstMediaThumbKeysForAssets).toHaveBeenCalledWith([8]);
  });

  it('demande les vignettes de plans en une seule passe, pas une par plan', async () => {
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue(sequence as never);
    await getDetail(5);
    expect(firstMediaThumbKeysForShots).toHaveBeenCalledTimes(1);
    expect(firstMediaThumbKeysForShots).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('borne les plans et les assets de la fiche, et rend le compte réel', async () => {
    // La fiche affiche tout d'un bloc : sans plafond, une séquence mal découpée
    // ramènerait la moitié du long-métrage à chaque ouverture.
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue(sequence as never);
    await getDetail(5);
    const include = vi.mocked(prisma.sequence.findUnique).mock.calls[0]![0].include as {
      shots: { take: number; orderBy: unknown };
      assets: { take: number; orderBy: unknown };
      _count: unknown;
    };
    expect(include.shots.take).toBe(500);
    expect(include.assets.take).toBe(500);
    expect(include._count).toEqual({
      select: { shots: { where: { deletedAt: null, hiddenAt: null } } },
    });
  });

  it('départage l’ordre des plans par id', async () => {
    // Les plans d'un import partagent order = 0 ; le code ne suffit pas non plus quand
    // deux séquences fusionnées portent la même numérotation.
    vi.mocked(prisma.sequence.findUnique).mockResolvedValue(sequence as never);
    await getDetail(5);
    const include = vi.mocked(prisma.sequence.findUnique).mock.calls[0]![0].include as {
      shots: { orderBy: unknown };
    };
    expect(include.shots.orderBy).toEqual([{ order: 'asc' }, { code: 'asc' }, { id: 'asc' }]);
  });
});

/**
 * La liste des séquences ne portait aucune vignette : le champ n'existait pas dans la
 * réponse, si bien que la carte d'une séquence restait grise quoi qu'il arrive. Elle suit
 * maintenant la règle commune — vignette choisie, sinon première image de ses plans.
 */
describe('signSequenceThumbnails', () => {
  it('préfère la vignette choisie, retombe sur les plans, et n’invente rien', async () => {
    vi.mocked(firstMediaThumbKeysForSequences).mockResolvedValue(new Map([[2, 'derived/7/thumbnail.webp']]));
    const rows = [
      { id: 1, thumbnailKey: 'entity-thumbs/sequence/1.jpg' },
      { id: 2, thumbnailKey: null },
      { id: 3, thumbnailKey: null },
    ];
    const signed = await signSequenceThumbnails(rows);
    expect(signed.map((s) => s.thumbnailUrl)).toEqual([
      'url:entity-thumbs/sequence/1.jpg',
      'url:derived/7/thumbnail.webp',
      null,
    ]);
    // Une requête pour toute la page : l'arbre de la sidebar en charge deux cents d'un coup.
    expect(firstMediaThumbKeysForSequences).toHaveBeenCalledTimes(1);
    expect(firstMediaThumbKeysForSequences).toHaveBeenCalledWith([1, 2, 3]);
  });
});
