// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, push } = vi.hoisted(() => ({
  db: {
    shot: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    sequence: { findUnique: vi.fn() },
  },
  push: { enqueuePush: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('./PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: push.enqueuePush }));
vi.mock('../lib/thumbnails', () => ({
  firstMediaThumbKeyForShot: vi.fn(),
  firstMediaThumbKeysForShots: vi.fn(),
  effectiveThumbnailUrl: vi.fn(),
}));

import { update } from './ShotService';

beforeEach(() => {
  vi.clearAllMocks();
  db.shot.update.mockResolvedValue({ id: 7, code: 'SH010' });
});

describe('ShotService.update — écriture vers ShotGrid', () => {
  it('met le statut en file quand il change', async () => {
    // Il ne partait nulle part : le plan changeait d'état dans ReView, le site gardait
    // l'ancien, et la synchronisation suivante ramenait celui du site.
    await update(7, 461, { pipelineStatusId: 42 }, 3);
    expect(push.enqueuePush).toHaveBeenCalledWith(461, {
      type: 'shot-status',
      shotId: 7,
      actorId: 3,
    });
  });

  it('met aussi l’effacement du statut en file', async () => {
    await update(7, 461, { pipelineStatusId: null }, 3);
    expect(push.enqueuePush).toHaveBeenCalledTimes(1);
  });

  it('n’écrit rien vers le site quand le statut n’est pas touché', async () => {
    // Renommer un plan ne doit pas provoquer d'écriture de statut : le site n'a rien
    // demandé, et une écriture inutile fait diverger les horodatages.
    db.shot.findUnique.mockResolvedValue({ code: 'SH010', sequenceId: 1 });
    db.shot.findFirst.mockResolvedValue(null);
    await update(7, 461, { name: 'Rooftop' }, 3);
    expect(push.enqueuePush).not.toHaveBeenCalled();
  });

  it('accepte de ne pas connaître l’auteur — l’écriture part quand même', async () => {
    await update(7, 461, { pipelineStatusId: 42 });
    expect(push.enqueuePush).toHaveBeenCalledWith(461, {
      type: 'shot-status',
      shotId: 7,
      actorId: undefined,
    });
  });
});
