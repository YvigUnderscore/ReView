// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La corbeille d'un épisode ne doit RIEN emporter.
 *
 * Un épisode regroupe des séquences, il ne les possède pas : le mettre à la corbeille ou
 * le purger ne doit toucher ni ses séquences, ni derrière elles les plans, les versions
 * et les commentaires. C'est la seule chose que ces tests vérifient, et c'est la seule
 * qui ne se rattrape pas.
 */

const { db } = vi.hoisted(() => ({
  db: {
    episode: { update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    sequence: { update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    shot: { updateMany: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock('./prisma', () => ({ prisma: db }));
vi.mock('../services/StorageService', () => ({
  storage: { deleteObject: vi.fn(), deletePrefix: vi.fn() },
}));
vi.mock('../services/JobService', () => ({ enqueueStorageCleanup: vi.fn() }));

import {
  purgeEpisode,
  restoreEpisode,
  restoreEpisodes,
  softDeleteEpisode,
  softDeleteEpisodes,
} from './trash';

beforeEach(() => vi.clearAllMocks());

const nothingElseTouched = () => {
  expect(db.sequence.update).not.toHaveBeenCalled();
  expect(db.sequence.updateMany).not.toHaveBeenCalled();
  expect(db.sequence.delete).not.toHaveBeenCalled();
  expect(db.sequence.deleteMany).not.toHaveBeenCalled();
  expect(db.shot.updateMany).not.toHaveBeenCalled();
  expect(db.shot.deleteMany).not.toHaveBeenCalled();
};

describe('corbeille des épisodes', () => {
  it('la mise à la corbeille ne marque que l’épisode', async () => {
    await softDeleteEpisode(9);
    expect(db.episode.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { deletedAt: expect.any(Date) },
    });
    nothingElseTouched();
  });

  it('la restauration ne relève que l’épisode — le rattachement n’a jamais bougé', async () => {
    await restoreEpisode(9);
    expect(db.episode.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { deletedAt: null } });
    nothingElseTouched();
  });

  it('la purge détruit l’épisode et rien d’autre : ses séquences survivent, détachées', async () => {
    await purgeEpisode(9);
    expect(db.episode.delete).toHaveBeenCalledWith({ where: { id: 9 } });
    nothingElseTouched();
  });

  it('en lot, mêmes règles', async () => {
    await softDeleteEpisodes([1, 2]);
    expect(db.episode.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
      data: { deletedAt: expect.any(Date) },
    });
    await restoreEpisodes([1, 2]);
    expect(db.episode.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
      data: { deletedAt: null },
    });
    nothingElseTouched();
  });
});
