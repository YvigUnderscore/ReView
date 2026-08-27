// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Rattachement d'une séquence à un épisode au moment de sa création en lot. Le niveau
 * est facultatif : sans épisode, la création doit rester exactement celle d'avant.
 */

const { db } = vi.hoisted(() => ({
  db: {
    sequence: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    episode: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/thumbnails', () => ({
  firstMediaThumbKeysForShots: vi.fn(),
  firstMediaThumbKeysForAssets: vi.fn(),
  firstMediaThumbKeysForSequences: vi.fn(),
  firstMediaThumbKeyForSequence: vi.fn(),
  effectiveThumbnailUrl: vi.fn(),
}));
vi.mock('./StorageService', () => ({ storage: { getPresignedGetUrl: vi.fn() } }));

import { createBulk, getDetail } from './SequenceService';

beforeEach(() => {
  vi.clearAllMocks();
  db.sequence.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation((ops: unknown[]) => Promise.resolve(ops));
});

describe('SequenceService.createBulk', () => {
  it('crée hors épisode quand aucun n’est donné — le cas du long-métrage', async () => {
    await createBulk(7, [{ name: 'SQ010', code: 'SQ010' }]);
    expect(db.episode.count).not.toHaveBeenCalled();
    expect(db.sequence.create).toHaveBeenCalledWith({
      data: { projectId: 7, name: 'SQ010', code: 'SQ010', order: 0, episodeId: null },
    });
  });

  it('refuse un épisode emprunté à un autre projet — rien n’est créé', async () => {
    // Le rattachement ne se voit depuis aucune des deux pages : il faut le refuser avant.
    db.episode.count.mockResolvedValue(0);
    await expect(createBulk(7, [{ name: 'SQ010', code: 'SQ010', episodeId: 42 }])).rejects.toMatchObject({
      code: 'BAD_EPISODE',
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('ne vérifie chaque épisode qu’une fois, quel que soit le nombre de séquences', async () => {
    db.episode.count.mockResolvedValue(1);
    await createBulk(7, [
      { name: 'SQ010', code: 'SQ010', episodeId: 4 },
      { name: 'SQ020', code: 'SQ020', episodeId: 4 },
    ]);
    expect(db.episode.count).toHaveBeenCalledTimes(1);
    expect(db.episode.count).toHaveBeenCalledWith({
      where: { id: { in: [4] }, projectId: 7, deletedAt: null },
    });
  });
});

describe('SequenceService.getDetail', () => {
  const sequence = (episodesEnabled: boolean) => ({
    id: 3,
    thumbnailKey: null,
    shots: [],
    assets: [],
    episode: { id: 11, code: 'EP101', name: 'EP101' },
    project: { episodesEnabled },
  });

  it('rend l’épisode quand le niveau est activé', async () => {
    db.sequence.findUnique.mockResolvedValue(sequence(true));
    await expect(getDetail(3)).resolves.toMatchObject({ episode: { code: 'EP101' } });
  });

  it('le tait quand le niveau est éteint — le rattachement survit, la trace non', async () => {
    // Éteindre ne détruit rien : `episodeId` reste en base. Mais l'écran d'un projet qui
    // ne connaît pas le niveau ne doit pas se mettre à afficher un lien vers un épisode.
    db.sequence.findUnique.mockResolvedValue(sequence(false));
    await expect(getDetail(3)).resolves.toMatchObject({ episode: null });
  });

  it('ne laisse pas fuir le réglage du projet dans la réponse', async () => {
    db.sequence.findUnique.mockResolvedValue(sequence(false));
    expect(await getDetail(3)).not.toHaveProperty('project');
  });
});
