// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Filtre par épisode sur une liste de plans. Le niveau est facultatif : sans filtre, la
 * requête doit être exactement celle d'avant — un long-métrage ne doit rien voir changer,
 * ni dans ses résultats ni dans son plan d'exécution.
 */

const { db, thumbs } = vi.hoisted(() => ({
  db: { shot: { findMany: vi.fn(), count: vi.fn() } },
  thumbs: {
    firstMediaThumbKeysForShots: vi.fn(),
    firstMediaThumbKeyForShot: vi.fn(),
    effectiveThumbnailUrl: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/thumbnails', () => thumbs);
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));

import { episodeWhere, list } from './ShotService';

const page = { page: 1, pageSize: 100, order: 'desc' as const };

beforeEach(() => {
  vi.clearAllMocks();
  db.shot.findMany.mockResolvedValue([]);
  db.shot.count.mockResolvedValue(0);
  thumbs.firstMediaThumbKeysForShots.mockResolvedValue(new Map());
});

describe('episodeWhere', () => {
  it('ne restreint rien sans filtre', () => {
    expect(episodeWhere(undefined)).toEqual({});
  });

  it('traverse la séquence pour un épisode donné', () => {
    // Un plan n'appartient pas à un épisode : c'est sa séquence qui en porte un.
    expect(episodeWhere(4)).toEqual({ sequence: { episodeId: 4 } });
  });

  it('« hors épisode » comprend les plans sans séquence du tout', () => {
    // Ils sont hors épisode par construction : les omettre les rendrait introuvables.
    expect(episodeWhere('none')).toEqual({
      OR: [{ sequenceId: null }, { sequence: { episodeId: null } }],
    });
  });
});

describe('ShotService.list', () => {
  it('laisse la requête intacte quand aucun épisode n’est demandé', async () => {
    await list(3, undefined, page);
    const args = db.shot.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ projectId: 3, deletedAt: null });
    expect(args.where.sequence).toBeUndefined();
    expect(args.where.OR).toBeUndefined();
  });

  it('combine le filtre de séquence et celui d’épisode', async () => {
    await list(3, 12, page, 4);
    const args = db.shot.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ sequenceId: 12, sequence: { episodeId: 4 } });
  });

  it('compte le total avec le même filtre que la page', async () => {
    await list(3, undefined, page, 4);
    const countArgs = db.shot.count.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(countArgs.where).toMatchObject({ projectId: 3, sequence: { episodeId: 4 } });
  });
});
