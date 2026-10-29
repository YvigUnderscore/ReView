// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaKind, Role } from '@prisma/client';

/**
 * Refusal of unreadable formats **before** the transfer.
 *
 * The defect corrected here is the costliest of ingestion: the extension table announced EXR, DPX, TIFF, TGA,
 * MXF and AVI, header validation did not know them, and the check only took place at finalization — that is,
 * after the full transfer of the master. Two guarantees are verified: what is announced passes, and what is
 * not readable is refused at the first call, without a single byte having left the artist's workstation.
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
  ensureVersion: vi.fn(async () => ({ entity: { id: 12, name: 'V01' }, created: false })),
}));
vi.mock('./PipelineResolveService', () => ({ resolveProject: vi.fn(async () => ({ id: 3 })) }));
vi.mock('./VersionService', () => ({}));
vi.mock('./ApiEventService', () => ({ publish: vi.fn() }));

import { start } from './PublishFlowService';

const actor = { id: 1, role: Role.SUPERVISOR, email: 'td@studio.test' };
const base = { path: 'PROJ/SQ010/SH0100/comp', createMissing: true };

/** Media type retained by `start` on the last call. */
const lastKind = () => (createUpload.mock.calls.at(-1)?.[1] as { kind: MediaKind }).kind;

beforeEach(() => {
  createUpload.mockReset();
  createUpload.mockResolvedValue({ mediaObjectId: 99, uploadUrl: 'https://minio/put', namingWarning: false });
});

describe('PublishFlowService.start: formats really delivered in VFX', () => {
  it('opens the publication of an EXR render', async () => {
    await start(actor, { ...base, filename: 'SH0100_comp_v012.exr' });
    expect(lastKind()).toBe(MediaKind.IMAGE);
  });

  it('opens the publication of a DPX plate and a TGA matte', async () => {
    await start(actor, { ...base, filename: 'SH0100_plate_v001.dpx' });
    expect(lastKind()).toBe(MediaKind.IMAGE);
    await start(actor, { ...base, filename: 'SH0100_matte_v001.tga' });
    expect(lastKind()).toBe(MediaKind.IMAGE);
  });

  it('opens the publication of an MXF master and an AVI', async () => {
    await start(actor, { ...base, filename: 'SH0100_master_v003.mxf' });
    expect(lastKind()).toBe(MediaKind.VIDEO);
    await start(actor, { ...base, filename: 'SH0100_ref_v001.avi' });
    expect(lastKind()).toBe(MediaKind.VIDEO);
  });

  it('refuses an unreadable format before any transfer, naming what is accepted', async () => {
    await expect(start(actor, { ...base, filename: 'SH0100_comp_v012.psd' })).rejects.toMatchObject({
      code: 'KIND_UNKNOWN',
    });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('also refuses when the client imposes a "kind" that the extension cannot honour', async () => {
    await expect(
      start(actor, { ...base, filename: 'notes.txt', kind: MediaKind.IMAGE }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('refuses an EXR declared as VIDEO: header validation would reject it afterwards', async () => {
    await expect(
      start(actor, { ...base, filename: 'SH0100_comp_v012.exr', kind: MediaKind.VIDEO }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('the error message enumerates the extensions admitted for this type', async () => {
    await expect(start(actor, { ...base, filename: 'cache.abc', kind: MediaKind.MODEL_3D })).rejects.toThrow(
      /\.glb/,
    );
  });
});
