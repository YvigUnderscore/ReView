// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: { version: { findMany: vi.fn() } } }));
vi.mock('./StorageService', () => ({
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
  it('compose une localisation lisible depuis la séquence, le plan et la tâche', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([version()] as never);
    const [c] = await list(1, 9);
    expect(c).toMatchObject({
      location: 'SQ010 · SH010 › comp',
      sequenceId: 3,
      department: 'compositing',
    });
  });

  it('nomme aussi ce qui pend d’un asset, par la tâche ou en direct', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([
      version({ task: { name: 'lookdev', department: null, shot: null, asset: { name: 'Ship' } } }),
      version({ id: 2, taskId: null, task: null, asset: { name: 'Ship' } }),
    ] as never);
    const found = await list(1, 9);
    expect(found.map((c) => c.location)).toEqual(['Ship › lookdev', 'Ship']);
  });

  it('signe la vignette du premier média visible, et rend null quand il n’y en a pas', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([
      version({ media: [{ id: 8, kind: 'VIDEO', originalName: 'a.mov', thumbnailKey: 'derived/8.webp' }] }),
      version({ id: 2, media: [] }),
    ] as never);
    const found = await list(1, 9);
    expect(found[0]?.media?.thumbnailUrl).toBe('https://minio/derived/8.webp');
    expect(found[1]?.media).toBeNull();
  });

  it('ne montre que les médias que le demandeur a le droit de voir', async () => {
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

  it('cherche le texte sur la version, la tâche, le plan et l’asset', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([] as never);
    await list(1, 9, { q: 'roof' });
    const and = whereOf().AND as { OR?: unknown[] }[];
    expect(and[1]?.OR).toHaveLength(5);
  });

  it('distingue « hors séquence » d’une séquence précise', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([] as never);
    await list(1, 9, { sequenceId: 'none' });
    expect((whereOf().AND as unknown[])[1]).toEqual({ task: { shot: { sequenceId: null } } });
    vi.clearAllMocks();
    vi.mocked(prisma.version.findMany).mockResolvedValue([] as never);
    await list(1, 9, { sequenceId: 7 });
    expect((whereOf().AND as unknown[])[1]).toEqual({ task: { shot: { sequenceId: 7 } } });
  });

  it('ne garde que la dernière version par tâche quand on le demande', async () => {
    // La requête est déjà triée du plus récent au plus ancien.
    vi.mocked(prisma.version.findMany).mockResolvedValue([
      version({ id: 3, taskId: 50 }),
      version({ id: 2, taskId: 50 }),
      version({ id: 1, taskId: 51 }),
    ] as never);
    const found = await list(1, 9, { latestOnly: true });
    expect(found.map((c) => c.versionId)).toEqual([3, 1]);
  });

  it('garde toujours les versions rattachées directement à un asset', async () => {
    // Elles n'ont pas de tâche : les dédupliquer par tâche les ferait toutes disparaître
    // sauf une, alors qu'elles n'ont rien à voir entre elles.
    vi.mocked(prisma.version.findMany).mockResolvedValue([
      version({ id: 3, taskId: null, task: null, asset: { name: 'Ship' } }),
      version({ id: 2, taskId: null, task: null, asset: { name: 'Dock' } }),
    ] as never);
    const found = await list(1, 9, { latestOnly: true });
    expect(found.map((c) => c.versionId)).toEqual([3, 2]);
  });

  it('borne le nombre de résultats rendus', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => version({ id: i + 1, taskId: i + 1 })) as never,
    );
    expect(await list(1, 9, { limit: 3 })).toHaveLength(3);
  });
});
