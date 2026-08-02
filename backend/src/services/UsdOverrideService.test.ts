// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { mediaObject: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('./MediaService', () => ({ assertMediaManage: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));

import { setSceneOverride } from './UsdOverrideService';
import { prisma } from '../lib/prisma';
import type { SceneOverride } from '../lib/sceneOverride';

const USER = { id: 5, role: 'ADMIN' as never };

const media = (over: Record<string, unknown> = {}) => ({
  id: 1,
  kind: 'MODEL_3D',
  published: false,
  status: 'READY',
  metadata: { model: { converter: 'blender' } },
  ...over,
});

const override: SceneOverride = {
  version: 1,
  prims: { '/World/Asset': { visible: false } },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mediaObject.update).mockResolvedValue({} as never);
});

describe('setSceneOverride (46.D)', () => {
  it('enregistre l’override sans toucher aux autres métadonnées', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media() as never);

    const res = await setSceneOverride(USER, 1, override);

    expect(res.usdOverride).toEqual(override);
    const data = vi.mocked(prisma.mediaObject.update).mock.calls[0]![0].data as {
      metadata: Record<string, unknown>;
    };
    expect(data.metadata.usdOverride).toEqual(override);
    expect(data.metadata.model).toEqual({ converter: 'blender' });
  });

  it('stocke un override sans effet comme absent', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media() as never);

    const res = await setSceneOverride(USER, 1, { version: 1, prims: {} });

    expect(res.usdOverride).toBeNull();
  });

  it('efface l’override sur null', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ metadata: { usdOverride: override } }) as never,
    );
    expect((await setSceneOverride(USER, 1, null)).usdOverride).toBeNull();
  });

  it('refuse un média publié : l’override est figé à la publication', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media({ published: true }) as never);

    await expect(setSceneOverride(USER, 1, override)).rejects.toMatchObject({
      code: 'PUBLISHED_LOCKED',
    });
    expect(prisma.mediaObject.update).not.toHaveBeenCalled();
  });

  it('refuse un média non 3D et un upload non finalisé', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media({ kind: 'VIDEO' }) as never);
    await expect(setSceneOverride(USER, 1, override)).rejects.toMatchObject({ code: 'NOT_3D' });

    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media({ status: 'UPLOADING' }) as never);
    await expect(setSceneOverride(USER, 1, override)).rejects.toMatchObject({
      code: 'NOT_FINALIZED',
    });
  });
});
