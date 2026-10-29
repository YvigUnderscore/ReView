// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

/**
 * An image sequence is not published through the two-step DCC path — and it must be said.
 *
 * `SH0100_comp_v003.%04d.exr` passes all the format checks: the extension is `.exr`, hence IMAGE, hence
 * accepted. Without an explicit refusal, the DCC obtains a presigned URL, uploads
 * a frame or nothing at all there, and creates a media named after a pattern — silent, unusable, and
 * discovered days later. This is exactly the fault that the previous wave corrected
 * on extensions announced but not recognised.
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

beforeEach(() => {
  createUpload.mockReset();
  createUpload.mockResolvedValue({ mediaObjectId: 99, uploadUrl: 'https://minio/put', namingWarning: false });
});

describe('PublishFlowService.start: sequence pattern', () => {
  it('refuses an FFmpeg pattern instead of opening an empty media', async () => {
    await expect(start(actor, { ...base, filename: 'SH0100_comp_v003.%04d.exr' })).rejects.toMatchObject({
      code: 'SEQUENCE_NOT_SUPPORTED_HERE',
    });
    expect(createUpload).not.toHaveBeenCalled();
  });

  it('also refuses the hash notation, the one used by DCCs', async () => {
    await expect(start(actor, { ...base, filename: 'SH0100_comp_v003.####.dpx' })).rejects.toMatchObject({
      code: 'SEQUENCE_NOT_SUPPORTED_HERE',
    });
  });

  it('names the route to use instead', async () => {
    await expect(start(actor, { ...base, filename: 'plan.%04d.exr' })).rejects.toThrow(
      /\/api\/media\/sequence\/init/,
    );
  });

  it('lets a single frame through, which is a file like any other', async () => {
    await start(actor, { ...base, filename: 'SH0100_comp_v003.1001.exr' });
    expect(createUpload).toHaveBeenCalledTimes(1);
  });
});
