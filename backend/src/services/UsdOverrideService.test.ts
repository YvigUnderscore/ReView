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
  it('records the override without touching the other metadata', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media() as never);

    const res = await setSceneOverride(USER, 1, override);

    expect(res.usdOverride).toEqual(override);
    const data = vi.mocked(prisma.mediaObject.update).mock.calls[0]![0].data as {
      metadata: Record<string, unknown>;
    };
    expect(data.metadata.usdOverride).toEqual(override);
    expect(data.metadata.model).toEqual({ converter: 'blender' });
  });

  it('stores an override with no effect as absent', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media() as never);

    const res = await setSceneOverride(USER, 1, { version: 1, prims: {} });

    expect(res.usdOverride).toBeNull();
  });

  it('clears the override on null', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ metadata: { usdOverride: override } }) as never,
    );
    expect((await setSceneOverride(USER, 1, null)).usdOverride).toBeNull();
  });

    /**
     * This test expected a 403: the override was frozen by publication (Phase 11). The rule has changed deliberately (Phase 50, table in `lib/publishLock`) — the override is a
     * staging replayed at load time, of the same nature as `splatPresentation`, which was already exempted. The media being published from its upload, keeping it frozen would have
     * forbidden putting a scene in a state to be watched. The test therefore checks the opposite, explicitly.
     */
  it('accepts a published media: the override is a staging, not the delivery', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media({ published: true }) as never);

    expect((await setSceneOverride(USER, 1, override)).usdOverride).toEqual(override);
    expect(prisma.mediaObject.update).toHaveBeenCalled();
  });

  it('refuses a non-3D media and an unfinalized upload', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media({ kind: 'VIDEO' }) as never);
    await expect(setSceneOverride(USER, 1, override)).rejects.toMatchObject({ code: 'NOT_3D' });

    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media({ status: 'UPLOADING' }) as never);
    await expect(setSceneOverride(USER, 1, override)).rejects.toMatchObject({
      code: 'NOT_FINALIZED',
    });
  });
});
