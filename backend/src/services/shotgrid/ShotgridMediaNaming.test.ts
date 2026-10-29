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
  it('renames an imported media whose name diverges from the code', () => {
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

  it('records the original name on the first rename', async () => {
    db.mediaObject.findMany.mockResolvedValue([
      { id: 1, originalName: 'playblast.mov', mimeType: null, metadata: { importedFromShotgrid: true } },
    ]);
    await realignMediaNames(ctx, 10, 'SH010_comp_v003');
    const call = db.mediaObject.update.mock.calls[0]![0] as { data: { metadata: Record<string, unknown> } };
    expect(call.data.metadata.sourceFilename).toBe('playblast.mov');
  });

  it('writes nothing when the name is already aligned', async () => {
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

  it('never touches a file dropped by hand', async () => {
    // An artist's file name carries information (_lin_, _acescg_, _h265_)
    // that the site's code does not carry over.
    db.mediaObject.findMany.mockResolvedValue([
      { id: 2, originalName: 'wip_acescg.exr', mimeType: 'image/x-exr', metadata: {} },
    ]);
    expect(await realignMediaNames(ctx, 10, 'SH010_comp_v003')).toBe(0);
    expect(db.mediaObject.update).not.toHaveBeenCalled();
  });

  it('respects the "keep the file name" setting', async () => {
    const filenameCtx = {
      ...ctx,
      settings: { media: { naming: 'filename' as const } },
    } as unknown as Parameters<typeof realignMediaNames>[0];
    expect(await realignMediaNames(filenameCtx, 10, 'SH010_comp_v003')).toBe(0);
    expect(db.mediaObject.findMany).not.toHaveBeenCalled();
  });
});
