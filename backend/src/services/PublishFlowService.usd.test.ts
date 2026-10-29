// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

/**
 * Transmission of the USD selection at media creation. Everything touching the database, storage and queues
 * is neutralised: what is verified here is the path of `usd` up to `MediaService.createUpload`, the only
 * write that sets `metadata.usdRequest`.
 */
const createUpload = vi.fn();

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/pipeline', () => ({ resolveProjectIdForVersion: vi.fn() }));
vi.mock('../lib/v1Resources', () => ({
  versionSelect: {},
  mediaSelect: {},
  toVersion: (v: unknown) => v,
  toMedia: (m: unknown) => m,
}));
vi.mock('./MediaService', () => ({ createUpload: (...args: unknown[]) => createUpload(...args) }));
vi.mock('./PipelineEnsureService', () => ({
  ensurePath: vi.fn(async () => ({ taskId: 7, created: ['task'] })),
  ensureVersion: vi.fn(async () => ({ entity: { id: 12, name: 'V01' }, created: true })),
}));
vi.mock('./PipelineResolveService', () => ({ resolveProject: vi.fn(async () => ({ id: 3 })) }));
vi.mock('./VersionService', () => ({}));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));

import { start } from './PublishFlowService';

const actor = { id: 1, role: Role.SUPERVISOR, email: 'td@studio.test' };
const base = { path: 'PROJ/SQ010/SH0100/anim', filename: 'SH0100_set_v001.usd', createMissing: true };

/** What `createUpload` received on the last call. */
const lastUpload = () => createUpload.mock.calls.at(-1)?.[1] as { usdRequest?: unknown };

beforeEach(() => {
  createUpload.mockReset();
  createUpload.mockResolvedValue({ mediaObjectId: 99, uploadUrl: 'https://minio/put', namingWarning: false });
});

describe('PublishFlowService.start: USD selection', () => {
  it('transmits the selection to the created media', async () => {
    const usd = { variants: { '/World/Set': { modelingVariant: 'hero' } }, purpose: 'proxy' as const };
    await start(actor, { ...base, usd });
    expect(lastUpload().usdRequest).toEqual(usd);
  });

  it('sets nothing when the client asks for nothing — the conversion keeps its default values', async () => {
    await start(actor, base);
    expect(lastUpload().usdRequest).toBeUndefined();
  });

  it('refuses the selection on a media that will never be converted to USD', async () => {
    await expect(
      start(actor, { ...base, filename: 'SH0100_anim_v001.mov', usd: { variants: {}, purpose: 'render' } }),
    ).rejects.toMatchObject({ code: 'USD_NOT_3D' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it("lets through a selection whose variantSets may not exist", async () => {
    // At publication, the scene has not yet been analysed: filtering here is impossible. Filtering takes
    // place at conversion (`sanitizeVariantSelection`), not before.
    const usd = { variants: { '/Nowhere': { inventé: 'jamais' } }, purpose: 'render' as const };
    await start(actor, { ...base, usd });
    expect(lastUpload().usdRequest).toEqual(usd);
  });
});
