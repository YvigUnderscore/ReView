// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, thumbs } = vi.hoisted(() => ({
  db: {
    shot: { findMany: vi.fn(), count: vi.fn() },
  },
  thumbs: {
    firstMediaThumbKeysForShots: vi.fn(),
    effectiveThumbnailUrl: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('./PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('../lib/thumbnails', () => ({
  firstMediaThumbKeyForShot: vi.fn(),
  firstMediaThumbKeysForShots: thumbs.firstMediaThumbKeysForShots,
  effectiveThumbnailUrl: thumbs.effectiveThumbnailUrl,
}));

import { list } from './ShotService';

const page = { page: 1, pageSize: 100, order: 'desc' as const };

beforeEach(() => {
  vi.clearAllMocks();
  db.shot.findMany.mockResolvedValue([
    {
      id: 7,
      code: 'SH010',
      thumbnailKey: null,
      departments: [{ id: 3, key: 'comp', name: 'Compositing', color: null }],
    },
  ]);
  db.shot.count.mockResolvedValue(1);
  thumbs.firstMediaThumbKeysForShots.mockResolvedValue(new Map());
  thumbs.effectiveThumbnailUrl.mockResolvedValue(null);
});

describe('ShotService.list — étapes traversées', () => {
  it('demande les départements de chaque plan', async () => {
    // Le filtre par département de l'onglet Shots compare les étapes que le plan traverse.
    // La liste ne les renvoyait pas — seule la fiche le faisait — et choisir un
    // département vidait l'écran : aucune carte n'avait d'étape à comparer.
    await list(461, undefined, page);
    expect(db.shot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          departments: {
            select: { id: true, key: true, name: true, color: true },
            orderBy: { order: 'asc' },
          },
        }),
      }),
    );
  });

  it('laisse les départements intacts dans la réponse', async () => {
    const { items } = await list(461, undefined, page);
    expect(items[0]).toMatchObject({ departments: [{ id: 3, name: 'Compositing' }] });
  });
});
