// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaStatus, Role } from '@prisma/client';

/**
 * Transport d'une séquence : N fichiers, UN média.
 *
 * Trois garanties sont vérifiées ici, parce que chacune coûte cher quand elle manque :
 * le refus arrive **avant** le transfert (un lot mal formé ne doit pas coûter 80 Go),
 * la reprise s'appuie sur le stockage et non sur le client, et la finalisation écrit ce
 * qui est réellement arrivé — pas ce qui avait été annoncé.
 */

const createUpload = vi.fn();
const objects: { key: string; size: number }[] = [];

vi.mock('../lib/prisma', () => ({
  prisma: {
    mediaObject: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    imageSequence: { create: vi.fn(), update: vi.fn() },
    version: { findUnique: vi.fn() },
    user: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('./StorageService', () => ({
  storage: {
    iterateObjects: async function* () {
      yield* objects;
    },
    getPresignedPutUrl: vi.fn(async (key: string) => `https://minio/put/${key}`),
    getPresignedGetUrl: vi.fn(async (key: string) => `https://minio/get/${key}`),
    getObjectHeader: vi.fn(),
    putObject: vi.fn(),
  },
}));
vi.mock('./MediaService', () => ({ createUpload: (...args: unknown[]) => createUpload(...args) }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./JobService', () => ({ enqueueMediaJob: vi.fn() }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn(async () => true) }));
vi.mock('../lib/projectQuota', () => ({ assertProjectQuota: vi.fn() }));
vi.mock('../lib/settings', () => ({
  getNumericSetting: vi.fn(async () => 500 * 1024 * 1024 * 1024),
  SETTING_KEYS: { MAX_FILE_SIZE: 'max_file_size' },
}));
vi.mock('../lib/pipeline', () => ({ resolveProjectIdForVersion: vi.fn(async () => 3) }));
vi.mock('../lib/projectSettings', () => ({
  resolveProjectSettingsById: vi.fn(async () => ({ framerate: 25 })),
  resolveEntitySettings: (project: { framerate: number }) => ({ framerate: project.framerate }),
}));

import { completeSequence, frameUploadUrls, initSequence, listSequenceFrames } from './ImageSequenceService';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { enqueueMediaJob } from './JobService';

const user = { id: 3, role: Role.ARTIST };
const PREFIX = 'projects/demo/shots/sh0100/v01/42/frames/';

const frames = (from: number, to: number, size = 1024): { name: string; size: number }[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    name: `plan.${String(from + i).padStart(4, '0')}.exr`,
    size,
  }));

/** En-tête OpenEXR (nombre magique 20000630 en petit-boutien) + de quoi remplir 32 octets. */
const EXR_HEADER = Buffer.concat([Buffer.from([0x76, 0x2f, 0x31, 0x01]), Buffer.alloc(28)]);

beforeEach(() => {
  vi.clearAllMocks();
  objects.length = 0;
  createUpload.mockResolvedValue({
    mediaObjectId: 42,
    storageKey: 'projects/demo/shots/sh0100/v01/42/plan-04d-exr',
    uploadUrl: 'https://minio/put',
    namingWarning: false,
  });
  vi.mocked(prisma.mediaObject.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.$transaction).mockImplementation(async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => Promise<unknown>)({
          imageSequence: { update: vi.fn() },
          mediaObject: { update: vi.fn(async () => ({ id: 42, status: MediaStatus.PROCESSING })) },
        })
      : Promise.all(arg as Promise<unknown>[]),
  );
  vi.mocked(storage.getObjectHeader).mockResolvedValue(EXR_HEADER);
});

describe('initSequence — refuser avant le transfert', () => {
  const base = { versionId: 12, pattern: 'plan.%04d.exr' };

  it('crée un seul média porteur et range les frames sous un préfixe dédié', async () => {
    const res = await initSequence(user, { ...base, frames: frames(1001, 1010) });
    expect(res).toMatchObject({ mediaObjectId: 42, resumed: false, framerate: 25 });
    expect(createUpload).toHaveBeenCalledTimes(1);
    const created = vi.mocked(prisma.imageSequence.create).mock.calls[0]![0].data;
    expect(created).toMatchObject({
      pattern: 'plan.%04d.exr',
      startFrame: 1001,
      endFrame: 1010,
      frameCount: 10,
      storagePrefix: PREFIX,
    });
  });

  it('refuse un motif qui n’en est pas un', async () => {
    await expect(
      initSequence(user, { versionId: 12, pattern: 'plan.exr', frames: frames(1, 2) }),
    ).rejects.toMatchObject({ code: 'BAD_PATTERN' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('refuse une frame qui n’appartient pas au motif', async () => {
    await expect(
      initSequence(user, { ...base, frames: [...frames(1001, 1002), { name: 'plan.1003.dpx', size: 1 }] }),
    ).rejects.toMatchObject({ code: 'FRAME_OUTSIDE_PATTERN' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('refuse un nom de frame qui se déguise en chemin', async () => {
    await expect(
      initSequence(user, { ...base, frames: [{ name: '../plan.1001.exr', size: 1 }, ...frames(1002, 1002)] }),
    ).rejects.toMatchObject({ code: 'BAD_FRAME_NAME' });
  });

  it('refuse un lot qui dépasse le plafond de taille du studio, sans rien créer', async () => {
    await expect(
      initSequence(user, { ...base, frames: frames(1001, 1010, 900 * 1024 * 1024 * 1024) }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('reprend un envoi interrompu en listant ce qui est déjà arrivé (le stockage fait foi)', async () => {
    vi.mocked(prisma.mediaObject.findFirst).mockResolvedValue({
      id: 42,
      imageSequence: { storagePrefix: PREFIX, framerate: 24 },
    } as never);
    objects.push({ key: `${PREFIX}plan.1001.exr`, size: 10 }, { key: `${PREFIX}plan.1002.exr`, size: 10 });

    const res = await initSequence(user, { ...base, frames: frames(1001, 1010) });
    expect(res).toMatchObject({ mediaObjectId: 42, resumed: true, framerate: 24 });
    expect(res.uploadedFrames).toEqual(['plan.1001.exr', 'plan.1002.exr']);
    expect(createUpload).not.toHaveBeenCalled();
  });
});

describe('frameUploadUrls — le nom devient une clé', () => {
  beforeEach(() => {
    vi.mocked(prisma.mediaObject.findFirst).mockResolvedValue({
      id: 42,
      imageSequence: { storagePrefix: PREFIX, extension: '.exr', pattern: 'plan.%04d.exr' },
    } as never);
  });

  it('signe sous le préfixe de la séquence, avec le nom livré', async () => {
    const { urls } = await frameUploadUrls(user, 42, ['plan.1001.exr']);
    expect(urls[0]!.url).toContain(`${PREFIX}plan.1001.exr`);
  });

  it('refuse une évasion de préfixe même une fois l’envoi ouvert', async () => {
    await expect(frameUploadUrls(user, 42, ['../../evade.exr'])).rejects.toMatchObject({
      code: 'BAD_FRAME_NAME',
    });
  });

  it('refuse une frame d’une autre extension que celle de la séquence', async () => {
    await expect(frameUploadUrls(user, 42, ['plan.1001.dpx'])).rejects.toMatchObject({
      code: 'FRAME_OUTSIDE_PATTERN',
    });
  });
});

describe('completeSequence — ce qui est arrivé fait foi', () => {
  beforeEach(() => {
    vi.mocked(prisma.mediaObject.findFirst).mockResolvedValue({
      id: 42,
      versionId: 12,
      uploaderId: 3,
      storageKey: 'projects/demo/shots/sh0100/v01/42/sequence.json',
      metadata: { sequencePending: true },
      imageSequence: {
        storagePrefix: PREFIX,
        extension: '.exr',
        digits: 4,
        pattern: 'plan.%04d.exr',
        framerate: 25,
      },
    } as never);
  });

  it('recompte les bornes sur les frames réellement déposées, trous compris', async () => {
    objects.push(
      { key: `${PREFIX}plan.1001.exr`, size: 100 },
      { key: `${PREFIX}plan.1002.exr`, size: 100 },
      { key: `${PREFIX}plan.1005.exr`, size: 100 },
    );
    const res = await completeSequence(user, 42);
    expect(res).toMatchObject({
      startFrame: 1001,
      endFrame: 1005,
      frameCount: 3,
      missingFrames: 2,
    });
    expect(enqueueMediaJob).toHaveBeenCalledWith({ mediaObjectId: 42, kind: 'transcode' });
  });

  it('écrit un manifeste : la livraison reste lisible sans la base de données', async () => {
    objects.push({ key: `${PREFIX}plan.1001.exr`, size: 7 }, { key: `${PREFIX}plan.1002.exr`, size: 9 });
    await completeSequence(user, 42);
    const [key, body] = vi.mocked(storage.putObject).mock.calls[0]!;
    expect(key).toBe('projects/demo/shots/sh0100/v01/42/sequence.json');
    const manifest = JSON.parse((body as Buffer).toString()) as {
      kind: string;
      totalSize: number;
      frames: { name: string }[];
    };
    expect(manifest.kind).toBe('image-sequence');
    expect(manifest.totalSize).toBe(16);
    expect(manifest.frames.map((f) => f.name)).toEqual(['plan.1001.exr', 'plan.1002.exr']);
  });

  it('refuse un lot dont aucune frame n’a atteint le stockage', async () => {
    await expect(completeSequence(user, 42)).rejects.toMatchObject({ code: 'SEQUENCE_EMPTY' });
  });

  it('refuse une livraison qui n’est pas le format annoncé (PNG renommés en .exr)', async () => {
    objects.push({ key: `${PREFIX}plan.1001.exr`, size: 100 }, { key: `${PREFIX}plan.1002.exr`, size: 100 });
    vi.mocked(storage.getObjectHeader).mockResolvedValue(Buffer.alloc(32));
    await expect(completeSequence(user, 42)).rejects.toMatchObject({ code: 'INVALID_FILE' });
    expect(enqueueMediaJob).not.toHaveBeenCalled();
  });
});

describe('listSequenceFrames — le livrable d’origine', () => {
  beforeEach(() => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue({
      id: 42,
      versionId: 12,
      uploaderId: 3,
      published: true,
      imageSequence: {
        storagePrefix: PREFIX,
        pattern: 'plan.%04d.exr',
        startFrame: 1001,
        endFrame: 1002,
        framerate: 25,
        totalSize: 200n,
      },
    } as never);
  });

  it('rend les frames dans l’ordre, sous leur nom d’origine', async () => {
    objects.push({ key: `${PREFIX}plan.1002.exr`, size: 100 }, { key: `${PREFIX}plan.1001.exr`, size: 100 });
    const res = await listSequenceFrames(user, 42);
    expect(res.frames.map((f) => f.name)).toEqual(['plan.1001.exr', 'plan.1002.exr']);
    expect(res).toMatchObject({ pattern: 'plan.%04d.exr', startFrame: 1001, endFrame: 1002 });
  });

  it('impose un type de réponse opaque : une frame déposée en text/html ne s’exécute pas', async () => {
    objects.push({ key: `${PREFIX}plan.1001.exr`, size: 100 }, { key: `${PREFIX}plan.1002.exr`, size: 100 });
    await listSequenceFrames(user, 42);
    for (const call of vi.mocked(storage.getPresignedGetUrl).mock.calls) {
      expect(call[2]).toBe('application/octet-stream');
    }
  });

  it('refuse un média sans séquence', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue({ id: 42, imageSequence: null } as never);
    await expect(listSequenceFrames(user, 42)).rejects.toThrow('Media has no image sequence');
  });
});
