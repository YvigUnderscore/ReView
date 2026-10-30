// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: { version: { findMany: vi.fn() } } }));
vi.mock('../lib/storage', () => ({
  storage: { getPresignedGetUrl: vi.fn(async (k: string) => `https://minio/${k}`) },
}));

import { list } from './PlaylistCandidateService';
import { prisma } from '../lib/prisma';

const version = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'SH010_comp_v003',
  createdAt: new Date('2026-08-01T10:00:00Z'),
  taskId: 50,
  reviewStatus: null,
  task: {
    name: 'comp',
    department: 'compositing',
    shot: { code: 'SH010', sequenceId: 3, sequence: { code: 'SQ010' } },
    asset: null,
  },
  asset: null,
  media: [],
  ...over,
});

const whereOf = () => vi.mocked(prisma.version.findMany).mock.calls[0]![0]!.where as Record<string, unknown>;

beforeEach(() => vi.clearAllMocks());

describe('list', () => {
  it('composes a readable location from the sequence, the shot and the task', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([version()] as never);
    const [c] = await list(1, 9);
    expect(c).toMatchObject({
      location: 'SQ010 · SH010 › comp',
      sequenceId: 3,
      department: 'compositing',
    });
  });

  it('also names what hangs from an asset, by the task or directly', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([
      version({ task: { name: 'lookdev', department: null, shot: null, asset: { name: 'Ship' } } }),
      version({ id: 2, taskId: null, task: null, asset: { name: 'Ship' } }),
    ] as never);
    const found = await list(1, 9);
    expect(found.map((c) => c.location)).toEqual(['Ship › lookdev', 'Ship']);
  });

  it('signs the thumbnail of the first visible media, and returns null when there is none', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([
      version({ media: [{ id: 8, kind: 'VIDEO', originalName: 'a.mov', thumbnailKey: 'derived/8.webp' }] }),
      version({ id: 2, media: [] }),
    ] as never);
    const found = await list(1, 9);
    expect(found[0]?.media?.thumbnailUrl).toBe('https://minio/derived/8.webp');
    expect(found[1]?.media).toBeNull();
  });

  it('only shows the media the requester is entitled to see', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([] as never);
    await list(1, 42);
    const select = vi.mocked(prisma.version.findMany).mock.calls[0]![0]!.select as {
      media: { where: unknown };
    };
    expect(select.media.where).toMatchObject({
      deletedAt: null,
      status: 'READY',
      OR: [{ published: true }, { uploaderId: 42 }],
    });
  });

  it('searches the text on the version, the task, the shot and the asset', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([] as never);
    await list(1, 9, { q: 'roof' });
    const and = whereOf().AND as { OR?: unknown[] }[];
    expect(and[1]?.OR).toHaveLength(5);
  });

  it('distinguishes "outside any sequence" from a specific sequence', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([] as never);
    await list(1, 9, { sequenceId: 'none' });
    expect((whereOf().AND as unknown[])[1]).toEqual({ task: { shot: { sequenceId: null } } });
    vi.clearAllMocks();
    vi.mocked(prisma.version.findMany).mockResolvedValue([] as never);
    await list(1, 9, { sequenceId: 7 });
    expect((whereOf().AND as unknown[])[1]).toEqual({ task: { shot: { sequenceId: 7 } } });
  });

  it('keeps only the latest version per task when asked to', async () => {
    // The query is already sorted from most recent to oldest.
    vi.mocked(prisma.version.findMany).mockResolvedValue([
      version({ id: 3, taskId: 50 }),
      version({ id: 2, taskId: 50 }),
      version({ id: 1, taskId: 51 }),
    ] as never);
    const found = await list(1, 9, { latestOnly: true });
    expect(found.map((c) => c.versionId)).toEqual([3, 1]);
  });

  it('always keeps the versions attached directly to an asset', async () => {
    // They have no task: de-duplicating them by task would make them all disappear except one, although they
    // have nothing to do with one another.
    vi.mocked(prisma.version.findMany).mockResolvedValue([
      version({ id: 3, taskId: null, task: null, asset: { name: 'Ship' } }),
      version({ id: 2, taskId: null, task: null, asset: { name: 'Dock' } }),
    ] as never);
    const found = await list(1, 9, { latestOnly: true });
    expect(found.map((c) => c.versionId)).toEqual([3, 2]);
  });

  it('bounds the number of results returned', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => version({ id: i + 1, taskId: i + 1 })) as never,
    );
    expect(await list(1, 9, { limit: 3 })).toHaveLength(3);
  });
});
