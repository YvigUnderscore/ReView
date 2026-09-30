// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: { mediaObject: { findMany: vi.fn(), update: vi.fn() } },
}));
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { realignMediaNames } from './ShotgridMediaNaming';

const ctx = {
  journal: { log: vi.fn(), count: vi.fn() },
  settings: { media: { naming: 'sgCode' as const } },
} as unknown as Parameters<typeof realignMediaNames>[0];

beforeEach(() => vi.clearAllMocks());

describe('realignMediaNames', () => {
  it('renomme un média importé dont le nom diverge du code', () => {
    db.mediaObject.findMany.mockResolvedValue([
      {
        id: 1,
        originalName: 'playblast_FINAL_retake.mov',
        mimeType: 'video/quicktime',
        metadata: { importedFromShotgrid: true },
      },
    ]);
    return realignMediaNames(ctx, 10, 'SH010_comp_v003').then((n) => {
      expect(n).toBe(1);
      expect(db.mediaObject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ originalName: 'SH010_comp_v003.mov' }),
        }),
      );
    });
  });

  it('mémorise le nom d’origine à la première reprise', async () => {
    db.mediaObject.findMany.mockResolvedValue([
      { id: 1, originalName: 'playblast.mov', mimeType: null, metadata: { importedFromShotgrid: true } },
    ]);
    await realignMediaNames(ctx, 10, 'SH010_comp_v003');
    const call = db.mediaObject.update.mock.calls[0]![0] as { data: { metadata: Record<string, unknown> } };
    expect(call.data.metadata.sourceFilename).toBe('playblast.mov');
  });

  it('n’écrit rien quand le nom est déjà aligné', async () => {
    db.mediaObject.findMany.mockResolvedValue([
      {
        id: 1,
        originalName: 'SH010_comp_v003.mov',
        mimeType: 'video/quicktime',
        metadata: { importedFromShotgrid: true, sourceFilename: 'playblast.mov' },
      },
    ]);
    expect(await realignMediaNames(ctx, 10, 'SH010_comp_v003')).toBe(0);
    expect(db.mediaObject.update).not.toHaveBeenCalled();
  });

  it('ne touche jamais un fichier déposé à la main', async () => {
    // Le nom du fichier d'un artiste porte de l'information (_lin_, _acescg_, _h265_)
    // que le code du site ne reprend pas.
    db.mediaObject.findMany.mockResolvedValue([
      { id: 2, originalName: 'wip_acescg.exr', mimeType: 'image/x-exr', metadata: {} },
    ]);
    expect(await realignMediaNames(ctx, 10, 'SH010_comp_v003')).toBe(0);
    expect(db.mediaObject.update).not.toHaveBeenCalled();
  });

  it('respecte le réglage « garder le nom du fichier »', async () => {
    const filenameCtx = {
      ...ctx,
      settings: { media: { naming: 'filename' as const } },
    } as unknown as Parameters<typeof realignMediaNames>[0];
    expect(await realignMediaNames(filenameCtx, 10, 'SH010_comp_v003')).toBe(0);
    expect(db.mediaObject.findMany).not.toHaveBeenCalled();
  });
});
