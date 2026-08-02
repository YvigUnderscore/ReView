// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { mediaObject: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('./MediaService', () => ({ assertMediaManage: vi.fn() }));
vi.mock('./JobService', () => ({ enqueueMediaJob: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));

import { recomposeUsd } from './UsdRecomposeService';
import { prisma } from '../lib/prisma';
import { enqueueMediaJob } from './JobService';

const USER = { id: 5, role: 'ADMIN' as never };

/** Média 3D USD prêt, exposant un variantSet à deux options. */
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
  it('mémorise la sélection filtrée et enfile une conversion', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia() as never);

    const res = await recomposeUsd(USER, 1, {
      variants: { '/World/Asset': { modelingVariant: 'lo', inconnu: 'x' } },
      purpose: 'proxy',
    });

    expect(res.selection).toEqual({
      variants: { '/World/Asset': { modelingVariant: 'lo' } },
      purpose: 'proxy',
    });
    // La demande vit dans les métadonnées : elle survit aux retries BullMQ et aux reprocess.
    const update = vi.mocked(prisma.mediaObject.update).mock.calls[0]![0];
    expect((update.data.metadata as Record<string, unknown>).usdRequest).toEqual(res.selection);
    expect(update.data.status).toBe('PROCESSING');
    expect(enqueueMediaJob).toHaveBeenCalledWith({ mediaObjectId: 1, kind: 'convert3d' });
  });

  it('ignore une variante inventée par le client', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia() as never);

    const res = await recomposeUsd(USER, 1, {
      variants: { '/World/Asset': { modelingVariant: 'variante_pirate' } },
      purpose: 'render',
    });

    expect(res.selection.variants).toEqual({});
  });

  it('refuse un média publié (verrou de publication Phase 11)', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia({ published: true }) as never);

    await expect(recomposeUsd(USER, 1, { variants: {}, purpose: 'render' })).rejects.toMatchObject({
      code: 'PUBLISHED_LOCKED',
    });
    expect(enqueueMediaJob).not.toHaveBeenCalled();
  });

  it('refuse un média non 3D et un média sans description USD', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia({ kind: 'VIDEO' }) as never);
    await expect(recomposeUsd(USER, 1, { variants: {}, purpose: 'render' })).rejects.toMatchObject({
      code: 'NOT_3D',
    });

    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia({ metadata: {} }) as never);
    await expect(recomposeUsd(USER, 1, { variants: {}, purpose: 'render' })).rejects.toMatchObject({
      code: 'NOT_USD',
    });
  });

  it('refuse un upload non finalisé', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(usdMedia({ status: 'UPLOADING' }) as never);
    await expect(recomposeUsd(USER, 1, { variants: {}, purpose: 'render' })).rejects.toMatchObject({
      code: 'NOT_FINALIZED',
    });
  });
});
