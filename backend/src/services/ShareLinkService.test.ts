// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    playlist: { findFirst: vi.fn() },
    version: { findFirst: vi.fn() },
    mediaObject: { findMany: vi.fn() },
  },
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));

import { ShareScope } from '@prisma/client';
import { candidateLocation, resolveScope, SHARE_SELECTION_LIMIT } from './ShareLinkService';
import { prisma } from '../lib/prisma';

/**
 * `resolveScope` is the last place where a link can be prevented from pointing outside its project.
 * Everything that passes here is then written as is to the database and serves as the read scope for
 * an unknown holder of a token: these refusals are the feature.
 */
beforeEach(() => vi.clearAllMocks());

describe('resolveScope: the target belongs to the project, or nothing', () => {
  it('reduces the "project" scope to a form without a target', async () => {
    await expect(resolveScope(7, {})).resolves.toEqual({
      scope: ShareScope.PROJECT,
      playlistId: null,
      versionId: null,
      mediaIds: [],
    });
  });

  it('accepts a playlist of the project', async () => {
    vi.mocked(prisma.playlist.findFirst).mockResolvedValue({ id: 3 } as never);
    await expect(resolveScope(7, { scope: ShareScope.PLAYLIST, playlistId: 3 })).resolves.toMatchObject({
      scope: ShareScope.PLAYLIST,
      playlistId: 3,
    });
    expect(vi.mocked(prisma.playlist.findFirst).mock.calls[0]?.[0]).toMatchObject({
      where: { id: 3, projectId: 7 },
    });
  });

  it("refuses a playlist of another project", async () => {
    vi.mocked(prisma.playlist.findFirst).mockResolvedValue(null);
    await expect(resolveScope(7, { scope: ShareScope.PLAYLIST, playlistId: 3 })).rejects.toMatchObject({
      code: 'SCOPE_TARGET_FOREIGN',
    });
  });

  it('refuses a restricted scope without a target', async () => {
    await expect(resolveScope(7, { scope: ShareScope.PLAYLIST })).rejects.toMatchObject({
      code: 'SCOPE_TARGET_MISSING',
    });
    await expect(resolveScope(7, { scope: ShareScope.VERSION })).rejects.toMatchObject({
      code: 'SCOPE_TARGET_MISSING',
    });
    await expect(resolveScope(7, { scope: ShareScope.MEDIA, mediaIds: [] })).rejects.toMatchObject({
      code: 'SCOPE_TARGET_MISSING',
    });
  });

  it('accepts a version of the project, whatever its attachment', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue({ id: 42 } as never);
    await expect(resolveScope(7, { scope: ShareScope.VERSION, versionId: 42 })).resolves.toMatchObject({
      scope: ShareScope.VERSION,
      versionId: 42,
    });
    const where = vi.mocked(prisma.version.findFirst).mock.calls[0]?.[0]?.where as { OR: unknown[] };
    expect(where.OR).toHaveLength(3);
  });

  it('de-duplicates the selection and keeps only the published media of the project', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([{ id: 11 }, { id: 12 }] as never);
    await expect(resolveScope(7, { scope: ShareScope.MEDIA, mediaIds: [11, 12, 11] })).resolves.toMatchObject(
      { scope: ShareScope.MEDIA, mediaIds: [11, 12] },
    );
  });

    // A requested but unpublished media would become visible on the day it is published, without
    // anyone having decided so: we refuse the creation rather than silently ignoring it.
  it('refuses the selection if a media is not shareable', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([{ id: 11 }] as never);
    await expect(resolveScope(7, { scope: ShareScope.MEDIA, mediaIds: [11, 99] })).rejects.toMatchObject({
      code: 'SCOPE_TARGET_FOREIGN',
    });
  });

  it('refuses a selection that is no longer one', async () => {
    const tooMany = Array.from({ length: SHARE_SELECTION_LIMIT + 1 }, (_, i) => i + 1);
    await expect(resolveScope(7, { scope: ShareScope.MEDIA, mediaIds: tooMany })).rejects.toMatchObject({
      code: 'SCOPE_SELECTION_TOO_LARGE',
    });
    expect(prisma.mediaObject.findMany).not.toHaveBeenCalled();
  });
});

describe('candidateLocation: recognizing a media at a glance in the picker', () => {
  it('prefers the shot and its step', () => {
    expect(
      candidateLocation({
        name: 'V03',
        task: { name: 'comp', shot: { code: 'SH020' }, asset: null },
        asset: null,
      }),
    ).toBe('SH020 › comp');
  });

  it("falls back to the asset carrying the task", () => {
    expect(
      candidateLocation({
        name: 'V01',
        task: { name: 'lookdev', shot: null, asset: { name: 'Robot' } },
        asset: null,
      }),
    ).toBe('Robot › lookdev');
  });

  it("names the asset when the version hangs directly from it", () => {
    expect(candidateLocation({ name: 'V01', task: null, asset: { name: 'Robot' } })).toBe('Robot');
  });

  it('falls back to the version name when nothing locates it', () => {
    expect(candidateLocation({ name: 'V07', task: null, asset: null })).toBe('V07');
  });
});
