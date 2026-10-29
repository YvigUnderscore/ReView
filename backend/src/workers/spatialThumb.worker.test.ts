// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';

// No Redis connection nor BullMQ loop in a unit test: only the worker's decisions
// are of interest.
vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      readonly name: string,
      readonly processor: unknown,
      readonly opts: unknown,
    ) {}
    on() {
      return this;
    }
    run() {
      return Promise.resolve();
    }
  },
  Queue: class {
    constructor(readonly name: string) {}
    add() {
      return Promise.resolve({});
    }
  },
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    mediaObject: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('../lib/storage', () => ({
  storage: {
    downloadToFile: vi.fn(),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  },
  StorageService: { thumbnailKey: (id: number, ext: string) => `derived/${id}/thumbnail.${ext}` },
}));

vi.mock('../services/ModelConvertService', () => ({
  renderModelThumbnail: vi.fn(),
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { renderSpatialThumb, SpatialThumbPendingError } from './spatialThumb.worker';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { renderModelThumbnail } from '../services/ModelConvertService';
import { logger } from '../lib/logger';

/** Minimal media as read by the worker (unused fields do not matter). */
function media(over: Record<string, unknown> = {}) {
  return {
    id: 42,
    kind: MediaKind.MODEL_3D,
    originalName: 'hero.glb',
    storageKey: 'projects/p/hero.glb',
    status: MediaStatus.READY,
    thumbnailKey: null,
    metadata: {},
    ...over,
  };
}

/** Minimal binary Gaussian PLY: two visible points, enough for a thumbnail. */
function gaussianPly(): Buffer {
  const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'];
  const rows = [
    [0, 0, 0, 1.7, 0, 0, 5],
    [1, 1, 1, 0, 1.7, 0, 5],
    [1, 0, 1, 0, 0, 1.7, 5],
  ];
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${rows.length}`,
    ...props.map((p) => `property float ${p}`),
    'end_header',
    '',
  ].join('\n');
  const body = Buffer.alloc(rows.length * props.length * 4);
  rows.forEach((row, i) => row.forEach((v, j) => body.writeFloatLE(v, (i * props.length + j) * 4)));
  return Buffer.concat([Buffer.from(header, 'latin1'), body]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mediaObject.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(renderModelThumbnail).mockResolvedValue({ rendered: true, reason: '' });
  vi.mocked(storage.downloadToFile).mockResolvedValue(undefined);
});

describe('renderSpatialThumb — what it refuses to do', () => {
  it('does nothing for a vanished media', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(null);
    await expect(renderSpatialThumb(42)).resolves.toBe('missing');
    expect(renderModelThumbnail).not.toHaveBeenCalled();
  });

  it('never overwrites a thumbnail already in place (manual or client capture)', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ thumbnailKey: 'derived/42/thumbnail.jpg' }) as never,
    );
    await expect(renderSpatialThumb(42)).resolves.toBe('exists');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('ignores non-spatial media, already handled by the FFmpeg worker', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ kind: MediaKind.VIDEO, originalName: 'plan.mp4' }) as never,
    );
    await expect(renderSpatialThumb(42)).resolves.toBe('unsupported');
  });

  it('waits for the GLB while the conversion runs, and gives up if it failed', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ originalName: 'set.usdz', status: MediaStatus.PROCESSING }) as never,
    );
    await expect(renderSpatialThumb(42)).resolves.toBe('pending');

    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ originalName: 'set.usdz', status: MediaStatus.FAILED }) as never,
    );
    await expect(renderSpatialThumb(42)).resolves.toBe('unsupported');
  });
});

describe('renderSpatialThumb — rendu 3D', () => {
  it('renders the native GLB and sets the key without touching the media status', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media() as never);
    await expect(renderSpatialThumb(42)).resolves.toBe('rendered');

    expect(vi.mocked(storage.downloadToFile).mock.calls[0]![0]).toBe('projects/p/hero.glb');
    expect(vi.mocked(storage.uploadFile).mock.calls[0]!.slice(0, 1)).toEqual(['derived/42/thumbnail.png']);
    expect(vi.mocked(storage.uploadFile).mock.calls[0]![2]).toBe('image/png');
    // Conditional write: never overwrite, never change the status.
    expect(vi.mocked(prisma.mediaObject.updateMany).mock.calls[0]![0]).toEqual({
      where: { id: 42, thumbnailKey: null },
      data: { thumbnailKey: 'derived/42/thumbnail.png' },
    });
    expect(prisma.mediaObject.update).not.toHaveBeenCalled();
  });

  it('renders the derived GLB when the media has been converted', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ originalName: 'set.usdz', metadata: { glbKey: 'derived/42/model.glb' } }) as never,
    );
    await expect(renderSpatialThumb(42)).resolves.toBe('rendered');
    expect(vi.mocked(storage.downloadToFile).mock.calls[0]![0]).toBe('derived/42/model.glb');
  });

  it('Blender missing from the image: clean failure, logged, no stuck media', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media() as never);
    vi.mocked(renderModelThumbnail).mockResolvedValue({ rendered: false, reason: 'blender-missing' });

    await expect(renderSpatialThumb(42)).resolves.toBe('no-render');
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(prisma.mediaObject.updateMany).not.toHaveBeenCalled();
    expect(prisma.mediaObject.update).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn).mock.calls[0]![0]).toContain('blender-missing');
  });
});

describe('renderSpatialThumb — rendu splat', () => {
  beforeEach(() => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ kind: MediaKind.SPLAT, originalName: 'scan.ply', storageKey: 'projects/p/scan.ply' }) as never,
    );
  });

  it('rasterizes the cloud and uploads a PNG (no Blender render)', async () => {
    const ply = gaussianPly();
    vi.mocked(storage.downloadToFile).mockImplementation(async (_key: string, dest: string) => {
      await writeFile(dest, ply);
    });

    await expect(renderSpatialThumb(42)).resolves.toBe('rendered');
    expect(renderModelThumbnail).not.toHaveBeenCalled();
    expect(vi.mocked(storage.uploadFile).mock.calls[0]![0]).toBe('derived/42/thumbnail.png');
  });

  it('unreadable container: pattern logged, no thumbnail, no failure', async () => {
    vi.mocked(storage.downloadToFile).mockImplementation(async (_key: string, dest: string) => {
      await writeFile(dest, Buffer.from('definitely not a ply'));
    });

    await expect(renderSpatialThumb(42)).resolves.toBe('no-render');
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn).mock.calls[0]![0]).toContain('not-a-ply');
  });

  it('winning concurrent client capture: the uploaded object is removed', async () => {
    vi.mocked(storage.downloadToFile).mockImplementation(async (_key: string, dest: string) => {
      await writeFile(dest, gaussianPly());
    });
    vi.mocked(prisma.mediaObject.updateMany).mockResolvedValue({ count: 0 });

    await expect(renderSpatialThumb(42)).resolves.toBe('raced');
    expect(storage.deleteObject).toHaveBeenCalledWith('derived/42/thumbnail.png');
  });
});

describe('SpatialThumbPendingError', () => {
  it('carries the relevant media so that BullMQ reschedules unambiguously', () => {
    const err = new SpatialThumbPendingError(7);
    expect(err.mediaObjectId).toBe(7);
    expect(err.name).toBe('SpatialThumbPendingError');
  });
});
