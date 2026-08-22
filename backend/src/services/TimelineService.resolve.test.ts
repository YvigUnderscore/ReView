// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, latest } = vi.hoisted(() => ({
  db: {
    timeline: { findUnique: vi.fn() },
    shot: { findMany: vi.fn() },
    timelineSnapshot: { findFirst: vi.fn(), findMany: vi.fn() },
  },
  latest: { latestForShots: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./PipelineLatestService', () => latest);
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./StorageService', () => ({
  storage: {
    getPresignedGetUrl: vi.fn((k: string) => Promise.resolve(`url:${k}`)),
    statObject: vi.fn(),
  },
}));
vi.mock('./JobService', () => ({
  enqueueTimelineExport: vi.fn(),
  timelineExportJobId: vi.fn(),
  timelineExportQueue: { getJob: vi.fn() },
}));
vi.mock('../lib/projectSettings', () => ({
  resolveProjectSettingsById: vi.fn().mockResolvedValue({
    framerate: 25,
    resolution: { width: 1920, height: 1080 },
    departments: [{ key: 'comp', name: 'Compositing' }],
  }),
}));

import { resolve, listSnapshots } from './TimelineService';

/** Un plan tel que la requête bornée le rend (les champs de `shotSelect`). */
const shot = (
  id: number,
  code: string,
  order = 0,
  sequence: unknown = { id: 1, code: 'SQ01', order: 0 },
) => ({
  id,
  code,
  name: code,
  startFrame: 1001,
  endFrame: 1024,
  order,
  sequenceId: sequence ? 1 : null,
  sequence,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.timeline.findUnique.mockResolvedValue({
    id: 5,
    projectId: 3,
    sequenceId: null,
    department: null,
    name: null,
    updatedAt: new Date('2026-08-21T00:00:00.000Z'),
    sequence: null,
  });
  db.shot.findMany.mockResolvedValue([]);
  db.timelineSnapshot.findFirst.mockResolvedValue(null);
  latest.latestForShots.mockResolvedValue(new Map());
});

describe('TimelineService.resolve — plans du montage', () => {
  it('borne la requête et la trie côté base', async () => {
    // La requête chargeait TOUS les plans du projet avant de trier en mémoire. Sans
    // `orderBy`, un plafond couperait dans un ensemble arbitraire et le montage
    // changerait d'un rafraîchissement à l'autre.
    await resolve(5);
    expect(db.shot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5000,
        orderBy: [
          { sequence: { order: 'asc' } },
          { sequence: { code: 'asc' } },
          { order: 'asc' },
          { code: 'asc' },
          { id: 'asc' },
        ],
      }),
    );
  });

  it('garde les plans omis et supprimés hors du montage', async () => {
    await resolve(5);
    const args = db.shot.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ projectId: 3, deletedAt: null, omitted: false });
  });

  it('conserve le départage naturel des codes, que SQL ne sait pas faire', async () => {
    // « SH2 » doit rester avant « SH10 » : c'est le tri en mémoire qui l'assure, et il
    // reste le juge final après le tri SQL.
    db.shot.findMany.mockResolvedValue([shot(1, 'SH10'), shot(2, 'SH2')]);
    const view = await resolve(5);
    expect(view.items.map((i) => i.shotCode)).toEqual(['SH2', 'SH10']);
  });

  it('range les plans hors séquence en fin de montage', async () => {
    db.shot.findMany.mockResolvedValue([shot(1, 'SH99', 0, null), shot(2, 'SH01')]);
    const view = await resolve(5);
    expect(view.items.map((i) => i.shotCode)).toEqual(['SH01', 'SH99']);
  });

  it('signale la troncature au lieu de la taire', async () => {
    expect((await resolve(5)).truncated).toBe(false);
    db.shot.findMany.mockResolvedValue(
      new Array(5000).fill(null).map((_, i) => shot(i + 1, `SH${String(i).padStart(4, '0')}`)),
    );
    expect((await resolve(5)).truncated).toBe(true);
  });
});

describe('TimelineService.listSnapshots', () => {
  it('borne la liste sans perdre les révisions récentes', async () => {
    db.timelineSnapshot.findMany.mockResolvedValue([]);
    await listSnapshots(5);
    expect(db.timelineSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { revision: 'desc' }, take: 200 }),
    );
  });
});
