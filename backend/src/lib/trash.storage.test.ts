// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ni base ni MinIO réels : ce fichier mesure ce que la purge DEMANDE au stockage —
// quelles clés, quels préfixes, et en combien d'appels.
vi.mock('./prisma', () => ({
  prisma: {
    mediaObject: { findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    version: { deleteMany: vi.fn() },
    project: { findMany: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock('../services/StorageService', () => ({
  storage: {
    deleteObject: vi.fn(),
    deleteObjects: vi.fn(),
    deletePrefix: vi.fn(),
  },
}));
vi.mock('../services/JobService', () => ({ enqueueStorageCleanup: vi.fn() }));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { purgeMedia, purgeMedias, purgeProjects } from './trash';
import { prisma } from './prisma';
import { storage } from '../services/StorageService';
import { enqueueStorageCleanup } from '../services/JobService';

const findUnique = vi.mocked(prisma.mediaObject.findUnique);
const findMany = vi.mocked(prisma.mediaObject.findMany);
const deleteMany = vi.mocked(prisma.mediaObject.deleteMany);
const deleteObject = vi.mocked(storage.deleteObject);
const deleteObjects = vi.mocked(storage.deleteObjects);
const deletePrefix = vi.mocked(storage.deletePrefix);
const enqueue = vi.mocked(enqueueStorageCleanup);

/** Clé telle que la produit `StorageService.mediaKey` : le dossier porte l'id du média. */
const mediaFolder = (id: number) => `projects/durian-open-movie/shots/sq010/sh0010/v01/${id}/`;
const mediaKeyOf = (id: number, filename: string) => `${mediaFolder(id)}${filename}`;

beforeEach(() => {
  vi.clearAllMocks();
  deleteObjects.mockResolvedValue([]);
  deletePrefix.mockResolvedValue(undefined);
  enqueue.mockResolvedValue(undefined as never);
  vi.mocked(prisma.mediaObject.delete).mockResolvedValue({} as never);
  deleteMany.mockResolvedValue({ count: 0 });
});

/**
 * A4-01. Les frames d'une séquence d'images vivent sous `…/{mediaId}/frames/`, préfixe que
 * seule la ligne `ImageSequence` nomme. La purge ne lisant que `storageKey`/`thumbnailKey`,
 * détruire une livraison de 2 000 EXR laissait les octets dans le bucket pour toujours,
 * sans plus rien en base pour les retrouver — et le quota du projet retombait à zéro.
 */
describe('purge d un media — tout ce qui lui appartient, et rien d autre', () => {
  it('emporte le dossier du media (fichier d origine, manifeste, frames)', async () => {
    findUnique.mockResolvedValue({
      id: 19,
      storageKey: mediaKeyOf(19, 'sequence.json'),
      thumbnailKey: null,
      imageSequence: { storagePrefix: `${mediaFolder(19)}frames/` },
    } as never);

    await purgeMedia(19);

    const prefixes = deletePrefix.mock.calls.map((call) => call[0]);
    expect(prefixes).toContain('derived/19/');
    // Le dossier du média contient `frames/` ET le manifeste : un seul préfixe suffit.
    expect(prefixes).toContain(mediaFolder(19));
  });

  it('cle inattendue : se rabat sur le prefixe de frames, jamais sur un dossier trop large', async () => {
    findUnique.mockResolvedValue({
      id: 7,
      storageKey: 'legacy/ancienne-convention/master.exr',
      thumbnailKey: null,
      imageSequence: { storagePrefix: 'legacy/ancienne-convention/frames/' },
    } as never);

    await purgeMedia(7);

    const prefixes = deletePrefix.mock.calls.map((call) => call[0]);
    expect(prefixes).toEqual(['derived/7/', 'legacy/ancienne-convention/frames/']);
    // Surtout pas `legacy/ancienne-convention/`, qui n'est pas démontrablement le sien.
    expect(prefixes).not.toContain('legacy/ancienne-convention/');
  });

  it('cle vide (media cree mais pas encore nomme) : aucun prefixe racine', async () => {
    findUnique.mockResolvedValue({
      id: 3,
      storageKey: '',
      thumbnailKey: null,
      imageSequence: null,
    } as never);

    await purgeMedia(3);

    // Un préfixe vide viderait le bucket entier : il ne doit jamais être produit.
    expect(deletePrefix.mock.calls.map((call) => call[0])).toEqual(['derived/3/']);
    expect(deleteObjects).not.toHaveBeenCalled();
  });
});

/**
 * PERF-11. Le coût se mesure en allers-retours MinIO, pas au chronomètre : la voie groupée
 * appelait la purge unitaire dans une boucle, soit deux suppressions d'objet par média, en
 * série, dans le fil de la requête HTTP.
 */
describe('purge en lot — nombre d allers-retours', () => {
  it('200 medias : une lecture, une suppression DB, UN SEUL DeleteObjects pour 400 cles', async () => {
    const ids = Array.from({ length: 200 }, (_, index) => index + 1);
    findMany.mockResolvedValue(
      ids.map((id) => ({
        id,
        storageKey: mediaKeyOf(id, `plan-${id}.mp4`),
        thumbnailKey: `derived/${id}/thumbnail.webp`,
        imageSequence: null,
      })) as never,
    );

    await purgeMedias(ids);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ids } } });
    // Avant : 400 appels `deleteObject`. Après : un seul appel, portant les 400 clés.
    expect(deleteObject).not.toHaveBeenCalled();
    expect(deleteObjects).toHaveBeenCalledTimes(1);
    expect(deleteObjects.mock.calls[0]![0]).toHaveLength(400);
  });

  it('lot vide : aucune requete, aucun appel stockage', async () => {
    await purgeMedias([]);
    expect(findMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it('les prefixes en echec sont reenfiles DANS L ORDRE, malgre le parallelisme', async () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    findMany.mockResolvedValue(
      ids.map((id) => ({
        id,
        storageKey: mediaKeyOf(id, `plan-${id}.mp4`),
        thumbnailKey: null,
        imageSequence: null,
      })) as never,
    );
    // Échec d'un préfixe sur deux, avec des latences inversées : sans réordonnancement
    // explicite, la liste réenfilée dépendrait de l'ordre d'arrivée des rejets.
    let rank = 0;
    deletePrefix.mockImplementation(async (prefix: string) => {
      const delay = (23 - rank++) % 7;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (prefix.startsWith('derived/')) throw new Error('MinIO down');
    });

    await purgeMedias(ids);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]![0].prefixes).toEqual(ids.map((id) => `derived/${id}/`));
  });
});

describe('purge de projets en lot', () => {
  it('supprime les lignes trouvees et retire les deux formes de prefixe, par projet', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { id: 3, slug: 'alpha' },
      { id: 4, slug: 'beta' },
    ] as never);
    vi.mocked(prisma.project.deleteMany).mockResolvedValue({ count: 2 });

    await purgeProjects([3, 4, 99]);

    expect(prisma.project.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [3, 4] } } });
    expect([...deletePrefix.mock.calls.map((call) => call[0])].sort()).toEqual(
      ['projects/3/', 'projects/4/', 'projects/alpha/', 'projects/beta/'].sort(),
    );
  });
});
