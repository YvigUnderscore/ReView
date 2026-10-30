// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaStatus, Role } from '@prisma/client';

/**
 * Transport of a sequence: N files, ONE media.
 *
 * Three guarantees are verified here, because each costs dearly when it is missing: the refusal happens
 * **before** the transfer (a malformed batch must not cost 80 GB), resumption relies on storage and not on
 * the client, and finalization writes what actually arrived — not what had been announced.
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
vi.mock('../lib/storage', () => ({
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
vi.mock('./MediaService', () => ({
  createUpload: (...args: unknown[]) => createUpload(...args),
  // The effects of publication have their own bench (MediaService.publication.test.ts).
  announcePublication: vi.fn(),
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/queues', () => ({ enqueueMediaJob: vi.fn() }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn(async () => true) }));
vi.mock('../lib/projectQuota', () => ({ assertProjectQuota: vi.fn() }));
vi.mock('../lib/settings', () => ({
  getNumericSetting: vi.fn(async () => 500 * 1024 * 1024 * 1024),
  isDraftModeEnabled: vi.fn(async () => false),
  SETTING_KEYS: { MAX_FILE_SIZE: 'max_file_size' },
}));
vi.mock('../lib/pipeline', () => ({ resolveProjectIdForVersion: vi.fn(async () => 3) }));
// The module stays REAL for `checkReviewNote`: `lib/uploadNote` relies on it, and it is the brief rule that
// we want to see applied to a sequence as well.
vi.mock('../lib/projectSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/projectSettings')>()),
  resolveProjectSettingsById: vi.fn(async () => ({
    framerate: 25,
    reviewRequest: { requireNote: false, minNoteLength: 5 },
  })),
  resolveEntitySettings: (project: { framerate: number }) => ({ framerate: project.framerate }),
}));

import { completeSequence, frameUploadUrls, initSequence, listSequenceFrames } from './ImageSequenceService';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { enqueueMediaJob } from '../lib/queues';
import { resolveProjectSettingsById } from '../lib/projectSettings';

const user = { id: 3, role: Role.ARTIST };
const PREFIX = 'projects/demo/shots/sh0100/v01/42/frames/';

const frames = (from: number, to: number, size = 1024): { name: string; size: number }[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    name: `plan.${String(from + i).padStart(4, '0')}.exr`,
    size,
  }));

/** OpenEXR header (magic number 20000630 in little-endian) + enough to fill 32 bytes. */
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

describe('initSequence: refuse before the transfer', () => {
  const base = { versionId: 12, pattern: 'plan.%04d.exr' };

  it('creates a single carrier media and files the frames under a dedicated prefix', async () => {
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

  it('refuses a pattern that is not one', async () => {
    await expect(
      initSequence(user, { versionId: 12, pattern: 'plan.exr', frames: frames(1, 2) }),
    ).rejects.toMatchObject({ code: 'BAD_PATTERN' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('refuses a frame that does not belong to the pattern', async () => {
    await expect(
      initSequence(user, { ...base, frames: [...frames(1001, 1002), { name: 'plan.1003.dpx', size: 1 }] }),
    ).rejects.toMatchObject({ code: 'FRAME_OUTSIDE_PATTERN' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('refuses a frame name disguised as a path', async () => {
    await expect(
      initSequence(user, { ...base, frames: [{ name: '../plan.1001.exr', size: 1 }, ...frames(1002, 1002)] }),
    ).rejects.toMatchObject({ code: 'BAD_FRAME_NAME' });
  });

  it("refuses a batch exceeding the studio's size ceiling, creating nothing", async () => {
    await expect(
      initSequence(user, { ...base, frames: frames(1001, 1010, 900 * 1024 * 1024 * 1024) }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('resumes an interrupted upload by listing what has already arrived (storage is authoritative)', async () => {
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

describe('frameUploadUrls: the name becomes a key', () => {
  beforeEach(() => {
    vi.mocked(prisma.mediaObject.findFirst).mockResolvedValue({
      id: 42,
      imageSequence: { storagePrefix: PREFIX, extension: '.exr', pattern: 'plan.%04d.exr' },
    } as never);
  });

  it('signs under the sequence prefix, with the delivered name', async () => {
    const { urls } = await frameUploadUrls(user, 42, ['plan.1001.exr']);
    expect(urls[0]!.url).toContain(`${PREFIX}plan.1001.exr`);
  });

  it('refuses a prefix escape even once the upload is open', async () => {
    await expect(frameUploadUrls(user, 42, ['../../evade.exr'])).rejects.toMatchObject({
      code: 'BAD_FRAME_NAME',
    });
  });

  it('refuses a frame of a different extension from that of the sequence', async () => {
    await expect(frameUploadUrls(user, 42, ['plan.1001.dpx'])).rejects.toMatchObject({
      code: 'FRAME_OUTSIDE_PATTERN',
    });
  });
});

describe('completeSequence: what arrived is authoritative', () => {
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

  it('recounts the bounds on the frames actually deposited, gaps included', async () => {
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

  it('writes a manifest: the delivery stays readable without the database', async () => {
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

  it('refuses a batch of which no frame reached storage', async () => {
    await expect(completeSequence(user, 42)).rejects.toMatchObject({ code: 'SEQUENCE_EMPTY' });
  });

  it('refuses a delivery that is not the announced format (PNGs renamed .exr)', async () => {
    objects.push({ key: `${PREFIX}plan.1001.exr`, size: 100 }, { key: `${PREFIX}plan.1002.exr`, size: 100 });
    vi.mocked(storage.getObjectHeader).mockResolvedValue(Buffer.alloc(32));
    await expect(completeSequence(user, 42)).rejects.toMatchObject({ code: 'INVALID_FILE' });
    expect(enqueueMediaJob).not.toHaveBeenCalled();
  });

  /**
   * This function plays the role of `MediaService.finalize` for a sequence: the mandatory brief (Phase 50)
   * must therefore apply here too. Without it, a thousand EXRs would have
   * become the service door of a setting the studio believes is applied to all its uploads.
   */
  it('refuses a sequence without a brief when the project requires one — before sweeping the bucket', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue({
      framerate: 25,
      reviewRequest: { requireNote: true, minNoteLength: 5 },
    } as never);
    objects.push({ key: `${PREFIX}plan.1001.exr`, size: 8 });

    await expect(completeSequence(user, 42)).rejects.toMatchObject({ code: 'UPLOAD_NOTE_REQUIRED' });
    expect(enqueueMediaJob).not.toHaveBeenCalled();

    // The same delivery goes through as soon as it is accompanied.
    objects.push({ key: `${PREFIX}plan.1002.exr`, size: 8 });
    vi.mocked(storage.getObjectHeader).mockResolvedValue(EXR_HEADER);
    await expect(completeSequence(user, 42, 'Regarder le grain du 1001')).resolves.toBeTruthy();
  });
});

describe('listSequenceFrames: the original deliverable', () => {
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

  it('returns the frames in order, under their original name', async () => {
    objects.push({ key: `${PREFIX}plan.1002.exr`, size: 100 }, { key: `${PREFIX}plan.1001.exr`, size: 100 });
    const res = await listSequenceFrames(user, 42);
    expect(res.frames.map((f) => f.name)).toEqual(['plan.1001.exr', 'plan.1002.exr']);
    expect(res).toMatchObject({ pattern: 'plan.%04d.exr', startFrame: 1001, endFrame: 1002 });
  });

  it('imposes an opaque response type: a frame deposited as text/html does not run', async () => {
    objects.push({ key: `${PREFIX}plan.1001.exr`, size: 100 }, { key: `${PREFIX}plan.1002.exr`, size: 100 });
    await listSequenceFrames(user, 42);
    for (const call of vi.mocked(storage.getPresignedGetUrl).mock.calls) {
      expect(call[2]).toBe('application/octet-stream');
    }
  });

  it('refuses a media without a sequence', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue({ id: 42, imageSequence: null } as never);
    await expect(listSequenceFrames(user, 42)).rejects.toThrow('Media has no image sequence');
  });
});
