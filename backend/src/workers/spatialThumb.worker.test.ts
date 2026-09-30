// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';

// Aucune connexion Redis ni boucle BullMQ dans un test unitaire : seules les décisions du
// worker nous intéressent.
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

vi.mock('../services/StorageService', () => ({
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
import { storage } from '../services/StorageService';
import { renderModelThumbnail } from '../services/ModelConvertService';
import { logger } from '../lib/logger';

/** Média minimal tel que le lit le worker (les champs non utilisés sont sans importance). */
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

/** PLY gaussien binaire minimal : deux points visibles, suffisant pour une vignette. */
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

describe('renderSpatialThumb — ce qu’il refuse de faire', () => {
  it('ne fait rien pour un média disparu', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(null);
    await expect(renderSpatialThumb(42)).resolves.toBe('missing');
    expect(renderModelThumbnail).not.toHaveBeenCalled();
  });

  it('n’écrase jamais une vignette déjà posée (capture manuelle ou client)', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ thumbnailKey: 'derived/42/thumbnail.jpg' }) as never,
    );
    await expect(renderSpatialThumb(42)).resolves.toBe('exists');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('ignore les médias non spatiaux, déjà pourvus par le worker FFmpeg', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ kind: MediaKind.VIDEO, originalName: 'plan.mp4' }) as never,
    );
    await expect(renderSpatialThumb(42)).resolves.toBe('unsupported');
  });

  it('attend le GLB tant que la conversion tourne, et renonce si elle a échoué', async () => {
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
  it('rend le GLB natif et pose la clé sans toucher au statut du média', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media() as never);
    await expect(renderSpatialThumb(42)).resolves.toBe('rendered');

    expect(vi.mocked(storage.downloadToFile).mock.calls[0]![0]).toBe('projects/p/hero.glb');
    expect(vi.mocked(storage.uploadFile).mock.calls[0]!.slice(0, 1)).toEqual(['derived/42/thumbnail.png']);
    expect(vi.mocked(storage.uploadFile).mock.calls[0]![2]).toBe('image/png');
    // Écriture conditionnelle : jamais d'écrasement, jamais de changement de statut.
    expect(vi.mocked(prisma.mediaObject.updateMany).mock.calls[0]![0]).toEqual({
      where: { id: 42, thumbnailKey: null },
      data: { thumbnailKey: 'derived/42/thumbnail.png' },
    });
    expect(prisma.mediaObject.update).not.toHaveBeenCalled();
  });

  it('rend le GLB dérivé quand le média a été converti', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ originalName: 'set.usdz', metadata: { glbKey: 'derived/42/model.glb' } }) as never,
    );
    await expect(renderSpatialThumb(42)).resolves.toBe('rendered');
    expect(vi.mocked(storage.downloadToFile).mock.calls[0]![0]).toBe('derived/42/model.glb');
  });

  it('Blender absent de l’image : échec propre, journalisé, sans média coincé', async () => {
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

  it('rasterise le nuage et téléverse un PNG (aucun rendu Blender)', async () => {
    const ply = gaussianPly();
    vi.mocked(storage.downloadToFile).mockImplementation(async (_key: string, dest: string) => {
      await writeFile(dest, ply);
    });

    await expect(renderSpatialThumb(42)).resolves.toBe('rendered');
    expect(renderModelThumbnail).not.toHaveBeenCalled();
    expect(vi.mocked(storage.uploadFile).mock.calls[0]![0]).toBe('derived/42/thumbnail.png');
  });

  it('conteneur illisible : motif journalisé, aucune vignette, aucun échec', async () => {
    vi.mocked(storage.downloadToFile).mockImplementation(async (_key: string, dest: string) => {
      await writeFile(dest, Buffer.from('definitely not a ply'));
    });

    await expect(renderSpatialThumb(42)).resolves.toBe('no-render');
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn).mock.calls[0]![0]).toContain('not-a-ply');
  });

  it('capture client concurrente gagnante : l’objet téléversé est retiré', async () => {
    vi.mocked(storage.downloadToFile).mockImplementation(async (_key: string, dest: string) => {
      await writeFile(dest, gaussianPly());
    });
    vi.mocked(prisma.mediaObject.updateMany).mockResolvedValue({ count: 0 });

    await expect(renderSpatialThumb(42)).resolves.toBe('raced');
    expect(storage.deleteObject).toHaveBeenCalledWith('derived/42/thumbnail.png');
  });
});

describe('SpatialThumbPendingError', () => {
  it('porte le média concerné pour que BullMQ replanifie sans ambiguïté', () => {
    const err = new SpatialThumbPendingError(7);
    expect(err.mediaObjectId).toBe(7);
    expect(err.name).toBe('SpatialThumbPendingError');
  });
});
