// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le niveau Épisode est facultatif : tout ce qui suit vérifie qu'un projet où il est
 * éteint — le cas par défaut, celui du long-métrage — ne peut ni recevoir ni montrer
 * d'épisode, et que l'éteindre ne détruit rien.
 */

const { db, thumbs, store } = vi.hoisted(() => ({
  db: {
    project: { findUnique: vi.fn(), update: vi.fn() },
    episode: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    sequence: { count: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    shot: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  thumbs: {
    firstMediaThumbKeysForShots: vi.fn(),
    firstMediaThumbKeysForEpisodes: vi.fn(),
    firstMediaThumbKeyForEpisode: vi.fn(),
    effectiveThumbnailUrl: vi.fn(),
  },
  store: { storage: { getPresignedGetUrl: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/thumbnails', () => thumbs);
vi.mock('./StorageService', () => store);

import * as EpisodeService from './EpisodeService';
import { AppError } from '../lib/errors';

const enabled = (value: boolean) => db.project.findUnique.mockResolvedValue({ episodesEnabled: value });

beforeEach(() => {
  vi.clearAllMocks();
  db.episode.count.mockResolvedValue(0);
  db.sequence.count.mockResolvedValue(0);
  db.$transaction.mockImplementation((ops: unknown[]) => Promise.resolve(ops));
});

describe('le réglage', () => {
  it('vaut faux sur un projet qui ne le connaît pas', async () => {
    db.project.findUnique.mockResolvedValue(null);
    expect(await EpisodeService.isEnabled(7)).toBe(false);
  });

  it('refuse toute opération en 409 tant qu’il est éteint', async () => {
    enabled(false);
    await expect(EpisodeService.assertEnabled(7)).rejects.toMatchObject({
      statusCode: 409,
      code: 'EPISODES_DISABLED',
    });
  });

  it('laisse passer une fois allumé', async () => {
    enabled(true);
    await expect(EpisodeService.assertEnabled(7)).resolves.toBeUndefined();
  });

  it('éteindre ne supprime ni épisode ni rattachement', async () => {
    // Le comportement retenu : un interrupteur d'affichage ne détruit pas de la donnée
    // que personne n'a demandé à perdre. Tout doit revenir intact à la réactivation.
    db.project.update.mockResolvedValue({ id: 7 });
    enabled(false);
    await EpisodeService.setEnabled(7, false);
    expect(db.project.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { episodesEnabled: false },
    });
    expect(db.episode.deleteMany).not.toHaveBeenCalled();
    expect(db.episode.updateMany).not.toHaveBeenCalled();
    expect(db.sequence.updateMany).not.toHaveBeenCalled();
  });

  it('annonce ce que la désactivation va masquer', async () => {
    enabled(true);
    db.episode.count.mockResolvedValue(6);
    db.sequence.count.mockResolvedValue(31);
    expect(await EpisodeService.readSettings(7)).toEqual({
      enabled: true,
      episodeCount: 6,
      linkedSequenceCount: 31,
    });
  });
});

describe('création', () => {
  it('refuse tant que le niveau est éteint', async () => {
    enabled(false);
    await expect(EpisodeService.create(7, { name: 'EP101', code: 'EP101' })).rejects.toBeInstanceOf(AppError);
    expect(db.episode.create).not.toHaveBeenCalled();
  });

  it('refuse un code déjà pris', async () => {
    enabled(true);
    db.episode.findUnique.mockResolvedValue({ id: 3 });
    await expect(EpisodeService.create(7, { name: 'EP101', code: 'EP101' })).rejects.toMatchObject({
      code: 'CODE_TAKEN',
    });
  });

  it('crée avec l’ordre demandé', async () => {
    enabled(true);
    db.episode.findUnique.mockResolvedValue(null);
    db.episode.create.mockResolvedValue({ id: 9 });
    await EpisodeService.create(7, { name: 'Pilote', code: 'EP101', order: 2 });
    expect(db.episode.create).toHaveBeenCalledWith({
      data: { projectId: 7, name: 'Pilote', code: 'EP101', order: 2 },
    });
  });
});

/**
 * L'image d'un épisode : la liste n'en renvoyait aucune — même pas celle qu'on avait
 * choisie, faute d'URL signée — et l'épisode n'héritait de rien de ses plans. Sa carte
 * restait donc au nom de l'épisode indéfiniment, quel que soit le travail livré.
 */
describe('vignette de la liste', () => {
  const page = { page: 1, pageSize: 20, order: 'desc' as const };

  it('signe la vignette choisie, et retombe sur le premier média des plans sinon', async () => {
    db.episode.findMany.mockResolvedValue([
      { id: 4, code: 'EP101', thumbnailKey: null },
      { id: 5, code: 'EP102', thumbnailKey: 'entity-thumbs/episode/5.jpg' },
    ]);
    db.episode.count.mockResolvedValue(2);
    thumbs.firstMediaThumbKeysForEpisodes.mockResolvedValue(new Map([[4, 'derived/9/thumbnail.webp']]));
    thumbs.effectiveThumbnailUrl.mockImplementation((key: string | null, fallback: string | null) =>
      Promise.resolve(key ?? fallback),
    );

    const res = await EpisodeService.list(7, page);
    expect(res.episodes.map((e) => e.thumbnailUrl)).toEqual([
      'derived/9/thumbnail.webp',
      'entity-thumbs/episode/5.jpg',
    ]);
    // Une seule requête pour toute la page : la variante unitaire en signerait une par ligne.
    expect(thumbs.firstMediaThumbKeysForEpisodes).toHaveBeenCalledTimes(1);
    expect(thumbs.firstMediaThumbKeysForEpisodes).toHaveBeenCalledWith([4, 5]);
  });

  it('laisse la vignette nulle tant qu’aucune image n’existe — l’interface affiche le nom', async () => {
    db.episode.findMany.mockResolvedValue([{ id: 4, code: 'EP101', thumbnailKey: null }]);
    db.episode.count.mockResolvedValue(1);
    thumbs.firstMediaThumbKeysForEpisodes.mockResolvedValue(new Map());
    thumbs.effectiveThumbnailUrl.mockResolvedValue(null);

    const res = await EpisodeService.list(7, page);
    expect(res.episodes[0]!.thumbnailUrl).toBeNull();
  });
});

describe('firstDuplicate', () => {
  it('rend le premier code répété, sinon null', () => {
    expect(EpisodeService.firstDuplicate(['EP101', 'EP102', 'EP101'])).toBe('EP101');
    expect(EpisodeService.firstDuplicate(['EP101', 'EP102'])).toBeNull();
  });
});

describe('createBulk', () => {
  it('annule tout le lot sur un doublon interne — rien n’est créé', async () => {
    enabled(true);
    await expect(
      EpisodeService.createBulk(7, [
        { name: 'a', code: 'EP101' },
        { name: 'b', code: 'EP101' },
      ]),
    ).rejects.toMatchObject({ code: 'CODE_DUP' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('annule tout le lot sur un code déjà en base', async () => {
    enabled(true);
    db.episode.findMany.mockResolvedValue([{ code: 'EP101' }]);
    await expect(EpisodeService.createBulk(7, [{ name: 'a', code: 'EP101' }])).rejects.toMatchObject({
      code: 'CODE_TAKEN',
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('numérote l’ordre dans le rang du lot', async () => {
    enabled(true);
    db.episode.findMany.mockResolvedValue([]);
    await EpisodeService.createBulk(7, [
      { name: 'a', code: 'EP101' },
      { name: 'b', code: 'EP102' },
    ]);
    expect(db.episode.create).toHaveBeenNthCalledWith(1, {
      data: { projectId: 7, name: 'a', code: 'EP101', order: 0 },
    });
    expect(db.episode.create).toHaveBeenNthCalledWith(2, {
      data: { projectId: 7, name: 'b', code: 'EP102', order: 1 },
    });
  });
});

describe('reorder', () => {
  it('refuse en bloc dès qu’un identifiant n’est pas du projet', async () => {
    // Appliquer la moitié de la demande laisserait un ordre que personne n'a voulu.
    enabled(true);
    db.episode.findMany.mockResolvedValue([{ id: 1 }]);
    await expect(EpisodeService.reorder(7, [1, 2])).rejects.toMatchObject({ code: 'BAD_EPISODE' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('écrit le rang de chaque épisode dans l’ordre reçu', async () => {
    enabled(true);
    db.episode.findMany.mockResolvedValue([{ id: 5 }, { id: 3 }]);
    await EpisodeService.reorder(7, [5, 3]);
    expect(db.episode.update).toHaveBeenNthCalledWith(1, { where: { id: 5 }, data: { order: 0 } });
    expect(db.episode.update).toHaveBeenNthCalledWith(2, { where: { id: 3 }, data: { order: 1 } });
  });
});

describe('assignSequences', () => {
  it('refuse un épisode qui n’appartient pas au projet', async () => {
    enabled(true);
    db.episode.findFirst.mockResolvedValue(null);
    await expect(EpisodeService.assignSequences(7, 42, [1, 2])).rejects.toMatchObject({
      code: 'BAD_EPISODE',
    });
    expect(db.sequence.updateMany).not.toHaveBeenCalled();
  });

  it('borne l’écriture au projet, même avec un identifiant emprunté', async () => {
    enabled(true);
    db.episode.findFirst.mockResolvedValue({ id: 42 });
    db.sequence.updateMany.mockResolvedValue({ count: 1 });
    await EpisodeService.assignSequences(7, 42, [1, 999]);
    expect(db.sequence.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 999] }, projectId: 7, deletedAt: null },
      data: { episodeId: 42 },
    });
  });

  it('détache avec un épisode nul, sans rien vérifier de plus', async () => {
    enabled(true);
    db.sequence.updateMany.mockResolvedValue({ count: 2 });
    expect(await EpisodeService.assignSequences(7, null, [1, 2])).toBe(2);
    expect(db.episode.findFirst).not.toHaveBeenCalled();
  });
});
