// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { mediaObject: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('./MediaService', () => ({ assertMediaManage: vi.fn() }));
vi.mock('../lib/queues', () => ({ enqueueMediaJob: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));

import { recomposeUsd } from './UsdRecomposeService';
import { prisma } from '../lib/prisma';
import { enqueueMediaJob } from '../lib/queues';

const USER = { id: 5, role: 'ADMIN' as never };

/** Ready USD 3D media, exposing a variantSet with two options. */
const usdMedia = (over: Record<string, unknown> = {}) => ({
  id: 1,
  kind: 'MODEL_3D',
  published: false,
  status: 'READY',
  metadata: {
    model: {
      converter: 'blender',
      usd: {
        rootLayer: 'scene.usda',
        variantSets: [
          { prim: '/World/Asset', name: 'modelingVariant', options: ['hero', 'lo'], selected: 'hero' },
        ],
      },
    },
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mediaObject.update).mockResolvedValue({} as never);
});

describe('recomposeUsd (45.E)', () => {
  it('records the filtered selection and queues a conversion', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia() as never);

    const res = await recomposeUsd(USER, 1, {
      variants: { '/World/Asset': { modelingVariant: 'lo', inconnu: 'x' } },
      purpose: 'proxy',
    });

    expect(res.selection).toEqual({
      variants: { '/World/Asset': { modelingVariant: 'lo' } },
      purpose: 'proxy',
    });
    // The request lives in the metadata: it survives BullMQ retries and reprocess runs.
    const update = vi.mocked(prisma.mediaObject.update).mock.calls[0]![0];
    expect((update.data.metadata as Record<string, unknown>).usdRequest).toEqual(res.selection);
    expect(update.data.status).toBe('PROCESSING');
    expect(enqueueMediaJob).toHaveBeenCalledWith({ mediaObjectId: 1, kind: 'convert3d' });
  });

  it('ignores a variant invented by the client', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia() as never);

    const res = await recomposeUsd(USER, 1, {
      variants: { '/World/Asset': { modelingVariant: 'variante_pirate' } },
      purpose: 'render',
    });

    expect(res.selection.variants).toEqual({});
  });

  /**
   * This test expected a 403 (Phase 11 lock). The rule changed deliberately in Phase 50: recomposition does not replace the delivered file, it derives a readable representation from it —
   * and since the media is published from upload, refusing it after publication amounted to refusing it outright, whereas it is the gesture that makes a USD scene viewable.
   */
  it('accepts a published media: recomposing derives a representation, without touching the file', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia({ published: true }) as never);

    const res = await recomposeUsd(USER, 1, { variants: {}, purpose: 'render' });

    expect(res.requeued).toBe(true);
    expect(enqueueMediaJob).toHaveBeenCalledWith({ mediaObjectId: 1, kind: 'convert3d' });
  });

  it('refuses a non-3D media and a media without a USD description', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia({ kind: 'VIDEO' }) as never);
    await expect(recomposeUsd(USER, 1, { variants: {}, purpose: 'render' })).rejects.toMatchObject({
      code: 'NOT_3D',
    });

    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia({ metadata: {} }) as never);
    await expect(recomposeUsd(USER, 1, { variants: {}, purpose: 'render' })).rejects.toMatchObject({
      code: 'NOT_USD',
    });
  });

  it('refuses an unfinalized upload', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia({ status: 'UPLOADING' }) as never);
    await expect(recomposeUsd(USER, 1, { variants: {}, purpose: 'render' })).rejects.toMatchObject({
      code: 'NOT_FINALIZED',
    });
  });
});
