// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    mediaObject: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock('./StorageService', () => ({
  storage: {
    abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    deletePrefix: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('./MediaService', () => ({
  createUpload: vi.fn(),
  mediaSourceKey: vi.fn(),
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));

import { abortUpload, partSizeFor, MULTIPART_PART_SIZE } from './MediaUploadService';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { Role } from '@prisma/client';

const findFirst = vi.mocked(prisma.mediaObject.findFirst);
const remove = vi.mocked(prisma.mediaObject.delete);
const abortMultipart = vi.mocked(storage.abortMultipartUpload);
const deleteObject = vi.mocked(storage.deleteObject);
const deletePrefix = vi.mocked(storage.deletePrefix);
const user = { id: 3, role: Role.ARTIST };

beforeEach(() => {
  vi.clearAllMocks();
});

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

describe('partSizeFor — découpe multipart', () => {
  it('garde la part de 16 Mo tant que le fichier tient en mille parts', () => {
    expect(partSizeFor(20 * MB)).toBe(MULTIPART_PART_SIZE);
    expect(partSizeFor(8 * GB)).toBe(MULTIPART_PART_SIZE);
    // Exactement mille parts (15,6 Go) : la limite est incluse.
    expect(partSizeFor(MULTIPART_PART_SIZE * 1000)).toBe(MULTIPART_PART_SIZE);
  });

  it('agrandit la part au-delà, pour que le master de 20 Go reste sous mille parts', () => {
    const size = 20 * GB;
    const part = partSizeFor(size);
    expect(part).toBeGreaterThan(MULTIPART_PART_SIZE);
    expect(part % MB).toBe(0); // multiple du Mo : lisible et aligné
    expect(Math.ceil(size / part)).toBeLessThanOrEqual(1000);
  });

  it('reste déterministe : une reprise retrouve la même découpe', () => {
    expect(partSizeFor(37 * GB)).toBe(partSizeFor(37 * GB));
  });

  it('ne descend jamais sous le minimum S3 de 5 Mo', () => {
    expect(partSizeFor(1)).toBeGreaterThanOrEqual(5 * MB);
    expect(partSizeFor(200 * GB)).toBeGreaterThanOrEqual(5 * MB);
  });
});

describe('abortUpload — annulation réelle côté serveur', () => {
  it('abandonne le multipart (les parts déposées cessent d’être facturées) et supprime la ligne', async () => {
    findFirst.mockResolvedValue({
      id: 12,
      storageKey: 'media/12/source.mov',
      metadata: { multipartUploadId: 'up-1', multipartPartSize: MULTIPART_PART_SIZE },
    } as never);

    await expect(abortUpload(user, 12)).resolves.toEqual({ aborted: true });
    expect(abortMultipart).toHaveBeenCalledWith('media/12/source.mov', 'up-1');
    expect(deleteObject).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith({ where: { id: 12 } });
  });

  it('supprime l’objet tronqué quand l’upload était un PUT simple (pas de multipart)', async () => {
    findFirst.mockResolvedValue({ id: 13, storageKey: 'media/13/source.png', metadata: {} } as never);

    await expect(abortUpload(user, 13)).resolves.toEqual({ aborted: true });
    expect(abortMultipart).not.toHaveBeenCalled();
    expect(deleteObject).toHaveBeenCalledWith('media/13/source.png');
    expect(remove).toHaveBeenCalledWith({ where: { id: 13 } });
  });

  it('supprime la ligne même si le stockage refuse l’abandon (upload déjà expiré)', async () => {
    findFirst.mockResolvedValue({
      id: 14,
      storageKey: 'media/14/source.mov',
      metadata: { multipartUploadId: 'up-gone' },
    } as never);
    abortMultipart.mockRejectedValueOnce(new Error('NoSuchUpload'));

    await expect(abortUpload(user, 14)).resolves.toEqual({ aborted: true });
    expect(remove).toHaveBeenCalledWith({ where: { id: 14 } });
  });

  it('vide le préfixe d’une séquence abandonnée : 80 Go de frames ne restent pas facturés', async () => {
    findFirst.mockResolvedValue({
      id: 15,
      storageKey: 'projects/demo/shots/sh0100/v01/15/sequence.json',
      metadata: {},
      imageSequence: { storagePrefix: 'projects/demo/shots/sh0100/v01/15/frames/' },
    } as never);

    await expect(abortUpload(user, 15)).resolves.toEqual({ aborted: true });
    expect(deletePrefix).toHaveBeenCalledWith('projects/demo/shots/sh0100/v01/15/frames/');
    expect(deleteObject).toHaveBeenCalledWith('projects/demo/shots/sh0100/v01/15/sequence.json');
    expect(abortMultipart).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith({ where: { id: 15 } });
  });

  it('refuse d’annuler l’upload d’un autre compte (la requête filtre déjà uploaderId)', async () => {
    findFirst.mockResolvedValue(null);
    await expect(abortUpload(user, 99)).rejects.toThrow('Upload not found');
    expect(remove).not.toHaveBeenCalled();
  });
});
