// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: { mediaObject: { findMany: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock('../services/StorageService', () => ({
  storage: { deleteObject: vi.fn(), deletePrefix: vi.fn(), abortMultipartUpload: vi.fn() },
}));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { purgeStaleUploads, STALE_UPLOAD_HOURS } from './staleUploads';
import { prisma } from './prisma';
import { storage } from '../services/StorageService';

const findMany = vi.mocked(prisma.mediaObject.findMany);
const deleteMany = vi.mocked(prisma.mediaObject.deleteMany);
const abortMultipart = vi.mocked(storage.abortMultipartUpload);

beforeEach(() => {
  vi.clearAllMocks();
  deleteMany.mockResolvedValue({ count: 0 });
  vi.mocked(storage.deleteObject).mockResolvedValue(undefined);
  vi.mocked(storage.deletePrefix).mockResolvedValue(undefined);
  abortMultipart.mockResolvedValue(undefined);
});

/**
 * Un onglet fermé pendant un envoi laissait une ligne `UPLOADING` éternelle. Comme
 * `createUpload` refuse au-delà de `MAX_CONCURRENT_UPLOADS` lignes dans cet état, cinq
 * accidents suffisaient à bloquer un compte pour de bon.
 */
describe('purgeStaleUploads', () => {
  it('ne touche à rien quand aucun envoi ne traîne', async () => {
    findMany.mockResolvedValue([] as never);
    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('supprime la ligne, l’objet déposé et les dérivés éventuels', async () => {
    findMany.mockResolvedValue([
      { id: 11, storageKey: 'projects/demo/a.mov' },
      { id: 12, storageKey: '' },
    ] as never);

    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 2 });

    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: [11, 12] } } });
    expect(storage.deleteObject).toHaveBeenCalledWith('projects/demo/a.mov');
    // Clé vide : rien à supprimer côté objet, mais le préfixe est tenté quand même.
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deletePrefix).toHaveBeenCalledWith('derived/11/');
    expect(storage.deletePrefix).toHaveBeenCalledWith('derived/12/');
  });

  it('ne retient que les envois plus vieux que le délai', async () => {
    findMany.mockResolvedValue([] as never);
    const before = Date.now();
    await purgeStaleUploads();
    const where = (findMany.mock.calls.at(-1)?.[0] as { where: { createdAt: { lt: Date } } }).where;
    const cutoff = where.createdAt.lt.getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(STALE_UPLOAD_HOURS * 3600 * 1000 - 1000);
  });

  it('survit à un MinIO indisponible : la ligne est libérée quand même', async () => {
    findMany.mockResolvedValue([{ id: 13, storageKey: 'k/x.mov' }] as never);
    vi.mocked(storage.deleteObject).mockRejectedValue(new Error('MinIO down'));
    vi.mocked(storage.deletePrefix).mockRejectedValue(new Error('MinIO down'));

    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 1 });
    expect(deleteMany).toHaveBeenCalled();
  });

  /**
   * A4-02 / INFRA-04. Un multipart jamais complété n'a AUCUN objet à `storageKey` :
   * `DeleteObject` y est un aller-retour perdu, et les parts déjà reçues — 30 Go pour un
   * master coupé à 80 % — restent dans `.minio.sys/multipart/`, que ni `ListObjectsV2`,
   * ni `mc ls`, ni le rapport de stockage ne voient. Seul `AbortMultipartUpload` les libère,
   * et son `uploadId` disparaît avec la ligne.
   */
  it('abandonne le multipart au lieu de supprimer un objet qui n’existe pas', async () => {
    findMany.mockResolvedValue([
      {
        id: 21,
        storageKey: 'projects/demo/shots/sh0100/v01/21/master.mov',
        metadata: { multipartUploadId: 'up-42', multipartPartSize: 16 * 1024 * 1024 },
        imageSequence: null,
      },
    ] as never);

    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 1 });

    expect(abortMultipart).toHaveBeenCalledWith('projects/demo/shots/sh0100/v01/21/master.mov', 'up-42');
    // Un aller-retour MinIO au lieu de deux, et c'est le seul qui libère quelque chose.
    expect(abortMultipart).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(storage.deletePrefix).toHaveBeenCalledExactlyOnceWith('derived/21/');
  });

  it('vide le préfixe des frames d’une séquence coupée en route', async () => {
    findMany.mockResolvedValue([
      {
        id: 22,
        storageKey: 'projects/demo/shots/sh0200/v03/22/sequence.json',
        metadata: {},
        imageSequence: { storagePrefix: 'projects/demo/shots/sh0200/v03/22/frames/' },
      },
    ] as never);

    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 1 });

    expect(storage.deletePrefix).toHaveBeenCalledWith('projects/demo/shots/sh0200/v03/22/frames/');
    expect(storage.deleteObject).toHaveBeenCalledWith('projects/demo/shots/sh0200/v03/22/sequence.json');
    expect(abortMultipart).not.toHaveBeenCalled();
  });

  /**
   * Ces deux colonnes portent les seuls fils qui mènent aux octets déjà déposés. Le
   * `deleteMany` les efface : ne pas les avoir lues AVANT, c'est les perdre définitivement.
   */
  it('lit metadata et le préfixe de séquence avant d’effacer les lignes', async () => {
    findMany.mockResolvedValue([] as never);
    await purgeStaleUploads();
    const select = (findMany.mock.calls.at(-1)?.[0] as { select: Record<string, unknown> }).select;
    expect(select.metadata).toBe(true);
    expect(select.imageSequence).toEqual({ select: { storagePrefix: true } });
  });

  it('libère la ligne même si l’abandon du multipart échoue (MinIO indisponible)', async () => {
    findMany.mockResolvedValue([
      { id: 23, storageKey: 'k/m.mov', metadata: { multipartUploadId: 'up-x' }, imageSequence: null },
    ] as never);
    abortMultipart.mockRejectedValue(new Error('MinIO down'));

    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 1 });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: [23] } } });
  });
});
